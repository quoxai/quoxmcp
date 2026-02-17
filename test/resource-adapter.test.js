/**
 * ResourceAdapter Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { registerResources } from '../lib/resource-adapter.js';

// Helper: create a mock MCP server that captures registrations
function createMockServer() {
  const registered = [];
  return {
    registered,
    resource(name, uri, metadata, handler) {
      registered.push({ name, uri, metadata, handler });
    }
  };
}

// Sample resource definitions (mirrors collector API response)
const SAMPLE_RESOURCES = [
  {
    name: 'system-identity',
    uri: 'quox://system/identity',
    title: 'Quox System Identity',
    description: 'System architecture overview',
    mimeType: 'text/markdown',
    content: '## Quox System Context\n\nHello world.',
    live: false
  },
  {
    name: 'agent-registry',
    uri: 'quox://agents/registry',
    title: 'Agent Registry',
    description: 'All agents with roles',
    mimeType: 'application/json',
    content: '{"agents":[{"id":"quox"}]}',
    live: false
  },
  {
    name: 'fleet-topology',
    uri: 'quox://fleet/topology',
    title: 'Fleet Topology',
    description: 'Live host inventory',
    mimeType: 'application/json',
    content: '{"hosts":[],"total":0}',
    live: true
  }
];

describe('registerResources', () => {
  it('registers all valid resources', () => {
    const server = createMockServer();
    const count = registerResources(server, SAMPLE_RESOURCES);
    expect(count).toBe(3);
    expect(server.registered).toHaveLength(3);
  });

  it('returns 0 for empty array', () => {
    const server = createMockServer();
    const count = registerResources(server, []);
    expect(count).toBe(0);
  });

  it('skips resources without name', () => {
    const server = createMockServer();
    const count = registerResources(server, [
      { uri: 'quox://test', content: 'hello' },
      { name: 'valid', uri: 'quox://valid', content: 'ok' }
    ]);
    expect(count).toBe(1);
  });

  it('skips resources without uri', () => {
    const server = createMockServer();
    const count = registerResources(server, [
      { name: 'no-uri', content: 'hello' }
    ]);
    expect(count).toBe(0);
  });

  it('passes correct metadata to server.resource()', () => {
    const server = createMockServer();
    registerResources(server, [SAMPLE_RESOURCES[0]]);
    const reg = server.registered[0];
    expect(reg.name).toBe('system-identity');
    expect(reg.uri).toBe('quox://system/identity');
    expect(reg.metadata.title).toBe('Quox System Identity');
    expect(reg.metadata.description).toBe('System architecture overview');
    expect(reg.metadata.mimeType).toBe('text/markdown');
  });

  it('static resource handler returns pre-rendered content', async () => {
    const server = createMockServer();
    registerResources(server, [SAMPLE_RESOURCES[0]]);
    const handler = server.registered[0].handler;
    const result = await handler('quox://system/identity');
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].text).toContain('## Quox System Context');
    expect(result.contents[0].mimeType).toBe('text/markdown');
  });

  it('live resource with client re-fetches content', async () => {
    const server = createMockServer();
    const mockClient = {
      listResources: vi.fn().mockResolvedValue({
        resources: [{
          name: 'fleet-topology',
          content: '{"hosts":[{"id":"docker01"}],"total":1}'
        }]
      })
    };

    registerResources(server, [SAMPLE_RESOURCES[2]], mockClient);
    const handler = server.registered[0].handler;
    const result = await handler('quox://fleet/topology');
    expect(mockClient.listResources).toHaveBeenCalledOnce();
    expect(result.contents[0].text).toContain('docker01');
  });

  it('live resource falls back to static content on error', async () => {
    const server = createMockServer();
    const mockClient = {
      listResources: vi.fn().mockRejectedValue(new Error('Connection refused'))
    };

    registerResources(server, [SAMPLE_RESOURCES[2]], mockClient);
    const handler = server.registered[0].handler;
    const result = await handler('quox://fleet/topology');
    expect(result.contents[0].text).toContain('"hosts":[]');
  });

  it('live resource without client serves static content', async () => {
    const server = createMockServer();
    registerResources(server, [SAMPLE_RESOURCES[2]]);  // no client
    const handler = server.registered[0].handler;
    const result = await handler('quox://fleet/topology');
    expect(result.contents[0].text).toContain('"hosts":[]');
  });

  it('defaults mimeType to text/plain when not specified', async () => {
    const server = createMockServer();
    registerResources(server, [
      { name: 'test', uri: 'quox://test', content: 'hello' }
    ]);
    const reg = server.registered[0];
    expect(reg.metadata.mimeType).toBe('text/plain');
    const result = await reg.handler('quox://test');
    expect(result.contents[0].mimeType).toBe('text/plain');
  });

  it('handles resource with empty content', async () => {
    const server = createMockServer();
    registerResources(server, [
      { name: 'empty', uri: 'quox://empty' }
    ]);
    const result = await server.registered[0].handler('quox://empty');
    expect(result.contents[0].text).toBe('');
  });
});
