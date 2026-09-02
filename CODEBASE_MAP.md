<!-- Last verified: 2026-09-02 by /codebase-mirror -->

# quoxmcp — Codebase Map

> MCP server bridging Claude CLI/Desktop to QuoxCORE infrastructure. Thin protocol adapter: all tool logic lives in the collector.

## Metrics

| Metric | Value |
|--------|-------|
| Source lines | 870 (server.js: 192, lib/: 678) |
| Test lines | 1987 |
| Test cases | 164 (across 8 files) |
| Lib modules | 5 |
| Runtime deps | 2 (`@modelcontextprotocol/sdk`, `zod`) |
| Dev deps | 1 (`vitest`) |
| Tools / resources / prompts | dynamic (fetched from collector at startup; ~94 tools live-verified 2026-08 incl. Discord Pro + quoxbrain_search) |

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
                   (no tool logic)         (SSH, Docker, Proxmox, Discord Pro, etc.)
```

QuoxMCP is a **thin protocol bridge**: tools, resources, and prompts are fetched from the collector API at startup. No domain logic lives here; all execution goes through the collector, which handles RBAC, bastion routing, approval gates, and audit trails. Tool/resource/prompt counts are runtime-dynamic. Discord Pro tools (QDIS-NEXT ph10) flow through the same generic adapter, including the collector's pending-approval bodies for the mutating ones, forwarded untouched.

## Startup Flow (`server.js:104-168`)

1. Validate env (fatal on missing): `QUOX_SERVICE_KEY`/`INTERNAL_SERVICE_KEY`, `QUOX_ORG_ID`. Warn (non-fatal) if `QUOX_USER_ID` missing (org-scoped service contexts valid). Validate `QUOX_AGENT_ID` (safe-ID pattern), `QUOX_COLLECTOR_URL` (valid http/https).
2. Sanitize `QUOX_SESSION_ID` if non-conforming (replaces illegal chars instead of fatal-exit to support Matrix room IDs).
3. Create `CollectorClient` with service-key auth.
4. `client.listTools(agentId, orgId)` → `GET /api/v1/tools/list?agent_id=...&org_id=...` (org_id merges the org's connector tools onto core tools; degrade to 0 tools if unreachable, do NOT exit). Logs connector-tool count separately.
5. `client.listResources()` → `GET /api/v1/resources/list`.
6. `client.listPrompts()` → `GET /api/v1/prompts/list`.
7. Register via adapters: `registerTools` → `registerResources` → `registerPrompts`.
8. Connect via `StdioServerTransport` to Claude CLI.
9. Shutdown on SIGTERM/SIGINT, on stdin end/close (so `claude -p` parents don't hang on a lingering keep-alive socket), and EPIPE on stdout (zombie prevention).

## File Tree

```
quoxmcp/
├── server.js                    # Entry point (STDIO transport, env validation, shutdown)
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
│   ├── discord-tools.test.js    # Discord Pro tool shapes through generic adapter
│   ├── resource-adapter.test.js # Resource caching tests
│   ├── prompt-adapter.test.js   # Template tests
│   ├── security.test.js         # Security hardening tests
│   └── validate.test.js         # Validation utilities tests
├── deploy/
│   ├── bundle.sh                # Tarball packaging script
│   └── quoxmcp-bundle.tar.gz    # Pre-built deployment tarball
├── manifest.json                # MCPB manifest (Claude Desktop bundle config)
├── package.json
└── README.md
```

Build artifacts (`dist/quoxmcp.mcpb`, MCPB staging) are gitignored and not present in this checkout.

## Registration Chains

| Surface | Adapter (`lib/`) | Pattern |
|---------|------------------|---------|
| Tools | `tool-adapter.js` → `registerTools(server, tools, client, ctx)` | Each collector tool → `server.tool(name, desc, zodShape, handler)`. Handler proxies to collector via `client.executeTool()`. |
| Resources | `resource-adapter.js` → `registerResources(server, resources, client)` | Each resource → `server.resource(...)` with TTL cache (30s, 100 max). |
| Prompts | `prompt-adapter.js` → `registerPrompts(server, prompts)` | Each prompt → `server.prompt(name, argsShape, handler)` with mustache templating. |

To expose a new tool/resource/prompt: add it in the **collector** (this repo needs no change). Proven by the Discord Pro exposure: zero Discord-specific code here.

## Authoritative Files

| File | Purpose | Lines |
|------|---------|-------|
| `server.js` | Entry point, env validation, MCP server setup, shutdown | 192 |
| `lib/collector-client.js` | HTTP client to collector API (retries, auth, org_id) | 137 |
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
- `listTools(agentId, orgId)` → `GET /api/v1/tools/list?agent_id=...&org_id=...` (orgId merges org connector tools; omitting it yields core tools only)
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

**Supported types:** string, number/integer, boolean, array (recursive), object (recursive), enum, defaults.

### resource-adapter.js

Registers MCP resources with caching for live resources.

**Exports:**
- `registerResources(server, resources, client)` — main registration loop
- `_resourceCache` — Map for TTL caching
- `RESOURCE_CACHE_TTL` — 30 seconds
- `RESOURCE_CACHE_MAX` — 100 entries (oldest-first eviction)

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
| `QUOX_ORG_ID` | Yes | — | Org ID; also merges the org's connector tools into the tool list |
| `QUOX_USER_ID` | No | — | User ID (warn if missing, org-scoped service contexts valid) |
| `QUOX_AGENT_ID` | No | `quox` | Agent identity for RBAC |
| `QUOX_SESSION_ID` | No | auto UUID | Session identifier (sanitized if non-conforming) |
| `QUOX_COLLECTOR_URL` | No | `http://127.0.0.1:9848` | Collector API base URL |
| `QUOX_AUTH_TOKEN` | No | `""` | Auth token passed through to collector |

