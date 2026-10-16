/**
 * mcp-auth: resource-server token validator tests
 */
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { validatePrincipal } from '../lib/mcp-auth.js';

const SECRET = 'test-secret-value';
const AUD = 'https://mcp.example.test/mcp';
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

function mint(claims, secret = SECRET, header = { alg: 'HS256', typ: 'JWT' }) {
  const body = `${b64(header)}.${b64(claims)}`;
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
const now = () => Math.floor(Date.now() / 1000);
const base = (over = {}) => ({
  org_id: 'org_A', user_id: 'user_A', agent_id: 'agent_A',
  aud: [AUD], exp: now() + 300, ...over,
});
const opts = (over = {}) => ({ expectedAudience: AUD, secret: SECRET, ...over });

describe('validatePrincipal', () => {
  it('accepts a valid token and derives principal from claims', async () => {
    const r = await validatePrincipal(mint(base({ scope: 'a b' })), opts());
    expect(r.ok).toBe(true);
    expect(r.principal).toEqual({ org_id: 'org_A', user_id: 'user_A', agent_id: 'agent_A', scopes: ['a', 'b'] });
  });
  it('rejects expired token with 401 invalid_token', async () => {
    const r = await validatePrincipal(mint(base({ exp: now() - 10 })), opts());
    expect(r).toMatchObject({ ok: false, status: 401, error_code: 'invalid_token' });
  });
  it('rejects bad signature', async () => {
    const r = await validatePrincipal(mint(base(), 'other-secret'), opts());
    expect(r).toMatchObject({ ok: false, status: 401, error_code: 'invalid_token' });
  });
  it('rejects aud not including expected audience', async () => {
    const r = await validatePrincipal(mint(base({ aud: ['https://other'] })), opts());
    expect(r).toMatchObject({ ok: false, status: 401, error_code: 'audience_mismatch' });
  });
  it('rejects token with no aud claim', async () => {
    const c = base(); delete c.aud;
    const r = await validatePrincipal(mint(c), opts());
    expect(r).toMatchObject({ ok: false, status: 401, error_code: 'audience_mismatch' });
  });
  it('accepts string aud equal to expected', async () => {
    const r = await validatePrincipal(mint(base({ aud: AUD })), opts());
    expect(r.ok).toBe(true);
  });
  it('rejects issuer mismatch when issuer configured', async () => {
    const r = await validatePrincipal(mint(base({ iss: 'https://evil' })), opts({ issuer: 'https://good' }));
    expect(r).toMatchObject({ ok: false, status: 401 });
    const ok = await validatePrincipal(mint(base({ iss: 'https://good' })), opts({ issuer: 'https://good' }));
    expect(ok.ok).toBe(true);
  });
  it('enforces requiredScopes with 403 insufficient_scope', async () => {
    const t = mint(base({ scope: 'read' }));
    const bad = await validatePrincipal(t, opts({ requiredScopes: ['read', 'write'] }));
    expect(bad).toMatchObject({ ok: false, status: 403, error_code: 'insufficient_scope' });
    const good = await validatePrincipal(mint(base({ scopes: ['read', 'write'] })), opts({ requiredScopes: ['read', 'write'] }));
    expect(good.ok).toBe(true);
  });
  it('rejects missing/empty token with 401 token_missing', async () => {
    for (const t of [undefined, null, '', '   ']) {
      expect(await validatePrincipal(t, opts())).toMatchObject({ ok: false, status: 401, error_code: 'token_missing' });
    }
  });
  it('TENANT ISOLATION: opts identity fields cannot override token claims', async () => {
    const r = await validatePrincipal(mint(base()), opts({ org_id: 'org_EVIL', user_id: 'u_EVIL', agent_id: 'a_EVIL', principal: { org_id: 'org_EVIL' } }));
    expect(r.ok).toBe(true);
    expect(r.principal.org_id).toBe('org_A');
    expect(r.principal.user_id).toBe('user_A');
    expect(r.principal.agent_id).toBe('agent_A');
  });
  it('rejects alg none / alg confusion and missing identity', async () => {
    const none = `${b64({ alg: 'none' })}.${b64(base())}.`;
    expect(await validatePrincipal(none, opts())).toMatchObject({ ok: false, status: 401 });
    const noOrg = base(); delete noOrg.org_id;
    expect(await validatePrincipal(mint(noOrg), opts())).toMatchObject({ ok: false, status: 401 });
  });
  it('fails closed with no secret, no expectedAudience, and never throws', async () => {
    expect(await validatePrincipal(mint(base()), { expectedAudience: AUD })).toMatchObject({ ok: false });
    expect(await validatePrincipal(mint(base()), { secret: SECRET })).toMatchObject({ ok: false });
    expect(await validatePrincipal(mint(base()), undefined)).toMatchObject({ ok: false });
    const r = await validatePrincipal(mint(base()), opts({ verify: async () => { throw new Error('boom'); } }));
    expect(r).toMatchObject({ ok: false, status: 401 });
  });
  it('supports custom verify fn', async () => {
    const r = await validatePrincipal('x', opts({ verify: async () => base() }));
    expect(r.ok).toBe(true);
  });
});
