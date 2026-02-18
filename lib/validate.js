/**
 * Validation utilities for QuoxMCP security hardening.
 * Centralised patterns, sanitizers, and validators.
 */

const SAFE_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const SAFE_TOOL_NAME = /^[a-zA-Z0-9_.-]{1,128}$/;
const MAX_INPUT_SIZE = 1024 * 1024; // 1MB
const ALLOWED_URI_SCHEMES = ['quox:', 'https:', 'http:'];

/**
 * Validate an identifier (agent ID, session ID).
 * @param {string} id
 * @returns {boolean}
 */
function isValidId(id) {
  return typeof id === 'string' && SAFE_ID.test(id);
}

/**
 * Validate a tool name.
 * @param {string} name
 * @returns {boolean}
 */
function isValidToolName(name) {
  return typeof name === 'string' && SAFE_TOOL_NAME.test(name);
}

/**
 * Validate and parse a collector URL.
 * Returns { valid, parsed, warning } or throws on fatal errors.
 * @param {string} url
 * @returns {{ valid: boolean, parsed: URL|null, warning: string|null }}
 */
function validateUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, parsed: null, warning: null };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { valid: false, parsed, warning: null };
  }

  let warning = null;
  if (parsed.protocol === 'http:') {
    const host = parsed.hostname;
    const isPrivate = host === '127.0.0.1' || host === 'localhost' ||
      host.startsWith('10.') || host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    if (!isPrivate) {
      warning = 'Collector URL uses HTTP over a non-private network. Consider HTTPS.';
    }
  }

  return { valid: true, parsed, warning };
}

/**
 * Validate a resource URI scheme.
 * @param {string} uri
 * @returns {boolean}
 */
function isValidResourceUri(uri) {
  if (typeof uri !== 'string') return false;
  // Allow quox:// custom scheme
  if (uri.startsWith('quox://')) return true;
  try {
    const parsed = new URL(uri);
    return ALLOWED_URI_SCHEMES.includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Sanitize error messages to remove internal infrastructure details.
 * Strips private IPs, file paths, and internal hostnames.
 * @param {string} message
 * @returns {string}
 */
function sanitizeError(message) {
  if (typeof message !== 'string') return 'Unknown error';
  return message
    .replace(/https?:\/\/[\d.]+:\d+/g, '[collector]')
    .replace(/https?:\/\/localhost:\d+/g, '[collector]')
    .replace(/\/home\/\S+/g, '[path]')
    .replace(/\/opt\/\S+/g, '[path]')
    .replace(/\/etc\/\S+/g, '[path]')
    .replace(/\/var\/\S+/g, '[path]')
    .replace(/\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d+\.\d+\b/g, '[internal-ip]');
}

/**
 * Escape mustache template characters in a value to prevent template injection.
 * @param {string} value
 * @returns {string}
 */
function escapeTemplateChars(value) {
  if (typeof value !== 'string') return String(value ?? '');
  return value.replace(/\{\{/g, '\\{\\{').replace(/\}\}/g, '\\}\\}');
}

/**
 * Check if serialised input exceeds the maximum size.
 * @param {object} input
 * @returns {boolean} true if too large
 */
function inputTooLarge(input) {
  try {
    return JSON.stringify(input).length > MAX_INPUT_SIZE;
  } catch {
    return true;
  }
}

module.exports = {
  SAFE_ID,
  SAFE_TOOL_NAME,
  MAX_INPUT_SIZE,
  ALLOWED_URI_SCHEMES,
  isValidId,
  isValidToolName,
  validateUrl,
  isValidResourceUri,
  sanitizeError,
  escapeTemplateChars,
  inputTooLarge
};
