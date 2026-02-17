/**
 * CollectorClient — HTTP client for QuoxCORE collector API callbacks.
 *
 * QuoxMCP is a thin MCP protocol adapter. All tool execution goes through
 * the collector API, which handles RBAC, bastion routing, and audit trails.
 */

class CollectorClient {
  constructor(baseUrl, opts = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeout = opts.timeout || 30000;
    this.retries = opts.retries || 2;
  }

  /**
   * Fetch the list of available tools for an agent.
   * @param {string} agentId - Agent identifier (quox, sentinel, nova, etc.)
   * @returns {Promise<{tools: Array, agent: string, count: number}>}
   */
  async listTools(agentId) {
    return this._get(`/api/v1/tools/list?agent_id=${encodeURIComponent(agentId)}`);
  }

  /**
   * Execute a tool via the collector.
   * @param {string} toolName - Tool identifier (ssh_exec, fleet_status, etc.)
   * @param {object} input - Tool input parameters
   * @param {string} agentId - Agent executing the tool (for RBAC)
   * @param {string} sessionId - Session identifier for context
   * @returns {Promise<object>} Tool execution result
   */
  async executeTool(toolName, input, agentId, sessionId) {
    return this._post('/api/v1/tools/execute', {
      tool_name: toolName,
      input,
      agent_id: agentId,
      session_id: sessionId
    });
  }

  async _get(path) {
    return this._request(path, { method: 'GET' });
  }

  async _post(path, body) {
    return this._request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  async _request(path, opts) {
    const url = `${this.baseUrl}${path}`;
    let lastErr;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const resp = await fetch(url, {
          ...opts,
          signal: AbortSignal.timeout(this.timeout)
        });

        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          throw new Error(`HTTP ${resp.status}: ${text.substring(0, 200)}`);
        }

        return resp.json();
      } catch (err) {
        lastErr = err;
        if (attempt < this.retries) {
          // Wait 1s before retry
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }

    throw lastErr;
  }
}

module.exports = { CollectorClient };
