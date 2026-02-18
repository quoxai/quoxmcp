/**
 * PromptAdapter — Registers MCP Prompts from collector API definitions.
 *
 * Prompts provide reusable operational templates (fleet health checks,
 * security sweeps, etc.) with argument substitution.
 */

const { z } = require('zod');
const { escapeTemplateChars } = require('./validate');

/**
 * Build a Zod shape from prompt argument definitions.
 * @param {Array} args - Argument definitions [{ name, description, required }]
 * @returns {object} Zod shape suitable for server.prompt()
 */
function buildArgsShape(args) {
  const shape = {};
  for (const arg of args) {
    let schema = z.string();
    if (arg.description) {
      schema = schema.describe(arg.description);
    }
    if (!arg.required) {
      schema = schema.optional();
    }
    shape[arg.name] = schema;
  }
  return shape;
}

/**
 * Interpolate argument values into a template string.
 * Supports mustache-style {{var}}, {{#var}}...{{/var}} (if set), {{^var}}...{{/var}} (if not set).
 * Also supports {{var|default}} for default values.
 *
 * @param {string} template - Template string with placeholders
 * @param {object} args - Argument values
 * @returns {string} Interpolated string
 */
function interpolateArgs(template, args) {
  // Escape user-provided argument values to prevent template injection
  // (e.g. user passing "{{admin}}" as a value to expand other placeholders)
  const safeArgs = {};
  for (const [key, value] of Object.entries(args || {})) {
    safeArgs[key] = escapeTemplateChars(value);
  }

  let result = template;

  // Handle conditional blocks: {{#var}}content{{/var}} — included if var is set
  result = result.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, content) => {
    return safeArgs[key] ? content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), safeArgs[key]) : '';
  });

  // Handle inverse blocks: {{^var}}content{{/var}} — included if var is NOT set
  result = result.replace(/\{\{\^(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, content) => {
    return safeArgs[key] ? '' : content;
  });

  // Handle simple substitution with default: {{var|default}}
  result = result.replace(/\{\{(\w+)\|([^}]+)\}\}/g, (_, key, defaultVal) => {
    return safeArgs[key] || defaultVal;
  });

  // Handle simple substitution: {{var}}
  result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return safeArgs[key] || '';
  });

  return result;
}

/**
 * Register prompts from collector API definitions onto an MCP server.
 *
 * @param {McpServer} server - MCP server instance
 * @param {Array} prompts - Prompt definitions from collector (/api/v1/prompts/list)
 * @returns {number} Number of registered prompts
 */
function registerPrompts(server, prompts) {
  let registered = 0;

  for (const prompt of prompts) {
    if (!prompt.name) {
      console.error(`[QuoxMCP] Skipping prompt with missing name:`, prompt);
      continue;
    }

    const argsShape = buildArgsShape(prompt.arguments || []);

    server.prompt(
      prompt.name,
      prompt.description || '',
      argsShape,
      async (args) => ({
        messages: (prompt.messages || []).map(m => ({
          role: m.role || 'user',
          content: {
            type: 'text',
            text: interpolateArgs(m.text, args)
          }
        }))
      })
    );

    registered++;
  }

  console.error(`[QuoxMCP] Registered ${registered} prompts`);
  return registered;
}

module.exports = { registerPrompts, buildArgsShape, interpolateArgs };
