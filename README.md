# QuoxMCP

MCP (Model Context Protocol) server that bridges Claude CLI to QuoxCORE infrastructure tools, resources, and operational prompts. QuoxMCP is a thin protocol adapter — all tool execution, resource serving, and prompt logic calls back to the QuoxCORE collector API. No tool logic lives here.

## Architecture

```
                          QuoxCORE Collector (port 9848)
                         ┌────────────────────────────────┐
                         │  83+ dynamic tools (RBAC)      │
                         │  5 MCP Resources (read-only)   │
                         │  4 MCP Prompts (workflows)     │
                         │  SSH Bastion routing            │
                         │  Plugin license checks          │
                         │  AEE audit trail                │
Claude CLI               │                                │
  │                      │  GET  /api/v1/tools/list       │
  │  ┌──────────────┐   │  POST /api/v1/tools/execute    │
  ├──│  QuoxMCP      │──▶│  GET  /api/v1/resources/list   │
  │  │  (STDIO)      │◀──│  GET  /api/v1/prompts/list     │
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

**Flow:** Claude CLI spawns QuoxMCP as a STDIO subprocess via `--mcp-config`. QuoxMCP fetches available tools, resources, and prompts from the collector at startup, registers them on the MCP server, then proxies every call back to the collector for execution.

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
        "QUOX_SERVICE_KEY": "your-service-key",
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
[QuoxMCP] Fetched 79 tools for agent quox
[QuoxMCP] Registered 79 tools, 5 resources, 4 prompts for agent quox
[QuoxMCP] Connected — serving 79 tools, 5 resources, 4 prompts via STDIO
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `QUOX_AGENT_ID` | `quox` | Agent identity for RBAC. Determines which tools are available. |
| `QUOX_SESSION_ID` | `""` | Session identifier for context threading. |
| `QUOX_COLLECTOR_URL` | `http://127.0.0.1:9848` | QuoxCORE collector API base URL. |
| `QUOX_SERVICE_KEY` | `""` | Service authentication key. Sent as `X-Service-Key` header on every collector request. Falls back to `INTERNAL_SERVICE_KEY` if not set. |
| `INTERNAL_SERVICE_KEY` | `""` | Fallback service key (used if `QUOX_SERVICE_KEY` is empty). |

## How It Works

1. **Discovery** — On startup, QuoxMCP calls three collector endpoints in parallel:
   - `GET /api/v1/tools/list?agent_id={id}` — tool definitions for this agent
   - `GET /api/v1/resources/list` — read-only resource definitions
   - `GET /api/v1/prompts/list` — operational prompt templates
2. **Registration** — Each tool's JSON Schema is converted to a Zod schema and registered with `server.tool()`. Resources are registered with `server.resource()`. Prompts are registered with `server.prompt()` including argument schemas and templated messages.
3. **Execution** — When Claude calls a tool, QuoxMCP sends `POST /api/v1/tools/execute` to the collector with the tool name, input, agent ID, and session ID. Resources are served from cache (30s TTL for live resources). Prompts interpolate arguments into message templates.
4. **Response** — The collector executes the tool (SSH, API call, memory operation, etc.), enforces RBAC, logs to the audit trail, and returns the result. QuoxMCP forwards it to Claude as MCP content.

## Available Tools

Tools are served dynamically by the collector based on the agent ID. The QUOX orchestrator agent has access to all tools; specialist agents get subsets. With plugins enabled, the total exceeds 83 tools.

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
| **Plugin Tools** | n8n workflow triggers, custom integrations, domain-specific actions | Per plugin RBAC |

Query the live list: `curl http://127.0.0.1:9848/api/v1/tools/list?agent_id=all`

## MCP Resources

Resources provide read-only infrastructure context to Claude without executing a tool call. They are fetched from the collector at startup and registered as MCP resources. Live resources are re-fetched on each read with a 30-second cache TTL.

