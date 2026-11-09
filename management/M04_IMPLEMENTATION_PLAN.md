# CALLFORGE M04 — UAE Compliance Implementation Plan

Date: 2026-11-09. Status: design only — NOT legal advice.
Implements only rules marked IMPLEMENTABLE NOW in `management/UAE_COMPLIANCE_REGISTER.md`.
Rules marked LEGAL-REVIEW (carrier contracting, competent-authority per entity,
PDPL cross-border, sector overlays) must be signed off by qualified UAE counsel
before the corresponding code ships.

## Preconditions (owner decisions, all open)

1. SEC-001: production IdP selection (blocks any network-exposed calling).
2. Carrier: e&/du SIP trunk contracts (R02). No grey routes, no SIM-box.
3. Counsel sign-off on Res.56/2024 scope per tenant entity.

## Implementable controls (priority order)

### M04-1 Quota-gated campaign dialing

Build on M03-2's atomic quota: per-tenant + per-campaign dialing windows that
enforce calling hours (Res.56 business-hours rules), retry caps, and DNCR
checks before intent creation. `consumeQuota` inside the idempotent create
transaction; `releaseQuota` on rejected/cancelled (PR #22 wires the first half;
extend with hours/DNCR).

### M04-2 DNCR + consent registry

Tenant-scoped consent store with opt-out flag per contact, DNCR list ingestion
(from e&/du portals), and a pre-dial gate that refuses intents for opted-out
or DNCR-listed numbers. Evidence: ingestion logs, per-dial decision audit rows.

### M04-3 CLI policy table

Every outbound CLI must be bound to tenant + trade licence + Kashif name.
The dialer rejects any CLI not in the inventory; unregistered/personal numbers
are hard-blocked (R03, R04). Logs capture `From` / `P-Asserted-Identity` per call.

### M04-4 Call recording consent + retention linkage

Recording consent captured and persisted before the call; recordings inherit
the tenant retention policy (never delete audit evidence — see F3 exclusion).
Legal-review: PDPL retention periods per data class.

### M04-5 Telemarketing disclosure scripts

Standard script templates (Company name, call purpose, opt-out offer) with
per-call transcript storage, pending counsel approval of script wording.

## Non-goals (M04)

Live telephony, paid carrier contracts, production deployment, bulk
telemarketing to opted-in lists without counsel sign-off. SEC-001 unchanged.

## Milestone tracking

M04 = engineering completion on IMPLEMENTABLE NOW controls, validated by
vitest suites per control (dial-gate refusals, DNCR behavior, CLI binding).
Publication readiness is NOT advanced by M04 alone — it requires SEC-001,
carrier, and counsel sign-off in addition.
