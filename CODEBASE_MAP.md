<!-- Last verified: 2026-03-10 by /codebase-mirror -->

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

## Authoritative Files
| File | Purpose | Lines |
|------|---------|-------|
| `server.js` | MCP startup, env validation | ~129 |
| `lib/tool-adapter.js` | JSON Schema→Zod, tool registration | ~177 |
| `lib/resource-adapter.js` | Resource registration, 30s cache | ~110 |
| `lib/prompt-adapter.js` | Template interpolation, prompts | ~114 |
| `lib/collector-client.js` | HTTP client, retries, auth | ~128 |
| `lib/validate.js` | Input validation, sanitization | ~132 |

## Invariants
| Check | Status | Details |
|-------|--------|---------|
| Dynamic registry | ✓ pass | Tools/resources/prompts fetched from collector at runtime |
| Test coverage | ✓ pass | 121 tests, 2.4:1 test-to-code ratio |

## Resources (5)
System Identity, Fleet Topology, Agent Capabilities, Service Status, Configuration

## Prompts (4)
Incident Triage, Security Sweep, Deploy Checklist, Fleet Review

## Test Suite (6 files, 121 tests)
adapter.test.js, client.test.js, prompt-adapter.test.js, resource-adapter.test.js, security.test.js, server.test.js
