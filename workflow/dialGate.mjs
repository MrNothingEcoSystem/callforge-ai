/**
 * CALLFORGE AI — M04 dial gate at the M03 dispatch path (TECH-011)
 *
 * `policies/dialEligibility.mjs` is a pure evaluator; this module supplies its
 * inputs from durable state and applies the verdict so the gate cannot be
 * skipped by a caller that forgets it.
 *
 * Flow: requestDial() snapshots the campaign/contact/policy facts into
 * `dial_requests` and enqueues `dial.requested` in one transaction. The
 * dispatcher later calls evaluateDial on the snapshot; allow enqueues one
 * `call.dial` outbox row, deny records the reasons. A denial is a decision,
 * not a failure, so the row is acked rather than retried.
 *
 * Facts: `requestDial` accepts caller-supplied contact facts (they are
 * snapshotted and the gate fails closed on anything missing). `requestDialResolved`
 * is the stronger path — TECH-012 — and reads consent, opt-outs and a TTL-cached
 * DNCR answer from the sources of record instead of trusting the caller.
 *
 * The tenant's own calling window / ceilings / DNCR freshness (TECH-013) are
 * read from the tenant policy record on both producers and snapshotted, so the
 * decision stays reproducible at dispatch time. A caller-supplied `options`
 * snapshot wins (the resolved producer passes the record it just read); without
 * one the record is read here, and an unusable record is carried as `null` so
 * dispatch denies (`invalid_policy`) instead of widening to the defaults.
 *
 * Still unwired by design: the M05 sink behind `call.dial`.
 */
import { generateId } from '../store.mjs';
import { enqueue } from './outbox.mjs';
import { evaluateDial, POLICY_DEFAULTS } from '../policies/dialEligibility.mjs';
import { resolveContactFacts } from '../sources/facts.mjs';
import { readTenantPolicy } from '../policies/tenantPolicy.mjs';

const ATTEMPT_WINDOW_MS = 7 * 86_400_000;

/**
 * Prior allowed dials for the phone — the R10 ceiling's attempt clock. Bounded
 * above by `now` too, so a future-dated request cannot hide today's attempts.
 */
export function readAttempts(db, { tenantId, phone, now = new Date() }) {
  const rows = db
    .prepare(
      `SELECT d.created_at, a.outcome
         FROM dial_requests d
         LEFT JOIN call_attempts a ON a.dial_request_id = d.id
        WHERE d.tenant_id = ? AND d.phone = ? AND d.status = 'allowed'
          AND d.created_at >= datetime(?, ?) AND d.created_at <= datetime(?)`,
    )
    .all(
      tenantId,
      phone,
      now.toISOString(),
      `-${ATTEMPT_WINDOW_MS / 86_400_000} days`,
      now.toISOString(),
    );
  // No reported outcome (never dialled, or the carrier has not told us yet)
  // keeps the conservative reading of the R10 ceiling — TECH-016 reports
  // outcomes, it does not assume them.
  return rows.map(row => ({
    at: new Date(`${row.created_at.replace(' ', 'T')}Z`),
    outcome: row.outcome ?? 'no_answer',
  }));
}

function revivePolicy(snapshot) {
  const policy = { ...snapshot };
  if (snapshot.approvalExpiresAt) {
    policy.approvalExpiresAt = new Date(snapshot.approvalExpiresAt);
  }
  return policy;
}

function reviveContact(snapshot) {
  const contact = { ...snapshot };
  // Dates arrive as ISO strings from JSON; the evaluator requires real Dates
  // and fails closed on strings, so a missed field would deny every dial.
  if (snapshot.dncrCheckedAt) {
    contact.dncrCheckedAt = new Date(snapshot.dncrCheckedAt);
  }
  return contact;
}

/**
 * Producer: snapshot the decision inputs and queue the gate.
 * Idempotent on (tenantId, idempotencyKey).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.callIntentId
 * @param {string} params.idempotencyKey
 * @param {Record<string, any>} [params.campaign]
 * @param {Record<string, any>} [params.contact]
 * @param {Record<string, any>} [params.policy]
 * @param {string} [params.timeZone]
 * @param {Date} [params.now]
 */
