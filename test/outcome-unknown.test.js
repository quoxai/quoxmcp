/**
 * VULCAN FND_01M6V4CTMT4BJEVA4FJQKM9X24: a timeout on POST /tools/execute happens AFTER the
 * collector may already have acted. QuoxMCP must report the outcome as UNKNOWN (never "failed"),
 * and send a per-call idempotency key so the collector can dedupe once it supports it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CollectorClient } from '../lib/collector-client.js';
import { registerTools } from '../lib/tool-adapter.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('executeTool idempotency key', () => {
  let mockFetch;
  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) });
    globalThis.fetch = mockFetch;
  });
  afterEach(() => vi.restoreAllMocks());

  it('sends an X-Idempotency-Key UUID header on the execute POST', async () => {
    const c = new CollectorClient('http://127.0.0.1:9848', { retries: 0, timeout: 5000, serviceKey: 'k' });
    await c.executeTool('fleet_status', {}, 'quox', 's1');
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['X-Idempotency-Key']).toMatch(UUID);
    expect(headers['X-Service-Key']).toBe('k');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('uses a fresh key for every call', async () => {
    const c = new CollectorClient('http://127.0.0.1:9848', { retries: 0, timeout: 5000 });
    await c.executeTool('fleet_status', {}, 'quox', 's1');
    await c.executeTool('fleet_status', {}, 'quox', 's1');
    const k1 = mockFetch.mock.calls[0][1].headers['X-Idempotency-Key'];
    const k2 = mockFetch.mock.calls[1][1].headers['X-Idempotency-Key'];
    expect(k1).not.toBe(k2);
  });

  it('does not send an idempotency key on GETs', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ tools: [] }) });
    const c = new CollectorClient('http://127.0.0.1:9848', { retries: 0, timeout: 5000 });
    await c.listTools('quox');
    expect(mockFetch.mock.calls[0][1].headers?.['X-Idempotency-Key']).toBeUndefined();
  });
});

describe('executeTool timeout reports an UNKNOWN outcome', () => {
  afterEach(() => vi.restoreAllMocks());

  function expectUnknown(result, key) {
    expect(result.outcome).toBe('unknown');
    expect(result.success).toBeUndefined();
    expect(result.idempotency_key).toBe(key);
    expect(result.message).toMatch(/may (already )?have run/i);
    expect(result.message).toContain('quox approvals result');
    expect(JSON.stringify(result)).not.toMatch(/failed/i);
  }

  it('a real request timeout resolves to outcome unknown, not a failure', async () => {
    globalThis.fetch = vi.fn((url, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () => reject(opts.signal.reason));
    }));
    const c = new CollectorClient('http://127.0.0.1:9848', { retries: 2, timeout: 50 });
    const result = await c.executeTool('ssh_exec', { host: 'h1' }, 'quox', 's1');
    expectUnknown(result, globalThis.fetch.mock.calls[0][1].headers['X-Idempotency-Key']);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // still never retried
  });

  it('an AbortError resolves to outcome unknown', async () => {
    const err = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch = vi.fn().mockRejectedValue(err);
    const c = new CollectorClient('http://127.0.0.1:9848', { retries: 0, timeout: 5000 });
    const result = await c.executeTool('ssh_exec', {}, 'quox', 's1');
    expectUnknown(result, globalThis.fetch.mock.calls[0][1].headers['X-Idempotency-Key']);
  });

  it('a connection refused (request never reached the collector) still throws', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const c = new CollectorClient('http://127.0.0.1:9848', { retries: 0, timeout: 5000 });
    await expect(c.executeTool('ssh_exec', {}, 'quox', 's1')).rejects.toThrow('ECONNREFUSED');
  });

  it('a GET timeout still throws (reads have no side effect)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    const c = new CollectorClient('http://127.0.0.1:9848', { retries: 0, timeout: 5000 });
    await expect(c.listTools('quox')).rejects.toThrow();
  });
});

describe('tool adapter surfaces an unknown outcome honestly', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not say "failed" and flags the result so the model does not assume success', async () => {
    let handler;
    const server = { tool: (n, d, s, h) => { handler = h; } };
    const unknown = {
      outcome: 'unknown',
      timed_out: true,
      idempotency_key: '00000000-0000-4000-8000-000000000000',
      message: 'The collector did not answer in time. The action may already have run. Check `quox approvals result` or the dashboard before running it again.'
    };
    const client = { executeTool: vi.fn().mockResolvedValue(unknown) };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    registerTools(server, [{ name: 'ssh_exec', description: 'Run', input_schema: { properties: {} } }], client, { agentId: 'quox' });
    const out = await handler({});
    expect(out.isError).toBe(true);
    expect(out.content[0].text).not.toMatch(/failed/i);
    expect(JSON.parse(out.content[0].text)).toEqual(unknown);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Tool ssh_exec OUTCOME UNKNOWN'));
  });
});
