# TECH-015 — `call.dial` telephony sink (M05 increment 1)

Status: implemented on `tech-015-dial-sink` (stacked on PR #201). Draft, unmerged, no live call.

## Why

`dispatchDialRequest()` has enqueued a `call.dial` outbox row since TECH-011, but no handler
existed: `dispatchOnce()` logs `no handler for call.dial (noop)` and acks. So an allowed dial was
authorised, recorded, and then dropped. This closes that gap with a provider-neutral sink.

## Shape

```
dial_requests(allowed) --call.dial--> handleCallDial --> telephony provider port
                                            |                    |
                                     call_attempts        { providerRef } | throw
                                            |
                              accepted -> intent approved->dispatched
                              failed   -> outbox retry/backoff
```

- `telephony/provider.mjs` — registry and fail-closed `resolveProvider()`; unknown
  `CALLFORGE_TELEPHONY_PROVIDER` throws, so the outbox retries instead of silently no-oping.
- `telephony/simulatedProvider.mjs` — default adapter. Inert, network-free, deterministic
  (`sim-<dialRequestId>`). Enabling it never spends money.
- `telephony/dialSink.mjs` — the handler. Writes the `call_attempts` row **before** calling the
  provider, so a crash mid-dial still leaves evidence; `UNIQUE(dial_request_id)` plus an
  `already_accepted` short-circuit makes at-least-once redelivery safe.
- `db/migrations/0008_call_attempts.sql` — attempt evidence, no schema change to existing tables.

## Deliberate boundaries

- The gate is **not** re-evaluated in the sink. The decision was snapshotted at dispatch; re-running
  it would fold a later clock or policy into an already-made decision.
- `providerRef` is mandatory. A provider that resolves without a handle is treated as a failure,
  because a later webhook could not be correlated.
- A cancelled intent is not resurrected: the attempt is still recorded, but no transition is forced.
- `call_attempts.attempts` counts sink attempts, not carrier retries — carriers own their own.
- `readAttempts()` still counts every allowed dial as unanswered: the gateway webhook handler does
  not map provider events to intents yet, so acceptance and outcome are not distinguishable there.

## Contract for a real adapter (EXT-003 territory)

`dial({ idempotencyKey, dialRequestId, callIntentId, tenantId, to, from, campaignKind })` must resolve
`{ providerRef }` on acceptance and **throw** on a definite rejection. `idempotencyKey` is the dial
request id and must be forwarded to the carrier where the carrier supports one. A live adapter is
blocked on EXT-003 (provider + carrier contract) and EXT-005-class credentials; nothing here calls a
network.
