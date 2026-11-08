/**
 * VULCAN FND_01M6V4CQYN809ZZ58EZE3KQA9Z (quox#1610 MCP-06, 2026-11-08): QuoxMCP sent the collector service key
 * over plain HTTP to public hosts (validateUrl only warned) and followed redirects with the key attached.
 * The private-host check was a string prefix, so '10.evil.com' counted as private.
 *
 * Now: plain http is refused at startup unless the host is loopback, a private IP literal or a single-label
 * internal name (a Docker/compose service such as 'collector'); the private check parses real IPs; and every
 * collector request is sent with redirect: 'error', so the key is never forwarded to another host.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { validateUrl, insecureTransportRefusal } = require('../lib/validate.js');

describe('the private-host check parses hosts, not prefixes', () => {
  for (const h of ['http://10.evil.com:9848', 'http://192.168.evil.com', 'http://172.16.example.org', 'http://127.0.0.1.nip.io', 'http://localhost.attacker.net']) {
    it(`${h} is not private`, () => {
      expect(validateUrl(h).warning).toMatch(/HTTP/);
    });
  }
  for (const h of ['http://10.0.0.5:9848', 'http://192.168.1.20', 'http://172.20.1.1', 'http://127.0.0.1:9848', 'http://localhost:9848', 'http://[::1]:9848', 'http://collector:9848', 'http://quox-collector:9848']) {
    it(`${h} is internal (no warning)`, () => {
      expect(validateUrl(h).warning).toBeNull();
    });
  }
});

describe('plain http to a public host is refused, not warned', () => {
  it('refuses http to a public IP or dotted public name', () => {
    expect(insecureTransportRefusal(validateUrl('http://203.0.113.5:9848'))).toMatch(/HTTPS/);
    expect(insecureTransportRefusal(validateUrl('http://collector.example.com'))).toMatch(/HTTPS/);
    expect(insecureTransportRefusal(validateUrl('http://10.evil.com'))).toMatch(/HTTPS/);
  });
  it('allows https anywhere and http to internal hosts', () => {
    expect(insecureTransportRefusal(validateUrl('https://collector.example.com'))).toBeNull();
    expect(insecureTransportRefusal(validateUrl('http://127.0.0.1:9848'))).toBeNull();
    expect(insecureTransportRefusal(validateUrl('http://collector:9848'))).toBeNull();
  });
  it('server.js exits on the refusal instead of only warning', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    expect(src).toMatch(/insecureTransportRefusal\(urlCheck\)/);
  });
});

describe('collector requests never follow redirects', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('every fetch carries redirect: "error"', async () => {
    const seen = [];
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => { seen.push(opts); return { ok: true, json: async () => ({ tools: [] }) }; }));
    const { CollectorClient } = require('../lib/collector-client.js');
    const c = new CollectorClient('https://collector.example.com', { serviceKey: 'k', orgId: 'o', timeout: 1000, retries: 0 });
    await c._request('/api/v1/tools/list', { method: 'GET' });
    await c._request('/api/v1/tools/execute', { method: 'POST', body: '{}' });
    expect(seen.length).toBe(2);
    for (const o of seen) expect(o.redirect).toBe('error');
  });
});
