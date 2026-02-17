/**
 * CollectorClient Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CollectorClient } from '../lib/collector-client.js';

describe('CollectorClient', () => {
  let client;
  let mockFetch;

  beforeEach(() => {
    client = new CollectorClient('http://127.0.0.1:9848', { retries: 0, timeout: 5000 });
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('listTools', () => {
    it('calls correct endpoint with agent_id', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tools: [{ name: 'ssh_exec' }], agent: 'quox', count: 1 })
      });

      const result = await client.listTools('quox');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://127.0.0.1:9848/api/v1/tools/list?agent_id=quox',
        expect.objectContaining({ method: 'GET' })
      );
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe('ssh_exec');
    });

    it('encodes agent_id in URL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tools: [], agent: 'test agent', count: 0 })
      });

      await client.listTools('test agent');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('agent_id=test%20agent'),
        expect.any(Object)
      );
    });

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error')
      });

      await expect(client.listTools('quox')).rejects.toThrow('HTTP 500');
    });

    it('throws on network error', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(client.listTools('quox')).rejects.toThrow('ECONNREFUSED');
    });
  });

  describe('executeTool', () => {
    it('sends correct POST payload', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, stdout: 'ok' })
      });

      const result = await client.executeTool('ssh_exec', { host: 'docker01', command: 'uptime' }, 'quox', 'sess-123');

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe('http://127.0.0.1:9848/api/v1/tools/execute');

      const body = JSON.parse(callArgs[1].body);
      expect(body.tool_name).toBe('ssh_exec');
      expect(body.input.host).toBe('docker01');
      expect(body.input.command).toBe('uptime');
      expect(body.agent_id).toBe('quox');
      expect(body.session_id).toBe('sess-123');

      expect(result.success).toBe(true);
    });

    it('passes Content-Type header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });

      await client.executeTool('fleet_status', {}, 'quox', '');

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].headers['Content-Type']).toBe('application/json');
    });
  });

  describe('retries', () => {
    it('retries on failure when configured', async () => {
      const retryClient = new CollectorClient('http://127.0.0.1:9848', { retries: 1, timeout: 5000 });

      mockFetch
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ tools: [], count: 0 })
        });

      const result = await retryClient.listTools('quox');
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.count).toBe(0);
    });

    it('throws after all retries exhausted', async () => {
      const retryClient = new CollectorClient('http://127.0.0.1:9848', { retries: 1, timeout: 5000 });

      mockFetch
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(retryClient.listTools('quox')).rejects.toThrow('ECONNREFUSED');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('exponential backoff', () => {
    it('uses increasing delays between retries', async () => {
      const retryClient = new CollectorClient('http://127.0.0.1:9848', { retries: 2, timeout: 5000 });
      const delays = [];
      const origSetTimeout = globalThis.setTimeout;

      // Track delays by spying on Promise constructor timing
      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        if (callCount <= 3) throw new Error('fail');
        return { ok: true, json: () => Promise.resolve({}) };
      });

      const start = Date.now();
      await expect(retryClient.listTools('quox')).rejects.toThrow('fail');
      const elapsed = Date.now() - start;

      // With exponential backoff: 1s + 2s = ~3s for 2 retries
      // With fixed 1s: would be ~2s
      // Allow some tolerance
      expect(elapsed).toBeGreaterThan(2500);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('URL handling', () => {
    it('strips trailing slash from baseUrl', () => {
      const c = new CollectorClient('http://localhost:9848/');
      expect(c.baseUrl).toBe('http://localhost:9848');
    });

    it('handles baseUrl without trailing slash', () => {
      const c = new CollectorClient('http://localhost:9848');
      expect(c.baseUrl).toBe('http://localhost:9848');
    });
  });

  describe('service key', () => {
    it('stores service key from opts', () => {
      const c = new CollectorClient('http://localhost:9848', { serviceKey: 'my-secret' });
      expect(c.serviceKey).toBe('my-secret');
    });

    it('defaults service key to empty string', () => {
      const c = new CollectorClient('http://localhost:9848');
      expect(c.serviceKey).toBe('');
    });

    it('sends X-Service-Key header on GET when configured', async () => {
      const c = new CollectorClient('http://127.0.0.1:9848', { serviceKey: 'secret123', retries: 0, timeout: 5000 });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tools: [], count: 0 })
      });

      await c.listTools('quox');

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].headers).toBeDefined();
      expect(callArgs[1].headers['X-Service-Key']).toBe('secret123');
    });

    it('sends X-Service-Key header on POST when configured', async () => {
      const c = new CollectorClient('http://127.0.0.1:9848', { serviceKey: 'key456', retries: 0, timeout: 5000 });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true })
      });

      await c.executeTool('fleet_status', {}, 'quox', 'session-1');

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].headers['X-Service-Key']).toBe('key456');
      expect(callArgs[1].headers['Content-Type']).toBe('application/json');
    });

    it('does not send X-Service-Key when not configured', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ tools: [], count: 0 })
      });

      await client.listTools('quox');

      const callArgs = mockFetch.mock.calls[0];
      const headers = callArgs[1].headers || {};
      expect(headers['X-Service-Key']).toBeUndefined();
    });
  });
});
