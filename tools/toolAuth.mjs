/**
 * CALLFORGE AI — MCP tool-layer authorization (issue #8)
 *
 * Derives tenant context from a verified access token instead of trusting the
 * caller-supplied `tenant_id`, and enforces real scopes. The token is taken
 * from the tool argument `access_token` (stdio/MCP clients) or the process
 * environment `CALLFORGE_ACCESS_TOKEN` (single-tenant local runs).
 *
 * Modes:
 *  - token present      -> strict: signature/issuer/audience/expiry + tenant
 *                          binding + scope enforcement.
 *  - no token, REQUIRE=1 -> reject (401) so unauthenticated calls fail closed.
 *  - no token, default   -> legacy simulation behaviour, flagged `unauthenticated`
 *                          (issue #8: retire/gate legacy dev tokens for non-local use).
 */

import { validateAccessToken, hasScopes } from '../oauth.mjs';

export const AUTH_MODES = { token: 'token', unauthenticated: 'unauthenticated' };

export function createToolAuthorizer({ env = process.env } = {}) {
  return function authorizeTool(args, requiredScopes = []) {
    const token = args?.access_token || env.CALLFORGE_ACCESS_TOKEN;

    if (!token) {
      if (env.CALLFORGE_REQUIRE_TOOL_AUTH === '1') {
        return { ok: false, status: 401, error: 'Access token required' };
      }
      return {
        ok: true,
        mode: AUTH_MODES.unauthenticated,
        tenantId: args?.tenant_id ?? null,
      };
    }

    const result = validateAccessToken(token);
    if (!result.valid) {
      return { ok: false, status: 401, error: result.error };
    }

    const { context } = result;
    if (args?.tenant_id && context.tenantId !== args.tenant_id) {
      return {
        ok: false,
        status: 403,
        error: `Tenant mismatch: token is bound to ${context.tenantId}`,
      };
    }
    if (!hasScopes(context, requiredScopes)) {
      return {
        ok: false,
        status: 403,
        error: `Insufficient scope: requires ${requiredScopes.join(',')}`,
      };
    }

    return { ok: true, mode: AUTH_MODES.token, tenantId: context.tenantId, context };
  };
}

export function authFailure(result) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          { error: result.error, status: result.status, mode: 'token' },
          null,
          2,
        ),
      },
    ],
    isError: true,
  };
}
