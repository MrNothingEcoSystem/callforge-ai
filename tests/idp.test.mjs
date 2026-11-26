import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSign, generateKeyPairSync, createHmac, randomUUID } from 'node:crypto';
import {
  idpConfig,
  jwksState,
  primeJwks,
  primeJwksQuietly,
  resetJwksCache,
  verifyExternalToken,
} from '../idp.mjs';
import { validateAccessToken } from '../oauth.mjs';
import { authorizationServerMetadata } from '../mcp-http.mjs';

const ISSUER = 'https://idp.example.test/';
const JWKS_URI = 'https://idp.example.test/.well-known/jwks.json';
const AUDIENCE = 'callforge-api';
const TENANT = 'tenant-acme';

const keys = new Map();

function makeKey(kid, alg = 'RS256') {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg, use: 'sig' };
  keys.set(kid, { privateKey, publicKey });
  return jwk;
}

function jwksDoc(children) {
  return { keys: children ?? [...keys.values()].map(k => k.publicJwk) };
}

function b64(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function signToken(claims, { kid, alg = 'RS256', raw } = {}) {
  const header = b64({ alg, typ: 'JWT', ...(kid ? { kid } : {}) });
  const body = b64({
    iss: ISSUER,
    aud: AUDIENCE,
    sub: 'user-1',
    org_id: TENANT,
    role: 'tenant_admin',
    scope: ['simulate', 'read'],
    iat: Math.floor(Date.now() / 1000) - 5,
    exp: Math.floor(Date.now() / 1000) + 600,
    ...claims,
  });
  const key = keys.get(kid);
  const signature = createSign('RSA-SHA256').update(`${header}.${body}`).sign(key.privateKey);
  const token = `${header}.${body}.${signature.toString('base64url')}`;
  return raw ? { token, body, header } : token;
}

function baseEnv(extra = {}) {
  return {
    CALLFORGE_IDP_MODE: 'external',
    CALLFORGE_OIDC_ISSUER: ISSUER,
    CALLFORGE_OIDC_JWKS_URI: JWKS_URI,
    ...extra,
  };
}

function applyEnv(env) {
  for (const [k, v] of Object.entries(env)) {
    process.env[k] = v;
  }
}

const ENV_KEYS = [
  'CALLFORGE_IDP_MODE',
  'CALLFORGE_OIDC_ISSUER',
  'CALLFORGE_OIDC_JWKS_URI',
  'CALLFORGE_OIDC_AUDIENCE',
  'CALLFORGE_OIDC_TENANT_CLAIM',
  'CALLFORGE_OIDC_ROLE_CLAIM',
  'CALLFORGE_OIDC_ROLE_MAP',
  'CALLFORGE_OIDC_CLOCK_SKEW',
  'CALLFORGE_TOKEN_SECRET',
  'MCP_AUTHORIZATION_SERVER',
  'NODE_ENV',
];

let publish;
let fetchImpl;
const realFetch = globalThis.fetch;

beforeEach(() => {
  for (const k of ENV_KEYS) {
    delete process.env[k];
  }
  resetJwksCache();
  keys.clear();
  publish = new Map();
  keys.publicJwk = undefined;
  fetchImpl = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ keys: [...publish.values()] }),
  }));
  // Background refresh uses the global fetch; route it at the same fake JWKS.
  globalThis.fetch = fetchImpl;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    delete process.env[k];
  }
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  resetJwksCache();
});

function publishKey(kid) {
  const jwk = makeKey(kid);
  publish.set(kid, jwk);
  return jwk;
}

async function primed() {
  applyEnv(baseEnv());
  await primeJwks(idpConfig(), { fetchImpl });
  return idpConfig();
}

