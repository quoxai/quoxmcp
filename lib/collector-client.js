/**
 * CollectorClient — HTTP client for QuoxCORE collector API callbacks.
 *
 * QuoxMCP is a thin MCP protocol adapter. All tool execution goes through
 * the collector API, which handles RBAC, bastion routing, and audit trails.
 */

const { sanitizeError } = require('./validate');

class CollectorClient {
  constructor(baseUrl, opts = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeout = opts.timeout || 30000;
    this.retries = opts.retries || 2;
    this.serviceKey = opts.serviceKey || '';
  }

  /**
   * Fetch the list of available tools for an agent.
   *
   * orgId is what makes the collector merge that org's CONNECTOR tools
   * (github_create_issue et al) onto the agent's core tools. Omitting it
   * yields core tools only, which is why GRIPE reported "no
   * github_create_issue tool is connected for this org" on 2026-08-23 while
   * the connector bridge resolved that exact tool for that exact org.
   *
   * @param {string} agentId - Agent identifier (quox, sentinel, nova, etc.)
   * @param {string} [orgId] - Org whose connector tools to merge in
   * @returns {Promise<{tools: Array, agent: string, count: number}>}
   */
  async listTools(agentId, orgId) {
    let path = `/api/v1/tools/list?agent_id=${encodeURIComponent(agentId)}`;
    if (orgId) path += `&org_id=${encodeURIComponent(orgId)}`;
    const data = await this._get(path);
    if (!data || !Array.isArray(data.tools)) {
      throw new Error('Invalid tools response: missing tools array');
    }
    return data;
  }

  /**
   * Execute a tool via the collector.
   * @param {string} toolName - Tool identifier (ssh_exec, fleet_status, etc.)
   * @param {object} input - Tool input parameters
   * @param {string} agentId - Agent executing the tool (for RBAC)
   * @param {string} sessionId - Session identifier for context
   * @returns {Promise<object>} Tool execution result
   */
  /**
   * Fetch MCP resource definitions from the collector.
   * @returns {Promise<{resources: Array, count: number}>}
   */
  async listResources() {
    const data = await this._get('/api/v1/resources/list');
    if (!data || !Array.isArray(data.resources)) {
      throw new Error('Invalid resources response: missing resources array');
    }
    return data;
  }

  /**
   * Fetch MCP prompt definitions from the collector.
   * @returns {Promise<{prompts: Array, count: number}>}
   */
  async listPrompts() {
    const data = await this._get('/api/v1/prompts/list');
    if (!data || !Array.isArray(data.prompts)) {
      throw new Error('Invalid prompts response: missing prompts array');
    }
    return data;
  }

  async executeTool(toolName, input, agentId, sessionId, orgId, userId, authToken) {
    const body = {
      tool_name: toolName,
      input,
      agent_id: agentId,
      session_id: sessionId
    };
    if (orgId) body.org_id = orgId;
    if (userId) body.user_id = userId;
    if (authToken) body.auth_token = authToken;
    const data = await this._post('/api/v1/tools/execute', body);
    if (typeof data !== 'object' || data === null) {
      throw new Error('Invalid tool execution response');
    }
    return data;
  }

  async _get(path) {
    // GET is idempotent: safe to retry.
    return this._request(path, { method: 'GET' }, { idempotent: true });
  }

  async _post(path, body) {
    // quox#1183/#4: POST /tools/execute is a MUTATION. A retry after a lost
    // response (the collector already ran the tool) duplicates the mutation, so
    // a non-idempotent POST must fire at most once. No idempotency key exists
    // on this path yet, so it is never retried.
    return this._request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, { idempotent: false });
  }

  async _request(path, opts, { idempotent = (opts.method || 'GET') === 'GET' } = {}) {
    const url = `${this.baseUrl}${path}`;
    let lastErr;

    // Inject service key header if configured
    if (this.serviceKey) {
      opts.headers = { ...opts.headers, 'X-Service-Key': this.serviceKey };
    }

    // Only idempotent requests are retried (#4). A non-idempotent request fires once.
    const maxAttempts = idempotent ? this.retries : 0;
    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      try {
        const resp = await fetch(url, {
          ...opts,
          signal: AbortSignal.timeout(this.timeout)
        });

        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          throw new Error(`HTTP ${resp.status}: ${sanitizeError(text.substring(0, 200))}`);
        }

        return resp.json();
      } catch (err) {
        lastErr = err;
        if (attempt < maxAttempts) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    throw lastErr;
  }
}

module.exports = { CollectorClient };
