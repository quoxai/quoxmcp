/**
 * VULCAN FND_01M6V4CGB2825J49KS932CDB43 (quox#1610 MCP-01, 2026-11-08): the Claude Desktop install told every
 * user to paste the instance-global INTERNAL_SERVICE_KEY. The collector already accepts a personal qmcp_ token
 * in the same X-Service-Key header and then acts as that user and their org, so the documented install path is
 * now a personal token minted in the dashboard. A non-personal key still works for the operator's own internal
 * deployments, but QuoxMCP says so loudly at startup.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');
const { keyKind } = require('../lib/validate.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

describe('the install path asks for a personal token, never the master key', () => {
  it('manifest.json service_key field asks for a personal qmcp_ token', () => {
    const m = JSON.parse(read('manifest.json'));
    const f = m.user_config.service_key;
    expect(f.title).toMatch(/personal/i);
    expect(f.description).toMatch(/qmcp_/);
    expect(f.description).not.toMatch(/INTERNAL_SERVICE_KEY from|\.env/);
  });

  it('the README install table asks for a personal token, not INTERNAL_SERVICE_KEY', () => {
    const readme = read('README.md');
    const start = readme.indexOf('## Install in Claude Desktop');
    const section = readme.slice(start, readme.indexOf('\n## ', start + 5));
    expect(section).toMatch(/qmcp_/);
    expect(section).not.toMatch(/`INTERNAL_SERVICE_KEY` from your/);
  });

  it('no example collector URL is plain http to a non-internal host', () => {
    const { validateUrl } = require('../lib/validate.js');
    const m = JSON.parse(read('manifest.json'));
    const urls = (m.user_config.collector_url.description.match(/https?:\/\/[^\s)]+/g) || []);
    for (const u of urls) expect(validateUrl(u).warning, u).toBeNull();
  });
});

describe('keyKind tells a personal token from a service key', () => {
  it('classifies keys', () => {
    expect(keyKind('qmcp_abc123')).toBe('personal');
    expect(keyKind('some-long-shared-secret')).toBe('service');
    expect(keyKind('')).toBe('none');
    expect(keyKind(undefined)).toBe('none');
  });
  it('server.js warns at startup when a non-personal key is configured', () => {
    expect(read('server.js')).toMatch(/keyKind\(serviceKey\)\s*===\s*'service'/);
  });
});
