/**
 * CALLFORGE AI — External OIDC access-token verification (M02, SEC-001 path)
 *
 * Resource endpoints must trust tokens minted by a real identity provider, not
 * a tenant/role the caller asserts. This module verifies asymmetric (RSA)
 * JWTs against a configured JWKS, binds the tenant from an IdP claim, and
 * re-derives scopes from the role rather than trusting token-supplied scopes
 * (audit SEC-003).
 *
 * Fail closed, deliberately narrow:
 * - only RS256/RS384/RS512 (no `none`, no HMAC — so an external token can
 *   never be confused with an internally HS256-signed one);
 * - `kid` is mandatory and must be present in the loaded key set;
 * - `iss` and `aud` are exact-matched, `exp` is mandatory, `nbf` is honoured;
 * - a missing/unusable tenant claim or an unknown role rejects the token.
 *
 * The key set is loaded at startup (`configureOidcFromEnv`). Verification stays
 * synchronous, so key rotation cannot await a fetch mid-token; instead a
 * background refresh (interval from CALLFORGE_OIDC_JWKS_REFRESH_SECONDS,
 * default 300s, 0 disables) reloads from the same source, and an unknown `kid`
 * additionally triggers a throttled refresh. A failed refresh keeps the working
 * key set. A token signed by a brand-new key is therefore rejected once, until
 * the refresh lands.
 */

import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

const ALGORITHMS = {
  RS256: 'RSA-SHA256',
  RS384: 'RSA-SHA384',
  RS512: 'RSA-SHA512',
};

const DEFAULT_CLOCK_SKEW_SECONDS = 5;
const JWKS_FETCH_TIMEOUT_MS = 5000;
const DEFAULT_REFRESH_SECONDS = 300;
const KID_MISS_REFRESH_MIN_MS = 5000;

let state = null;
let refreshTimer = null;

