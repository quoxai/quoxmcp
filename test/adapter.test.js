/**
 * ToolAdapter Tests
 */

import { describe, it, expect } from 'vitest';
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
});
