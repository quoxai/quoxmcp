<!-- Last verified: 2026-03-30 by codebase-mirror scan -->

# QuoxMCP — Codebase Map

MCP (Model Context Protocol) server bridging Claude CLI to QuoxCORE infrastructure tools.
Thin protocol adapter — all tool logic lives in the collector, not here.

## Metrics
| Metric | Value |
|--------|-------|
| Tools | dynamic (from collector API) |
| Resources | dynamic (from collector API) |
| Prompts | dynamic (from collector API) |
| Source Files | 6 (server.js + 5 lib modules) |
| Source Lines | 784 |
| Test Files | 7 |
| Node.js | >=20.0.0 |
| Transport | STDIO (subprocess) |

## File Map

### Entry Point
| File | Lines | Purpose |
|------|-------|---------|
| `server.js` | 128 | MCP server entry point, startup orchestration, env validation, graceful shutdown |

### Lib Modules
| File | Lines | Exports | Purpose |
|------|-------|---------|---------|
| `lib/validate.js` | 131 | `isValidId`, `isValidToolName`, `validateUrl`, `isValidResourceUri`, `sanitizeError`, `escapeTemplateChars`, `inputTooLarge`, `SAFE_ID`, `SAFE_TOOL_NAME`, `MAX_INPUT_SIZE`, `ALLOWED_URI_SCHEMES` | Input validation, security sanitizers, regex patterns |
| `lib/collector-client.js` | 127 | `CollectorClient` | HTTP client for collector API (retries, auth, timeout) |
| `lib/tool-adapter.js` | 176 | `registerTools`, `jsonSchemaToZodShape`, `jsonSchemaToZodItem` | JSON Schema -> Zod, tool registration + execution proxy |
| `lib/resource-adapter.js` | 109 | `registerResources`, `_resourceCache`, `RESOURCE_CACHE_TTL` | MCP resource registration, 30s TTL cache for live resources |
| `lib/prompt-adapter.js` | 113 | `registerPrompts`, `buildArgsShape`, `interpolateArgs` | MCP prompt registration, mustache-like template interpolation |

### Deploy
| File | Purpose |
|------|---------|
| `deploy/bundle.sh` | Bundle packaging script for remote deployment (server.js + lib/ + node_modules/) |
| `deploy/quoxmcp-bundle.tar.gz` | Pre-built deployment bundle (~15MB) |

### Tests
| File | Coverage |
|------|----------|
| `test/server.test.js` | MCP server integration |
| `test/adapter.test.js` | Schema conversion, tool registration |
| `test/client.test.js` | CollectorClient with mocked HTTP |
| `test/resource-adapter.test.js` | Resource adapter, caching |
| `test/prompt-adapter.test.js` | Prompt template interpolation |
| `test/security.test.js` | Security hardening tests |
| `test/validate.test.js` | Validation utilities |

## Startup Flow

```
1. Validate env vars (exit 1 on failure)
   |- QUOX_SERVICE_KEY (required — no anonymous tool execution)
   |- QUOX_AGENT_ID (default: "quox", validated via isValidId)
   |- QUOX_COLLECTOR_URL (default: "http://127.0.0.1:9848", validated via validateUrl)
   +- QUOX_SESSION_ID, QUOX_ORG_ID, QUOX_USER_ID, QUOX_AUTH_TOKEN (optional)
2. Create McpServer ("quoxmcp" v1.0.0)
3. Create CollectorClient with service key auth
4. Fetch tools -> GET /api/v1/tools/list?agent_id={id} -> registerTools()
5. Fetch resources -> GET /api/v1/resources/list -> registerResources()
6. Fetch prompts -> GET /api/v1/prompts/list -> registerPrompts()
7. Connect StdioServerTransport
8. Graceful shutdown on SIGTERM/SIGINT
```

## Collector API Endpoints Used
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/tools/list?agent_id={id}` | Fetch available tools for agent |
| POST | `/api/v1/tools/execute` | Execute a tool (body: tool_name, input, agent_id, session_id, org_id?, user_id?, auth_token?) |
| GET | `/api/v1/resources/list` | Fetch MCP resources |
| GET | `/api/v1/prompts/list` | Fetch MCP prompts |

## CollectorClient Details

- **Base URL**: Configured via `QUOX_COLLECTOR_URL`
- **Auth**: `X-Service-Key` header on every request
- **Timeout**: 30s per request
- **Retries**: 2 attempts with exponential backoff (max 8s delay)
- **Methods**: `listTools(agentId)`, `listResources()`, `listPrompts()`, `executeTool(...)`

## Security Invariants
| Check | Status | Implementation |
|-------|--------|----------------|
| Service key required | Y | Startup fails without QUOX_SERVICE_KEY |
| Agent ID validation | Y | `isValidId()` — alphanumeric/dash/underscore, max 64 chars |
| Tool name validation | Y | `isValidToolName()` — alphanumeric/dot/dash/underscore, max 128 chars |
| URL validation | Y | `validateUrl()` — http/https only, warns on non-private HTTP |
| Resource URI validation | Y | `isValidResourceUri()` — quox:/https:/http: schemes only |
| Input size limit | Y | `inputTooLarge()` — 1MB max |
| Error sanitization | Y | `sanitizeError()` — strips IPs, paths, internal hostnames |
| Template injection | Y | `escapeTemplateChars()` — escapes `{{}}` in prompt args |

## Architecture Notes

- **No tool logic here** — All tools defined in collector (`quox-dashboard/services/collector`)
- **Stateless** — No persistent state; all state lives in collector/memory service
- **Auth flow** — Service key sent as `X-Service-Key` header on every collector request
- **Caching** — Live resources cached 30s to avoid redundant fetches
- **Retries** — Collector calls retry 2x with exponential backoff (max 8s delay)
- **Timeout** — 30s per collector request

## Schema Conversion

Tool adapter converts collector JSON Schema to Zod:
- `string` -> `z.string()`
- `number`/`integer` -> `z.number()`
- `boolean` -> `z.boolean()`
- `array` -> `z.array()` with typed items
- `object` -> `z.object()` or `z.record()` for generic objects
- `enum` -> `z.enum()`
- Supports `required`, `default`, `description`

## Prompt Template Syntax

| Pattern | Description |
|---------|-------------|
| `{{var}}` | Simple substitution |
| `{{var\|default}}` | Substitution with default value |
| `{{#var}}...{{/var}}` | Conditional block (included if var is set) |
| `{{^var}}...{{/var}}` | Inverse block (included if var is NOT set) |

## Adding Tools

Tools are NOT defined in quoxmcp. Add them in:
```
quox-dashboard/services/collector/server.js -> agentToolAccess / toolDefinitions
```

## Dependencies
| Package | Version | Purpose |
|---------|---------|---------|
| @modelcontextprotocol/sdk | ^1.0.0 | MCP server + STDIO transport |
| zod | (via MCP SDK) | Schema validation |
| vitest | ^4.0.0 | Test runner (devDependency) |

## Remote Deployment Layout
| Path | Contents |
|------|----------|
| `/opt/quoxmcp/server.js` | Entry point |
| `/opt/quoxmcp/lib/` | Protocol adapters |
| `/opt/quoxmcp/node_modules/` | Dependencies |
| `/etc/quoxmcp/mcp-config.json` | MCP config (chmod 600) |
