/**
 * X (Twitter) native tool exposure (X-PLUGIN COMMANDABLE dimension).
 *
 * QuoxMCP has no X-specific code — it is a thin generic proxy over whatever
 * the collector's /api/v1/tools/list returns. These tests lock in that the
 * existing generic tool-adapter pattern (same one proven for Discord Pro in
 * discord-tools.test.js) handles the real x_* tool shapes
 * (services/collector/lib/xTools.js in quox-dashboard, exposed to the
 * `xtwitter` agent via AGENT_TOOLS) correctly:
 *   - all four native tools (x_post, x_thread, x_delete, x_budget_status)
 *     register and execute like any other tool, no MCP-side special-casing
 *   - the mutating, approval-gated tools (x_post, x_thread, x_delete) forward
 *     the collector's pending-approval body ("awaiting_approval") to Claude
 *     untouched — QuoxMCP never fabricates a posted/deleted outcome and never
 *     bypasses the gate
 *   - the read-only tool (x_budget_status) executes and returns its body
 *     verbatim
 *
 * Confirmed live against the running collector (2026-09-12):
 *   curl -H "X-Service-Key: $QUOX_SERVICE_KEY" \
 *     "http://127.0.0.1:9848/api/v1/tools/list?agent_id=xtwitter"
 *   -> x_post, x_thread, x_delete, x_budget_status all present, no org_id
 *      required (they are native/hardcoded tools, not connector-merged).
 *
 * twitter_verify_credentials is NOT covered here: it is a connector-family
 * tool (services/collector/lib/connectors/types/twitter.js) gated by
 * CONNECTOR_FAMILIES in services/collector/lib/agentTools.js, which only
 * grants the 'twitter' family to an agent key literally named 'twitter'.
 * The live agent is 'xtwitter' (renamed from 'twitter'/'x' per the
 * X-PLUGIN P1 comment in agentRegistry.js) and has no CONNECTOR_FAMILIES
 * entry, so getConnectorFamiliesForAgent('xtwitter') returns [] and
 * twitter_verify_credentials never merges in for that agent — confirmed live
 * with agent_id=xtwitter&org_id=__system__. This is a quox-dashboard-side
 * gap (a stale map key), not a quoxmcp bridge gap: the bridge would relay
 * the tool the moment the collector included it. See README "X (Twitter)
 * native posting tools" section.
 */

import { describe, it, expect, vi } from 'vitest';
import { registerTools } from '../lib/tool-adapter.js';

// Real tool definitions as served by the collector's /api/v1/tools/list for
// agent_id=xtwitter (see quox-dashboard services/collector/lib/xTools.js).
// Kept minimal but shape-true to the live response.
const X_POST_TOOL = {
  name: 'x_post',
  description: 'Draft a post to X (Twitter). Never posts directly — files an owner approval card (Inbox-Q) and returns immediately with awaiting_approval; the post is only published once the owner approves. Max 280 characters. Optionally reply to an existing tweet.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Post text, max 280 characters' },
      reply_to_tweet_id: { type: 'string', description: 'Optional: id of an existing tweet this post replies to' }
    },
    required: ['text']
  }
};

const X_THREAD_TOOL = {
  name: 'x_thread',
  description: 'Draft a thread (sequence of posts, each replying to the last) on X (Twitter). Never posts directly — files an owner approval card and returns awaiting_approval; refuses up front if the thread would exceed the remaining posting budget. Each post max 280 characters.',
  input_schema: {
    type: 'object',
    properties: {
      texts: { type: 'array', description: 'Ordered post texts making up the thread', items: { type: 'string' } }
    },
    required: ['texts']
  }
};

const X_DELETE_TOOL = {
  name: 'x_delete',
  description: 'Delete an existing post on X (Twitter). Never deletes directly — files an owner approval card and returns awaiting_approval; the delete only happens once the owner approves.',
  input_schema: {
    type: 'object',
    properties: { tweet_id: { type: 'string', description: 'Id of the tweet to delete' } },
    required: ['tweet_id']
  }
};

