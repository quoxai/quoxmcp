<!-- Last verified: 2026-03-27 by /codebase-mirror -->

# QuoxMCP — Codebase Map

## Metrics
| Metric | Count |
|--------|-------|
| Tools | 83+ (dynamic per agent RBAC) |
| Resources | 5 |
| Prompts | 4 |
| Test Files | 6 |

## Architecture

Thin MCP protocol adapter. All tools, resources, and prompts are fetched dynamically from QuoxCORE collector API at startup, then registered onto the MCP server.

## Registration Flow
1. Tools fetched from collector at startup via `GET /api/v1/tools/list`
2. JSON Schema parameters converted to Zod via `jsonSchemaToZodShape()`
3. Each tool registered with `server.tool()`, handler proxies to `CollectorClient.executeTool()`
4. Resources and prompts similarly fetched and registered

## Authoritative Files
| File | Purpose |
|------|---------|
| `server.js` | Entry point, startup orchestration, STDIO transport |
| `lib/tool-adapter.js` | Tool registration + JSON→Zod conversion |
| `lib/resource-adapter.js` | Resource registration (static + live with 30s TTL) |
| `lib/prompt-adapter.js` | Prompt registration + Mustache templating |
| `lib/collector-client.js` | HTTP client to collector API (retry + backoff) |

## Invariants
| Check | Status | Details |
|-------|--------|---------|
| env-validation | ✓ pass | Required: QUOX_AGENT_ID, QUOX_SESSION_ID, QUOX_COLLECTOR_URL, QUOX_SERVICE_KEY |
| tool-name-validation | ✓ pass | Alphanumeric/dash/underscore, max 128 chars |
| template-injection | ✓ pass | Mustache args escaped before interpolation |

## Test Files (6)
adapter.test.js, client.test.js, prompt-adapter.test.js, resource-adapter.test.js, security.test.js, server.test.js
