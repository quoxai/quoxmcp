<!-- Last verified: 2026-05-31T09:16 by codebase-mirror scan -->

# quoxmcp — Codebase Map

> MCP server bridging Claude CLI/Desktop to QuoxCORE infrastructure. Thin protocol adapter — all tool logic lives in the collector.

## Metrics
| Metric | Value |
|--------|-------|
| Source lines | 831 (server.js: 163, lib/: 668) |
| Lib modules | 5 |
| Test files | 7 |
| Test cases | 157 |
| Test lines | 1,776 |
| Direct deps | 2 (`@modelcontextprotocol/sdk`, `zod`) |
| Dev deps | 1 (`vitest`) |
| Tools/resources/prompts | dynamic (130+ tools, 5 resources, 4 prompts from collector) |

## Package
- **Name:** `@quox/mcp` v1.2.0
- **Main:** `server.js` (CLI bin: `quoxmcp`)
- **License:** BUSL-1.1
- **Node:** >=20.0.0

## Architecture
```
Claude CLI ──STDIO──► QuoxMCP ──HTTP──► QuoxCORE Collector (port 9848)
                         │                      │
                    MCP JSON-RPC           RBAC, Bastion, Audit
                    stdin/stdout                │
                         ▼                      ▼
                   Protocol Adapter        Infrastructure
                   (no tool logic)         (SSH, Docker, Proxmox, etc.)
```

QuoxMCP is a **thin protocol bridge** — tools, resources, and prompts are fetched from the collector API at startup. No domain logic lives here; all execution goes through the collector which handles RBAC, bastion routing, and audit trails.

## Environment Variables
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `QUOX_SERVICE_KEY` | Yes | — | Service key for collector auth (or `INTERNAL_SERVICE_KEY`) |
| `QUOX_ORG_ID` | Yes | — | Organisation ID for multi-tenant audit attribution |
| `QUOX_USER_ID` | Yes | — | User ID for audit trail attribution |
| `QUOX_AGENT_ID` | No | `quox` | Agent identity for RBAC |
| `QUOX_SESSION_ID` | No | auto-generated UUID | Session identifier for context |
| `QUOX_COLLECTOR_URL` | No | `http://127.0.0.1:9848` | Collector API base URL |
| `QUOX_AUTH_TOKEN` | No | `""` | Auth token passed through to collector |

## Startup Flow (`server.js`)
1. **Validate env** (fatal errors):
   - `QUOX_SERVICE_KEY` / `INTERNAL_SERVICE_KEY` must be set
   - `QUOX_ORG_ID` must be set
   - `QUOX_USER_ID` must be set
   - `QUOX_AGENT_ID` must match safe ID pattern
   - `QUOX_COLLECTOR_URL` must be valid http/https URL
2. Create `CollectorClient` with service key auth
3. Fetch tools from `GET /api/v1/tools/list?agent_id=` (exit if unreachable)
4. Fetch resources from `GET /api/v1/resources/list`
5. Fetch prompts from `GET /api/v1/prompts/list`
6. Register tools + resources + prompts via adapters
7. Connect via `StdioServerTransport` to Claude CLI
8. Graceful shutdown on SIGTERM/SIGINT, EPIPE handling for zombie prevention

