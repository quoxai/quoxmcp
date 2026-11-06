<!-- Last verified: 2026-11-06 by /codebase-mirror -->

# quoxmcp — Codebase Map

> MCP server bridging Claude CLI/Desktop to QuoxCORE infrastructure. Thin protocol adapter: all tool logic lives in the collector.

## Metrics

| Metric | Value |
|--------|-------|
| Source lines | 1105 (server.js: 210, lib/: 895) |
| Test lines | 2408 |
| Test cases | 194 across 10 files (all green, `npx vitest run` 2026-11-06, 14.0s) |
| Lib modules | 7 (6 wired into server.js, 1 standalone: `mcp-auth.js`) |
| Runtime deps | 2 (`@modelcontextprotocol/sdk` 1.26.0 installed, `zod` 4.3.6) |
| Dev deps | 1 (`vitest` 4.0.18) |
| Tools / resources / prompts | dynamic (fetched from collector at startup; agent- and org-scoped, no single flat count; 320 distinct tool names across 44 agent roles per the 2026-09-16 parity audit) / 5 / 4 |

No source, test, or config file has changed since the previous map (2026-11-05). Last code commit touching `lib/`, `server.js`, `test/` or the configs is `f6b5b38` (2026-10-16, resource-server token validator).

## Package

- **Name:** `@quox/mcp` v1.3.0
- **Main / bin:** `server.js` (CLI bin: `quoxmcp`)
- **License:** Quox Community Source Licence 1.0 (see `LICENSE`)
- **Node:** >=20.0.0 (uses the global `crypto.randomUUID()`, no `require('crypto')`)
- **Scripts:** `start` (`node server.js`), `test` (`vitest run`)

## Architecture

```
Claude CLI ──STDIO──► QuoxMCP ──HTTP──► QuoxCORE Collector (port 9848)
                         │                      │
                    MCP JSON-RPC           RBAC, Bastion, Audit
                    stdin/stdout                │
                         ▼                      ▼
                   Protocol Adapter        Infrastructure
                   (no tool logic)         (SSH, Docker, Proxmox, Discord Pro, X, etc.)
```

QuoxMCP is a **thin protocol bridge**: tools, resources, and prompts are fetched from the collector API at startup. No domain logic lives here; all execution goes through the collector, which handles RBAC, bastion routing, approval gates, and audit trails. Discord Pro and X (Twitter) tools flow through the same generic adapter, including the collector's pending-approval bodies for the mutating ones, forwarded untouched.

## Entry Point: `server.js`

Single entry point, spawned as a STDIO subprocess by Claude CLI (`--mcp-config`) or Claude Desktop (MCPB).

**Startup validation (`server.js:43-88`), fatal on failure:**
1. Service key present (`QUOX_SERVICE_KEY` or `INTERNAL_SERVICE_KEY`).
2. `QUOX_ORG_ID` present.
3. `QUOX_AGENT_ID` matches the safe-ID pattern.
4. `QUOX_COLLECTOR_URL` is a valid http/https URL (warns on plain HTTP to a public host).

**Non-fatal:** missing `QUOX_USER_ID` (warn; org-scoped service contexts such as the Matrix appservice are legitimate), non-conforming `QUOX_SESSION_ID` (sanitized to the safe charset, since Matrix room IDs contain `!` and `:`).

**`main()` (`server.js:105-186`):**
1. `new McpServer({ name: 'quoxmcp', version: '1.3.0' })` + `CollectorClient` with service-key auth.
2. `client.listTools(agentId, orgId)`. On failure: log, continue with 0 tools, set `initialLoadFailed` (never exit pre-connect). Logs connector-tool count (`provider` starting `connector:`) separately.
3. `registerTools(...)`, then `listResources()` → `registerResources(...)`, `listPrompts()` → `registerPrompts(...)` (each independently tolerant of collector errors).
4. `server.setToolRequestHandlers()` so the tools capability is declared even with zero tools (allows post-connect registration).
5. `server.connect(new StdioServerTransport())`.
6. If the initial load failed: `startToolRediscovery(...)` retries on a bounded backoff and registers tools when found (SDK emits `tools/list_changed`).

**Shutdown (`server.js:189-205`):** exits on SIGTERM, SIGINT, stdin `end`/`close` (so a parent `claude -p` never hangs on a lingering keep-alive socket), and EPIPE on stdout. `unhandledRejection` / `uncaughtException` exit 1. All logging goes to stderr; stdout is reserved for the MCP protocol.

## File Tree

