<!-- Last verified: 2026-03-14 by /codebase-mirror -->

# QuoxMCP — Codebase Map

## Metrics
| Metric | Count |
|--------|-------|
| Source Modules | 6 |
| Test Files | 6 |
| Tests | 121 |
| Resources | 5 |
| Prompts | 4 |
| Tools | Dynamic (79-83 per agent) |
| Version | 1.0.0 |

## Authoritative Files
| File | Purpose | Lines |
|------|---------|-------|
| `server.js` | MCP startup, env validation | ~129 |
| `lib/tool-adapter.js` | JSON Schema→Zod, tool registration | ~177 |
| `lib/resource-adapter.js` | Resource registration, 30s cache | ~110 |
| `lib/prompt-adapter.js` | Prompt registration, template interpolation | ~114 |
| `lib/collector-client.js` | HTTP client, retries, auth | ~128 |
| `lib/validate.js` | Input validation, sanitizers | ~132 |

## Invariants
| Check | Status | Details |
|-------|--------|---------|
| Dynamic registry | ✓ pass | Tools/resources/prompts fetched from collector at startup |
| Test coverage | ✓ pass | 121 tests, 2.4:1 test-to-code ratio |
| Security validation | ✓ pass | 40 security tests, input sanitization, template injection prevention |

## Resources (5)
System Identity, Fleet Topology, Agent Capabilities, Service Status, Configuration

## Prompts (4)
Incident Triage, Security Sweep, Deploy Checklist, Fleet Review

## Collector API Endpoints Called
| Endpoint | Method | When |
|----------|--------|------|
| `/api/v1/tools/list` | GET | Startup |
| `/api/v1/tools/execute` | POST | Tool invocation |
| `/api/v1/resources/list` | GET | Startup + live reads (30s cache) |
| `/api/v1/prompts/list` | GET | Startup |

## Test Files (6)
| File | Tests | Focus |
|------|-------|-------|
| `adapter.test.js` | 22 | JSON Schema→Zod, tool registration |
| `client.test.js` | — | Collector HTTP client, retries |
| `prompt-adapter.test.js` | 23 | Template interpolation, args |
| `resource-adapter.test.js` | 13 | Resource registration, caching |
| `security.test.js` | 40 | Input validation, auth, sanitizers |
| `server.test.js` | — | MCP server creation |

## Key Validation Rules
- Agent ID: alphanumeric/dash/underscore, max 64 chars
- Resource URI: `quox://` scheme only
- Input size: 1MB limit per tool execution
- Template injection: user args escaped before interpolation
- Error messages: sanitized to 200 chars max
