import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  configureOidc,
  configureOidcFromEnv,
  loadJwks,
  oidcConfigured,
  resetOidc,
  verifyExternalToken,
} from '../oidc.mjs';
import { CallforgeHttpServer } from '../server.mjs';
import { ROLES, validateAccessToken } from '../oauth.mjs';
import { getDatabase, setTestDatabasePath } from '../store.mjs';

const ISSUER = 'https://idp.example.ae';
const AUDIENCE = 'callforge-api';
const KID = 'k-2026-11';
const NOW = 1_800_000_000;

function makeKey(kid = KID) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
  return { privateKey, jwk };
}

const key = makeKey();
const stranger = makeKey('k-other');

function token(claims = {}, { kid = KID, alg = 'RS256', key: signingKey = key.privateKey } = {}) {
  const header = Buffer.from(JSON.stringify({ alg, typ: 'JWT', kid })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: 'idp-user-1',
      tenant_id: 'tenant-a',
      role: 'operator',
      // Deliberately wider than the role's real scopes (SEC-003: don't trust).
      scope: ['read', 'simulate', 'audit', 'admin'],
      iat: NOW - 10,
      exp: NOW + 300,
      ...claims,
    }),
  ).toString('base64url');
  const sig = cryptoSign('RSA-SHA256', Buffer.from(`${header}.${payload}`), signingKey);
  return `${header}.${payload}.${sig.toString('base64url')}`;
}

function configure(overrides = {}) {
  return configureOidc({
    issuer: ISSUER,
    audience: AUDIENCE,
    jwks: { keys: [key.jwk, stranger.jwk] },
    roleScopes: ROLES,
    ...overrides,
  });
}

afterEach(() => resetOidc());

describe('oidc: configuration is fail-closed', () => {
  it('rejects a JWKS with no usable RSA signing key', () => {
    expect(() => loadJwks({ keys: [{ kty: 'EC', kid: 'e', crv: 'P-256' }] })).toThrow(/no usable/);
    expect(() => loadJwks({ keys: [{ ...key.jwk, use: 'enc' }] })).toThrow(/no usable/);
    expect(() => loadJwks({})).toThrow(/no keys array/);
  });

  it('skips metadata keys but keeps the good ones', () => {
    const keys = loadJwks({ keys: [{ kty: 'oct', kid: 'h' }, key.jwk] });
    expect(keys.size).toBe(1);
  });

  it('requires issuer, audience and role scopes', () => {
    const base = {
      issuer: ISSUER,
      audience: AUDIENCE,
      jwks: { keys: [key.jwk] },
      roleScopes: ROLES,
    };
    expect(() => configureOidc({ ...base, issuer: ' ' })).toThrow(/issuer/);
    expect(() => configureOidc({ ...base, audience: undefined })).toThrow(/audience/);
    expect(() => configureOidc({ ...base, roleScopes: {} })).toThrow(/roleScopes/);
    // Config problems are named even when the key set is also unusable.
    expect(() => configureOidc({ ...base, issuer: '', jwks: { keys: [] } })).toThrow(/issuer/);
  });

  it('leaves the verifier unconfigured when no JWKS source is set', async () => {
    expect(await configureOidcFromEnv({ roleScopes: ROLES, env: {} })).toBeNull();
    expect(oidcConfigured()).toBe(false);
  });

  it('refuses both JWKS sources at once', async () => {
    await expect(
      configureOidcFromEnv({
        roleScopes: ROLES,
        env: { CALLFORGE_OIDC_JWKS_FILE: 'a.json', CALLFORGE_OIDC_JWKS_URL: 'https://x/jwks' },
      }),
    ).rejects.toThrow(/only one/i);
  });
});

