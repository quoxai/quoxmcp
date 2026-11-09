/**
 * PromptAdapter — Registers MCP Prompts from collector API definitions.
 *
 * Prompts provide reusable operational templates (fleet health checks,
 * security sweeps, etc.) with argument substitution.
 */

const { z } = require('zod');
const {
  escapeTemplateChars, sanitizeUntrustedText, MAX_DESCRIPTION_LENGTH, MAX_PROMPT_TEXT_LENGTH
} = require('./validate');

/**
 * Build a Zod shape from prompt argument definitions.
 * @param {Array} args - Argument definitions [{ name, description, required }]
 * @returns {object} Zod shape suitable for server.prompt()
 */
function buildArgsShape(args) {
  const shape = {};
  for (const arg of args) {
    let schema = z.string();
    // VULCAN MCP-04: argument descriptions are collector-provided; strip + cap.
    const desc = sanitizeUntrustedText(arg.description, MAX_DESCRIPTION_LENGTH);
    if (desc) {
      schema = schema.describe(desc);
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

    // VULCAN FND_01M6V4CK6EC9EJ0RKPMB5GQ3DN (MCP-04): description and message templates are
    // collector-provided and land in the client's model context. Strip hidden characters and cap
    // length BEFORE interpolation, so user-supplied argument values are never altered.
    const description = sanitizeUntrustedText(prompt.description || '', MAX_DESCRIPTION_LENGTH);
    const messages = (prompt.messages || []).map(m => ({
      role: m.role || 'user',
      text: sanitizeUntrustedText(m.text, MAX_PROMPT_TEXT_LENGTH)
    }));

    server.prompt(
      prompt.name,
      description,
      argsShape,
      async (args) => ({
        messages: messages.map(m => ({
          role: m.role,
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