const X_BUDGET_STATUS_TOOL = {
  name: 'x_budget_status',
  description: 'Read-only: current X (Twitter) posting budget usage. Never gates or consumes budget — just reports where the org stands against the free-tier caps (17 posts/24h, 500 posts/30d).',
  input_schema: { type: 'object', properties: {}, required: [] }
};

const X_TOOLS = [X_POST_TOOL, X_THREAD_TOOL, X_DELETE_TOOL, X_BUDGET_STATUS_TOOL];

describe('X (Twitter) native tools via the generic tool-adapter', () => {
  it('registers all four native x_* tools with no MCP-side special-casing', () => {
    const registered = [];
    const mockServer = { tool: (name) => { registered.push(name); } };
    const mockClient = {};

    const count = registerTools(mockServer, X_TOOLS, mockClient, { agentId: 'xtwitter', sessionId: 's1' });

    expect(count).toBe(4);
    expect(registered).toEqual(['x_post', 'x_thread', 'x_delete', 'x_budget_status']);
  });

  it('x_budget_status executes read-only and returns the collector body verbatim', async () => {
    let capturedHandler;
    const mockServer = { tool: (name, desc, shape, handler) => { capturedHandler = handler; } };
    const budgetReport = { success: true, used_24h: 3, cap_24h: 17, used_30d: 40, cap_30d: 500 };
    const mockClient = { executeTool: vi.fn().mockResolvedValue(budgetReport) };

    registerTools(mockServer, [X_BUDGET_STATUS_TOOL], mockClient, { agentId: 'xtwitter', sessionId: 's1' });

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await capturedHandler({});
    console.error.mockRestore();

    expect(mockClient.executeTool).toHaveBeenCalledWith(
      'x_budget_status', {}, 'xtwitter', 's1', undefined, undefined, undefined
    );
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual(budgetReport);
  });

  it('x_post forwards an awaiting_approval body untouched — never fabricates a posted tweet id', async () => {
    let capturedHandler;
    const mockServer = { tool: (name, desc, shape, handler) => { capturedHandler = handler; } };
    // Real shape from the approval gate: success:false + status:awaiting_approval
    // means "queued for owner approval", not "failed" and not "posted".
    const awaitingApprovalBody = {
      success: false,
      status: 'awaiting_approval',
      message: 'Post queued for owner approval.',
      approvalId: 'appr_x123',
      instructions: 'Approve in Inbox-Q to publish. No tweet id exists yet.'
    };
    const mockClient = { executeTool: vi.fn().mockResolvedValue(awaitingApprovalBody) };

    registerTools(mockServer, [X_POST_TOOL], mockClient, { agentId: 'xtwitter', sessionId: 's1' });

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await capturedHandler({ text: 'hello world' });
    console.error.mockRestore();

    // QuoxMCP treats this as a normal (non-isError) tool result — the gate
    // decided the outcome, QuoxMCP just relays it verbatim. No polling, no
    // synthesized tweet id, no MCP-side bypass of the gate.
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual(awaitingApprovalBody);
    expect(parsed.status).toBe('awaiting_approval');
    expect(parsed).not.toHaveProperty('tweet_id');
  });

  it('x_delete: an RBAC-denied collector response surfaces as an honest MCP error, never empty success', async () => {
    let capturedHandler;
    const mockServer = { tool: (name, desc, shape, handler) => { capturedHandler = handler; } };
    const mockClient = {
      executeTool: vi.fn().mockRejectedValue(new Error('HTTP 403: forbidden'))
    };

    registerTools(mockServer, [X_DELETE_TOOL], mockClient, { agentId: 'nova', sessionId: 's1' });

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await capturedHandler({ tweet_id: '123' });
    console.error.mockRestore();

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('403');
  });
});