## Directory Structure
```
quoxmcp/
├── server.js                 # Entry point, MCP server setup (163 lines)
├── package.json              # @quox/mcp v1.2.0
├── manifest.json             # MCPB manifest for Claude Desktop install
├── README.md                 # Full documentation
├── CODEBASE_MAP.md           # This file
├── lib/
│   ├── validate.js           # Input/URL/ID validation (131 lines)
│   ├── collector-client.js   # HTTP client to collector API (127 lines)
│   ├── tool-adapter.js       # Collector tools → MCP tools (176 lines)
│   ├── resource-adapter.js   # Resource registration + caching (121 lines)
│   └── prompt-adapter.js     # Prompt registration + templating (113 lines)
├── test/
│   ├── security.test.js      # Input validation, injection prevention (40 tests, 414 lines)
│   ├── adapter.test.js       # JSON Schema → Zod, tool registration (23 tests, 313 lines)
│   ├── client.test.js        # CollectorClient HTTP, retries (18 tests, 248 lines)
│   ├── prompt-adapter.test.js # Prompt templating tests (23 tests, 227 lines)
│   ├── validate.test.js      # Validation utility tests (33 tests, 212 lines)
│   ├── resource-adapter.test.js # Resource caching tests (13 tests, 209 lines)
│   └── server.test.js        # Server startup tests (7 tests, 153 lines)
├── deploy/
│   ├── bundle.sh             # Build deployment tarball
│   └── quoxmcp-bundle.tar.gz # Pre-built bundle for remote hosts (~14.5MB)
├── build/                    # Staging for MCPB packaging
│   ├── server.js
│   ├── lib/                  # Lib modules
│   ├── manifest.json
│   ├── package.json
│   └── node_modules/         # Production deps only
└── dist/
    └── quoxmcp.mcpb          # Claude Desktop one-click install (~3.2MB)
```

## Lib Modules

### validate.js (131 lines)
Centralised validation and sanitisation utilities.

| Export | Description |
|--------|-------------|
| `SAFE_ID` | Regex: `/^[a-zA-Z0-9_-]{1,64}$/` |
| `SAFE_TOOL_NAME` | Regex: `/^[a-zA-Z0-9_.-]{1,128}$/` |
| `MAX_INPUT_SIZE` | 1MB (1,048,576 bytes) |
| `ALLOWED_URI_SCHEMES` | `['quox:', 'https:', 'http:']` |
| `isValidId(id)` | Validate agent/session ID |
| `isValidToolName(name)` | Validate tool name |
| `validateUrl(url)` | Parse and validate collector URL |
| `isValidResourceUri(uri)` | Validate resource URI scheme |
| `sanitizeError(msg)` | Strip internal IPs, paths, hostnames |
| `escapeTemplateChars(val)` | Prevent mustache template injection |
| `inputTooLarge(input)` | Check if input exceeds 1MB |

### collector-client.js (127 lines)
HTTP client for QuoxCORE collector API with retry logic and auth.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `listTools(agentId)` | `GET /api/v1/tools/list?agent_id=` | Fetch tools for agent |
| `listResources()` | `GET /api/v1/resources/list` | Fetch MCP resources |
| `listPrompts()` | `GET /api/v1/prompts/list` | Fetch MCP prompts |
| `executeTool(name, input, agentId, sessionId, orgId, userId, authToken)` | `POST /api/v1/tools/execute` | Execute tool via collector |

**Config:** 30s timeout, 2 retries with exponential backoff (max 8s), `X-Service-Key` header injection.

### tool-adapter.js (176 lines)
Converts collector tool definitions (Anthropic format) to MCP tool registrations.

| Export | Description |
|--------|-------------|
| `registerTools(server, tools, client, ctx)` | Register tools onto MCP server |
| `jsonSchemaToZodShape(properties, required)` | Convert JSON Schema → Zod shape |
| `jsonSchemaToZodItem(items)` | Convert array item schema → Zod |

**Features:**
- Name validation: alphanumeric/dash/underscore/dot, max 128 chars
- Handles enums, nested objects, typed arrays, default values
- Input size limit: 1MB
- Logs execution time to stderr
- Passes org_id, user_id, auth_token for multi-tenant audit attribution

### resource-adapter.js (121 lines)
Registers MCP resources with optional live fetching and TTL caching.

| Export | Description |
|--------|-------------|
| `registerResources(server, resources, client)` | Register resources onto MCP server |
| `_resourceCache` | Internal TTL cache (Map) |
| `RESOURCE_CACHE_TTL` | 30 seconds |
| `RESOURCE_CACHE_MAX` | 100 entries (LRU eviction) |

**Resource types:**
- **Static:** Pre-rendered content, served directly
- **Live:** Re-fetched on each read (cached for 30s)

### prompt-adapter.js (113 lines)
Registers MCP prompts with mustache-style templating.

