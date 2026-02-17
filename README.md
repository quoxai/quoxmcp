# QuoxMCP

MCP (Model Context Protocol) server that bridges Claude CLI to QuoxCORE infrastructure tools. QuoxMCP is a thin protocol adapter — all tool execution calls back to the QuoxCORE collector API. No tool logic lives here.

## Architecture

```
                          QuoxCORE Collector (port 9848)
                         ┌────────────────────────────────┐
                         │  TOOL_DEFS (20 native tools)   │
                         │  AGENT_TOOLS (RBAC per agent)  │
                         │  SSH Bastion routing            │
                         │  Plugin license checks          │
                         │  AEE audit trail                │
Claude CLI               │                                │
  │                      │  GET  /api/v1/tools/list       │
  │  ┌──────────────┐   │  POST /api/v1/tools/execute    │
  ├──│  QuoxMCP      │──▶│  GET  /api/v1/tools/agents     │
  │  │  (STDIO)      │◀──│                                │
  │  └──────────────┘   └────────────┬───────────────────┘
  │                                   │
  │   MCP JSON-RPC                    │  SSH / HTTP / API
  │   over stdin/stdout               │
  │                      ┌────────────▼───────────────────┐
  │                      │  Infrastructure                 │
  │                      │  Docker hosts, Proxmox, Fleet,  │
  │                      │  Monitoring, Memory, Security   │
  │                      └────────────────────────────────┘
```

**Flow:** Claude CLI spawns QuoxMCP as a STDIO subprocess via `--mcp-config`. QuoxMCP fetches available tools from the collector at startup, registers them as MCP tools, then proxies every tool call back to the collector for execution.

## Quick Start

### 1. Install

```bash
cd /home/control/quoxmcp
npm install
```

### 2. Configure Claude CLI

Create or update your MCP config (e.g., `~/.claude/mcp-config.json`):

```json
{
  "mcpServers": {
    "quox-tools": {
      "command": "node",
      "args": ["/home/control/quoxmcp/server.js"],
      "env": {
        "QUOX_AGENT_ID": "quox",
        "QUOX_SESSION_ID": "",
        "QUOX_COLLECTOR_URL": "http://127.0.0.1:9848"
      }
    }
  }
}
```

### 3. Verify

```bash
# Standalone test — starts MCP server, fetches tools, exits after 5s
QUOX_AGENT_ID=quox QUOX_COLLECTOR_URL=http://127.0.0.1:9848 timeout 5 node server.js
```

Expected output:
```
[QuoxMCP] Starting — agent=quox, collector=http://127.0.0.1:9848
[QuoxMCP] Fetched 16 tools for agent quox
[QuoxMCP] Registered 16 tools for agent quox
[QuoxMCP] Connected — serving 16 tools via STDIO
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `QUOX_AGENT_ID` | `quox` | Agent identity for RBAC. Determines which tools are available. |
| `QUOX_SESSION_ID` | `""` | Session identifier for context threading. |
| `QUOX_COLLECTOR_URL` | `http://127.0.0.1:9848` | QuoxCORE collector API base URL. |

## How It Works

1. **Discovery** — On startup, QuoxMCP calls `GET /api/v1/tools/list?agent_id={id}` to fetch the tool definitions available for this agent.
2. **Registration** — Each tool's JSON Schema is converted to a Zod schema and registered on the MCP server with `server.tool()`.
3. **Execution** — When Claude calls a tool, QuoxMCP sends `POST /api/v1/tools/execute` to the collector with the tool name, input, agent ID, and session ID.
4. **Response** — The collector executes the tool (SSH, API call, memory operation, etc.), enforces RBAC, logs to the audit trail, and returns the result. QuoxMCP forwards it to Claude as MCP content.

## Available Tools

Tools are served dynamically by the collector based on the agent ID. The QUOX orchestrator agent has access to all tools; specialist agents get subsets.

| Category | Tools | Agents |
|----------|-------|--------|
| **Infrastructure** | ssh_exec, fleet_status, system_admin | QUOX, CIPHER, NOVA, SENTINEL |
| **Containers** | docker_status, docker_extended | QUOX, NOVA |
| **Network** | network_check | QUOX, CIPHER, SENTINEL |
| **Virtualization** | proxmox_vms, proxmox_containers, proxmox_cluster_status, proxmox_storage, proxmox_vm_action | QUOX, ATLAS |
| **Security** | security_audit, ssl_certificates | QUOX, SENTINEL |
| **Monitoring** | metrics_query, alerts_manage | QUOX, METRICS |
| **Memory** | memory_save, memory_search, memory_update, entity_note | All agents |
| **Orchestration** | delegate_to_agent | QUOX only |

Query the live list: `curl http://127.0.0.1:9848/api/v1/tools/list?agent_id=all`

## Project Structure

```
quoxmcp/
├── server.js               # MCP server entry point (STDIO transport)
├── lib/
│   ├── collector-client.js  # HTTP client for collector API callbacks
│   └── tool-adapter.js      # JSON Schema → Zod conversion + MCP registration
├── test/
│   ├── server.test.js       # MCP server + integration tests (7)
│   ├── adapter.test.js      # Schema conversion + registration tests (13)
│   └── client.test.js       # Collector client tests with mocked HTTP (10)
├── package.json
└── README.md
```

## Development

```bash
# Run all tests (30 tests across 3 files)
npm test

# Run tests in watch mode
npx vitest

# Test against live collector
QUOX_AGENT_ID=quox QUOX_COLLECTOR_URL=http://127.0.0.1:9848 timeout 5 node server.js
```

## Related

- [QuoxCORE](https://github.com/AdaminX/quox) — The platform dashboard and collector
- [quox.ai](https://quox.ai) — Product website
- [MCP Specification](https://modelcontextprotocol.io) — Model Context Protocol docs
