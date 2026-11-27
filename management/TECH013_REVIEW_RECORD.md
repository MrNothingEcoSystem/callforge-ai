# TECH-013 tenant policy record — review record

Head reviewed: see PR #200. Self-review pass (single cycle), read-only probes plus mutation.

## Verdict: ACCEPT WITH FOLLOW-UPS

## Probes

1. No row → `source: 'default'`, options exactly `POLICY_DEFAULTS` (test).
2. Row `start=18, end=9` (passes the CHECKs, semantically inverted) → `options: null`, one
   violation; evaluator on the same options returns exactly `['invalid_policy']` (test).
3. Window widened to 07:00 moves an 08:00 local dial from denied to allowed while the
   statutory window still denies it (mutation pair, test).
4. DNCR age 2h turns a 4h-old check stale; `day: 1` denies on one prior unanswered call (test).
5. End-to-end: stored policy reaches `policy_json` as a snapshot and dispatch allows the early
   dial that defaults would deny (test).
6. Full suite 186/186 `--pool=threads`, tsc 0, eslint 0, prettier clean.

## Findings

- F1 (Low, real): `requestDial` (non-resolving producer) does not consult the record; only
  `requestDialResolved` does. A caller on the older path silently gets statutory defaults.
- F2 (Low): whole-hour windows only.
- F3 (Low): no write surface outside the module — dashboard/API still owed.
- F4 (Info): `checkWindow` now receives the option object, so a future caller could pass an
  unvalidated shape directly; the evaluator re-validates, which is the guard.

No blocker. Note the snapshot means a later policy change does not retroactively re-gate a
pending request — deliberate (reproducibility), worth stating for the dashboard.
