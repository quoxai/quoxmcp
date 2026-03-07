<!-- Last verified: 2026-03-06 by /codebase-mirror -->

# QuoxMCP — Codebase Map

## Metrics
| Metric | Count |
|--------|-------|
| Version | 1.0.0 |
| Core Modules | 5 |
| Test Files | 6 |
| Test Lines | 1,564 |
| Tools | Dynamic (fetched from collector) |
| Resources | Dynamic |
| Prompts | Dynamic |

## Authoritative Files
| File | Purpose | Lines |
|------|---------|-------|
| `server.js` | Entry point, MCP startup | — |
| `lib/tool-adapter.js` | JSON Schema→Zod, tool registration | ~177 |
| `lib/resource-adapter.js` | Resource registration (live/static) | ~110 |
| `lib/prompt-adapter.js` | Template interpolation, prompt registration | ~114 |
| `lib/collector-client.js` | HTTP client to collector API | ~128 |
| `lib/validate.js` | ID/URI/input validators, error sanitization | ~132 |

## Invariants
| Check | Status | Details |
|-------|--------|---------|
| Test-to-code ratio | ✓ pass | 2.4:1 (1,564 test lines / 661 source lines) |
| Dependencies minimal | ✓ pass | 1 prod dep (@modelcontextprotocol/sdk) |
| Security tests | ✓ pass | Dedicated security.test.js (414 lines) |

## Architecture
- **Transport:** STDIO (StdioServerTransport for Claude CLI)
- **Auth:** Service key required (`QUOX_SERVICE_KEY` env var)
- **Tool source:** Dynamic from collector API (`/api/v1/tools/list`)
- **Resource types:** Live (30s TTL cache) and Static
- **Prompt templating:** Mustache-style with conditionals, defaults, escaping
- **Input validation:** 1MB payload limit, tool name pattern enforcement

## Test Suite
| File | Lines | Focus |
|------|-------|-------|
| adapter.test.js | 313 | Tool Zod schema, registration |
| client.test.js | 248 | HTTP client, retries, timeout |
| prompt-adapter.test.js | 227 | Template interpolation, escaping |
| resource-adapter.test.js | 209 | Live/static resources, caching |
| security.test.js | 414 | Validation, sanitization |
| server.test.js | 153 | Startup, shutdown |

## Startup Flow
1. Validate env: `QUOX_AGENT_ID`, `QUOX_SESSION_ID`, `QUOX_COLLECTOR_URL`, `QUOX_SERVICE_KEY`
2. Create `CollectorClient` (HTTP client)
3. Fetch tools from `/api/v1/tools/list` → register with Zod validation
4. Fetch resources from `/api/v1/resources/list` → register (live/static)
5. Fetch prompts from `/api/v1/prompts/list` → register with template interpolation
6. Connect via StdioServerTransport
