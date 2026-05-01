/**
 * ResourceAdapter — Registers MCP Resources from collector API definitions.
 *
 * Resources provide read-only context (system identity, agent registry, etc.)
 * that Claude CLI can access without making tool calls.
 */

const { isValidResourceUri, sanitizeError } = require('./validate');

// TTL cache for live resource fetches (avoids re-fetching on every read)
const _resourceCache = new Map(); // name → { data, ts }
const RESOURCE_CACHE_TTL = 30000; // 30 seconds
const RESOURCE_CACHE_MAX = 100;   // max entries; evict oldest (insertion-order) when exceeded

/**
 * Insert a value into the resource cache, evicting the oldest entry if at capacity.
 */
function _resourceCacheSet(key, value) {
  if (_resourceCache.size >= RESOURCE_CACHE_MAX && !_resourceCache.has(key)) {
    // Delete oldest entry (Maps preserve insertion order)
    _resourceCache.delete(_resourceCache.keys().next().value);
  }
  _resourceCache.set(key, value);
}

/**
 * Register resources from collector API definitions onto an MCP server.
 *
 * @param {McpServer} server - MCP server instance
 * @param {Array} resources - Resource definitions from collector (/api/v1/resources/list)
 * @param {CollectorClient} [client] - Collector client for live resources
 * @returns {number} Number of registered resources
 */
function registerResources(server, resources, client) {
  let registered = 0;

  for (const res of resources) {
    if (!res.name || !res.uri) {
      console.error(`[QuoxMCP] Skipping resource with missing name/uri`);
      continue;
    }

    if (!isValidResourceUri(res.uri)) {
      console.error(`[QuoxMCP] Skipping resource with disallowed URI scheme: "${res.name}"`);
      continue;
    }

    const metadata = {
      title: res.title || res.name,
      description: res.description || '',
      mimeType: res.mimeType || 'text/plain'
    };

    if (res.live && client) {
      // Live resource — re-fetch content on each read
      server.resource(
        res.name,
        res.uri,
        metadata,
        async (uri) => {
          // Check TTL cache first
          const cached = _resourceCache.get(res.name);
          if (cached && Date.now() - cached.ts < RESOURCE_CACHE_TTL) {
            return {
              contents: [{
                uri: uri.toString(),
                text: cached.data,
                mimeType: res.mimeType || 'text/plain'
              }]
            };
          }

          try {
            const data = await client.listResources();
            const fresh = (data.resources || []).find(r => r.name === res.name);
            const text = fresh ? fresh.content : res.content || '';
            _resourceCacheSet(res.name, { data: text, ts: Date.now() });
            return {
              contents: [{
                uri: uri.toString(),
                text,
                mimeType: res.mimeType || 'text/plain'
              }]
            };
          } catch (err) {
            // Fallback to static content on error
            return {
              contents: [{
                uri: uri.toString(),
                text: res.content || `Error fetching live data: ${sanitizeError(err.message)}`,
                mimeType: res.mimeType || 'text/plain'
              }]
            };
          }
        }
      );
    } else {
      // Static resource — serve pre-rendered content
      const content = res.content || '';
      server.resource(
        res.name,
        res.uri,
        metadata,
        async (uri) => ({
          contents: [{
            uri: uri.toString(),
            text: content,
            mimeType: res.mimeType || 'text/plain'
          }]
        })
      );
    }

    registered++;
  }

  console.error(`[QuoxMCP] Registered ${registered} resources`);
  return registered;
}

module.exports = { registerResources, _resourceCache, RESOURCE_CACHE_TTL, RESOURCE_CACHE_MAX, _resourceCacheSet };
