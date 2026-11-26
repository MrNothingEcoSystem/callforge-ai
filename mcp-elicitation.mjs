/**
 * CALLFORGE AI — M09 C2 confirmation gate (elicitation / input_required)
 *
 * Design §4/§7E: C2 tools (destructive or externally visible actions) must be
 * confirmed by the user, not merely annotated. Annotations are hints; this gate
 * is the server-side enforcement point.
 *
 * Transport reality: the remote surface is stateless with plain JSON replies, so
 * a server→client `elicitation/create` request cannot be parked mid-call. We use
 * the resumable form instead: the first call answers
 * `resultType: "input_required"` with one typed `confirm` request and an opaque
 * `requestState`; the client re-calls the same tool with `inputResponses`. The
 * state carries a fingerprint of the risky arguments, so a stale confirmation
 * cannot be replayed onto different changes. Decline/cancel mutates nothing.
 *
 * Today the only C2 tool is `configure_business`, and only when it touches the
 * licensed/externally-binding flags (LICENSE_FLAGS). `simulate_call` stays C1.
 */

import { createHash } from 'node:crypto';

/** Argument names whose mutation makes `configure_business` a C2 action. */
export const LICENSE_FLAGS = [
  'license_number',
  'license_expiry',
  'dncr_check_enabled',
  'recording_consent_required',
];

export const C2_TOOLS = new Set(['configure_business']);

/** @returns {string[]} the risky flags this call would change */
export function riskyChanges(name, args = {}) {
  if (!C2_TOOLS.has(name)) {
    return [];
  }
  return LICENSE_FLAGS.filter(flag => args[flag] !== undefined);
}

function fingerprint(name, args) {
  const subset = {};
  for (const flag of LICENSE_FLAGS) {
    if (args[flag] !== undefined) {
      subset[flag] = args[flag];
    }
  }
  return createHash('sha256').update(JSON.stringify({ name, subset })).digest('hex').slice(0, 32);
}

export function createRequestState(name, args) {
  return Buffer.from(JSON.stringify({ tool: name, fp: fingerprint(name, args) }), 'utf8').toString(
    'base64url',
  );
}

/** @returns {{tool: string, fp: string} | null} */
export function parseRequestState(state) {
  if (typeof state !== 'string' || !state) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    return typeof parsed?.tool === 'string' && typeof parsed?.fp === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function stateMatches(state, name, args) {
  const parsed = parseRequestState(state);
  return Boolean(parsed) && parsed.tool === name && parsed.fp === fingerprint(name, args);
}

/**
 * The `inputRequests` payload: one flat, typed confirmation form. Deliberately a
 * single boolean — the summary is in the message so a minimal client can render
 * it without understanding the tool.
 */
export function confirmationRequest(name, args) {
  const changed = riskyChanges(name, args);
  return {
    confirm: {
      type: 'elicitation',
      message:
        `Confirm ${name}: this changes licensed / externally-binding settings (${changed.join(', ')}). ` +
        'Declining leaves the current business configuration untouched.',
      requestedSchema: {
        type: 'object',
        properties: {
          confirm: {
            type: 'boolean',
            title: 'Apply these changes',
            description: `Changing: ${changed.join(', ')}`,
            default: true,
          },
        },
        required: ['confirm'],
      },
      requestState: createRequestState(name, args),
    },
  };
}

/** Result of a declined/cancelled confirmation. Nothing was written. */
export function declinedResult(name, args, action) {
  return {
    status: 'declined',
    tool: name,
    reason: action === 'cancel' ? 'cancelled by user' : 'user declined the confirmation',
    changed: riskyChanges(name, args),
    message: 'No configuration was written; re-call with inputResponses to apply.',
  };
}

/**
 * Decide what a single tool call needs.
 * @returns {{action: 'none'} |
 *   {action: 'require', changed: string[], inputRequests: Record<string, {requestState: string}>} |
 *   {action: 'accept', changed: string[]} |
 *   {action: 'declined', changed: string[], reason: string}}
 */
export function gate(name, args = {}, inputResponses) {
  const changed = riskyChanges(name, args);
  if (!changed.length) {
    return { action: 'none' };
  }
  if (!inputResponses || typeof inputResponses !== 'object') {
    return { action: 'require', changed, inputRequests: confirmationRequest(name, args) };
  }
  const answer = inputResponses.confirm;
  const action = answer?.action;
  if (action !== 'accept') {
    return { action: 'declined', changed, reason: action === 'cancel' ? 'cancel' : 'decline' };
  }
  if (answer?.content?.confirm === false) {
    return { action: 'declined', changed, reason: 'decline' };
  }
  return { action: 'accept', changed };
}
