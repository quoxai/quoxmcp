/**
 * ToolAdapter — Converts collector tool definitions (Anthropic format) to MCP
 * tool registrations, and bridges tool calls back to the collector API.
 */

const { z } = require('zod');

/**
 * Convert a JSON Schema property definition to a Zod schema.
 * MCP SDK's server.tool() accepts Zod schemas or raw objects for parameters.
 * We use the raw shape approach for simplicity.
 */
function jsonSchemaToZodShape(properties, required = []) {
  const shape = {};
  const requiredSet = new Set(required);

  for (const [name, prop] of Object.entries(properties || {})) {
    let schema;
    switch (prop.type) {
      case 'number':
      case 'integer':
        schema = z.number();
        break;
      case 'boolean':
        schema = z.boolean();
        break;
      case 'array':
        schema = z.array(z.any());
        break;
      case 'object':
        schema = z.object({}).passthrough();
        break;
      default:
        schema = z.string();
    }

    if (prop.description) {
      schema = schema.describe(prop.description);
    }

    if (prop.enum) {
      schema = z.enum(prop.enum);
      if (prop.description) schema = schema.describe(prop.description);
    }

    if (!requiredSet.has(name)) {
      schema = schema.optional();
    }

    shape[name] = schema;
  }

  return shape;
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
      console.error(`[QuoxMCP] Skipping tool with missing name/description:`, tool);
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
        try {
          const result = await client.executeTool(
            tool.name,
            input,
            ctx.agentId,
            ctx.sessionId
          );

          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }]
          };
        } catch (err) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: `Tool execution failed: ${err.message}`
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

module.exports = { registerTools, jsonSchemaToZodShape };
