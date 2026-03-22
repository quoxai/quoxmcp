<!-- Last verified: 2026-03-21 by /codebase-mirror -->

# QuoxMCP — Codebase Map

## Metrics

| Metric | Count |
|--------|-------|
| Version | 1.0.0 |
| Entry point | server.js (STDIO MCP server) |
| Lib modules | 5 |
| Test files | 6 |

## Stack

Node.js, @modelcontextprotocol/sdk, Express (collector client), Vitest

## Architecture

QuoxMCP is a thin MCP protocol adapter. All tool logic lives in the collector. QuoxMCP bridges Claude CLI to QuoxCORE infrastructure tools via STDIO.

## Source Files

| File | Purpose |
|------|---------|
| server.js | MCP server entry point, startup validation, registration |
| lib/collector-client.js | HTTP client for collector API |
| lib/tool-adapter.js | Registers collector tools as MCP tools |
| lib/resource-adapter.js | Registers MCP resources |
| lib/prompt-adapter.js | Registers MCP prompts |
| lib/validate.js | Input validation utilities |

## Test Files (test/)

6 files: adapter.test.js, client.test.js, security.test.js, resource-adapter.test.js, prompt-adapter.test.js, server.test.js

## Environment Variables

QUOX_AGENT_ID, QUOX_SESSION_ID, QUOX_COLLECTOR_URL, QUOX_SERVICE_KEY, QUOX_ORG_ID, QUOX_USER_ID, QUOX_AUTH_TOKEN
