<!-- Last verified: 2026-04-13 by codebase-mirror scan -->

# QuoxMCP — Codebase Map

MCP (Model Context Protocol) server bridging Claude CLI to QuoxCORE infrastructure tools.

## Metrics
| Metric | Count |
|--------|-------|
| Lib Modules | 5 |
| Test Files | 7 |
| Source Lines | 784 |
| Test Lines | 1776 |

## Architecture
Pure protocol bridge — zero hardcoded tools. Tools, resources, and prompts are dynamically fetched from collector API at startup via `CollectorClient.listTools(agentId)`.

```
┌─────────────────┐     STDIO      ┌─────────────────┐     HTTP      ┌─────────────────┐
│   Claude CLI    │◄──────────────►│    QuoxMCP      │◄────────────►│   Collector API │
│  (mcp-config)   │   MCP Protocol │   server.js     │  /api/v1/*   │   (port 9848)   │
└─────────────────┘                └─────────────────┘              └─────────────────┘
```

## Authoritative Files
| File | Lines | Purpose |
|------|-------|---------|
| `server.js` | 128 | Entry point — env validation, McpServer creation, transport setup |
| `lib/tool-adapter.js` | 176 | Converts collector tool defs (Anthropic JSON Schema) → MCP Zod registrations |
| `lib/collector-client.js` | 127 | HTTP client for collector API (tools, resources, prompts, execute) |
| `lib/validate.js` | 131 | Input validation (IDs, URLs, tool names, resource URIs, size limits) |
| `lib/prompt-adapter.js` | 113 | Mustache-style template interpolation for prompts |
| `lib/resource-adapter.js` | 109 | Static + live MCP resources (30s TTL cache) |

## Test Coverage
| Test File | Lines | Scope |
|-----------|-------|-------|
| `test/security.test.js` | 414 | Comprehensive security validation (injection, overflow, sanitization) |
| `test/adapter.test.js` | 313 | Tool adapter JSON Schema → Zod conversion |
| `test/client.test.js` | 248 | CollectorClient HTTP methods, retries, error handling |
| `test/prompt-adapter.test.js` | 227 | Template interpolation, conditional blocks, escaping |
| `test/validate.test.js` | 212 | All validation functions |
| `test/resource-adapter.test.js` | 209 | Resource registration, TTL cache, live/static modes |
| `test/server.test.js` | 153 | Server startup, env validation, shutdown |

## Collector API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/tools/list?agent_id=` | Fetch available tools for agent |
| POST | `/api/v1/tools/execute` | Execute tool (RBAC-checked) |
| GET | `/api/v1/resources/list` | Fetch MCP resource definitions |
| GET | `/api/v1/prompts/list` | Fetch MCP prompt templates |

## Environment Variables
| Variable | Required | Purpose |
|----------|----------|---------|
| `QUOX_SERVICE_KEY` | Yes | Service authentication (or `INTERNAL_SERVICE_KEY`) |
| `QUOX_AGENT_ID` | No | Agent identity for RBAC (default: `quox`) |
| `QUOX_SESSION_ID` | No | Session identifier for context |
| `QUOX_COLLECTOR_URL` | No | Collector API base (default: `http://127.0.0.1:9848`) |
| `QUOX_ORG_ID` | No | Organisation ID for multi-tenant |
| `QUOX_USER_ID` | No | User ID for audit trails |
| `QUOX_AUTH_TOKEN` | No | User auth token passthrough |

## Security Invariants
| Check | Status | Details |
|-------|--------|---------|
| env-validation | pass | Service key required, agent ID format validated |
| tool-name-validation | pass | Tool names sanitized (`SAFE_TOOL_NAME` regex: alphanumeric, `_`, `.`, `-`, max 128 chars) |
| template-injection | pass | Prompt templates use `escapeTemplateChars()` |
| input-size-limit | pass | 1MB max input size (`inputTooLarge()`) |
| resource-uri-scheme | pass | Only `quox://`, `http://`, `https://` allowed |
| error-sanitization | pass | Internal IPs/paths stripped from error messages |

## Dependencies
| Package | Version | Purpose |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | ^1.0.0 | MCP server primitives (runtime) |
| `vitest` | ^4.0.0 | Test framework (dev) |

## Key Functions

### server.js
- `main()` — Startup sequence: validate env, create McpServer, fetch tools/resources/prompts, connect STDIO transport
- `shutdown(signal)` — Graceful SIGTERM/SIGINT handler

### tool-adapter.js
- `registerTools(server, tools, client, ctx)` — Main registration loop, validates tool names, converts schemas
- `jsonSchemaToZodShape(properties, required)` — Recursive JSON Schema → Zod conversion (handles nested objects, arrays, enums)
- `jsonSchemaToZodItem(items)` — Array item schema conversion

### collector-client.js
- `listTools(agentId)` — GET tools for agent
- `listResources()` — GET MCP resources
- `listPrompts()` — GET prompt templates
- `executeTool(name, input, agentId, sessionId, orgId, userId, authToken)` — POST tool execution with full context
- `_request(path, opts)` — Retry logic with exponential backoff (max 2 retries, 8s cap)

### validate.js
- `isValidId(id)` — Validate agent/session IDs (alphanumeric/dash/underscore, max 64 chars)
- `isValidToolName(name)` — Validate tool names (128 chars, safe chars)
- `validateUrl(url)` — URL validation with HTTP warning for non-private networks
- `isValidResourceUri(uri)` — Resource URI scheme check
- `sanitizeError(message)` — Strip internal IPs, paths, hostnames from errors
- `escapeTemplateChars(value)` — Prevent template injection (`{{` → `\{\{`)
- `inputTooLarge(input)` — 1MB limit check

### prompt-adapter.js
- `registerPrompts(server, prompts)` — Register prompts with Zod arg shapes
- `interpolateArgs(template, args)` — Mustache-style substitution with conditionals: `{{var}}`, `{{#var}}...{{/var}}`, `{{^var}}...{{/var}}`, `{{var|default}}`
- `buildArgsShape(args)` — Convert arg defs to Zod shape

### resource-adapter.js
- `registerResources(server, resources, client)` — Register static/live resources
- `_resourceCache` — TTL cache (30s) for live resources, avoids re-fetch on every read

## Deployment
| File | Purpose |
|------|---------|
| `deploy/bundle.sh` | Creates distributable tarball |
| `deploy/quoxmcp-bundle.tar.gz` | Pre-built bundle (~15MB) |
