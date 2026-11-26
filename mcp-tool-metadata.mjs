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

/**
 * Structured-output schemas (design §4: `outputSchema` + structuredContent).
 * Loose objects — every published field is optional so an additive change to a
 * handler cannot start failing validation, and unknown extras are kept. Error
 * results skip validation in the SDK, so only success shapes are declared.
 */
const loose = (shape = {}) => z.looseObject(shape);

export const OUTPUT_SCHEMAS = {
  onboard_tenant: loose({
    tenant_id: z.string().optional(),
    status: z.string().optional(),
    // `null` is the legitimate value when no dev token is minted (anonymous
    // mode, F15); `.optional()` alone rejects it and fails an otherwise
    // successful onboarding on output validation.
    credential: z.looseObject({}).nullish(),
  }),
  configure_business: loose({
    tenant_id: z.string().optional(),
    status: z.string().optional(),
    tool: z.string().optional(),
    reason: z.string().optional(),
    changed: z.array(z.string()).optional(),
    message: z.string().optional(),
  }),
  simulate_call: loose({
    call_intent_id: z.string().optional(),
    status: z.string().optional(),
    idempotent: z.boolean().optional(),
    message: z.string().optional(),
  }),
  simulate_conversation: loose({
    language: z.string().optional(),
    scenario: z.string().optional(),
    turns: z.array(z.unknown()).optional(),
    expected_outcome: z.string().optional(),
  }),
  check_readiness: loose({ ready: z.boolean().optional(), checks: z.looseObject({}).optional() }),
  get_call_status: loose({
    call_intent: z.looseObject({}).optional(),
    events: z.array(z.looseObject({})).optional(),
  }),
  list_call_history: loose({
    calls: z.array(z.looseObject({})).optional(),
    pagination: z.looseObject({}).optional(),
  }),
  generate_report: loose({
    report_type: z.string().optional(),
    tenant_id: z.string().optional(),
    period: z.looseObject({}).optional(),
    data: z.looseObject({}).optional(),
  }),
  access_audit_log: loose({
    events: z.array(z.unknown()).optional(),
    verification: z.unknown().optional(),
    pagination: z.looseObject({}).optional(),
  }),
  validate_compliance: loose({
    call_intent_id: z.string().optional(),
    evidence: z.looseObject({}).optional(),
    results: z.looseObject({}).optional(),
  }),
};

/**
 * The text body is the JSON document, so structured outputs cost the handlers
 * nothing: parse it back and publish it as `structuredContent`.
 */
export function withStructuredContent(name, handler) {
  const outputSchema = OUTPUT_SCHEMAS[name];
  if (!outputSchema) {
    return { outputSchema: undefined, handler };
  }
  return {
    outputSchema,
    handler: async (args, extra) => {
      const result = await handler(args, extra);
      const text = result?.content?.[0]?.text;
      if (!result?.isError && typeof text === 'string') {
        try {
          const structured = JSON.parse(text);
          if (structured && typeof structured === 'object' && !Array.isArray(structured)) {
            result.structuredContent = structured;
          }
        } catch {
          // Non-JSON text: leave content-only rather than fail the call.
        }
      }
      return result;
    },
  };
}
