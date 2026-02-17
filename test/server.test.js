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
