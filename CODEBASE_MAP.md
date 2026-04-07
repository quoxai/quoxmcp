<!-- Last verified: 2026-04-07 by /codebase-mirror -->

# QuoxMCP — Codebase Map

MCP (Model Context Protocol) server bridging Claude CLI to QuoxCORE infrastructure tools.

## Metrics
| Metric | Count |
|--------|-------|
| Lib Modules | 5 |
| Test Files | 7 |

## Architecture
Pure protocol bridge — zero hardcoded tools. Tools, resources, and prompts are dynamically fetched from collector API at startup via `CollectorClient.listTools(agentId)`.

## Authoritative Files
| File | Purpose |
|------|---------|
| `server.js` | Entry point — env validation, McpServer creation, transport setup |
| `lib/tool-adapter.js` | Converts collector tool defs (Anthropic JSON Schema) → MCP Zod registrations |
| `lib/resource-adapter.js` | Static + live MCP resources (30s TTL cache) |
| `lib/prompt-adapter.js` | Mustache-style template interpolation |
| `lib/collector-client.js` | HTTP client for collector API |
| `lib/validate.js` | Input validation (IDs, URLs, tool names, resource URIs, size limits) |

## Invariants
| Check | Status | Details |
|-------|--------|---------|
| env-validation | ✓ pass | Service key required, agent ID format validated |
| tool-name-validation | ✓ pass | Tool names sanitized |
| template-injection | ✓ pass | Prompt templates use safe interpolation |

## Environment Variables
`QUOX_AGENT_ID`, `QUOX_SESSION_ID`, `QUOX_COLLECTOR_URL`, `QUOX_SERVICE_KEY`, `QUOX_ORG_ID`, `QUOX_USER_ID`, `QUOX_AUTH_TOKEN`

## Dependencies
`@modelcontextprotocol/sdk` ^1.0.0 (runtime), `vitest` ^4.0.0 (dev)