## Resilience

- **Graceful degradation:** If `listTools()` fails at startup, connect with 0 tools instead of fatal-exit (session self-heals on next turn).
- **Session ID sanitization:** Non-conforming IDs (e.g., Matrix room IDs with `!` and `:`) are sanitized instead of causing fatal-exit.
- **Org-scoped contexts:** Missing `QUOX_USER_ID` is warned, not fatal (appservice/agent invokes are legitimate user-less contexts).
- **STDIO client shutdown:** Exits on stdin end/close so a parent `claude -p` never blocks on a lingering keep-alive socket after its final answer (proven 2026-08-14).

## Test Coverage

| File | Lines | Cases | Focus |
|------|-------|-------|-------|
| `server.test.js` | 153 | 7 | MCP server integration |
| `adapter.test.js` | 313 | 23 | Schema conversion |
| `client.test.js` | 279 | 20 | HTTP client, retries, org_id |
| `discord-tools.test.js` | 180 | 5 | Discord Pro tool shapes, approval-gate passthrough, honest errors |
| `resource-adapter.test.js` | 209 | 13 | Caching, live/static |
| `prompt-adapter.test.js` | 227 | 23 | Template interpolation |
| `security.test.js` | 414 | 40 | Input validation |
| `validate.test.js` | 212 | 33 | Validation utilities |

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

| Check | Status | Details |
|-------|--------|---------|
| Every adapter imported by entry point | ✓ pass | 5 lib modules, all imported at `server.js:20-24` |
| Each lib module has a test | ✓ pass | 5 modules, 8 test files |
| No domain/tool logic in repo | ✓ pass | All execution proxied to collector; Discord Pro exposure needed zero code here |
| Fatal env validation before connect (service key, org ID) | ✓ pass | `server.js:42-52` |
| Graceful degradation for transient collector issues | ✓ pass | Never exits pre-connect on collector failure |
| Version aligned across package.json / manifest.json / server.js | ✓ pass | 1.2.0 everywhere |
| Deps minimal (2 runtime, 1 dev) | ✓ pass | |
| manifest.json `user_id` matches server behaviour | ⚠ warn | `manifest.json:62` marks it required, `server.js:60` treats it optional for org-scoped contexts |
| Tool count consistent in docs | ⚠ warn | `manifest.json:5` and `README.md:49` say 130+, `README.md:10` says 83+, `README.md:157` says 94 total (live-verified) |
| Checkout runnable as-is | ⚠ warn | `node_modules/` is empty; `npm install` needed before `npm test` or `deploy/bundle.sh` |

## Related

- **QuoxCORE collector** — provides all tools/resources/prompts (incl. `discordProTools.js` in quox-dashboard)
- **quox-dashboard** — UI for QuoxCORE
- **quoxagent** — Go agent that can host QuoxMCP
- **quox-discord-pro** — Discord gateway daemon whose tools are exposed through this bridge
