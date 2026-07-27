<!-- Last verified: 2026-07-27T15:16:00Z by /codebase-mirror -->

# quoxmcp — Codebase Map

> MCP server bridging Claude CLI/Desktop to QuoxCORE infrastructure. Thin protocol adapter: all tool logic lives in the collector.

## Metrics

| Metric | Value |
|--------|-------|
| Source lines | 845 (server.js: 177, lib/: 668) |
| Test lines | 1776 |
| Lib modules | 5 |
| Test files | 7 |
| Runtime deps | 2 (`@modelcontextprotocol/sdk`, `zod`) |
| Dev deps | 1 (`vitest`) |
| Tools / resources / prompts | dynamic (fetched from collector at startup) |

## Package

- **Name:** `@quox/mcp` v1.2.0
- **Main / bin:** `server.js` (CLI bin: `quoxmcp`)
- **License:** BUSL-1.1
- **Node:** >=20.0.0
- **Scripts:** `start`, `test`

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

QuoxMCP is a **thin protocol bridge**: tools, resources, and prompts are fetched from the collector API at startup. No domain logic lives here; all execution goes through the collector which handles RBAC, bastion routing, and audit trails. Tool/resource/prompt counts are runtime-dynamic.

## Startup Flow (`server.js:104-163`)

1. Validate env (fatal on missing): `QUOX_SERVICE_KEY`/`INTERNAL_SERVICE_KEY`, `QUOX_ORG_ID`. Warn (non-fatal) if `QUOX_USER_ID` missing (org-scoped service contexts valid). Validate `QUOX_AGENT_ID` (safe-ID pattern), `QUOX_COLLECTOR_URL` (valid http/https).
2. Sanitize `QUOX_SESSION_ID` if non-conforming (replaces illegal chars instead of fatal-exit to support Matrix room IDs).
3. Create `CollectorClient` with service-key auth.
4. `client.listTools(agentId)` → `GET /api/v1/tools/list` (degrade to 0 tools if unreachable, do NOT exit).
5. `client.listResources()` → `GET /api/v1/resources/list`.
6. `client.listPrompts()` → `GET /api/v1/prompts/list`.
7. Register via adapters: `registerTools` → `registerResources` → `registerPrompts`.
8. Connect via `StdioServerTransport` to Claude CLI.
9. Graceful shutdown on SIGTERM/SIGINT; EPIPE handling for zombie prevention.

## File Tree

```
quoxmcp/
├── server.js                    # Entry point (STDIO transport, env validation)
├── lib/
│   ├── collector-client.js      # HTTP client for collector API
│   ├── tool-adapter.js          # JSON Schema → Zod + MCP tool registration
│   ├── resource-adapter.js      # MCP resource registration + TTL caching
│   ├── prompt-adapter.js        # MCP prompt registration + templating
│   └── validate.js              # Input validation + sanitization
├── test/
│   ├── server.test.js           # Integration tests
│   ├── adapter.test.js          # Schema conversion tests
│   ├── client.test.js           # HTTP client tests
│   ├── resource-adapter.test.js # Resource caching tests
│   ├── prompt-adapter.test.js   # Template tests
│   ├── security.test.js         # Security hardening tests
│   └── validate.test.js         # Validation utilities tests
├── build/                       # Staged MCPB assets (server.js, lib/, package.json, node_modules/)
├── deploy/
│   ├── bundle.sh                # Tarball packaging script
│   └── quoxmcp-bundle.tar.gz    # Pre-built deployment tarball
├── dist/
│   └── quoxmcp.mcpb             # Claude Desktop bundle (gitignored)
├── manifest.json                # MCPB manifest
├── package.json
└── README.md
```

## Registration Chains

| Surface | Adapter (`lib/`) | Pattern |
|---------|------------------|---------|
| Tools | `tool-adapter.js` → `registerTools(server, tools, client, ctx)` | Each collector tool → `server.tool(name, desc, zodShape, handler)`. Handler proxies to collector via `client.executeTool()`. |
| Resources | `resource-adapter.js` → `registerResources(server, resources, client)` | Each resource → `server.resource(...)` with TTL cache (30s, 100 max). |
| Prompts | `prompt-adapter.js` → `registerPrompts(server, prompts)` | Each prompt → `server.prompt(name, argsShape, handler)` with mustache templating. |

To expose a new tool/resource/prompt: add it in the **collector** (this repo needs no change).

## Authoritative Files

| File | Purpose | Lines |
|------|---------|-------|
| `server.js` | Entry point, env validation, MCP server setup | 177 |
| `lib/collector-client.js` | HTTP client to collector API (retries, auth) | 127 |
| `lib/tool-adapter.js` | Collector tools → MCP tools (JSON Schema → Zod) | 176 |
| `lib/resource-adapter.js` | Resource registration + caching | 121 |
| `lib/prompt-adapter.js` | Prompt registration + templating | 113 |
| `lib/validate.js` | Security validation utilities | 131 |

## lib/ Module Details

### collector-client.js

HTTP client for QuoxCORE collector API.

**Class:** `CollectorClient(baseUrl, opts)`
- `opts.timeout` — request timeout (default 30s)
- `opts.retries` — retry count (default 2)
- `opts.serviceKey` — auth header value

**Methods:**
- `listTools(agentId)` → `GET /api/v1/tools/list?agent_id=...`
- `listResources()` → `GET /api/v1/resources/list`
- `listPrompts()` → `GET /api/v1/prompts/list`
- `executeTool(name, input, agentId, sessionId, orgId, userId, authToken)` → `POST /api/v1/tools/execute`