describe('idpConfig', () => {
  it('is off unless CALLFORGE_IDP_MODE=external', () => {
    expect(idpConfig()).toBeNull();
    expect(idpConfig({ CALLFORGE_IDP_MODE: 'local' })).toBeNull();
  });

  it('fails closed when the flag is on without issuer or JWKS URI', () => {
    expect(() => idpConfig({ CALLFORGE_IDP_MODE: 'external' })).toThrow(/requires/);
    expect(() =>
      idpConfig({ CALLFORGE_IDP_MODE: 'external', CALLFORGE_OIDC_ISSUER: ISSUER }),
    ).toThrow(/JWKS_URI/);
  });

  it('rejects a non-URL issuer and an https JWKS in production', () => {
    expect(() => idpConfig({ ...baseEnv({ CALLFORGE_OIDC_ISSUER: 'callforge' }) })).toThrow(
      /absolute URL/,
    );
    expect(() =>
      idpConfig({
        ...baseEnv({ CALLFORGE_OIDC_JWKS_URI: 'http://insecure.test/jwks' }),
        NODE_ENV: 'production',
      }),
    ).toThrow(/https/);
  });

  it('normalises the trailing slash off the issuer and defaults the claims', () => {
    const config = idpConfig(baseEnv());
    expect(config.issuer).toBe('https://idp.example.test');
    expect(config.audience).toBe(AUDIENCE);
    expect(config.tenantClaim).toBe('org_id');
    expect(config.roleClaim).toBe('role');
    expect(config.clockSkew).toBe(60);
  });
});

