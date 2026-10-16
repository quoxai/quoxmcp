/**
 * ToolAdapter — Converts collector tool definitions (Anthropic format) to MCP
 * tool registrations, and bridges tool calls back to the collector API.
 */

const { z } = require('zod');
const { isValidToolName, inputTooLarge, sanitizeError } = require('./validate');

/**
 * Convert a JSON Schema property definition to a Zod schema.
 * MCP SDK's server.tool() accepts Zod schemas or raw objects for parameters.
 * We use the raw shape approach for simplicity.
 */
function jsonSchemaToZodShape(properties, required = []) {
  const shape = {};
  const requiredSet = new Set(required);

  for (const [name, prop] of Object.entries(properties || {})) {
    let schema = jsonSchemaToZodType(prop, z.string());

    if (prop.description) {
      schema = schema.describe(prop.description);
    }

    // Apply default values
    if (prop.default !== undefined) {
      schema = schema.default(prop.default);
    }

    if (!requiredSet.has(name)) {
      schema = schema.optional();
    }

    shape[name] = schema;
  }

  return shape;
}

/**
 * Convert one JSON Schema node to a Zod type, preserving the common
 * validation constraints (int-ness, bounds, length, pattern, enum, nullable,
 * array size). `fallback` is used when the node has no recognised type.
 */
function jsonSchemaToZodType(prop, fallback) {
  if (!prop || typeof prop !== 'object') return fallback;
  let schema;

  if (Array.isArray(prop.enum) && prop.enum.length > 0) {
    // Enum overrides type
    if (prop.enum.every((v) => typeof v === 'string')) {
      schema = z.enum(prop.enum);
    } else {
      const lits = prop.enum.map((v) => z.literal(v));
      schema = lits.length === 1 ? lits[0] : z.union(lits);
    }
  } else {
    switch (prop.type) {
      case 'number':
      case 'integer': {
        schema = z.number();
        if (prop.type === 'integer') schema = schema.int();
        if (typeof prop.minimum === 'number') schema = schema.min(prop.minimum);
        if (typeof prop.maximum === 'number') schema = schema.max(prop.maximum);
        if (typeof prop.exclusiveMinimum === 'number') schema = schema.gt(prop.exclusiveMinimum);
        if (typeof prop.exclusiveMaximum === 'number') schema = schema.lt(prop.exclusiveMaximum);
        break;
      }
      case 'boolean':
        schema = z.boolean();
        break;
      case 'array':
        // Typed arrays based on items schema
        schema = z.array(jsonSchemaToZodItem(prop.items));
        if (Number.isInteger(prop.minItems)) schema = schema.min(prop.minItems);
        if (Number.isInteger(prop.maxItems)) schema = schema.max(prop.maxItems);
        break;
      case 'object':
        // Recursive nested objects
        if (prop.properties) {
          schema = z.object(jsonSchemaToZodShape(prop.properties, prop.required || []));
        } else {
          schema = z.record(z.string(), z.any());
        }
        break;
      case 'string':
        schema = z.string();
        if (Number.isInteger(prop.minLength)) schema = schema.min(prop.minLength);
        if (Number.isInteger(prop.maxLength)) schema = schema.max(prop.maxLength);
        if (typeof prop.pattern === 'string') {
          try { schema = schema.regex(new RegExp(prop.pattern)); } catch { /* invalid pattern: ignore */ }
        }
        break;
      default:
        schema = fallback;
    }
  }

  if (prop.nullable === true) schema = schema.nullable();
  return schema;
}

/**
 * Convert a JSON Schema items definition to a Zod schema for array elements.
 */
function jsonSchemaToZodItem(items) {
  if (!items || !items.type) return z.any();
  return jsonSchemaToZodType(items, z.any());
}

/**
 * Register tools from collector API definitions onto an MCP server.
 *
 * @param {McpServer} server - MCP server instance
 * @param {Array} tools - Tool definitions from collector (/api/v1/tools/list)
 * @param {CollectorClient} client - Collector API client
 * @param {object} ctx - Context: { agentId, sessionId }
 */
function registerTools(server, tools, client, ctx) {
  let registered = 0;

  for (const tool of tools) {
    if (!tool.name || !tool.description) {
      console.error(`[QuoxMCP] Skipping tool with missing name/description`);
      continue;
    }

    if (!isValidToolName(tool.name)) {
      console.error(`[QuoxMCP] Skipping tool with unsafe name: "${tool.name.substring(0, 40)}"`);
      continue;
    }

    const properties = tool.input_schema?.properties || {};
    const required = tool.input_schema?.required || [];
    const shape = jsonSchemaToZodShape(properties, required);

    server.tool(
      tool.name,
      tool.description,
      shape,
      async (input) => {
        const start = Date.now();

        if (inputTooLarge(input)) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Input exceeds maximum size (1MB)' }) }],
            isError: true
          };
        }

        try {
          const result = await client.executeTool(
            tool.name,
            input,
            ctx.agentId,
            ctx.sessionId,
            ctx.orgId,
            ctx.userId,
            ctx.authToken
          );
          console.error(`[QuoxMCP] Tool ${tool.name} OK (${Date.now() - start}ms)`);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }]
          };
        } catch (err) {
          console.error(`[QuoxMCP] Tool ${tool.name} FAILED (${Date.now() - start}ms): ${sanitizeError(err.message)}`);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: `Tool execution failed: ${sanitizeError(err.message)}`
              })
            }],
            isError: true
          };
        }
      }
    );

    registered++;
  }

  console.error(`[QuoxMCP] Registered ${registered} tools for agent ${ctx.agentId}`);
  return registered;
}

module.exports = { registerTools, jsonSchemaToZodShape, jsonSchemaToZodItem };
