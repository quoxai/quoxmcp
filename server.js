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

const agentId = process.env.QUOX_AGENT_ID || 'quox';
const sessionId = process.env.QUOX_SESSION_ID || '';
const collectorUrl = process.env.QUOX_COLLECTOR_URL || 'http://127.0.0.1:9848';
const serviceKey = process.env.QUOX_SERVICE_KEY || process.env.INTERNAL_SERVICE_KEY || '';

async function main() {
  // Log to stderr (stdout is reserved for MCP STDIO protocol)
  console.error(`[QuoxMCP] Starting — agent=${agentId}, collector=${collectorUrl}`);

  const server = new McpServer({
    name: 'quoxmcp',
    version: '1.0.0'
  });

  const client = new CollectorClient(collectorUrl, { serviceKey });

  // Fetch available tools for this agent from the collector
  let tools;
  try {
    const data = await client.listTools(agentId);
    tools = data.tools || [];
    console.error(`[QuoxMCP] Fetched ${tools.length} tools for agent ${agentId}`);
  } catch (err) {
    console.error(`[QuoxMCP] Failed to fetch tools from collector: ${err.message}`);
    console.error(`[QuoxMCP] Ensure collector is running at ${collectorUrl}`);
    process.exit(1);
  }

  if (tools.length === 0) {
    console.error(`[QuoxMCP] Warning: No tools available for agent ${agentId}`);
  }

  // Register tools onto the MCP server
  registerTools(server, tools, client, { agentId, sessionId });

  // Fetch and register MCP resources (read-only context)
  let resCount = 0;
  try {
    const resData = await client.listResources();
    const resources = resData.resources || [];
    resCount = registerResources(server, resources, client);
  } catch (err) {
    console.error(`[QuoxMCP] Resources unavailable: ${err.message}`);
  }

  // Fetch and register MCP prompts (operational templates)
  let promptCount = 0;
  try {
    const promptData = await client.listPrompts();
    const prompts = promptData.prompts || [];
    promptCount = registerPrompts(server, prompts);
  } catch (err) {
    console.error(`[QuoxMCP] Prompts unavailable: ${err.message}`);
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
  console.error(`[QuoxMCP] Fatal error: ${err.message}`);
  process.exit(1);
});
