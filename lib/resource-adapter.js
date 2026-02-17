/**
 * ResourceAdapter — Registers MCP Resources from collector API definitions.
 *
 * Resources provide read-only context (system identity, agent registry, etc.)
 * that Claude CLI can access without making tool calls.
 */

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
      console.error(`[QuoxMCP] Skipping resource with missing name/uri:`, res);
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
          try {
            const data = await client.listResources();
            const fresh = (data.resources || []).find(r => r.name === res.name);
            const text = fresh ? fresh.content : res.content || '';
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
                text: res.content || `Error fetching live data: ${err.message}`,
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

module.exports = { registerResources };