```
quoxmcp/
├── server.js                    # Entry point: env validation, MCP server setup, STDIO, shutdown
├── lib/
│   ├── collector-client.js      # HTTP client for collector API (GET retried, POST never)
│   ├── tool-adapter.js          # JSON Schema → Zod (constraint-preserving) + MCP tool registration
│   ├── tool-discovery.js        # Bounded post-connect tool rediscovery
│   ├── resource-adapter.js      # MCP resource registration + TTL cache
│   ├── prompt-adapter.js        # MCP prompt registration + mustache templating
│   ├── validate.js              # Input validation + error sanitization
│   └── mcp-auth.js              # OAuth resource-server token validator (standalone, not yet wired)
├── test/                        # 10 vitest files (see Test Coverage)
├── deploy/
│   ├── bundle.sh                # Tarball packaging for fleet hosts
│   └── quoxmcp-bundle.tar.gz    # Pre-built deployment tarball
├── docs/assets/readme-hero.png  # README artwork
├── manifest.json                # MCPB manifest (Claude Desktop one-click install)
├── package.json / package-lock.json
├── LICENSE                      # Quox Community Source Licence 1.0
└── README.md
```

Build artifacts (`dist/quoxmcp.mcpb`, MCPB staging) are gitignored and not present in this checkout.

## Registries

There are no static registries in this repo. All three MCP surfaces are populated at runtime from the collector:

| Surface | Collector endpoint | Adapter | Registration |
|---------|-------------------|---------|--------------|
| Tools | `GET /api/v1/tools/list?agent_id=&org_id=` | `tool-adapter.js` → `registerTools(server, tools, client, ctx)` | `server.tool(name, desc, zodShape, handler)`; handler proxies to `client.executeTool()` |
| Resources | `GET /api/v1/resources/list` | `resource-adapter.js` → `registerResources(server, resources, client)` | `server.resource(...)`, TTL cache 30s / 100 entries |
| Prompts | `GET /api/v1/prompts/list` | `prompt-adapter.js` → `registerPrompts(server, prompts)` | `server.prompt(name, argsShape, handler)` with templating |

To expose a new tool/resource/prompt: add it in the **collector** (quox-dashboard `services/collector`). This repo needs no change. Proven twice: Discord Pro and X native tools landed with zero MCP-side code, only lock-in tests.

## Collector API Calls (outbound)

