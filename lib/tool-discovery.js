/**
 * Bounded tool rediscovery. When the initial listTools fails (collector not up
 * yet, transient 5xx), the server connects with zero tools; this retries on a
 * backoff and hands discovered tools to onTools so they can be registered.
 * Registering on a connected McpServer makes the SDK emit
 * notifications/tools/list_changed to the client automatically.
 */

const DEFAULT_DELAYS_MS = [2000, 5000, 15000, 30000, 60000];

function startToolRediscovery({ listTools, onTools, delaysMs = DEFAULT_DELAYS_MS, log = console.error }) {
  let cancelled = false;
  let timer = null;
  let wake = null;

  const sleep = (ms) => new Promise((resolve) => {
    wake = resolve;
    timer = setTimeout(resolve, ms);
    if (timer.unref) timer.unref();
  });

  const finished = (async () => {
    for (let i = 0; i < delaysMs.length && !cancelled; i++) {
      await sleep(delaysMs[i]);
      if (cancelled) return false;
      try {
        const data = await listTools();
        const tools = (data && data.tools) || [];
        if (tools.length > 0) {
          log(`[QuoxMCP] Rediscovery attempt ${i + 1}: fetched ${tools.length} tools`);
          onTools(tools);
          return true;
        }
        log(`[QuoxMCP] Rediscovery attempt ${i + 1}: collector returned 0 tools`);
      } catch (err) {
        log(`[QuoxMCP] Rediscovery attempt ${i + 1}/${delaysMs.length} failed: ${err && err.message}`);
      }
    }
    if (!cancelled) log('[QuoxMCP] Tool rediscovery gave up; serving without tools.');
    return false;
  })();

  return {
    finished,
    cancel() {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (wake) wake();
    }
  };
}

module.exports = { startToolRediscovery, DEFAULT_DELAYS_MS };