| Resource | Description |
|----------|-------------|
| System Identity | Server name, version, agent ID, uptime |
| Fleet Topology | All managed hosts, roles, network layout |
| Agent Capabilities | Tools and permissions available per agent |
| Service Status | Health of all connected services |
| Configuration | Current MCP server settings and environment |

Query available resources: `curl http://127.0.0.1:9848/api/v1/resources/list`

## MCP Prompts

Prompts are pre-built operational workflows that Claude can invoke. Each prompt accepts structured arguments and produces templated messages with conditional sections (mustache-style: `{{var}}`, `{{#var}}...{{/var}}`, `{{var|default}}`).

| Prompt | Description |
|--------|-------------|
| Incident Triage | Structured diagnostic workflow for investigating alerts |
| Security Sweep | Multi-pass security audit with fix suggestions |
| Deploy Checklist | Pre/post deployment verification steps |
| Fleet Review | Comprehensive infrastructure health check |

Query available prompts: `curl http://127.0.0.1:9848/api/v1/prompts/list`

## Authentication

QuoxMCP authenticates every request to the collector using a service key sent as the `X-Service-Key` HTTP header. Set `QUOX_SERVICE_KEY` in your MCP config env to enable authentication. If not set, it falls back to `INTERNAL_SERVICE_KEY`.

No anonymous tool execution is possible when the collector enforces service key validation.

## Resilience Features

- **Exponential backoff** — Failed collector calls retry up to 2 times with exponential delays (max 8s between retries)
- **Request timeout** — 30-second timeout on every collector HTTP request
- **Resource caching** — Live resources cache responses for 30 seconds to avoid redundant fetches
- **Graceful shutdown** — SIGTERM and SIGINT handlers ensure clean MCP server disconnection
- **Per-tool logging** — Every tool call, resource read, and prompt invocation is logged with timing and agent context

## Remote Deployment

QuoxMCP can be deployed to any fleet host alongside QuoxAgent. The install script handles Node.js provisioning, bundle download, and MCP config generation automatically.

### Build & Deploy

```bash
# 1. Build the bundle on the control workstation
cd /home/control/quoxmcp/deploy && ./bundle.sh

# 2. Deploy to fleet hosts (reads service key from dashboard .env)
cd /home/control/quoxagent/deploy
./deploy-to-host.sh docker01            # single host
./deploy-to-host.sh all                 # all fleet hosts

# 3. Verify
./deploy-to-host.sh all --check-mcp
```

### Remote File Layout

| Path | Contents |
|------|----------|
| `/opt/quoxmcp/server.js` | Entry point |
| `/opt/quoxmcp/lib/` | Protocol adapters |
| `/opt/quoxmcp/node_modules/` | Dependencies (MCP SDK, Zod) |
| `/etc/quoxmcp/mcp-config.json` | MCP config with collector URL + service key (chmod 600) |

### Usage on Remote Hosts

```bash
# Claude CLI with MCP tools
claude --mcp-config /etc/quoxmcp/mcp-config.json
```

## Project Structure

```
quoxmcp/
├── server.js                    # MCP server entry point (STDIO transport)
├── lib/
│   ├── validate.js              # Centralised validation (IDs, URLs, sanitizers)
│   ├── collector-client.js      # HTTP client for collector API (retries + auth)
│   ├── tool-adapter.js          # JSON Schema → Zod conversion + MCP tool registration
│   ├── resource-adapter.js      # MCP resource registration + caching
│   └── prompt-adapter.js        # MCP prompt registration + template interpolation
├── test/
│   ├── server.test.js           # MCP server + integration tests
│   ├── adapter.test.js          # Schema conversion + tool registration tests (22)
│   ├── client.test.js           # Collector client tests with mocked HTTP
│   ├── resource-adapter.test.js # Resource adapter tests
│   ├── prompt-adapter.test.js   # Prompt adapter + template tests (23)
│   └── security.test.js         # Security hardening tests (40)
├── deploy/
│   └── bundle.sh                # Bundle packaging for remote deployment
├── package.json
└── README.md
```

## Development

```bash
# Run all tests (121 tests across 6 files)
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
