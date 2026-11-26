/**
 * CALLFORGE AI — M09 remote tool registry metadata
 *
 * Owner-facing subset, annotations and OAuth2 security schemes for the remote
 * (Streamable HTTP) surface. Mirrors management/M09_REMOTE_MCP_DESIGN.md §4 and
 * is the review gate for tools/list: every exposed tool carries explicit
 * annotations (SDK defaults are worst-case: destructive and open-world) plus a
 * single least-privilege `securitySchemes` entry.
 *
 * Annotations are hints only — scope and tenant enforcement in tools/toolAuth.mjs
 * stays authoritative. `create_dev_token` is C3 and never listed remotely.
 *
 * Annotations per design §4 (RO / Destructive / Idempotent / OpenWorld):
 *   onboard_tenant          F/F/F/F  config   C1
 *   configure_business      F/F/T/F  config   C1
 *   simulate_call           F/F/T/F  simulate C1 (*T open-world once live)
 *   simulate_conversation   T/F/T/F  read     C0
 *   check_readiness         T/F/T/F  read     C0
 *   get_call_status         T/F/T/F  read     C0
 *   list_call_history       T/F/T/F  read     C0
 *   generate_report         T/F/T/F  report   C0
 *   access_audit_log        T/F/T/F  audit    C0 (auditor/tenant_admin)
 *   create_dev_token        —        —        C3, not exposed
 *   validate_compliance     F/F/T/F  compliance C1
 */

import { z } from 'zod';

const READ = 'callforge:read';

function oauth2(scope) {
  return [{ type: 'oauth2', scopes: [scope] }];
}

const entry = (title, scope, annotations, exposed = true) => ({
  exposed,
  title,
  annotations,
  securitySchemes: oauth2(scope),
});

export const REMOTE_TOOL_METADATA = {
  onboard_tenant: entry('Request onboarding', 'callforge:config', {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  }),
  configure_business: entry('Configure business', 'callforge:config', {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  }),
  simulate_call: entry('Simulate an inbound call', 'callforge:simulate', {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false, // simulated only; true once a live provider is wired
  }),
  simulate_conversation: entry('Preview a conversation', 'callforge:read', {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  }),
  check_readiness: entry('Check tenant readiness', 'callforge:read', {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  }),
  get_call_status: entry('Get call status', 'callforge:read', {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  }),
  list_call_history: entry('List call history', 'callforge:read', {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  }),
  generate_report: entry('Generate report', 'callforge:report', {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  }),
  access_audit_log: entry('Read audit log', 'callforge:audit', {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  }),
  create_dev_token: entry('Create dev token', 'callforge:config', null, false),
  validate_compliance: entry('Record compliance evidence', 'callforge:compliance', {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  }),
};

export { READ };

/**
 * Remote JSON Schema for a tool's input: the bearer already carries the
 * credential and the tenant, so `access_token` goes away and `tenant_id` stays
 * only for the anonymous (MCP_HTTP_ALLOW_ANONYMOUS=1) fallback.
 */
export function remoteToolSchema(_name, shape, { authenticated = true } = {}) {
  if (!authenticated) {
    return shape;
  }
  const rest = { ...shape };
  delete rest.access_token;
  delete rest.tenant_id;
  // Passthrough, so a client that still sends `tenant_id` gets the 403 mismatch
  // safety net in tools/toolAuth.mjs even though it is no longer advertised.
  return z.object(rest).passthrough();
}