| Export | Description |
|--------|-------------|
| `registerPrompts(server, prompts)` | Register prompts onto MCP server |
| `buildArgsShape(args)` | Build Zod shape from argument definitions |
| `interpolateArgs(template, args)` | Interpolate values into template |

**Template syntax:**
- `{{var}}` — simple substitution
- `{{var|default}}` — substitution with default value
- `{{#var}}...{{/var}}` — conditional block (if var is set)
- `{{^var}}...{{/var}}` — inverse block (if var is NOT set)

User values are escaped via `escapeTemplateChars()` to prevent injection.

## Security Model

| Layer | Implementation |
|-------|----------------|
| **Authentication** | Service key required (`QUOX_SERVICE_KEY`), sent as `X-Service-Key` header |
| **Tenant isolation** | `QUOX_ORG_ID` and `QUOX_USER_ID` required for audit attribution |
| **ID validation** | Agent/session IDs must match `SAFE_ID` pattern |
| **Tool name validation** | Must match `SAFE_TOOL_NAME` pattern |
| **URL validation** | Only http/https; warns on HTTP over public networks |
| **Resource URI validation** | Only `quox://`, `http://`, `https://` schemes |
| **Error sanitisation** | Strips internal IPs, paths, hostnames from messages |
| **Input size limits** | 1MB max for tool inputs |
| **Template injection** | User values escaped in prompt interpolation |

## Tests

| File | Tests | Lines | Focus |
|------|-------|-------|-------|
| security.test.js | 40 | 414 | Input validation, auth, injection prevention, size limits |
| adapter.test.js | 23 | 313 | JSON Schema → Zod conversion, tool registration |
| client.test.js | 18 | 248 | HTTP client, retries, error handling |
| prompt-adapter.test.js | 23 | 227 | Prompt registration, template interpolation |
| validate.test.js | 33 | 212 | Validation utilities |
| resource-adapter.test.js | 13 | 209 | Resource registration, TTL cache |
| server.test.js | 7 | 153 | MCP server creation, env defaults |
| **Total** | **157** | **1,776** | |

**Run:** `npm test` (Vitest)

## MCPB Packaging (Claude Desktop Install)

The `manifest.json` enables one-click install in Claude Desktop via MCPB format:

```json
{
  "manifest_version": "0.3",
  "name": "quoxmcp",
  "version": "1.2.0",
  "server": {
    "type": "node",
    "entry_point": "server.js"
  },
  "user_config": {
    "collector_url": { "type": "string", "default": "http://127.0.0.1:9848", "required": true },
    "service_key": { "type": "string", "sensitive": true, "required": true },
    "agent_id": { "type": "string", "default": "quox" },
    "org_id": { "type": "string", "required": true },
    "user_id": { "type": "string", "required": true }
  }
}
```

Build MCPB bundle:
```bash
mcpb pack build dist/quoxmcp.mcpb
```

## Deployment

### MCPB (Claude Desktop)
1. Download `quoxmcp.mcpb` from releases or build locally
2. Double-click — Claude Desktop auto-extracts and prompts for config
3. Enter collector URL, service key, org ID, user ID
4. Restart Claude Desktop; `quox` appears in tools menu

### Manual Tarball (Fleet Hosts)
Bundle script creates a self-contained tarball for remote hosts:
```bash
cd /home/control/quoxmcp/deploy && ./bundle.sh
```

Remote layout:
```
/opt/quoxmcp/
├── server.js
├── lib/
├── node_modules/
└── package.json

/etc/quoxmcp/
└── mcp-config.json   # Service key config (chmod 600)
```

Usage:
```bash
claude --mcp-config /etc/quoxmcp/mcp-config.json
```

## Related

- [QuoxCORE](https://github.com/quoxai/quox) — Platform dashboard and collector
- [quoxagent](https://github.com/quoxai/quoxagent) — Fleet agent (can deploy quoxmcp to remote hosts)
- [MCP Specification](https://modelcontextprotocol.io) — Model Context Protocol docs
