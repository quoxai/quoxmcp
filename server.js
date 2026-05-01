#!/usr/bin/env node
/**
 * QuoxMCP Server — AI Infrastructure Engine
 *
 * MCP (Model Context Protocol) server that bridges Claude CLI to QuoxCORE
 * infrastructure tools. Spawned as a STDIO subprocess by Claude CLI via
 * --mcp-config flag.
 *
 * All tool execution calls back to the QuoxCORE collector API.
 * QuoxMCP is a thin protocol adapter — no tool logic lives here.
 *
 * Environment variables (set via MCP config):
 *   QUOX_AGENT_ID       - Agent identity for RBAC (quox, sentinel, etc.)
 *   QUOX_SESSION_ID     - Session identifier for context
 *   QUOX_COLLECTOR_URL  - Collector API base URL (http://127.0.0.1:9848)
 */

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CollectorClient } = require('./lib/collector-client');
const { registerTools } = require('./lib/tool-adapter');
const { registerResources } = require('./lib/resource-adapter');
const { registerPrompts } = require('./lib/prompt-adapter');
const { isValidId, validateUrl, sanitizeError } = require('./lib/validate');

const agentId = process.env.QUOX_AGENT_ID || 'quox';
const rawSessionId = process.env.QUOX_SESSION_ID || '';
const collectorUrl = process.env.QUOX_COLLECTOR_URL || 'http://127.0.0.1:9848';
const serviceKey = process.env.QUOX_SERVICE_KEY || process.env.INTERNAL_SERVICE_KEY || '';
const orgId = process.env.QUOX_ORG_ID || '';
const userId = process.env.QUOX_USER_ID || '';
const authToken = process.env.QUOX_AUTH_TOKEN || '';

// Stable session ID: use provided value or generate a UUID for this process lifetime
const sessionId = rawSessionId || (() => {
  const generated = crypto.randomUUID();
  console.error(`[QuoxMCP] Generated session_id: ${generated}`);
  return generated;
})();

// --- Startup validation ---
if (!serviceKey) {
  console.error('[QuoxMCP] FATAL: No service key configured. Set QUOX_SERVICE_KEY or INTERNAL_SERVICE_KEY.');
  console.error('[QuoxMCP] Refusing to start without authentication.');
  process.exit(1);
}

if (!orgId) {
  console.error('[QuoxMCP] FATAL: QUOX_ORG_ID is required. Set it via the org_id field in your MCP config.');
  console.error('[QuoxMCP] Find your org ID in your QuoxCORE dashboard profile.');
  process.exit(1);
}

if (!userId) {
  console.error('[QuoxMCP] FATAL: QUOX_USER_ID is required. Set it via the user_id field in your MCP config.');
  console.error('[QuoxMCP] Find your user ID in your QuoxCORE dashboard profile.');
  process.exit(1);
}

if (!isValidId(agentId)) {
  console.error(`[QuoxMCP] FATAL: Invalid QUOX_AGENT_ID: "${agentId}". Must be alphanumeric/dash/underscore, max 64 chars.`);
  process.exit(1);
}

if (rawSessionId && !isValidId(rawSessionId)) {
  console.error('[QuoxMCP] FATAL: Invalid QUOX_SESSION_ID. Must be alphanumeric/dash/underscore, max 64 chars.');
  process.exit(1);
}

const urlCheck = validateUrl(collectorUrl);
if (!urlCheck.valid) {
  console.error(`[QuoxMCP] FATAL: Invalid collector URL. Must be a valid http/https URL.`);
  process.exit(1);
}
if (urlCheck.warning) {
  console.error(`[QuoxMCP] WARNING: ${urlCheck.warning}`);
}

// --- Process-level error handlers ---
process.on('unhandledRejection', (err) => {
  console.error('[QuoxMCP] Unhandled rejection:', err);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('[QuoxMCP] Uncaught exception:', err);
  process.exit(1);
});

// Prevent zombie processes when Claude Desktop force-quits
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
});

async function main() {
  // Log to stderr (stdout is reserved for MCP STDIO protocol)
  console.error(`[QuoxMCP] Starting — agent=${agentId}, collector=${collectorUrl}`);
  console.error(`[QuoxMCP] Tenant: org=${orgId}, user=${userId}, session=${sessionId}`);

  const server = new McpServer({
    name: 'quoxmcp',
    version: '1.2.0'
  });

  const client = new CollectorClient(collectorUrl, { serviceKey });

  // Fetch available tools for this agent from the collector
  let tools;
  try {
    const data = await client.listTools(agentId);
    tools = data.tools || [];
    console.error(`[QuoxMCP] Fetched ${tools.length} tools for agent ${agentId}`);
  } catch (err) {
    console.error(`[QuoxMCP] Failed to fetch tools from collector: ${sanitizeError(err.message)}`);
    console.error(`[QuoxMCP] Ensure collector is running and reachable.`);
    process.exit(1);
  }

  if (tools.length === 0) {
    console.error(`[QuoxMCP] Warning: No tools available for agent ${agentId}`);
  }

  // Register tools onto the MCP server
  registerTools(server, tools, client, { agentId, sessionId, orgId, userId, authToken });

  // Fetch and register MCP resources (read-only context)
  let resCount = 0;
  try {
    const resData = await client.listResources();
    const resources = resData.resources || [];
    resCount = registerResources(server, resources, client);
  } catch (err) {
    console.error(`[QuoxMCP] Resources unavailable: ${sanitizeError(err.message)}`);
  }

  // Fetch and register MCP prompts (operational templates)
  let promptCount = 0;
  try {
    const promptData = await client.listPrompts();
    const prompts = promptData.prompts || [];
    promptCount = registerPrompts(server, prompts);
  } catch (err) {
    console.error(`[QuoxMCP] Prompts unavailable: ${sanitizeError(err.message)}`);
  }

  // Connect via STDIO transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`[QuoxMCP] Connected — serving ${tools.length} tools, ${resCount} resources, ${promptCount} prompts via STDIO`);
}

// Graceful shutdown
function shutdown(signal) {
  console.error(`[QuoxMCP] Received ${signal}, shutting down`);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch(err => {
  console.error(`[QuoxMCP] Fatal error: ${sanitizeError(err.message)}`);
  process.exit(1);
});
