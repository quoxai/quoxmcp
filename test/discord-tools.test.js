/**
 * Discord Pro tool exposure (QDIS-NEXT ph10).
 *
 * QuoxMCP has no Discord-specific code — it is a thin generic proxy over
 * whatever the collector's /api/v1/tools/list returns. These tests lock in
 * that the existing generic tool-adapter pattern handles the real Discord
 * Pro tool shapes (services/collector/lib/discordProTools.js in
 * quox-dashboard) correctly:
 *   - the two read-only tools (discord_list_bindings, discord_diagnose)
 *     register and execute like any other tool
 *   - the two mutating, approval-gated tools (discord_bind_channel,
 *     discord_unbind_channel) forward the collector's pending-approval body
 *     to Claude untouched — QuoxMCP never special-cases or bypasses the gate
 *   - a non-2xx / RBAC-denied collector response surfaces as an honest MCP
 *     error, never an empty success
 */

import { describe, it, expect, vi } from 'vitest';
import { registerTools } from '../lib/tool-adapter.js';

// Real tool definitions as served by the collector's /api/v1/tools/list for
// an agent with Discord Pro access (see quox-dashboard
// services/collector/lib/discordProTools.js). Kept minimal but shape-true.
const DISCORD_LIST_BINDINGS_TOOL = {
  name: 'discord_list_bindings',
  description: 'List every Discord channel binding on the Discord Pro daemon. Read-only.',
  input_schema: { type: 'object', properties: {}, required: [] }
};

const DISCORD_DIAGNOSE_TOOL = {
  name: 'discord_diagnose',
  description: 'Diagnose why a Discord Pro binding is not working. Read-only.',
  input_schema: { type: 'object', properties: {}, required: [] }
};

const DISCORD_BIND_CHANNEL_TOOL = {
  name: 'discord_bind_channel',
  description: 'Bind (or rebind) a Discord channel to a mode and agent. MUTATING, always approval-gated.',
  input_schema: {
    type: 'object',
    properties: {
      channel_id: { type: 'string', description: 'Discord channel snowflake id' },
      mode: { type: 'string', enum: ['echo', 'support', 'quoxchat', 'team', 'roundtable', 'bridge'] }
    },
    required: ['channel_id', 'mode']
  }
};

const DISCORD_UNBIND_CHANNEL_TOOL = {
  name: 'discord_unbind_channel',
  description: 'Remove a Discord channel binding. MUTATING, always approval-gated.',
  input_schema: {
    type: 'object',
    properties: { channel_id: { type: 'string' } },
    required: ['channel_id']
  }
};

const DISCORD_TOOLS = [
  DISCORD_LIST_BINDINGS_TOOL,
  DISCORD_DIAGNOSE_TOOL,
  DISCORD_BIND_CHANNEL_TOOL,
  DISCORD_UNBIND_CHANNEL_TOOL
];

describe('Discord Pro tools via the generic tool-adapter', () => {
  it('registers all four Discord Pro tools with no MCP-side special-casing', () => {
    const registered = [];
    const mockServer = { tool: (name) => { registered.push(name); } };
    const mockClient = {};

    const count = registerTools(mockServer, DISCORD_TOOLS, mockClient, { agentId: 'concierge', sessionId: 's1' });

    expect(count).toBe(4);
    expect(registered).toEqual([
      'discord_list_bindings',
      'discord_diagnose',
      'discord_bind_channel',
      'discord_unbind_channel'
    ]);
  });

  it('discord_diagnose executes read-only and returns the collector body verbatim', async () => {
    let capturedHandler;
    const mockServer = { tool: (name, desc, shape, handler) => { capturedHandler = handler; } };
    const diagnoseReport = {
      success: true,
      bindings: [
        { channel_id: '123', status: 'FATAL', reason: 'Missing View Channel permission' },
        { channel_id: '456', status: 'OK' }
      ]
    };
    const mockClient = { executeTool: vi.fn().mockResolvedValue(diagnoseReport) };

    registerTools(mockServer, [DISCORD_DIAGNOSE_TOOL], mockClient, { agentId: 'concierge', sessionId: 's1' });

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await capturedHandler({});
    console.error.mockRestore();

    expect(mockClient.executeTool).toHaveBeenCalledWith(
      'discord_diagnose', {}, 'concierge', 's1', undefined, undefined, undefined
    );
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual(diagnoseReport);
  });

  it('discord_list_bindings surfaces the daemon-unreachable case honestly (not empty success)', async () => {
    let capturedHandler;
    const mockServer = { tool: (name, desc, shape, handler) => { capturedHandler = handler; } };
    // discordProTools.js never throws for a daemon-down condition — it resolves
    // { success: false, error }. Confirm the adapter passes that through as-is,
    // it must not upgrade it to a bare success.
    const mockClient = {
      executeTool: vi.fn().mockResolvedValue({ success: false, error: 'Discord Pro proxy unreachable' })
    };

    registerTools(mockServer, [DISCORD_LIST_BINDINGS_TOOL], mockClient, { agentId: 'concierge', sessionId: 's1' });

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await capturedHandler({});
    console.error.mockRestore();

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('unreachable');
  });

  it('discord_bind_channel forwards a pending-approval body untouched, without marking it an MCP error', async () => {
    let capturedHandler;
    const mockServer = { tool: (name, desc, shape, handler) => { capturedHandler = handler; } };
    // Real shape from withApprovalGate() in quox-dashboard's approvalGate.js:
    // success:false + pending:true is a valid, non-error outcome — it means
    // "a human must approve this", not "the call failed".
    const pendingApprovalBody = {
      success: false,
      pending: true,
      message: 'This action requires approval.',
      approvalId: 'appr_abc123',
      instructions: 'Re-invoke with _approvalId: "appr_abc123" after approval.',
      _approval: { id: 'appr_abc123', status: 'pending' }
    };
    const mockClient = { executeTool: vi.fn().mockResolvedValue(pendingApprovalBody) };

    registerTools(mockServer, [DISCORD_BIND_CHANNEL_TOOL], mockClient, { agentId: 'concierge', sessionId: 's1' });

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await capturedHandler({ channel_id: '123', mode: 'bridge' });
    console.error.mockRestore();

    // QuoxMCP treats this as a normal (non-isError) tool result — the gate
    // decided the outcome, QuoxMCP just relays it. No MCP-side bypass exists.
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual(pendingApprovalBody);
  });

  it('discord_unbind_channel: an RBAC-denied collector response surfaces as an honest MCP error, never empty success', async () => {
    let capturedHandler;
    const mockServer = { tool: (name, desc, shape, handler) => { capturedHandler = handler; } };
    // Mirrors CollectorClient._request(): a non-2xx status is thrown as an
    // Error before any body parsing happens, so a 403 body can never be
    // mistaken for tool data.
    const mockClient = {
      executeTool: vi.fn().mockRejectedValue(new Error('HTTP 403: forbidden'))
    };

    registerTools(mockServer, [DISCORD_UNBIND_CHANNEL_TOOL], mockClient, { agentId: 'nova', sessionId: 's1' });

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await capturedHandler({ channel_id: '123' });
    console.error.mockRestore();

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('403');
  });
});