describe('oidc: external token verification', () => {
  beforeEach(() => configure());

  it('accepts a valid token and re-derives scopes from the role', () => {
    const result = verifyExternalToken(token(), NOW);
    expect(result.valid).toBe(true);
    expect(result.context).toMatchObject({
      tenantId: 'tenant-a',
      subject: 'idp-user-1',
      role: 'operator',
    });
    // operator really only has simulate+read, despite the token claiming admin.
    expect(result.context.scopes).toEqual(ROLES.operator);
  });

  it('binds the tenant from a configured claim', () => {
    configure({ tenantClaim: 'org_id' });
    expect(verifyExternalToken(token({ org_id: 'org-9' }), NOW).context.tenantId).toBe('org-9');
    expect(verifyExternalToken(token(), NOW).error).toMatch(/tenant/);
  });

  it('rejects a tampered payload', () => {
    const [h, , s] = token().split('.');
    const swapped = Buffer.from(JSON.stringify({ tenant_id: 'tenant-b' })).toString('base64url');
    expect(verifyExternalToken(`${h}.${swapped}.${s}`, NOW).valid).toBe(false);
  });

  it('rejects a signature from an unknown-but-present key', () => {
    const forged = token({}, { key: stranger.privateKey });
    expect(verifyExternalToken(forged, NOW).error).toMatch(/signature/);
  });

  it('rejects an unknown or missing kid', () => {
    expect(verifyExternalToken(token({}, { kid: 'nope' }), NOW).error).toMatch(/key/);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
    const [, payload, sig] = token().split('.');
    expect(verifyExternalToken(`${header}.${payload}.${sig}`, NOW).error).toMatch(/key id/);
  });

  it('rejects issuer, audience and expiry failures', () => {
    expect(verifyExternalToken(token({ iss: 'https://evil' }), NOW).error).toMatch(/issuer/);
    expect(verifyExternalToken(token({ aud: 'other' }), NOW).error).toMatch(/audience/);
    expect(verifyExternalToken(token({ exp: NOW - 1 }), NOW).error).toMatch(/expired/);
    expect(verifyExternalToken(token({ exp: undefined }), NOW).error).toMatch(/expired/);
  });

  it('accepts an audience array and honours nbf within skew', () => {
    expect(verifyExternalToken(token({ aud: [AUDIENCE, 'x'] }), NOW).valid).toBe(true);
    expect(verifyExternalToken(token({ nbf: NOW + 60 }), NOW).error).toMatch(/not yet valid/);
    expect(verifyExternalToken(token({ nbf: NOW + 2 }), NOW).valid).toBe(true);
  });

  it('rejects an unknown role and a missing tenant', () => {
    expect(verifyExternalToken(token({ role: 'superuser' }), NOW).error).toMatch(/role/);
    expect(verifyExternalToken(token({ tenant_id: '' }), NOW).error).toMatch(/tenant/);
    expect(verifyExternalToken(token({ role: undefined }), NOW).error).toMatch(/role/);
  });

  it('rejects prototype-inherited role names instead of throwing', () => {
    for (const role of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(verifyExternalToken(token({ role }), NOW).error).toMatch(/role/);
    }
  });

  it('rejects alg none and unsupported algorithms', () => {
    const none = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(
      JSON.stringify({ tenant_id: 't' }),
    ).toString('base64url')}.`;
    // `alg: none` carries an empty signature segment: rejected either way.
    expect(verifyExternalToken(none, NOW).error).toMatch(/structure|algorithm/);
    expect(verifyExternalToken(token({}, { alg: 'ES256' }), NOW).error).toMatch(/algorithm/);
  });

  it('carries external tokens through validateAccessToken', () => {
    const result = validateAccessToken(token(), NOW);
    expect(result.valid).toBe(true);
    expect(result.context.tenantId).toBe('tenant-a');
  });

  it('fails external tokens when the verifier was never configured', () => {
    resetOidc();
    expect(validateAccessToken(token(), NOW).error).toMatch(/no OIDC verifier/);
  });

  it('still accepts internal HS256 tokens while an IdP is configured', () => {
    const saved = process.env.CALLFORGE_TOKEN_SECRET;
    process.env.CALLFORGE_TOKEN_SECRET = 'test-secret';
    try {
      expect(validateAccessToken(token(), NOW).valid).toBe(true);
    } finally {
      if (saved === undefined) {
        delete process.env.CALLFORGE_TOKEN_SECRET;
      } else {
        process.env.CALLFORGE_TOKEN_SECRET = saved;
      }
    }
  });
});

describe('oidc: startup wiring', () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'callforge-oidc-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('loads the JWKS from a file during initialize()', async () => {
    const file = join(dir, 'jwks.json');
    writeFileSync(file, JSON.stringify({ keys: [key.jwk] }));
    const saved = { ...process.env };
    Object.assign(process.env, {
      CALLFORGE_OIDC_JWKS_FILE: file,
      CALLFORGE_OIDC_ISSUER: ISSUER,
      CALLFORGE_OIDC_AUDIENCE: AUDIENCE,
    });
    setTestDatabasePath(join(dir, 'startup.db'));
    const server = new CallforgeHttpServer();
    try {
      await server.initialize();
      expect(server.oidc).toMatchObject({ keyCount: 1, issuer: ISSUER });
      expect(validateAccessToken(token(), NOW).valid).toBe(true);
    } finally {
      await server.shutdown();
      for (const k of [
        'CALLFORGE_OIDC_JWKS_FILE',
        'CALLFORGE_OIDC_ISSUER',
        'CALLFORGE_OIDC_AUDIENCE',
      ]) {
        if (saved[k] === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = saved[k];
        }
      }
    }
  });

  it('aborts startup on a broken JWKS', async () => {
    const file = join(dir, 'empty.json');
    writeFileSync(file, JSON.stringify({ keys: [] }));
    const saved = process.env.CALLFORGE_OIDC_JWKS_FILE;
    process.env.CALLFORGE_OIDC_JWKS_FILE = file;
    process.env.CALLFORGE_OIDC_ISSUER = ISSUER;
    process.env.CALLFORGE_OIDC_AUDIENCE = AUDIENCE;
    setTestDatabasePath(join(dir, 'broken.db'));
    try {
      await expect(new CallforgeHttpServer().initialize()).rejects.toThrow(/no usable/);
    } finally {
      if (saved === undefined) {
        delete process.env.CALLFORGE_OIDC_JWKS_FILE;
      } else {
        process.env.CALLFORGE_OIDC_JWKS_FILE = saved;
      }
    }
  });
});

describe('oidc: end to end over HTTP', () => {
  let server;
  let port;
  let dir;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'callforge-oidc-http-'));
    setTestDatabasePath(join(dir, 'http.db'));
    configure();
    server = new CallforgeHttpServer();
    await server.initialize();
    getDatabase()
      .prepare('INSERT OR IGNORE INTO tenants (id, name, settings) VALUES (?, ?, ?)')
      .run('tenant-a', 'OIDC Tenant', '{}');
    server.server = http.createServer((req, res) => {
      server.routeRequest(
        req,
        res,
        new URL(req.url, 'http://x').pathname,
        req.method,
        Object.fromEntries(new URL(req.url, 'http://x').searchParams),
      );
    });
    await new Promise(resolve => server.server.listen(0, resolve));
    port = server.server.address().port;
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
    resetOidc();
  });

  function post(path, { token, body }) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
        res => {
          let data = '';
          res.on('data', c => (data += c));
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        },
      );
      req.on('error', reject);
      req.end(payload);
    });
  }

  it('accepts an external token on a guarded route and rejects a forged one', async () => {
    const body = { idempotency_key: 'oidc-1', direction: 'inbound' };
    const ok = await post('/simulate/call', { token: token({ role: 'tenant_admin' }), body });
    expect(ok.status).not.toBe(401);

    const forged = await post('/simulate/call', {
      token: token({ role: 'tenant_admin' }, { key: stranger.privateKey }),
      body: { ...body, idempotency_key: 'oidc-2' },
    });
    expect(forged.status).toBe(401);
  });
});
