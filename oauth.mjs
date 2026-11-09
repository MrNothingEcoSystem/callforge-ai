/**
 * CALLFORGE AI — OAuth 2.1 (Authorization Code + PKCE) & RBAC
 * M02: Production identity and tenant isolation (simulation baseline)
 *
 * - Resource endpoints derive tenant context ONLY from a verified access
 *   token. Client-supplied tenant_id is never trusted (M02 critical gate).
 * - Access tokens are HS256-signed JWTs (iss/aud/exp enforced).
 * - Authorization codes are single-use, short-lived (10 min), and bound to
 *   a PKCE S256 code_challenge.
 * - Codes are held in memory; durable storage is an M03 concern.
 * - Real IdP user authentication is out of scope for this simulation
 *   baseline; the authorize endpoint records the tenant + role binding
 *   server-side, which is what resource endpoints trust.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const ISSUER = 'callforge';
export const AUDIENCE = 'callforge-api';
const CODE_TTL_MS = 10 * 60 * 1000;
const TOKEN_TTL_SECONDS = 15 * 60;

export const ROLES = {
  tenant_admin: ['simulate', 'read', 'audit', 'admin'],
  operator: ['simulate', 'read'],
  auditor: ['read', 'audit'],
};

const ALL_SCOPES = new Set(Object.values(ROLES).flat());

function tokenSecret() {
  return process.env.CALLFORGE_TOKEN_SECRET || 'callforge-dev-secret-change-me';
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

export function pkceS256(verifier) {
  return b64url(createHash('sha256').update(verifier).digest());
}

export function generateCodeVerifier() {
  return b64url(randomBytes(32));
}

function sign(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac('sha256', tokenSecret()).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

function verifySignature(token) {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [header, body, sig] = parts;
  const expected = b64url(createHmac('sha256', tokenSecret()).update(`${header}.${body}`).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function validateAccessToken(token, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Missing access token' };
  }
  const claims = verifySignature(token);
  if (!claims) {
    return { valid: false, error: 'Invalid token signature' };
  }
  if (claims.iss !== ISSUER) {
    return { valid: false, error: 'Invalid issuer' };
  }
  if (claims.aud !== AUDIENCE) {
    return { valid: false, error: 'Invalid audience' };
  }
  if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) {
    return { valid: false, error: 'Token expired' };
  }
  if (!claims.tenant_id) {
    return { valid: false, error: 'Token has no tenant binding' };
  }
  const scopes = Array.isArray(claims.scope) ? claims.scope : [];
  return {
    valid: true,
    context: {
      tenantId: claims.tenant_id,
      subject: claims.sub || null,
      role: claims.role || null,
      scopes,
      expiresAt: claims.exp,
    },
  };
}

export function hasScopes(context, required) {
  const granted = new Set(context?.scopes || []);
  return required.every(s => granted.has(s));
}

export function createOAuthServer() {
  const pendingCodes = new Map();

  return {
    /**
     * Authorization endpoint (simulation IdP step): records the server-side
     * tenant + role binding and issues a single-use code bound to PKCE.
     */
    authorize({
      tenant_id,
      client_id = 'callforge-sim',
      role = 'operator',
      scope,
      code_challenge,
      code_challenge_method = 'S256',
    }) {
      if (!tenant_id) {
        return { error: 'tenant_id required' };
      }
      if (!ROLES[role]) {
        return { error: `Unknown role: ${role}` };
      }
      if (!code_challenge) {
        return { error: 'code_challenge required (PKCE)' };
      }
      if (code_challenge_method !== 'S256') {
        return { error: 'Only S256 code_challenge_method supported' };
      }
      const requested = Array.isArray(scope) ? scope : ['read'];
      if (requested.some(s => !ALL_SCOPES.has(s))) {
        return { error: 'Unknown scope requested' };
      }
      const roleScopes = new Set(ROLES[role]);
      const granted = requested.filter(s => roleScopes.has(s));
      if (granted.length === 0) {
        return { error: 'Role does not allow any requested scope' };
      }

      const code = b64url(randomBytes(24));
      pendingCodes.set(code, {
        tenant_id,
        client_id,
        role,
        scope: granted,
        code_challenge,
        expires_at: Date.now() + CODE_TTL_MS,
        used: false,
      });
      return { code, expires_in: CODE_TTL_MS / 1000 };
    },

    /** Token endpoint: exchange code + verifier for a signed access token. */
    exchange({
      grant_type = 'authorization_code',
      code,
      code_verifier,
      client_id = 'callforge-sim',
    }) {
      if (grant_type !== 'authorization_code') {
        return { error: 'Unsupported grant_type' };
      }
      const record = pendingCodes.get(code);
      if (!record) {
        return { error: 'Invalid authorization code' };
      }
      if (record.used) {
        return { error: 'Authorization code already used' };
      }
      if (record.expires_at < Date.now()) {
        return { error: 'Authorization code expired' };
      }
      if (record.client_id !== client_id) {
        return { error: 'Client mismatch' };
      }
      if (!code_verifier || pkceS256(code_verifier) !== record.code_challenge) {
        return { error: 'PKCE verification failed' };
      }
      record.used = true;
      const now = Math.floor(Date.now() / 1000);
      const access_token = sign({
        iss: ISSUER,
        aud: AUDIENCE,
        sub: record.tenant_id,
        tenant_id: record.tenant_id,
        role: record.role,
        scope: record.scope,
        iat: now,
        exp: now + TOKEN_TTL_SECONDS,
        jti: b64url(randomBytes(16)),
      });
      return {
        access_token,
        token_type: 'Bearer',
        expires_in: TOKEN_TTL_SECONDS,
        scope: record.scope.join(' '),
      };
    },

    /** Extract + verify Bearer context from a request. */
    authenticate(req) {
      const header = req.headers?.authorization || req.headers?.Authorization;
      if (!header || !header.startsWith('Bearer ')) {
        return { valid: false, status: 401, error: 'Missing or invalid Authorization header' };
      }
      const result = validateAccessToken(header.slice(7));
      if (!result.valid) {
        return { valid: false, status: 401, error: result.error };
      }
      return { valid: true, context: result.context };
    },

    /** Enforce required scopes on an authenticated context. */
    authorizeScopes(context, required) {
      if (!hasScopes(context, required)) {
        return {
          authorized: false,
          status: 403,
          error: `Insufficient scope: requires ${required.join(',')}`,
        };
      }
      return { authorized: true };
    },
  };
}
