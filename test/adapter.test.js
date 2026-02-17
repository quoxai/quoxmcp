/**
 * ToolAdapter Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { jsonSchemaToZodShape } from '../lib/tool-adapter.js';

describe('jsonSchemaToZodShape', () => {
  it('converts string properties', () => {
    const shape = jsonSchemaToZodShape(
      { host: { type: 'string', description: 'Target host' } },
      ['host']
    );
    expect(shape).toHaveProperty('host');
  });

  it('converts number properties', () => {
    const shape = jsonSchemaToZodShape(
      { count: { type: 'number', description: 'Item count' } },
      ['count']
    );
    expect(shape).toHaveProperty('count');
  });

  it('converts boolean properties', () => {
    const shape = jsonSchemaToZodShape(
      { all: { type: 'boolean', description: 'Show all' } },
      []
    );
    expect(shape).toHaveProperty('all');
  });

  it('makes optional properties optional', () => {
    const shape = jsonSchemaToZodShape(
      {
        host: { type: 'string' },
        command: { type: 'string' }
      },
      ['host'] // only host is required
    );
    expect(shape).toHaveProperty('host');
    expect(shape).toHaveProperty('command');
    // command should be optional (not in required array)
    expect(shape.command.isOptional()).toBe(true);
  });

  it('handles enum properties', () => {
    const shape = jsonSchemaToZodShape(
      {
        action: {
          type: 'string',
          enum: ['start', 'stop', 'reboot'],
          description: 'VM action'
        }
      },
      ['action']
    );
    expect(shape).toHaveProperty('action');
  });

  it('handles empty properties', () => {
    const shape = jsonSchemaToZodShape({}, []);
    expect(Object.keys(shape)).toHaveLength(0);
  });

  it('handles undefined properties', () => {
    const shape = jsonSchemaToZodShape(undefined, []);
    expect(Object.keys(shape)).toHaveLength(0);
  });

  it('converts real ssh_exec schema', () => {
    const shape = jsonSchemaToZodShape(
      {
        host: { type: 'string', description: 'Target host ID' },
        command: { type: 'string', description: 'Command to execute' }
      },
      ['host', 'command']
    );
    expect(shape).toHaveProperty('host');
    expect(shape).toHaveProperty('command');
    // Both required, so neither should be optional
    expect(shape.host.isOptional()).toBe(false);
    expect(shape.command.isOptional()).toBe(false);
  });

  it('converts real proxmox_vm_action schema', () => {
    const shape = jsonSchemaToZodShape(
      {
        node: { type: 'string', description: 'Proxmox node' },
        vmid: { type: 'integer', description: 'VM ID' },
        action: {
          type: 'string',
          enum: ['start', 'stop', 'reboot', 'suspend', 'resume', 'shutdown'],
          description: 'Action to perform'
        }
      },
      ['node', 'vmid', 'action']
    );
    expect(Object.keys(shape)).toHaveLength(3);
  });

  it('converts fleet_status schema (no properties)', () => {
    const shape = jsonSchemaToZodShape({}, []);
    expect(Object.keys(shape)).toHaveLength(0);
  });

  it('converts nested object properties recursively', () => {
    const shape = jsonSchemaToZodShape({
      config: {
        type: 'object',
        description: 'Configuration',
        properties: {
          host: { type: 'string' },
          port: { type: 'integer' }
        },
        required: ['host']
      }
    }, ['config']);
    expect(shape).toHaveProperty('config');
    // Nested object should have been processed
    expect(shape.config.isOptional()).toBe(false);
  });

  it('converts typed string arrays', () => {
    const shape = jsonSchemaToZodShape({
      hosts: {
        type: 'array',
        items: { type: 'string' },
        description: 'Host list'
      }
    }, ['hosts']);
    expect(shape).toHaveProperty('hosts');
  });

  it('converts typed object arrays', () => {
    const shape = jsonSchemaToZodShape({
      rules: {
        type: 'array',
        items: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name']
        }
      }
    }, []);
    expect(shape).toHaveProperty('rules');
  });

  it('applies default values', () => {
    const shape = jsonSchemaToZodShape({
      timeout: { type: 'number', default: 30 },
      format: { type: 'string', default: 'json' }
    }, []);
    expect(shape).toHaveProperty('timeout');
    expect(shape).toHaveProperty('format');
  });

  it('handles array with no items schema', () => {
    const shape = jsonSchemaToZodShape({
      data: { type: 'array' }
    }, []);
    expect(shape).toHaveProperty('data');
  });

  it('uses z.record for objects without properties (no passthrough)', () => {
    const shape = jsonSchemaToZodShape({
      metadata: { type: 'object', description: 'Arbitrary metadata' }
    }, []);
    expect(shape).toHaveProperty('metadata');
    // z.record allows arbitrary keys but is not z.object().passthrough()
    const parsed = shape.metadata.safeParse({ foo: 'bar', num: 42 });
    expect(parsed.success).toBe(true);
  });

  it('nested objects do not allow passthrough of unknown properties', () => {
    const shape = jsonSchemaToZodShape({
      config: {
        type: 'object',
        properties: { host: { type: 'string' } },
        required: ['host']
      }
    }, ['config']);
    // z.object() (without .passthrough()) strips unknown keys by default
    const parsed = shape.config.safeParse({ host: 'docker01', extra: 'ignored' });
    expect(parsed.success).toBe(true);
    // Zod strips unknown keys by default (not strict, not passthrough)
    expect(parsed.data).toEqual({ host: 'docker01' });
  });
});

describe('registerTools', () => {
  it('skips tools without name', async () => {
    const { registerTools } = await import('../lib/tool-adapter.js');

    const mockServer = {
      tool: () => {}
    };
    const mockClient = {};
    const ctx = { agentId: 'quox', sessionId: '' };

    const count = registerTools(mockServer, [
      { description: 'No name tool' },
      { name: 'valid', description: 'Valid tool', input_schema: { properties: {}, required: [] } }
    ], mockClient, ctx);

    expect(count).toBe(1);
  });

  it('skips tools without description', async () => {
    const { registerTools } = await import('../lib/tool-adapter.js');

    const mockServer = {
      tool: () => {}
    };
    const mockClient = {};

    const count = registerTools(mockServer, [
      { name: 'no_desc' }
    ], mockClient, { agentId: 'quox', sessionId: '' });

    expect(count).toBe(0);
  });

  it('registers all valid tools', async () => {
    const { registerTools } = await import('../lib/tool-adapter.js');

    const registered = [];
    const mockServer = {
      tool: (name, desc, shape, handler) => { registered.push(name); }
    };
    const mockClient = {};

    const tools = [
      { name: 'ssh_exec', description: 'Execute SSH command', input_schema: { properties: { host: { type: 'string' } }, required: ['host'] } },
      { name: 'fleet_status', description: 'Get fleet status', input_schema: { properties: {}, required: [] } },
      { name: 'docker_status', description: 'Docker containers', input_schema: { properties: { host: { type: 'string' } }, required: ['host'] } }
    ];

    const count = registerTools(mockServer, tools, mockClient, { agentId: 'quox', sessionId: '' });

    expect(count).toBe(3);
    expect(registered).toEqual(['ssh_exec', 'fleet_status', 'docker_status']);
  });

  it('tool handler logs success to stderr', async () => {
    const { registerTools } = await import('../lib/tool-adapter.js');

    let capturedHandler;
    const mockServer = {
      tool: (name, desc, shape, handler) => { capturedHandler = handler; }
    };
    const mockClient = {
      executeTool: vi.fn().mockResolvedValue({ success: true, stdout: 'ok' })
    };

    registerTools(mockServer, [
      { name: 'test_tool', description: 'Test', input_schema: { properties: {}, required: [] } }
    ], mockClient, { agentId: 'quox', sessionId: 'sess-1' });

    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await capturedHandler({});
    expect(result.content[0].text).toContain('"success":');
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Tool test_tool OK'));
    stderrSpy.mockRestore();
  });

  it('tool handler logs failure to stderr', async () => {
    const { registerTools } = await import('../lib/tool-adapter.js');

    let capturedHandler;
    const mockServer = {
      tool: (name, desc, shape, handler) => { capturedHandler = handler; }
    };
    const mockClient = {
      executeTool: vi.fn().mockRejectedValue(new Error('Connection refused'))
    };

    registerTools(mockServer, [
      { name: 'fail_tool', description: 'Test', input_schema: { properties: {}, required: [] } }
    ], mockClient, { agentId: 'quox', sessionId: 'sess-1' });

    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await capturedHandler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Connection refused');
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Tool fail_tool FAILED'));
    stderrSpy.mockRestore();
  });
});
