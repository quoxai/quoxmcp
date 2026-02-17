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

const agentId = process.env.QUOX_AGENT_ID || 'quox';
const sessionId = process.env.QUOX_SESSION_ID || '';
const collectorUrl = process.env.QUOX_COLLECTOR_URL || 'http://127.0.0.1:9848';

async function main() {
  // Log to stderr (stdout is reserved for MCP STDIO protocol)
  console.error(`[QuoxMCP] Starting — agent=${agentId}, collector=${collectorUrl}`);

  const server = new McpServer({
    name: 'quoxmcp',
    version: '1.0.0'
  });

  const client = new CollectorClient(collectorUrl);

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

  // Connect via STDIO transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`[QuoxMCP] Connected — serving ${tools.length} tools via STDIO`);
}

main().catch(err => {
  console.error(`[QuoxMCP] Fatal error: ${err.message}`);
  process.exit(1);
});
