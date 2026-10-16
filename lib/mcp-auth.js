/**
 * mcp-auth: OAuth resource-server token validator.
 *
 * Single tenant-isolation enforcement point for remote MCP calls.
 *
 * SECURITY CONTRACT
 *  - Fail closed: every failure returns { ok:false, status, error_code, error }; never throws.
 *  - The principal (org_id, user_id, agent_id, scopes) is derived EXCLUSIVELY
 *    from verified token claims. No opts field or argument can set or override it.
 *  - `aud` must be present and include opts.expectedAudience (canonical MCP resource URI).
 *  - NO TOKEN PASSTHROUGH: the validated inbound token must NOT be forwarded to
 *    upstream collector calls. Upstream calls use the service key, with the
 *    verified principal supplied by this module's output only.
 */

'use strict';

const crypto = require('node:crypto');
const { sanitizeError } = require('./validate');

function fail(status, error_code, error) {
  return { ok: false, status, error_code, error: sanitizeError(String(error || error_code)) };
}

function b64urlDecode(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('malformed token');
  return Buffer.from(s, 'base64url');
}

/** Default HS256 verifier. Returns claims or throws. */
function makeHs256Verify(secret) {
  return async function verifyHs256(token) {
    if (!secret) throw new Error('verifier not configured');
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('malformed token');
    const header = JSON.parse(b64urlDecode(parts[0]).toString('utf8'));
    if (!header || header.alg !== 'HS256') throw new Error('unsupported alg');
    const expected = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
    const given = b64urlDecode(parts[2]);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      throw new Error('bad signature');
    }
    const claims = JSON.parse(b64urlDecode(parts[1]).toString('utf8'));
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) throw new Error('bad claims');
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== 'number' || claims.exp <= nowSec) throw new Error('token expired');
    if (typeof claims.nbf === 'number' && claims.nbf > nowSec) throw new Error('token not yet valid');
    return claims;
  };
}

function scopesFrom(claims) {
  const out = [];
  if (typeof claims.scope === 'string') out.push(...claims.scope.split(/\s+/).filter(Boolean));
  if (Array.isArray(claims.scopes)) out.push(...claims.scopes.filter((s) => typeof s === 'string' && s));
  else if (typeof claims.scopes === 'string') out.push(...claims.scopes.split(/\s+/).filter(Boolean));
  return [...new Set(out)];
}

/**
 * @param {string} token raw bearer token (no "Bearer " prefix)
 * @param {{expectedAudience:string, issuer?:string, requiredScopes?:string[],
 *          verify?:(token:string)=>Promise<object>, secret?:string}} opts
 * @returns {Promise<{ok:true, principal:{org_id,user_id,agent_id,scopes:string[]}}
 *                  |{ok:false,status:number,error_code:string,error:string}>}
 */
async function validatePrincipal(token, opts) {
  try {
    const o = opts && typeof opts === 'object' ? opts : {};
    const expectedAudience = o.expectedAudience;
    if (typeof expectedAudience !== 'string' || !expectedAudience) {
      return fail(500, 'server_misconfigured', 'expectedAudience not configured');
    }
    if (typeof token !== 'string' || !token.trim()) {
      return fail(401, 'token_missing', 'bearer token required');
    }

    let verify = o.verify;
    if (typeof verify !== 'function') {
      const secret = o.secret || process.env.QUOX_JWT_SECRET || process.env.JWT_SECRET;
      if (!secret) return fail(500, 'server_misconfigured', 'token verifier not configured');
      verify = makeHs256Verify(secret);
    }

    let claims;
    try {
      claims = await verify(token.trim());
    } catch (err) {
      return fail(401, 'invalid_token', `token verification failed: ${err && err.message}`);
    }
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
      return fail(401, 'invalid_token', 'token claims invalid');
    }

    // Enforce expiry in the COMMON path, not only in the default verifier: a custom
    // `verify` (e.g. a future JWKS/RS256 validator) must not be able to skip exp. exp
    // is required; nbf honoured when present. Fail closed.
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== 'number' || claims.exp <= nowSec) {
      return fail(401, 'invalid_token', 'token expired or missing exp');
    }
    if (typeof claims.nbf === 'number' && claims.nbf > nowSec) {
      return fail(401, 'invalid_token', 'token not yet valid');
    }

    const aud = Array.isArray(claims.aud) ? claims.aud : claims.aud != null ? [claims.aud] : [];
    if (!aud.includes(expectedAudience)) {
      return fail(401, 'audience_mismatch', 'token audience does not match this resource');
    }

    if (o.issuer && claims.iss !== o.issuer) {
      return fail(401, 'invalid_token', 'token issuer mismatch');
    }

    const nonEmpty = (v) => typeof v === 'string' && v.length > 0;
    if (!nonEmpty(claims.org_id) || !nonEmpty(claims.user_id)) {
      return fail(401, 'invalid_token', 'token missing identity claims');
    }

    const scopes = scopesFrom(claims);
    if (Array.isArray(o.requiredScopes) && o.requiredScopes.length) {
      const missing = o.requiredScopes.filter((s) => !scopes.includes(s));
      if (missing.length) return fail(403, 'insufficient_scope', 'token lacks required scope');
    }

    // Principal comes ONLY from verified claims. Never read identity from opts.
    return {
      ok: true,
      principal: {
        org_id: claims.org_id,
        user_id: claims.user_id,
        agent_id: nonEmpty(claims.agent_id) ? claims.agent_id : null,
        scopes,
      },
    };
  } catch (err) {
    return fail(401, 'invalid_token', err && err.message);
  }
}

module.exports = { validatePrincipal };
