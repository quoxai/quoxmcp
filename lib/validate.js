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
/**
 * VULCAN FND_01M6V4CQYN809ZZ58EZE3KQA9Z (MCP-06): is this host internal enough to carry the service key over
 * plain http? Loopback, an RFC 1918 / loopback IPv4 literal, ::1, or a single-label name (a Docker/compose
 * service such as 'collector'). A real IP parse, never a string prefix: '10.evil.com' is NOT private.
 */
function isInternalHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const o = m.slice(1).map(Number);
    if (o.some((n) => n > 255)) return false;
    return o[0] === 10 || o[0] === 127 || (o[0] === 192 && o[1] === 168) || (o[0] === 172 && o[1] >= 16 && o[1] <= 31);
  }
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(host);
}

/** A startup refusal for a URL that would send the service key over plain http to a non-internal host, or null. */
function insecureTransportRefusal(urlCheck) {
  if (!urlCheck || !urlCheck.valid || !urlCheck.parsed) return null;
  if (urlCheck.parsed.protocol === 'http:' && !isInternalHost(urlCheck.parsed.hostname)) {
    return 'Refusing to send the collector key over plain HTTP to a non-internal host. Use an HTTPS collector URL (plain http is allowed only for localhost, private IP addresses and single-label internal service names).';
  }
  return null;
}

/**
 * VULCAN FND_01M6V4CGB2825J49KS932CDB43 (MCP-01): what kind of collector key is configured.
 * 'personal' = a user's qmcp_ token (the collector acts as that user and org); 'service' = any other value,
 * i.e. an instance-wide service key, which belongs to the operator's own internal deployments; 'none'.
 */
function keyKind(key) {
  if (typeof key !== 'string' || key.length === 0) return 'none';
  return key.startsWith('qmcp_') ? 'personal' : 'service';
}

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
  if (parsed.protocol === 'http:' && !isInternalHost(parsed.hostname)) {
    warning = 'Collector URL uses HTTP over a non-private network. Use HTTPS.';
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
  isInternalHost,
  insecureTransportRefusal,
  keyKind,
  isValidResourceUri,
  sanitizeError,
  escapeTemplateChars,
  inputTooLarge
};