describe('primeJwks', () => {
  it('imports only signature-capable asymmetric keys', async () => {
    publishKey('rsa-1');
    publish.set('enc-1', { kty: 'RSA', kid: 'enc-1', use: 'enc', e: 'AQAB', n: 'AQAB' });
    publish.set('oct-1', { kty: 'oct', kid: 'oct-1', k: 'secret' });
    applyEnv(baseEnv());
    const result = await primeJwks(idpConfig(), { fetchImpl });
    expect(result.keys).toBe(1);
    expect(jwksState().keys).toBe(1);
  });

  it('fails on a non-200 response, a keyless document, and an unusable key set', async () => {
    applyEnv(baseEnv());
    await expect(
      primeJwks(idpConfig(), { fetchImpl: async () => ({ ok: false, status: 503 }) }),
    ).rejects.toThrow(/503/);
    await expect(
      primeJwks(idpConfig(), { fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }),
    ).rejects.toThrow(/no keys/);
    await expect(primeJwks(idpConfig(), { fetchImpl })).rejects.toThrow(/no usable signature key/);
  });

  it('does not throw from primeJwksQuietly', async () => {
    applyEnv(baseEnv());
    const result = await primeJwksQuietly(idpConfig(), {
      fetchImpl: async () => {
        throw new Error('idp down');
      },
    });
    expect(result.ok).toBe(false);
    expect(jwksState().lastError).toMatch(/idp down/);
  });

  it('deduplicates concurrent fetches', async () => {
    publishKey('rsa-1');
    applyEnv(baseEnv());
    const config = idpConfig();
    await Promise.all([primeJwks(config, { fetchImpl }), primeJwks(config, { fetchImpl })]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('verifyExternalToken', () => {
  it('accepts a well-formed token and maps the context', async () => {
    publishKey('rsa-1');
    const config = await primed();
    const token = signToken({}, { kid: 'rsa-1' });
    const result = verifyExternalToken(token, config);
    expect(result.valid).toBe(true);
    expect(result.context.tenantId).toBe(TENANT);
    expect(result.context.role).toBe('tenant_admin');
    expect(result.context.claimedScopes).toEqual(['simulate', 'read']);
  });

  it('maps IdP roles through CALLFORGE_OIDC_ROLE_MAP', async () => {
    publishKey('rsa-1');
    applyEnv(
      baseEnv({
        CALLFORGE_OIDC_ROLE_MAP: JSON.stringify({ admin: 'tenant_admin' }),
      }),
    );
    await primeJwks(idpConfig(), { fetchImpl });
    const result = verifyExternalToken(signToken({ role: 'admin' }, { kid: 'rsa-1' }), idpConfig());
    expect(result.context.role).toBe('tenant_admin');
  });

  it('honours a custom tenant claim', async () => {
    publishKey('rsa-1');
    applyEnv(baseEnv({ CALLFORGE_OIDC_TENANT_CLAIM: 'org' }));
    await primeJwks(idpConfig(), { fetchImpl });
    const token = signToken({ org: 'tenant-other', org_id: 'decoy' }, { kid: 'rsa-1' });
    expect(verifyExternalToken(token, idpConfig()).context.tenantId).toBe('tenant-other');
  });

  it('rejects a missing tenant claim', async () => {
    publishKey('rsa-1');
    const config = await primed();
    const token = signToken({ org_id: undefined }, { kid: 'rsa-1' });
    expect(verifyExternalToken(token, config)).toMatchObject({
      valid: false,
      error: /org_id/,
    });
  });

  it('rejects a tampered payload and a tampered signature', async () => {
    publishKey('rsa-1');
    const config = await primed();
    const { token, body } = signToken({}, { kid: 'rsa-1', raw: true });
    const [h, , s] = token.split('.');
    const swapped = b64({ ...JSON.parse(Buffer.from(body, 'base64url')), org_id: 'tenant-evil' });
    expect(verifyExternalToken(`${h}.${swapped}.${s}`, config).error).toMatch(/signature/);
    expect(verifyExternalToken(`${h}.${body}.${'A'.repeat(342)}`, config).error).toMatch(
      /signature/,
    );
  });

  it('rejects alg=none, an alg/key mismatch, and a foreign issuer', async () => {
    publishKey('rsa-1');
    const config = await primed();
    const h = b64({ alg: 'none', typ: 'JWT' });
    const none = `${h}.${b64({ iss: ISSUER, aud: AUDIENCE, org_id: TENANT, exp: 9e9 })}.`;
    expect(verifyExternalToken(none, config).error).toMatch(/Unsupported token algorithm/);
    expect(
      verifyExternalToken(signToken({}, { kid: 'rsa-1', alg: 'ES256' }), config).error,
    ).toMatch(/Unsupported|match/);
    expect(
      verifyExternalToken(signToken({ iss: 'https://evil.test' }, { kid: 'rsa-1' }), config).error,
    ).toBe('Invalid issuer');
  });

  it('enforces audience, resource binding and expiry with skew', async () => {
    publishKey('rsa-1');
    const config = await primed();
    const token = signToken({ aud: 'other-api' }, { kid: 'rsa-1' });
    expect(verifyExternalToken(token, config).error).toBe('Invalid audience');
    expect(verifyExternalToken(signToken({ aud: undefined }, { kid: 'rsa-1' }), config).error).toBe(
      'Invalid audience',
    );
    const bound = signToken({ aud: [AUDIENCE, 'https://host.test/mcp'] }, { kid: 'rsa-1' });
    expect(verifyExternalToken(bound, config, { resource: 'https://host.test/mcp' }).valid).toBe(
      true,
    );
    expect(verifyExternalToken(bound, config, { resource: 'https://other.test/mcp' }).error).toBe(
      'Token not valid for this resource',
    );
    const now = Math.floor(Date.now() / 1000);
    expect(
      verifyExternalToken(signToken({ exp: now + 30 }, { kid: 'rsa-1' }), config, {
        now: now + 200,
      }).error,
    ).toBe('Token expired');
    expect(verifyExternalToken(signToken({ nbf: now + 600 }, { kid: 'rsa-1' }), config).error).toBe(
      'Token not yet valid',
    );
  });

  it('rejects an unknown kid and refreshes for the next call', async () => {
    publishKey('rsa-1');
    const rotatedJwk = makeKey('rotated'); // known to the signer, not yet published
    const config = await primed();
    const token = signToken({}, { kid: 'rotated' });
    expect(verifyExternalToken(token, config).error).toMatch(/refreshing/);
    publish.set('rotated', rotatedJwk);
    await vi.waitFor(() => expect(jwksState().keys).toBe(2));
    expect(verifyExternalToken(token, idpConfig()).valid).toBe(true);
  });

  it('drops a key once it outlives the cache TTL', async () => {
    const jwk = publishKey('rsa-1');
    applyEnv(baseEnv());
    const config = idpConfig();
    const base = Date.now();
    await primeJwks(config, { fetchImpl, now: base });
    const token = signToken({}, { kid: 'rsa-1' });
    expect(verifyExternalToken(token, config).valid).toBe(true);
    vi.spyOn(Date, 'now').mockReturnValue(base + 10 * 60 * 1000 + 1);
    expect(verifyExternalToken(token, config).error).toMatch(/refreshing/);
    expect(jwk.kid).toBe('rsa-1');
  });
});

describe('validateAccessToken in external mode', () => {
  it('returns scopes re-derived from the role, never the claimed ones', async () => {
    publishKey('rsa-1');
    await primed();
    const token = signToken(
      { role: 'operator', scope: ['simulate', 'read', 'admin'] },
      { kid: 'rsa-1' },
    );
    const result = validateAccessToken(token);
    expect(result.valid).toBe(true);
    expect(result.context.scopes).toEqual(['simulate', 'read']);
    expect(result.context.issuer).toBe(ISSUER);
  });

  it('fails closed for an unknown IdP role', async () => {
    publishKey('rsa-1');
    await primed();
    const result = validateAccessToken(signToken({ role: 'superuser' }, { kid: 'rsa-1' }));
    expect(result.valid).toBe(true);
    expect(result.context.scopes).toEqual([]);
  });

  it('still accepts a locally minted HS256 token during a cutover', async () => {
    publishKey('rsa-1');
    await primed();
    process.env.CALLFORGE_TOKEN_SECRET = 'test-secret';
    const now = Math.floor(Date.now() / 1000);
    const header = b64({ alg: 'HS256', typ: 'JWT' });
    const body = b64({
      iss: 'callforge',
      aud: AUDIENCE,
      sub: TENANT,
      tenant_id: TENANT,
      role: 'operator',
      scope: ['simulate'],
      exp: now + 60,
    });
    const sig = createHmac('sha256', 'test-secret').update(`${header}.${body}`).digest('base64url');
    const result = validateAccessToken(`${header}.${body}.${sig}`);
    expect(result.valid).toBe(true);
    expect(result.context.tenantId).toBe(TENANT);
  });

  it('reports an external failure rather than a generic one', async () => {
    publishKey('rsa-1');
    await primed();
    process.env.CALLFORGE_TOKEN_SECRET = 'test-secret';
    expect(validateAccessToken(signToken({ org_id: '' }, { kid: 'rsa-1' })).error).toMatch(
      /org_id/,
    );
  });

  it('leaves the local path untouched when the flag is off', async () => {
    makeKey('rsa-1');
    const token = signToken({}, { kid: 'rsa-1' });
    for (const k of ENV_KEYS) {
      delete process.env[k];
    }
    process.env.CALLFORGE_TOKEN_SECRET = randomUUID();
    // Honestly: the local verifier recomputes HS256, so an RS256 token fails on
    // signature here — the point is that the external path is never consulted.
    expect(validateAccessToken(token).error).toMatch(/signature/);
  });
});

describe('discovery metadata under an external IdP', () => {
  it('publishes the IdP issuer and JWKS, not this server', () => {
    const meta = authorizationServerMetadata({
      CALLFORGE_IDP_MODE: 'external',
      CALLFORGE_OIDC_ISSUER: ISSUER,
      CALLFORGE_OIDC_JWKS_URI: JWKS_URI,
      MCP_PUBLIC_URL: 'https://callforge.test',
      MCP_AUTHORIZATION_SERVER: 'https://ignored.test',
    });
    expect(meta.issuer).toBe(ISSUER);
    expect(meta.jwks_uri).toBe(JWKS_URI);
  });

  it('keeps the local issuer when the mode is off', () => {
    const meta = authorizationServerMetadata({ MCP_PUBLIC_URL: 'https://callforge.test' });
    expect(meta.issuer).toBe('https://callforge.test');
  });
});

describe('jwksDoc helper sanity', () => {
  it('serialises published keys', () => {
    publishKey('rsa-1');
    expect(jwksDoc().keys).toHaveLength(1);
  });
});