export function requestDial(
  db,
  {
    tenantId,
    callIntentId,
    idempotencyKey,
    campaign = {},
    contact = {},
    policy = {},
    timeZone,
    now = new Date(),
  },
) {
  if (!tenantId || !callIntentId || !idempotencyKey) {
    throw new TypeError('requestDial requires tenantId, callIntentId and idempotencyKey');
  }
  // Review F1: the FK only proves the intent exists, not that it belongs to this
  // tenant — a mismatch would enqueue a dial row under the wrong tenant.
  const intent = /** @type {any} */ (
    db.prepare('SELECT tenant_id FROM call_intents WHERE id = ?').get(callIntentId)
  );
  if (!intent) {
    throw new ReferenceError(`call intent ${callIntentId} does not exist`);
  }
  if (intent.tenant_id !== tenantId) {
    throw new RangeError(`call intent ${callIntentId} belongs to tenant ${intent.tenant_id}`);
  }
  const existing = db
    .prepare('SELECT * FROM dial_requests WHERE tenant_id = ? AND idempotency_key = ?')
    .get(tenantId, idempotencyKey);
  if (existing) {
    return { request: existing, outboxRow: null, inserted: false };
  }
  // Review F1 (TECH-013): the legacy producer used to be gated against the
  // statutory defaults only, so whoever called it silently avoided the tenant
  // record. Resolve the record unless the caller already snapshotted options.
  let options = policy.options;
  let policyViolations = policy.policyViolations;
  let effectiveTimeZone = policy.timeZone ?? timeZone;
  if (options === undefined) {
    const record = /** @type {{options: any, violations: string[]}} */ (
      readTenantPolicy(db, tenantId)
    );
    options = record.options;
    policyViolations = record.violations;
    if (effectiveTimeZone === undefined) {
      effectiveTimeZone = record.options?.timeZone;
    }
  }
  const request = {
    id: generateId(),
    tenant_id: tenantId,
    call_intent_id: callIntentId,
    idempotency_key: idempotencyKey,
    campaign_kind: campaign.kind,
    cli: campaign.cli ?? null,
    purpose: campaign.purpose ?? null,
    phone: contact.phone,
    policy_json: JSON.stringify({
      ...policy,
      options,
      policyViolations,
      timeZone: effectiveTimeZone,
    }),
    contact_json: JSON.stringify(contact),
    created_at: now.toISOString().slice(0, 19).replace('T', ' '),
  };
  const outboxRow = db.transaction(() => {
    db.prepare(
      `INSERT INTO dial_requests
         (id, tenant_id, call_intent_id, idempotency_key, campaign_kind, cli, purpose,
          phone, policy_json, contact_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      request.id,
      tenantId,
      callIntentId,
      idempotencyKey,
      request.campaign_kind,
      request.cli,
      request.purpose,
      request.phone,
      request.policy_json,
      request.contact_json,
      request.created_at,
    );
    return enqueue(db, {
      tenantId,
      aggregateType: 'dial_request',
      aggregateId: request.id,
      type: 'dial.requested',
      payload: { dialRequestId: request.id, callIntentId },
      dedupKey: `dial.requested:${request.id}`,
    }).row;
  })();
  return { request, outboxRow, inserted: true };
}

/**
 * Producer over the fact sources (TECH-012): resolve consent/opt-out/DNCR for
 * the number, then snapshot the *resolved* facts. A caller claim of `clean`
 * cannot outlive the provider answer.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.callIntentId
 * @param {string} params.idempotencyKey
 * @param {Record<string, any>} params.campaign
 * @param {Record<string, any>} params.policy
 * @param {{ check: Function }} [params.dncr]
 * @param {string} [params.timeZone]
 * @param {Date} [params.now]
 */
export async function requestDialResolved(
  db,
  { tenantId, callIntentId, idempotencyKey, campaign, policy, dncr, timeZone, now = new Date() },
) {
  if (!tenantId || !callIntentId || !idempotencyKey) {
    throw new TypeError('requestDialResolved requires tenantId, callIntentId and idempotencyKey');
  }
  const phone = campaign?.phone ?? campaign?.contactPhone;
  if (!phone) {
    throw new TypeError('requestDialResolved requires campaign.phone');
  }
  const existing = db
    .prepare('SELECT * FROM dial_requests WHERE tenant_id = ? AND idempotency_key = ?')
    .get(tenantId, idempotencyKey);
  if (existing) {
    return { request: existing, outboxRow: null, inserted: false };
  }
  // Review F2: validate the intent before querying a provider, so a typo'd id
  // does not burn a DNCR call and write a cache row.
  const intent = /** @type {any} */ (
    db.prepare('SELECT tenant_id FROM call_intents WHERE id = ?').get(callIntentId)
  );
  if (!intent) {
    throw new ReferenceError(`call intent ${callIntentId} does not exist`);
  }
  if (intent.tenant_id !== tenantId) {
    throw new RangeError(`call intent ${callIntentId} belongs to tenant ${intent.tenant_id}`);
  }
  const tenantPolicy = /** @type {{options: any, violations: string[]}} */ (
    readTenantPolicy(db, tenantId)
  );
  const contact = await resolveContactFacts(db, {
    tenantId,
    phone,
    purpose: campaign.purpose,
    dncr,
    now,
  });
  return requestDial(db, {
    tenantId,
    callIntentId,
    idempotencyKey,
    campaign,
    contact,
    policy: {
      ...policy,
      options: tenantPolicy.options,
      policyViolations: tenantPolicy.violations,
    },
    timeZone: tenantPolicy.options?.timeZone ?? timeZone,
    now,
  });
}

/**
 * Dispatcher handler: evaluate one pending request and apply the verdict.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ aggregate_id: string }} row
 * @param {{ now?: Date }} [options]
 */
export function dispatchDialRequest(db, row, { now = new Date() } = {}) {
  const request = /** @type {any} */ (
    db.prepare('SELECT * FROM dial_requests WHERE id = ?').get(row.aggregate_id)
  );
  if (!request || request.status !== 'pending') {
    return { noop: true, status: request?.status ?? 'missing' };
  }
  const policy = revivePolicy(JSON.parse(request.policy_json));
  const contact = reviveContact(JSON.parse(request.contact_json));
  const verdict = evaluateDial({
    now,
    campaign: { kind: request.campaign_kind, cli: request.cli, purpose: request.purpose },
    contact,
    policy,
    attempts: readAttempts(db, { tenantId: request.tenant_id, phone: request.phone, now }),
    options: policy.options,
    timeZone: policy.options?.timeZone ?? policy.timeZone ?? POLICY_DEFAULTS.timeZone,
  });

  return db.transaction(() => {
    const decidedAt = now.toISOString();
    const mark = db
      .prepare(
        `UPDATE dial_requests SET status = ?, reasons_json = ?, decided_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(
        verdict.allowed ? 'allowed' : 'denied',
        JSON.stringify(verdict.reasons),
        decidedAt,
        request.id,
      );
    if (mark.changes === 0) {
      return { noop: true, status: 'raced' };
    }
    if (!verdict.allowed) {
      return { allowed: false, reasons: verdict.reasons };
    }
    const outboxRow = enqueue(db, {
      tenantId: request.tenant_id,
      aggregateType: 'call_intent',
      aggregateId: request.call_intent_id,
      type: 'call.dial',
      payload: {
        dialRequestId: request.id,
        callIntentId: request.call_intent_id,
        phone: request.phone,
        cli: request.cli,
        campaignKind: request.campaign_kind,
      },
      dedupKey: `call.dial:${request.id}`,
    }).row;
    return { allowed: true, reasons: [], outboxId: outboxRow.id };
  })();
}
