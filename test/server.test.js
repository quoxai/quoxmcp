/**
 * MCP Server Tests
 *
 * Tests for server initialization, tool registration, and MCP protocol compliance.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('MCP Server Components', () => {
  describe('McpServer creation', () => {
    it('creates server with correct metadata', async () => {
      const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
      const server = new McpServer({ name: 'quoxmcp', version: '1.0.0' });
      expect(server).toBeDefined();
    });

    it('StdioServerTransport is available', async () => {
      const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
      expect(StdioServerTransport).toBeDefined();
      expect(typeof StdioServerTransport).toBe('function');
    });
  });

  describe('Tool registration on McpServer', () => {
    it('registers a tool with string params', async () => {
      const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
      const { z } = await import('zod');
      const server = new McpServer({ name: 'test', version: '1.0.0' });

      // Should not throw
      server.tool(
        'test_tool',
        'A test tool',
        { param1: z.string().describe('A parameter') },
        async (input) => ({ content: [{ type: 'text', text: 'ok' }] })
      );
    });

    it('registers a tool with no params', async () => {
      const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
      const server = new McpServer({ name: 'test', version: '1.0.0' });

      server.tool(
        'no_params_tool',
        'A tool with no parameters',
        {},
        async () => ({ content: [{ type: 'text', text: 'fleet data' }] })
      );
    });

    it('registers multiple tools', async () => {
      const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
      const { z } = await import('zod');
      const server = new McpServer({ name: 'test', version: '1.0.0' });

      const tools = [
        { name: 'ssh_exec', desc: 'SSH command', shape: { host: z.string(), command: z.string() } },
        { name: 'fleet_status', desc: 'Fleet overview', shape: {} },
        { name: 'docker_status', desc: 'Docker containers', shape: { host: z.string() } }
      ];

      for (const tool of tools) {
        server.tool(tool.name, tool.desc, tool.shape, async () => ({
          content: [{ type: 'text', text: '{}' }]
        }));
      }

      // No assertion needed — if registration throws, test fails
    });
  });

  describe('Full integration: registerTools with McpServer', () => {
    it('registers collector tools onto MCP server', async () => {
      const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
      const { registerTools } = await import('../lib/tool-adapter.js');

      const server = new McpServer({ name: 'quoxmcp', version: '1.0.0' });
      const mockClient = {
        executeTool: vi.fn().mockResolvedValue({ success: true })
      };

      const collectorTools = [
        {
          name: 'ssh_exec',
          description: 'Execute a command on a remote host via SSH bastion',
          input_schema: {
            type: 'object',
            properties: {
              host: { type: 'string', description: 'Target host' },
              command: { type: 'string', description: 'Command to run' }
            },
            required: ['host', 'command']
          }
        },
        {
          name: 'fleet_status',
          description: 'Get fleet-wide status of all connected agents',
          input_schema: {
            type: 'object',
            properties: {},
            required: []
          }
        },
        {
          name: 'docker_status',
          description: 'List Docker containers on a host',
          input_schema: {
            type: 'object',
            properties: {
              host: { type: 'string', description: 'Target host' },
              all: { type: 'boolean', description: 'Include stopped containers' }
            },
            required: ['host']
          }
        },
        {
          name: 'proxmox_vm_action',
          description: 'Perform action on a Proxmox VM',
          input_schema: {
            type: 'object',
            properties: {
              node: { type: 'string', description: 'Proxmox node' },
              vmid: { type: 'integer', description: 'VM ID' },
              action: {
                type: 'string',
                enum: ['start', 'stop', 'reboot', 'suspend', 'resume', 'shutdown'],
                description: 'Action to perform'
              }
            },
            required: ['node', 'vmid', 'action']
          }
        }
      ];

      const count = registerTools(server, collectorTools, mockClient, {
        agentId: 'quox',
        sessionId: 'test-session'
      });

      expect(count).toBe(4);
    });
  });

  describe('Environment variable handling', () => {
    it('defaults are sensible', () => {
      const agentId = process.env.QUOX_AGENT_ID || 'quox';
      const collectorUrl = process.env.QUOX_COLLECTOR_URL || 'http://127.0.0.1:9848';

      expect(agentId).toBe('quox');
      expect(collectorUrl).toContain('9848');
    });
  });
});

describe('Tool rediscovery after failed initial load (#6)', () => {
  it('starts empty, retries, registers tools and notifies list_changed without crashing', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const { ToolListChangedNotificationSchema } = await import('@modelcontextprotocol/sdk/types.js');
    const { startToolRediscovery } = await import('../lib/tool-discovery.js');
    const { registerTools } = await import('../lib/tool-adapter.js');

    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const calls = [];
    const client = {
      listTools: vi.fn(async () => {
        calls.push(1);
        if (calls.length < 3) throw new Error('collector down');
        return { tools: [{ name: 'fleet_status', description: 'Fleet', input_schema: { properties: {} } }] };
      }),
      executeTool: vi.fn()
    };
    const ctx = { agentId: 'quox', sessionId: 's', orgId: 'o', userId: '', authToken: '' };

    // Boot degraded: zero tools, but handlers must exist so late registration works.
    server.setToolRequestHandlers();
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const mcpClient = new Client({ name: 'c', version: '1' });
    let changed = 0;
    mcpClient.setNotificationHandler(ToolListChangedNotificationSchema, () => { changed++; });
    await mcpClient.connect(ct);
    expect((await mcpClient.listTools()).tools).toHaveLength(0);

    const done = new Promise((resolve) => {
      startToolRediscovery({
        listTools: () => client.listTools('quox', 'o'),
        onTools: (tools) => { registerTools(server, tools, client, ctx); resolve(); },
        delaysMs: [1, 1, 1, 1]
      });
    });
    await done;
    await new Promise((r) => setTimeout(r, 20));

    expect(client.listTools).toHaveBeenCalledTimes(3);
    expect((await mcpClient.listTools()).tools.map((t) => t.name)).toEqual(['fleet_status']);
    expect(changed).toBeGreaterThan(0);
  });

  it('gives up after bounded attempts without throwing', async () => {
    const { startToolRediscovery } = await import('../lib/tool-discovery.js');
    const listTools = vi.fn(async () => { throw new Error('down'); });
    const onTools = vi.fn();
    await startToolRediscovery({ listTools, onTools, delaysMs: [1, 1] }).finished;
    expect(listTools).toHaveBeenCalledTimes(2);
    expect(onTools).not.toHaveBeenCalled();
  });
});

describe('Version consistency (#9)', () => {
  it('package.json, manifest.json and server.js versions match', async () => {
    const fs = await import('node:fs');
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const man = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    const srv = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
    expect(man.version).toBe(pkg.version);
    expect(srv).toContain(`version: '${pkg.version}'`);
  });

  it('manifest marks user_id optional and org_id required (matches server.js)', async () => {
    const fs = await import('node:fs');
    const man = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
    expect(man.user_config.user_id.required).toBe(false);
    expect(man.user_config.org_id.required).toBe(true);
  });
});
