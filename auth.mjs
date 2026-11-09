/**
 * CALLFORGE AI — Authentication Middleware
 * v0.2 Simulation Baseline
 *
 * Tenant-scoped bearer token authentication for development.
 * Production OAuth implementation in M02.
 */

import { createHash, randomBytes } from 'node:crypto';
import { getDatabase } from './store.mjs';
import { createAuditLogger } from './audit.mjs';

const DEV_TOKEN_PREFIX = 'cf_dev_';
const TOKEN_LENGTH = 32;

function generateDevToken() {
  return DEV_TOKEN_PREFIX + randomBytes(TOKEN_LENGTH).toString('hex');
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function createAuthMiddleware() {
  const auditLogger = createAuditLogger();

  return {
    /**
     * Validate a bearer token and return tenant context
     */
    async validateToken(token) {
      if (!token || !token.startsWith('Bearer ')) {
        return { valid: false, error: 'Missing or invalid Authorization header' };
      }

      const rawToken = token.slice(7); // Remove 'Bearer '

      // Development token validation
      if (rawToken.startsWith(DEV_TOKEN_PREFIX)) {
        return this.validateDevToken(rawToken);
      }

      // Production token validation (placeholder for M02)
      return { valid: false, error: 'Production tokens not supported in v0.2' };
    },

    /**
     * Validate development token
     */
    async validateDevToken(rawToken) {
      const db = getDatabase();
      const keyHash = hashToken(rawToken);

      const apiKey = db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(keyHash);

      if (!apiKey) {
        await auditLogger.log({
          event_type: 'auth_failed',
          actor_type: 'system',
          action: 'validate_token',
          payload: { reason: 'token_not_found', token_prefix: rawToken.slice(0, 12) },
        });
        return { valid: false, error: 'Invalid token' };
      }

      // Check expiration
      if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
        await auditLogger.log({
          event_type: 'auth_failed',
          actor_type: 'system',
          action: 'validate_token',
          payload: { reason: 'token_expired', key_id: apiKey.id },
        });
        return { valid: false, error: 'Token expired' };
      }

      // Update last used
      db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(apiKey.id);

      // Get tenant
      const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(apiKey.tenant_id);

      if (!tenant) {
        return { valid: false, error: 'Tenant not found' };
      }

      await auditLogger.log({
        tenant_id: apiKey.tenant_id,
        event_type: 'auth_success',
        actor_type: 'system',
        action: 'validate_token',
        payload: { key_id: apiKey.id, scopes: JSON.parse(apiKey.scopes || '[]') },
      });

      return {
        valid: true,
        tenant: {
          id: tenant.id,
          name: tenant.name,
          domain: tenant.domain,
          settings: JSON.parse(tenant.settings || '{}'),
          compliance_status: tenant.compliance_status,
        },
        scopes: JSON.parse(apiKey.scopes || '[]'),
        keyId: apiKey.id,
      };
    },

    /**
     * Create a development token for a tenant
     */
    async createDevToken(tenantId, name, scopes = ['simulate', 'read'], expiresInDays = 30) {
      const db = getDatabase();
      const rawToken = generateDevToken();
      const keyHash = hashToken(rawToken);
      const keyId = `key_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

      db.prepare(
        'INSERT INTO api_keys (id, tenant_id, name, key_hash, scopes, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(keyId, tenantId, name, keyHash, JSON.stringify(scopes), expiresAt);

      await auditLogger.log({
        tenant_id: tenantId,
        event_type: 'dev_token_created',
        actor_type: 'system',
        action: 'create_dev_token',
        resource_type: 'api_key',
        resource_id: keyId,
        payload: { name, scopes, expires_at: expiresAt },
      });

      return {
        token: rawToken,
        keyId,
        expiresAt,
        scopes,
      };
    },

    /**
     * Extract tenant context from request
     */
    async getTenantContext(req) {
      const authHeader = req.headers?.authorization;
      const result = await this.validateToken(authHeader);

      if (!result.valid) {
        return null;
      }

      return result.tenant;
    },

    /**
     * Require specific scopes
     */
    requireScopes(..._requiredScopes) {
      return async tenantContext => {
        if (!tenantContext) {
          return { authorized: false, error: 'Authentication required' };
        }

        // In v0.2, scopes are on the key, not tenant
        // This is a placeholder for M02 RBAC
        return { authorized: true };
      };
    },
  };
}

export { generateDevToken, hashToken };