| Method | Path | Called from | Retry |
|--------|------|-------------|-------|
| GET | `/api/v1/tools/list?agent_id=...&org_id=...` | `listTools()` at startup + rediscovery | Yes (idempotent, `retries` default 2, backoff 1s→8s cap) |
| GET | `/api/v1/resources/list` | `listResources()` at startup, and on live-resource reads after cache TTL | Yes |
| GET | `/api/v1/prompts/list` | `listPrompts()` at startup | Yes |
| POST | `/api/v1/tools/execute` | `executeTool()` per tool call | **Never** (mutation; a retry after a lost response would duplicate the tool run, quox#1183/#4) |

All requests carry `X-Service-Key`, honour a 30s timeout (`AbortSignal.timeout`), and sanitize error bodies before they reach logs or Claude. QuoxMCP exposes no inbound HTTP routes; its only inbound surface is MCP over STDIO.

## lib/ Module Details

### collector-client.js (144 lines)
`class CollectorClient(baseUrl, { timeout=30000, retries=2, serviceKey })`. Methods: `listTools(agentId, orgId)`, `listResources()`, `listPrompts()`, `executeTool(name, input, agentId, sessionId, orgId, userId, authToken)`. Internals: `_get` (idempotent), `_post` (non-idempotent), `_request(path, opts, { idempotent })`. Response shape validated (`tools`/`resources`/`prompts` must be arrays). `org_id`, `user_id`, `auth_token` are only added to the execute body when set.

### tool-adapter.js (192 lines)
Exports `registerTools`, `jsonSchemaToZodShape(properties, required)`, `jsonSchemaToZodItem(items)`. `jsonSchemaToZodType` preserves JSON-Schema constraints: integer-ness, `minimum`/`maximum`, `exclusiveMinimum`/`exclusiveMaximum`, `minLength`/`maxLength`, `pattern` (invalid regex ignored), `minItems`/`maxItems`, enum (string enums → `z.enum`, mixed → literal union), nullable, defaults; recursive for arrays and objects. Tools with a missing name/description or an unsafe name are skipped (`tool-adapter.js:128`). Handler rejects inputs over 1MB before calling the collector (`:144`) and returns errors as structured text content with `isError: true`, never throwing into the SDK.

### tool-discovery.js (53 lines)
Exports `startToolRediscovery({ listTools, onTools, delaysMs, log })` and `DEFAULT_DELAYS_MS = [2000, 5000, 15000, 30000, 60000]`. Returns `{ finished, cancel() }`. Timers are `unref`'d so they never keep the process alive. Gives up after the last delay and logs that it is serving without tools.

### resource-adapter.js (121 lines)
Exports `registerResources`, `_resourceCache` (Map), `RESOURCE_CACHE_TTL` (30s), `RESOURCE_CACHE_MAX` (100, oldest-first eviction), `_resourceCacheSet`. Accepts `quox://`, `https://`, `http://` URIs. Live resources re-fetch via the client after TTL expiry and fall back to static content on error; static resources are served from the definition.

### prompt-adapter.js (113 lines)
Exports `registerPrompts`, `buildArgsShape(args)`, `interpolateArgs(template, args)`. Template syntax: `{{var}}`, `{{var|default}}`, `{{#var}}...{{/var}}` (if set), `{{^var}}...{{/var}}` (if unset). User args pass through `escapeTemplateChars` to block template injection.

### validate.js (131 lines)
Constants: `SAFE_ID` (`/^[a-zA-Z0-9_-]{1,64}$/`), `SAFE_TOOL_NAME` (`/^[a-zA-Z0-9_.-]{1,128}$/`), `MAX_INPUT_SIZE` (1MB), `ALLOWED_URI_SCHEMES` (`quox:`, `https:`, `http:`). Functions: `isValidId`, `isValidToolName`, `validateUrl` (returns `{ valid, parsed, warning }`), `isValidResourceUri`, `sanitizeError` (strips collector URLs, `/home` `/opt` `/etc` `/var` paths, private IPs), `escapeTemplateChars`, `inputTooLarge`.

### mcp-auth.js (141 lines) — standalone
Exports `validatePrincipal(token, { expectedAudience, issuer?, requiredScopes?, verify?, secret? })`. OAuth resource-server token validator for a future remote (non-STDIO) MCP transport. Fail-closed: always returns `{ ok:false, status, error_code, error }` rather than throwing (`401 token_missing` / `invalid_token` / `audience_mismatch`, `403 insufficient_scope`, `500 server_misconfigured`). Default verifier is HS256 using `QUOX_JWT_SECRET` / `JWT_SECRET`; a custom `verify` can be injected but `exp`/`nbf`/`aud`/`iss` are re-enforced in the common path. Principal (`org_id`, `user_id`, `agent_id`, `scopes`) comes only from verified claims. Explicit no-token-passthrough contract: the inbound token must never be forwarded to the collector. **Not imported by `server.js`**; only `test/mcpAuth.test.js` exercises it.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `QUOX_SERVICE_KEY` | Yes | — | Collector auth (fallback: `INTERNAL_SERVICE_KEY`) |
| `QUOX_ORG_ID` | Yes | — | Org ID; also merges the org's connector tools into the tool list |
| `QUOX_USER_ID` | No | — | User ID for audit attribution; warn if missing |
| `QUOX_AGENT_ID` | No | `quox` | Agent identity for RBAC (validated against `SAFE_ID`) |
| `QUOX_SESSION_ID` | No | random UUID | Correlation ID, sanitized if non-conforming |
| `QUOX_COLLECTOR_URL` | No | `http://127.0.0.1:9848` | Collector API base URL |
| `QUOX_AUTH_TOKEN` | No | `""` | Auth token forwarded in the execute body |
| `QUOX_JWT_SECRET` / `JWT_SECRET` | No | — | HS256 secret for `mcp-auth.js` (unused by the STDIO server today) |

## Config Files

| File | Controls |
|------|----------|
| `package.json` | Package identity, `quoxmcp` bin, `start`/`test` scripts, Node >=20 engine, 2 runtime deps |
| `manifest.json` | MCPB bundle (manifest v0.3) for Claude Desktop: maps `user_config` fields (`collector_url`, `service_key` [sensitive], `agent_id`, `org_id`, `user_id`) onto the `QUOX_*` env vars above. `collector_url`, `service_key`, `org_id` required; `agent_id`, `user_id` optional |
| `deploy/bundle.sh` | Stages `server.js`, `lib/`, `package.json`, `node_modules/` into a flat tarball for extraction to `/opt/quoxmcp/` on fleet hosts (config lives at `/etc/quoxmcp/mcp-config.json`, chmod 600). Requires `node_modules/` present; no `npm install` on the remote |
| `.gitignore` | `node_modules/`, `.env`, `*.log`, `coverage/`, `dist/`, `build/`, `.DS_Store` |

No vitest config file: tests run with vitest defaults (`vitest run`).

## Test Coverage

| File | Lines | Cases | Focus |
|------|-------|-------|-------|
| `adapter.test.js` | 368 | 29 | JSON Schema → Zod conversion, constraint parity (#7), `registerTools` |
| `client.test.js` | 311 | 23 | HTTP client, GET retries + backoff, POST never retried (#4), service key, URL handling |
| `discord-tools.test.js` | 180 | 5 | Discord Pro tool shapes via generic adapter, approval-gate passthrough |
| `mcpAuth.test.js` | 93 | 13 | `validatePrincipal`: signature, exp/nbf, aud/iss, identity claims, scopes, fail-closed |
| `prompt-adapter.test.js` | 227 | 23 | `buildArgsShape`, `interpolateArgs`, `registerPrompts` |
| `resource-adapter.test.js` | 209 | 13 | Static vs live resources, TTL cache, eviction |
| `security.test.js` | 414 | 40 | Service key enforcement, ID/URL/tool-name/URI validation, response validation, template injection, input size, error sanitization |
| `server.test.js` | 227 | 11 | McpServer creation, tool registration integration, env handling, rediscovery (#6), version consistency (#9) |
| `validate.test.js` | 212 | 33 | Every `validate.js` export |
| `x-tools.test.js` | 167 | 4 | X native tools (`x_post`, `x_thread`, `x_delete`, `x_budget_status`) via generic adapter, approval passthrough |

Tests are ESM (`import` from vitest) against CommonJS lib modules, with `fetch` mocked via `vi`. `client.test.js` takes ~12s because it exercises real backoff delays. No live-collector test is in the suite; `README.md` describes a manual standalone check, and `x-tools.test.js` records a live curl confirmation from 2026-09-12 in its header comment.

## Resilience

- **Graceful degradation:** `listTools()` failure at startup connects with 0 tools, then rediscovers on a 2s/5s/15s/30s/60s schedule.
- **Post-connect registration:** `setToolRequestHandlers()` before `connect()` keeps the tools capability declared so late registration works.
- **Non-idempotent execute:** tool execution fires exactly once; only list calls retry.
- **Session ID sanitization** and **optional user ID** keep Matrix/Rooms/Slack/Telegram agent turns from dying before the MCP handshake.
- **STDIO client shutdown:** exits on stdin end/close so a parent `claude -p` never blocks (proven 2026-08-14).

## Invariants

| Check | Status | Details |
|-------|--------|---------|
| Adapters imported by entry point | ⚠ warn | 6 of 7 lib modules imported at `server.js:20-25`. `lib/mcp-auth.js` is standalone (remote-transport validator, no consumer yet) |
| Each lib module has a test | ✓ pass | 7 modules; `tool-discovery.js` covered inside `server.test.js`, the rest have dedicated files |
| No domain/tool logic in repo | ✓ pass | All execution proxied to collector; Discord Pro and X exposure needed zero MCP-side code |
| Fatal env validation before connect | ✓ pass | `server.js:43-88` (service key, org ID, agent ID, URL) |
| Never exits pre-connect on collector failure | ✓ pass | `server.js:128-138`, rediscovery `server.js:178-183` |
| executeTool never retried | ✓ pass | `collector-client.js` `_post` → `idempotent: false`; locked by `client.test.js` |
| Version aligned (package.json / manifest.json / server.js) | ✓ pass | 1.3.0 everywhere; locked by `server.test.js` (#9) |
| manifest.json `user_id` matches server behaviour | ✓ pass | Both optional since #9 |
| Deps minimal (2 runtime, 1 dev) | ✓ pass | |
| Tool count honest in docs | ✓ pass | manifest.json and README state the count is agent- and org-scoped |
| Full suite executed and green | ✓ pass | `npx vitest run`: 10 files, 194/194 passed, 2026-11-06 |
| README test count current | ⚠ warn | `README.md:320` Development section still says "168 tests across 9 files"; suite is 194 across 10 (stale since the 2026-10-23 map) |
| Checkout runnable as-is | ✓ pass | `node_modules/` installed (123 packages); `npm test` and `deploy/bundle.sh` run without a prior `npm install` |

## Related

- **QuoxCORE collector** (quox-dashboard `services/collector`): provides all tools/resources/prompts, incl. `discordProTools.js`, `xTools.js`, `quoxbrain_search`
- **quox-dashboard**: UI for QuoxCORE
- **quoxagent**: Go per-host sidecar that can host QuoxMCP
- **quox-discord-pro**: Discord gateway daemon whose tools are exposed through this bridge
- **quoxpert-mcp** skill: install and troubleshooting recipes for this server
