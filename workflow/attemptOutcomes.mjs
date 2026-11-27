/**
 * CALLFORGE AI — provider call outcomes on the attempt record (TECH-016)
 *
 * `readAttempts()` in the dial gate counted every allowed dial as unanswered,
 * which is conservative but wrong once a carrier tells us what actually
 * happened: a connected call kept consuming the R10 retry ceiling.
 *
 * This module is the write side. It is deliberately small and fail-closed:
 *  - only a known outcome string is accepted; an unrecognised one is reported
 *    as `unknown_outcome` and the row is left untouched, so a provider that
 *    invents a status cannot silently widen the ceiling;
 *  - the attempt must be found by (provider, provider_ref). An event for an
 *    attempt we never dialled is `unknown_attempt`, never a create;
 *  - the first reported outcome wins. A redelivered or out-of-order event can
 *    fill a missing duration but cannot rewrite what the call already was,
 *    which keeps the ceiling monotonic under at-least-once delivery;
 *  - a `failed` attempt row (provider threw, no handle) can still take an
 *    outcome: it is the same call, and the carrier knows more than we do.
 *
 * Not wired to semantics: whether an outcome counts toward the ceiling is the
 * evaluator's decision (`UNANSWERED_OUTCOMES` in policies/dialEligibility.mjs),
 * not this module's.
 */
export const KNOWN_OUTCOMES = new Set([
  'answered',
  'no_answer',
  'voicemail',
  'callback',
  'ended_unanswered',
  'failed',
]);

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ provider: string, providerRef: string, outcome: string,
 *           durationSeconds?: number | null, at?: Date | string | null }} event
 */
export function recordAttemptOutcome(
  db,
  { provider, providerRef, outcome, durationSeconds = null, at = null },
) {
  if (!provider || !providerRef) {
    return { recorded: false, reason: 'missing_correlation' };
  }
  if (!KNOWN_OUTCOMES.has(outcome)) {
    return { recorded: false, reason: 'unknown_outcome' };
  }
  const attempt = /** @type {any} */ (
    db
      .prepare('SELECT * FROM call_attempts WHERE provider = ? AND provider_ref = ?')
      .get(provider, providerRef)
  );
  if (!attempt) {
    return { recorded: false, reason: 'unknown_attempt' };
  }
  const outcomeAt =
    at == null ? new Date().toISOString() : at instanceof Date ? at.toISOString() : String(at);

  if (attempt.outcome) {
    // First-wins: refresh only what is still missing.
    if (attempt.duration_seconds != null || durationSeconds == null) {
      return {
        recorded: false,
        reason: 'outcome_already_set',
        attemptId: attempt.id,
        outcome: attempt.outcome,
      };
    }
    db.prepare(
      "UPDATE call_attempts SET duration_seconds = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(durationSeconds, attempt.id);
    return { recorded: true, attemptId: attempt.id, outcome: attempt.outcome, refined: 'duration' };
  }

  db.prepare(
    `UPDATE call_attempts
     SET outcome = ?, outcome_at = ?, duration_seconds = COALESCE(?, duration_seconds),
         updated_at = datetime('now')
     WHERE id = ?`,
  ).run(outcome, outcomeAt, durationSeconds, attempt.id);
  return { recorded: true, attemptId: attempt.id, outcome };
}