function b64json(part) {
  try {
    const parsed = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required to configure external OIDC verification`);
  }
  return value;
}

/**
 * Load and validate a JWKS document. Accepts only signature-capable RSA keys
 * with a `kid` and, if it declares one, a supported `alg`.
 */
export function loadJwks(jwks) {
  if (!jwks || !Array.isArray(jwks.keys)) {
    throw new Error('JWKS document has no keys array');
  }
  const keys = new Map();
  for (const jwk of jwks.keys) {
    if (jwk.kty !== 'RSA') {
      continue;
    }
    if (jwk.use && jwk.use !== 'sig') {
      continue;
    }
    if (jwk.alg && !(jwk.alg in ALGORITHMS)) {
      continue;
    }
    if (typeof jwk.kid !== 'string' || jwk.kid === '') {
      continue;
    }
    let key;
    try {
      key = createPublicKey({ key: jwk, format: 'jwk' });
    } catch {
      continue; // an unparseable key must not take the whole set down
    }
    keys.set(jwk.kid, key);
  }
  if (keys.size === 0) {
    throw new Error('JWKS contains no usable RSA signing key');
  }
  return keys;
}

/**
 * Configure the verifier. `roleScopes` maps an IdP role claim value to the
 * scopes CALLFORGE grants for it; scopes are re-derived, never trusted.
 */
export function configureOidc({
  issuer,
  audience,
  jwks,
  roleScopes,
  tenantClaim = 'tenant_id',
  roleClaim = 'role',
  clockSkewSeconds = DEFAULT_CLOCK_SKEW_SECONDS,
  source = null,
  refreshSeconds = 0,
  kidMissRefreshMinMs = KID_MISS_REFRESH_MIN_MS,
}) {
  // Validate the scalar config before touching the key set, so a missing
  // issuer is reported as such rather than as a key-set problem.
  const validatedIssuer = requiredString(issuer, 'issuer');
  const validatedAudience = requiredString(audience, 'audience');
  if (!roleScopes || Object.keys(roleScopes).length === 0) {
    throw new Error('roleScopes is required to configure external OIDC verification');
  }
  const keys = loadJwks(jwks);
  stopRefreshTimer();
  state = {
    issuer: validatedIssuer,
    audience: validatedAudience,
    tenantClaim: requiredString(tenantClaim, 'tenantClaim'),
    roleClaim: requiredString(roleClaim, 'roleClaim'),
    clockSkewSeconds: Number.isFinite(clockSkewSeconds) ? clockSkewSeconds : 0,
    roleScopes,
    keys,
    source: source ?? null,
    kidMissRefreshMinMs: Number.isFinite(kidMissRefreshMinMs) ? kidMissRefreshMinMs : 0,
    lastRefreshAt: Date.now(),
    refreshing: false,
  };
  if (state.source && Number.isFinite(refreshSeconds) && refreshSeconds > 0) {
    refreshTimer = setInterval(() => {
      refreshOidcKeys().catch(() => {});
    }, refreshSeconds * 1000);
    refreshTimer.unref?.();
  }
  return { keyCount: keys.size, issuer: state.issuer, audience: state.audience };
}

function stopRefreshTimer() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

async function readJwks(source) {
  if (source.type === 'file') {
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(source.file, 'utf8'));
  }
  return fetchJwks(source.url);
}

/**
 * Reload the key set from the configured source. Keeps the previous set when
 * the refresh fails; never throws. Resolves `false` when there is no source or
 * a refresh is already in flight.
 */
export async function refreshOidcKeys() {
  const current = state;
  if (!current || !current.source || current.refreshing) {
    return false;
  }
  current.refreshing = true;
  try {
    const keys = loadJwks(await readJwks(current.source));
    if (state === current) {
      current.keys = keys;
    }
    return true;
  } catch {
    return false;
  } finally {
    current.refreshing = false;
    current.lastRefreshAt = Date.now();
  }
}

async function fetchJwks(source) {
  const response = await fetch(source, { signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`JWKS fetch failed with status ${response.status}`);
  }
  return response.json();
}

/**
 * Configure from the environment. No-op (returns null) when no JWKS source is
 * set, so the HS256 simulation baseline keeps working unchanged.
 *
 * CALLFORGE_OIDC_ISSUER / CALLFORGE_OIDC_AUDIENCE are mandatory once a source
 * is set; exactly one of CALLFORGE_OIDC_JWKS_FILE / CALLFORGE_OIDC_JWKS_URL.
 *
 * @param {{ roleScopes?: Record<string, string[]>, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<{ keyCount: number, issuer: string, audience: string } | null>}
 */
export async function configureOidcFromEnv({ roleScopes, env = process.env } = {}) {
  const file = env.CALLFORGE_OIDC_JWKS_FILE;
  const url = env.CALLFORGE_OIDC_JWKS_URL;
  if (!file && !url) {
    return null;
  }
  if (file && url) {
    throw new Error('Set only one of CALLFORGE_OIDC_JWKS_FILE or CALLFORGE_OIDC_JWKS_URL');
  }
  const source = file ? { type: 'file', file } : { type: 'url', url };
  const jwks = await readJwks(source);
  const refreshRaw = env.CALLFORGE_OIDC_JWKS_REFRESH_SECONDS;
  const refreshSeconds =
    refreshRaw === undefined || refreshRaw === '' ? DEFAULT_REFRESH_SECONDS : Number(refreshRaw);
  return configureOidc({
    issuer: env.CALLFORGE_OIDC_ISSUER,
    audience: env.CALLFORGE_OIDC_AUDIENCE,
    tenantClaim: env.CALLFORGE_OIDC_TENANT_CLAIM,
    roleClaim: env.CALLFORGE_OIDC_ROLE_CLAIM,
    clockSkewSeconds: Number(env.CALLFORGE_OIDC_CLOCK_SKEW_SECONDS),
    roleScopes,
    jwks,
    source,
    refreshSeconds: Number.isFinite(refreshSeconds) ? refreshSeconds : 0,
  });
}

export function oidcConfigured() {
  return state !== null;
}

/** Test helper. */
export function resetOidc() {
  stopRefreshTimer();
  state = null;
}

/**
 * Verify an externally issued RS* token and derive the request context.
 * Returns `{ valid: false, error }` for every rejection — never throws for
 * bad input.
 */
export function verifyExternalToken(token, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!state) {
    return { valid: false, error: 'External token presented but no OIDC verifier configured' };
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Invalid token structure' };
  }
  if (parts.some(p => p === '')) {
    return { valid: false, error: 'Invalid token structure' }; // refuses `alg: none`
  }
  const header = b64json(parts[0]);
  if (!header) {
    return { valid: false, error: 'Invalid token header' };
  }
  const algorithm = ALGORITHMS[header.alg];
  if (!algorithm) {
    return { valid: false, error: `Unsupported token algorithm: ${header.alg}` };
  }
  if (typeof header.kid !== 'string' || header.kid === '') {
    return { valid: false, error: 'Token has no key id' };
  }
  const key = state.keys.get(header.kid);
  if (!key) {
    // A rotated-in key is unknown until the next refresh. Start one, but not
    // more often than KID_MISS_REFRESH_MIN_MS, so unauthenticated misses cannot
    // turn into a fetch storm.
    if (state.source && Date.now() - state.lastRefreshAt >= state.kidMissRefreshMinMs) {
      state.lastRefreshAt = Date.now();
      refreshOidcKeys().catch(() => {});
    }
    return { valid: false, error: 'Unknown signing key' };
  }
  let signatureOk = false;
  try {
    signatureOk = cryptoVerify(
      algorithm,
      Buffer.from(`${parts[0]}.${parts[1]}`),
      key,
      Buffer.from(parts[2], 'base64url'),
    );
  } catch {
    return { valid: false, error: 'Invalid token signature' };
  }
  if (!signatureOk) {
    return { valid: false, error: 'Invalid token signature' };
  }

  const claims = b64json(parts[1]);
  if (!claims) {
    return { valid: false, error: 'Invalid token payload' };
  }
  if (claims.iss !== state.issuer) {
    return { valid: false, error: 'Invalid issuer' };
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(state.audience)) {
    return { valid: false, error: 'Invalid audience' };
  }
  if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) {
    return { valid: false, error: 'Token expired' };
  }
  if (typeof claims.nbf === 'number' && claims.nbf > nowSeconds + state.clockSkewSeconds) {
    return { valid: false, error: 'Token not yet valid' };
  }
  const tenantId = claims[state.tenantClaim];
  if (typeof tenantId !== 'string' || tenantId === '') {
    return { valid: false, error: 'Token has no tenant binding' };
  }
  const role = claims[state.roleClaim];
  // `in` would accept prototype names ('toString', 'constructor') that are not
  // scope lists and make the spread throw.
  if (typeof role !== 'string' || !Object.hasOwn(state.roleScopes, role)) {
    return { valid: false, error: 'Token has no known role' };
  }
  return {
    valid: true,
    context: {
      tenantId,
      subject: typeof claims.sub === 'string' ? claims.sub : null,
      role,
      scopes: [...state.roleScopes[role]],
      expiresAt: claims.exp,
    },
  };
}