**Features:** Exponential backoff (max 8s), `X-Service-Key` header injection, error sanitization.

### tool-adapter.js

Converts collector tool definitions to MCP registrations.

**Exports:**
- `registerTools(server, tools, client, ctx)` — main registration loop
- `jsonSchemaToZodShape(properties, required)` — JSON Schema → Zod shape
- `jsonSchemaToZodItem(items)` — array item schema conversion

**Supported types:** string, number/integer, boolean, array (recursive), object (recursive), enum.

### resource-adapter.js

Registers MCP resources with caching for live resources.

**Exports:**
- `registerResources(server, resources, client)` — main registration loop
- `_resourceCache` — Map for TTL caching
- `RESOURCE_CACHE_TTL` — 30 seconds
- `RESOURCE_CACHE_MAX` — 100 entries (LRU eviction)

**URI schemes:** `quox://`, `https://`, `http://`

### prompt-adapter.js

Registers MCP prompts with mustache-style templating.

**Exports:**
- `registerPrompts(server, prompts)` — main registration loop
- `buildArgsShape(args)` — argument defs → Zod shape
- `interpolateArgs(template, args)` — template interpolation

**Template syntax:**
- `{{var}}` — simple substitution
- `{{var|default}}` — with fallback
- `{{#var}}...{{/var}}` — conditional (if set)
- `{{^var}}...{{/var}}` — inverse (if not set)

**Security:** `escapeTemplateChars` prevents injection via user args.

### validate.js

Centralised security validation utilities.

**Constants:**
- `SAFE_ID` — `/^[a-zA-Z0-9_-]{1,64}$/`
- `SAFE_TOOL_NAME` — `/^[a-zA-Z0-9_.-]{1,128}$/`
- `MAX_INPUT_SIZE` — 1MB
- `ALLOWED_URI_SCHEMES` — `['quox:', 'https:', 'http:']`

**Functions:**
- `isValidId(id)` — agent/session ID validation
- `isValidToolName(name)` — tool name validation
- `validateUrl(url)` — URL validation with HTTP-over-public warning
- `isValidResourceUri(uri)` — URI scheme check
- `sanitizeError(msg)` — strip IPs, paths, hostnames
- `escapeTemplateChars(value)` — escape `{{` / `}}`
- `inputTooLarge(input)` — check serialized size

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `QUOX_SERVICE_KEY` | Yes | — | Collector auth (or `INTERNAL_SERVICE_KEY`) |
| `QUOX_ORG_ID` | Yes | — | Org ID for multi-tenant audit |
| `QUOX_USER_ID` | No | — | User ID (warn if missing, org-scoped service contexts valid) |
| `QUOX_AGENT_ID` | No | `quox` | Agent identity for RBAC |
| `QUOX_SESSION_ID` | No | auto UUID | Session identifier (sanitized if non-conforming) |
| `QUOX_COLLECTOR_URL` | No | `http://127.0.0.1:9848` | Collector API base URL |
| `QUOX_AUTH_TOKEN` | No | `""` | Auth token passed through to collector |

## Resilience

- **Graceful degradation:** If `listTools()` fails at startup, connect with 0 tools instead of fatal-exit (session self-heals on next turn).
- **Session ID sanitization:** Non-conforming IDs (e.g., Matrix room IDs with `!` and `:`) are sanitized instead of causing fatal-exit.
- **Org-scoped contexts:** Missing `QUOX_USER_ID` is warned, not fatal (appservice/agent invokes are legitimate user-less contexts).

## Test Coverage

| File | Lines | Focus |
|------|-------|-------|
| `server.test.js` | 153 | MCP server integration |
| `adapter.test.js` | 313 | Schema conversion |
| `client.test.js` | 248 | HTTP client, retries |
| `resource-adapter.test.js` | 209 | Caching, live/static |
| `prompt-adapter.test.js` | 227 | Template interpolation |
| `security.test.js` | 414 | Input validation |
| `validate.test.js` | 212 | Validation utilities |

## Deployment

### Claude Desktop (MCPB)

`manifest.json` defines the MCPB bundle for one-click install.

**User config fields:**
- `collector_url` — QuoxCORE collector URL
- `service_key` — `INTERNAL_SERVICE_KEY` (sensitive)
- `agent_id` — RBAC agent identity
- `org_id` — Organisation ID
- `user_id` — User ID

**Build:** `mcpb pack build dist/quoxmcp.mcpb`

### Fleet Deployment (Tarball)

`deploy/bundle.sh` creates tarball with:
- `server.js`, `lib/`, `package.json`, `node_modules/`

**Remote layout:**
- `/opt/quoxmcp/` — extracted bundle
- `/etc/quoxmcp/mcp-config.json` — config (chmod 600)

## Dependencies

**Runtime (package.json):**
- `@modelcontextprotocol/sdk` ^1.0.0 — MCP protocol
- `zod` ^4.3.6 — schema validation

**Dev:**
- `vitest` ^4.0.0 — test runner

## Invariants

| Check | Status |
|-------|--------|
| Every adapter imported by entry point | ✓ |
| Each lib module has a test | ✓ |
| No domain/tool logic in repo | ✓ |
| Fatal env validation before connect (service key, org ID) | ✓ |
| Graceful degradation for transient collector issues | ✓ |
| Deps minimal (2 runtime, 1 dev) | ✓ |

## Related

- **QuoxCORE collector** — provides all tools/resources/prompts
- **quox-dashboard** — UI for QuoxCORE
- **quoxagent** — Go agent that can host QuoxMCP
