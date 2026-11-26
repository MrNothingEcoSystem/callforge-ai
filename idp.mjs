/**
 * CALLFORGE AI — External OIDC identity-provider verification seam (M09 step 6 / SEC-001)
 *
 * SEC-001 is that `/oauth/authorize` self-asserts tenant + role: `oauth.mjs` mints
 * HS256 tokens for whoever asks. The production answer is a real IdP. Which IdP is
 * still an owner decision (see management/SEC001_IDP_DOSSIER.md), so this module is
 * the provider-neutral half: it verifies bearer tokens issued by *any*
 * OIDC-compliant authorization server from its published JWKS, and maps claims to
 * CALLFORGE's tenant/role context. The vendor choice then only decides where the
 * issuer URL points.
 *
 * Opt-in and default-off: `CALLFORGE_IDP_MODE=external` switches `validateAccessToken`
 * onto this path. With the flag unset the local HS256 behaviour is untouched, so the
 * simulation baseline and every existing test stay valid.
 *
 * Config (all read from env, fail closed):
 *   CALLFORGE_IDP_MODE=external        enable the external path
 *   CALLFORGE_OIDC_ISSUER              exact `iss` value the IdP stamps (claim `iss`)
 *   CALLFORGE_OIDC_JWKS_URI            JWKS document URI (never derived from the token)
 *   CALLFORGE_OIDC_AUDIENCE            expected `aud` (default `callforge-api`)
 *   CALLFORGE_OIDC_TENANT_CLAIM        claim holding the tenant/org id (default `org_id`)
 *   CALLFORGE_OIDC_ROLE_CLAIM          claim holding the role (default `role`)
 *   CALLFORGE_OIDC_ROLE_MAP            JSON object mapping IdP roles -> CALLFORGE roles
 *   CALLFORGE_OIDC_CLOCK_SKEW          seconds of leeway on exp/nbf (default 60)
 *
 * Verification is synchronous: the JWKS is fetched ahead of time (startup prime and
 * background refresh) into a key cache, so `validateAccessToken` keeps its sync
 * signature and every call site is unchanged. An unknown `kid` fails closed and
 * schedules a refresh, which is the right behaviour for key rotation.
 */

import { createPublicKey, verify as cryptoVerify, timingSafeEqual } from 'node:crypto';

const KEY_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

/** Accepted JWS algorithms; `none` and symmetric HS* are rejected by design. */
const ALGS = {
  RS256: { hash: 'sha256', keyType: 'rsa' },
  RS384: { hash: 'sha384', keyType: 'rsa' },
  RS512: { hash: 'sha512', keyType: 'rsa' },
  PS256: { hash: 'sha256', keyType: 'rsa', pss: true },
  ES256: { hash: 'sha256', keyType: 'ec', dsaEncoding: 'ieee-p1363' },
  ES384: { hash: 'sha384', keyType: 'ec', dsaEncoding: 'ieee-p1363' },
};

const keyCache = new Map(); // kid (or `:single`) -> { key, alg, expiresAt }
let lastFetchAt = 0;
let inflight = null;
let lastError = null;

