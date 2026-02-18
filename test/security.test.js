/**
 * Security Tests — QuoxMCP Phase 8
 *
 * Validates input validation, auth enforcement, error sanitization,
 * template injection prevention, URI validation, and input size limits.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isValidId,
  isValidToolName,
  validateUrl,
  isValidResourceUri,
  sanitizeError,
  escapeTemplateChars,
  inputTooLarge,
  MAX_INPUT_SIZE
} from '../lib/validate.js';
import { registerTools } from '../lib/tool-adapter.js';
import { registerResources } from '../lib/resource-adapter.js';
import { registerPrompts, interpolateArgs } from '../lib/prompt-adapter.js';
import { CollectorClient } from '../lib/collector-client.js';

// --- Service key enforcement ---
describe('Service key enforcement', () => {
  let mockFetch;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends service key on all requests', async () => {
    const client = new CollectorClient('http://127.0.0.1:9848', {
      serviceKey: 'test-key-abc123',
      retries: 0
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ tools: [], count: 0 })
    });

    await client.listTools('quox');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Service-Key': 'test-key-abc123'
        })
      })
    );
  });

  it('sends service key on POST requests too', async () => {
    const client = new CollectorClient('http://127.0.0.1:9848', {
      serviceKey: 'post-key-xyz',
      retries: 0
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true })
    });

    await client.executeTool('ssh_exec', { host: 'test' }, 'quox', 'sess1');

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].headers['X-Service-Key']).toBe('post-key-xyz');
    expect(callArgs[1].headers['Content-Type']).toBe('application/json');
  });

  it('does not include service key header when no key configured', async () => {
    const client = new CollectorClient('http://127.0.0.1:9848', {
      serviceKey: '',
      retries: 0
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ tools: [], count: 0 })
    });

    await client.listTools('quox');

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].headers).toBeUndefined();
  });
});

// --- ID validation ---
describe('ID validation', () => {
  it('accepts valid agent IDs', () => {
    expect(isValidId('quox')).toBe(true);
    expect(isValidId('sentinel')).toBe(true);
    expect(isValidId('nova-agent')).toBe(true);
    expect(isValidId('agent_v2')).toBe(true);
    expect(isValidId('A123')).toBe(true);
  });

  it('rejects IDs with special characters', () => {
    expect(isValidId('agent;rm -rf')).toBe(false);
    expect(isValidId('agent$(whoami)')).toBe(false);
    expect(isValidId('agent`id`')).toBe(false);
    expect(isValidId('../etc/passwd')).toBe(false);
    expect(isValidId('agent<script>')).toBe(false);
  });

  it('rejects empty and missing IDs', () => {
    expect(isValidId('')).toBe(false);
    expect(isValidId(null)).toBe(false);
    expect(isValidId(undefined)).toBe(false);
    expect(isValidId(123)).toBe(false);
  });

  it('rejects oversized IDs (>64 chars)', () => {
    const longId = 'a'.repeat(65);
    expect(isValidId(longId)).toBe(false);
    // Exactly 64 should pass
    expect(isValidId('a'.repeat(64))).toBe(true);
  });
});

// --- URL validation ---
describe('URL validation', () => {
  it('accepts valid http/https collector URLs', () => {
    expect(validateUrl('http://127.0.0.1:9848').valid).toBe(true);
    expect(validateUrl('https://collector.example.com').valid).toBe(true);
    expect(validateUrl('http://localhost:9848').valid).toBe(true);
    expect(validateUrl('http://192.168.88.10:9848').valid).toBe(true);
  });

  it('rejects non-http protocols', () => {
    expect(validateUrl('ftp://127.0.0.1:9848').valid).toBe(false);
    expect(validateUrl('file:///etc/passwd').valid).toBe(false);
    expect(validateUrl('javascript:alert(1)').valid).toBe(false);
  });

  it('rejects invalid URLs', () => {
    expect(validateUrl('not-a-url').valid).toBe(false);
    expect(validateUrl('').valid).toBe(false);
  });

  it('warns on HTTP over public network', () => {
    const result = validateUrl('http://203.0.113.5:9848');
    expect(result.valid).toBe(true);
    expect(result.warning).toContain('HTTP');
  });

  it('does not warn on HTTP over private network', () => {
    expect(validateUrl('http://127.0.0.1:9848').warning).toBeNull();
    expect(validateUrl('http://localhost:9848').warning).toBeNull();
    expect(validateUrl('http://10.0.0.5:9848').warning).toBeNull();
    expect(validateUrl('http://192.168.1.1:9848').warning).toBeNull();
  });
});

// --- Tool name validation ---
describe('Tool name validation', () => {
  it('accepts valid tool names', () => {
    expect(isValidToolName('ssh_exec')).toBe(true);
    expect(isValidToolName('fleet_status')).toBe(true);
    expect(isValidToolName('mikrotik.discover')).toBe(true);
    expect(isValidToolName('deploy-check')).toBe(true);
  });

  it('rejects tool names with injection characters', () => {
    expect(isValidToolName('tool;rm -rf /')).toBe(false);
    expect(isValidToolName('tool$(whoami)')).toBe(false);
    expect(isValidToolName('tool`id`')).toBe(false);
    expect(isValidToolName('tool<script>alert</script>')).toBe(false);
    expect(isValidToolName('tool/../../etc')).toBe(false);
  });

  it('rejects oversized tool names (>128 chars)', () => {
    expect(isValidToolName('a'.repeat(129))).toBe(false);
    expect(isValidToolName('a'.repeat(128))).toBe(true);
  });

  it('skips tools with invalid names during registration', () => {
    const mockServer = { tool: vi.fn() };
    const mockClient = { executeTool: vi.fn() };

    const tools = [
      { name: 'valid_tool', description: 'OK', input_schema: { properties: {} } },
      { name: 'bad;name', description: 'Injection', input_schema: { properties: {} } },
      { name: '../path/traversal', description: 'Traversal', input_schema: { properties: {} } }
    ];

    const count = registerTools(mockServer, tools, mockClient, { agentId: 'quox', sessionId: '' });
    expect(count).toBe(1);
    expect(mockServer.tool).toHaveBeenCalledTimes(1);
  });
});

// --- Response validation ---
describe('Response validation', () => {
  let mockFetch;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects listTools with missing tools array', async () => {
    const client = new CollectorClient('http://127.0.0.1:9848', { retries: 0 });

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ agent: 'quox' }) // missing tools
    });

    await expect(client.listTools('quox')).rejects.toThrow('missing tools array');
  });

  it('rejects listResources with missing resources array', async () => {
    const client = new CollectorClient('http://127.0.0.1:9848', { retries: 0 });

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ count: 0 }) // missing resources
    });

    await expect(client.listResources()).rejects.toThrow('missing resources array');
  });

  it('rejects executeTool with null response', async () => {
    const client = new CollectorClient('http://127.0.0.1:9848', { retries: 0 });

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(null)
    });

    await expect(
      client.executeTool('ssh_exec', {}, 'quox', 'sess1')
    ).rejects.toThrow('Invalid tool execution response');
  });
});

// --- Template injection prevention ---
describe('Template injection prevention', () => {
  it('escapes mustache characters in argument values', () => {
    const escaped = escapeTemplateChars('{{admin}}');
    expect(escaped).not.toContain('{{');
    expect(escaped).not.toContain('}}');
  });

  it('does not alter normal strings', () => {
    expect(escapeTemplateChars('hello world')).toBe('hello world');
    expect(escapeTemplateChars('no templates here')).toBe('no templates here');
  });

  it('handles non-string values', () => {
    expect(escapeTemplateChars(null)).toBe('');
    expect(escapeTemplateChars(undefined)).toBe('');
    expect(escapeTemplateChars(42)).toBe('42');
  });

  it('prevents nested template expansion in interpolateArgs', () => {
    const template = 'Hello {{name}}, welcome to {{place}}';
    // User tries to inject template syntax as a value
    const args = { name: '{{place}}', place: 'Quox' };
    const result = interpolateArgs(template, args);

    // The injected {{place}} should NOT expand to "Quox"
    expect(result).not.toBe('Hello Quox, welcome to Quox');
    expect(result).toContain('Quox'); // place still resolves
  });

  it('prevents conditional block injection', () => {
    const template = '{{#admin}}Admin access granted{{/admin}}. User: {{name}}';
    // User tries to inject conditional block activation
    const args = { name: 'hacker', admin: '' }; // admin not set
    const result = interpolateArgs(template, args);

    expect(result).not.toContain('Admin access granted');
  });
});

// --- URI validation ---
describe('URI validation', () => {
  it('accepts quox:// URIs', () => {
    expect(isValidResourceUri('quox://system/identity')).toBe(true);
    expect(isValidResourceUri('quox://fleet/topology')).toBe(true);
  });

  it('accepts http/https URIs', () => {
    expect(isValidResourceUri('https://api.example.com/resource')).toBe(true);
    expect(isValidResourceUri('http://localhost:9848/data')).toBe(true);
  });

  it('rejects file:// URIs', () => {
    expect(isValidResourceUri('file:///etc/passwd')).toBe(false);
    expect(isValidResourceUri('file:///home/user/.ssh/id_rsa')).toBe(false);
  });

  it('rejects javascript: URIs', () => {
    expect(isValidResourceUri('javascript:alert(1)')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isValidResourceUri(null)).toBe(false);
    expect(isValidResourceUri(undefined)).toBe(false);
    expect(isValidResourceUri(123)).toBe(false);
  });

  it('skips resources with invalid URIs during registration', () => {
    const mockServer = { resource: vi.fn() };

    const resources = [
      { name: 'valid', uri: 'quox://system/id', content: 'data' },
      { name: 'bad-file', uri: 'file:///etc/passwd', content: 'hack' },
      { name: 'bad-js', uri: 'javascript:alert(1)', content: 'xss' }
    ];

    const count = registerResources(mockServer, resources);
    expect(count).toBe(1);
    expect(mockServer.resource).toHaveBeenCalledTimes(1);
  });
});

// --- Input size limits ---
describe('Input size limits', () => {
  it('rejects payloads exceeding 1MB', () => {
    const bigInput = { data: 'x'.repeat(MAX_INPUT_SIZE + 1) };
    expect(inputTooLarge(bigInput)).toBe(true);
  });

  it('accepts payloads under 1MB', () => {
    const smallInput = { data: 'hello world' };
    expect(inputTooLarge(smallInput)).toBe(false);
  });

  it('rejects circular references gracefully', () => {
    const circular = {};
    circular.self = circular;
    expect(inputTooLarge(circular)).toBe(true);
  });

  it('tool handler rejects oversized input', async () => {
    const mockServer = { tool: vi.fn() };
    const mockClient = { executeTool: vi.fn() };

    const tools = [
      { name: 'test_tool', description: 'Test', input_schema: { properties: { data: { type: 'string' } } } }
    ];

    registerTools(mockServer, tools, mockClient, { agentId: 'quox', sessionId: '' });

    // Get the handler that was registered
    const handler = mockServer.tool.mock.calls[0][3];
    const bigInput = { data: 'x'.repeat(MAX_INPUT_SIZE + 1) };
    const result = await handler(bigInput);

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toContain('maximum size');
    expect(mockClient.executeTool).not.toHaveBeenCalled();
  });
});

// --- Error sanitization ---
describe('Error sanitization', () => {
  it('strips internal IP addresses', () => {
    const msg = 'Connection refused to 10.0.0.5:9848';
    const sanitized = sanitizeError(msg);
    expect(sanitized).not.toContain('10.0.0.5');
    expect(sanitized).toContain('[internal-ip]');
  });

  it('strips collector URLs with port numbers', () => {
    const msg = 'Failed to connect to http://127.0.0.1:9848/api/v1/tools';
    const sanitized = sanitizeError(msg);
    expect(sanitized).not.toContain('127.0.0.1');
    expect(sanitized).toContain('[collector]');
  });

  it('strips file paths', () => {
    const msg = 'ENOENT: no such file at /home/control/quoxmcp/server.js';
    const sanitized = sanitizeError(msg);
    expect(sanitized).not.toContain('/home/control');
    expect(sanitized).toContain('[path]');
  });

  it('strips multiple path types', () => {
    const msg = 'Error in /opt/quoxmcp/lib/foo.js and /var/log/syslog and /etc/passwd';
    const sanitized = sanitizeError(msg);
    expect(sanitized).not.toContain('/opt/');
    expect(sanitized).not.toContain('/var/');
    expect(sanitized).not.toContain('/etc/');
  });

  it('handles non-string input', () => {
    expect(sanitizeError(null)).toBe('Unknown error');
    expect(sanitizeError(undefined)).toBe('Unknown error');
    expect(sanitizeError(42)).toBe('Unknown error');
  });

  it('strips private network ranges', () => {
    expect(sanitizeError('host 192.168.88.247')).toContain('[internal-ip]');
    expect(sanitizeError('host 172.16.0.1')).toContain('[internal-ip]');
    expect(sanitizeError('host 172.31.255.255')).toContain('[internal-ip]');
    expect(sanitizeError('host 10.99.1.2')).toContain('[internal-ip]');
  });
});