function b64urlJson(segment) {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Read + validate the external-IdP configuration. Returns null when the external
 * path is off. Throws when the flag is on but the config cannot be satisfied — a
 * half-configured IdP must not silently fall back to self-asserted HS256 tokens.
 */
export function idpConfig(env = process.env) {
  if (env.CALLFORGE_IDP_MODE !== 'external') {
    return null;
  }
  const missing = ['CALLFORGE_OIDC_ISSUER', 'CALLFORGE_OIDC_JWKS_URI'].filter(k => !env[k]);
  if (missing.length > 0) {
    throw new Error(`CALLFORGE_IDP_MODE=external requires ${missing.join(', ')}`);
  }
  let issuer;
  let jwksUri;
  try {
    issuer = new URL(env.CALLFORGE_OIDC_ISSUER).toString().replace(/\/$/, '');
    jwksUri = new URL(env.CALLFORGE_OIDC_JWKS_URI).toString();
  } catch {
    throw new Error('CALLFORGE_OIDC_ISSUER and CALLFORGE_OIDC_JWKS_URI must be absolute URLs');
  }
  if (!jwksUri.startsWith('https://') && env.NODE_ENV === 'production') {
    throw new Error('CALLFORGE_OIDC_JWKS_URI must be https in production');
  }
  let roleMap = {};
  if (env.CALLFORGE_OIDC_ROLE_MAP) {
    try {
      roleMap = JSON.parse(env.CALLFORGE_OIDC_ROLE_MAP);
    } catch {
      throw new Error('CALLFORGE_OIDC_ROLE_MAP must be valid JSON');
    }
  }
  const skew = Number(env.CALLFORGE_OIDC_CLOCK_SKEW);
  return {
    issuer,
    jwksUri,
    audience: env.CALLFORGE_OIDC_AUDIENCE || 'callforge-api',
    tenantClaim: env.CALLFORGE_OIDC_TENANT_CLAIM || 'org_id',
    roleClaim: env.CALLFORGE_OIDC_ROLE_CLAIM || 'role',
    roleMap,
    clockSkew: Number.isFinite(skew) && skew >= 0 ? skew : 60,
  };
}

function usableKey(jwk) {
  if (!jwk || !jwk.kty || (jwk.use && jwk.use !== 'sig')) {
    return null;
  }
  if (Array.isArray(jwk.key_ops) && !jwk.key_ops.includes('verify')) {
    return null;
  }
  if (jwk.kty !== 'RSA' && jwk.kty !== 'EC') {
    return null;
  }
  const alg = jwk.alg && ALGS[jwk.alg] ? jwk.alg : null;
  try {
    return { key: createPublicKey({ key: jwk, format: 'jwk' }), alg };
  } catch {
    return null;
  }
}

/** Fetch + cache the JWKS. Called at startup, on rotation suspicion, and by tests. */
export async function primeJwks(config, { fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  if (inflight) {
    return inflight;
  }
  inflight = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetchImpl(config.jwksUri, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (!res.ok) {
        throw new Error(`JWKS fetch failed: ${res.status}`);
      }
      const body = await res.json();
      if (!body || !Array.isArray(body.keys)) {
        throw new Error('JWKS document has no keys array');
      }
      const next = new Map();
      for (const jwk of body.keys) {
        const imported = usableKey(jwk);
        if (!imported) {
          continue;
        }
        next.set(jwk.kid || ':single', { ...imported, expiresAt: now + KEY_TTL_MS });
      }
      if (next.size === 0) {
        throw new Error('JWKS document has no usable signature key');
      }
      keyCache.clear();
      for (const [kid, entry] of next) {
        keyCache.set(kid, entry);
      }
      lastFetchAt = now;
      lastError = null;
      return { ok: true, keys: next.size };
    } catch (error) {
      lastError = error.message;
      throw error;
    } finally {
      clearTimeout(timer);
      inflight = null;
    }
  })();
  return inflight;
}

/** Non-throwing prime for startup wiring: a cold IdP must not crash the server. */
export async function primeJwksQuietly(config, opts) {
  try {
    return await primeJwks(config, opts);
  } catch {
    return { ok: false, error: lastError };
  }
}

function lookupKey(kid, alg, now) {
  const entry = keyCache.get(kid || ':single');
  if (!entry) {
    return { miss: true };
  }
  if (entry.expiresAt < now) {
    keyCache.delete(kid || ':single');
    return { miss: true };
  }
  if (entry.alg && alg && entry.alg !== alg) {
    return { error: 'Token algorithm does not match the JWKS key' };
  }
  return { entry };
}

function signatureOk(entry, alg, signingInput, signature) {
  const spec = ALGS[alg];
  if (!spec) {
    return false;
  }
  try {
    return cryptoVerify(
      spec.hash,
      Buffer.from(signingInput),
      {
        key: entry.key,
        padding: spec.pss ? 6 : 1, // 6 = RSA_PKCS1_PSS_PADDING
        ...(spec.dsaEncoding ? { dsaEncoding: spec.dsaEncoding } : {}),
        ...(spec.pss ? { saltLength: 32 } : {}),
      },
      signature,
    );
  } catch {
    return false;
  }
}

const claimList = value =>
  Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];

/**
 * Verify an externally-issued access token and map its claims. Synchronous and
 * cache-only; an unknown `kid` triggers a fire-and-forget refresh for the next call.
 */
export function verifyExternalToken(
  token,
  config,
  { now = Math.floor(Date.now() / 1000), resource = null } = {},
) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Missing access token' };
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Invalid token signature' };
  }
  const [headerSeg, bodySeg, sigSeg] = parts;
  const header = b64urlJson(headerSeg);
  const claims = b64urlJson(bodySeg);
  if (!header || !claims) {
    return { valid: false, error: 'Invalid token signature' };
  }
  const alg = header.alg;
  const spec = ALGS[alg];
  if (!spec) {
    return { valid: false, error: `Unsupported token algorithm: ${alg || 'none'}` };
  }
  const looked = lookupKey(header.kid, alg, Date.now());
  if (looked.miss) {
    primeJwksQuietly(config);
    return { valid: false, error: 'Token signing key is not in the JWKS (refreshing)' };
  }
  if (looked.error) {
    return { valid: false, error: looked.error };
  }
  const signature = Buffer.from(sigSeg, 'base64url');
  if (!signatureOk(looked.entry, alg, `${headerSeg}.${bodySeg}`, signature)) {
    return { valid: false, error: 'Invalid token signature' };
  }
  // Issuers are compared exactly except for one trailing slash: providers differ
  // on it and a mismatch here is far more likely a formatting quirk than an attack
  // (the signature is already verified above).
  if (typeof claims.iss !== 'string' || claims.iss.replace(/\/$/, '') !== config.issuer) {
    return { valid: false, error: 'Invalid issuer' };
  }
  const audiences = claimList(claims.aud);
  if (resource ? !audiences.includes(resource) : !audiences.includes(config.audience)) {
    return {
      valid: false,
      error: resource ? 'Token not valid for this resource' : 'Invalid audience',
    };
  }
  if (typeof claims.exp !== 'number' || claims.exp + config.clockSkew <= now) {
    return { valid: false, error: 'Token expired' };
  }
  if (typeof claims.nbf === 'number' && claims.nbf - config.clockSkew > now) {
    return { valid: false, error: 'Token not yet valid' };
  }
  const tenantId = claims[config.tenantClaim];
  if (typeof tenantId !== 'string' || tenantId === '') {
    return { valid: false, error: `Token has no ${config.tenantClaim} claim` };
  }
  const rawRole = claims[config.roleClaim];
  const role = Array.isArray(rawRole) ? rawRole[0] : rawRole;
  // Unknown roles fail closed in the caller (no role => no scopes); the map is here
  // so an IdP's own vocabulary (e.g. `admin`) can be normalised to CALLFORGE's.
  const mapped = role && typeof role === 'string' ? config.roleMap[role] || role : null;
  return {
    valid: true,
    claims,
    context: {
      tenantId,
      subject: typeof claims.sub === 'string' ? claims.sub : null,
      role: mapped,
      claimedScopes: claimList(claims.scope).flatMap(s => s.split(' ')),
      expiresAt: claims.exp,
      iss: claims.iss,
    },
  };
}

/** Test/ops helper: expose cache state without reaching into module internals. */
export function jwksState() {
  return { keys: keyCache.size, lastFetchAt, lastError };
}

export function resetJwksCache() {
  keyCache.clear();
  lastFetchAt = 0;
  lastError = null;
  inflight = null;
}

export { timingSafeEqual };
