# CALLFORGE OMEGA — Merge-Readiness Matrix

Generated: 2026-11-09 (supervisor, live GitHub state). **No merges performed.**
Canonical `main` = `75b191a` (unchanged). No branch protection is configured
on `main` (verified via merge state); merges below are therefore
owner-authorized actions, not system gates.

## PR matrix

| PR                    | Content                                                                                        | Head      | CI (exact head)                  | Mergeable | Verdict / gate                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------- | --------- | -------------------------------- | --------- | --------------------------------------------------------------------- |
| #7 M02 identity       | `oauth.mjs`, `server.mjs`, 2 test files                                                        | `4368955` | PASS (42560741400)               | CLEAN     | Audit ACCEPT WITH FOLLOW-UPS; SEC-001 blocks production identity only |
| #9 M03-1 durability   | `db/`, `workflow/`, `scripts/`, `store.mjs`, `tsconfig`, `package.json`                        | `6c0ffb9` | PASS (42563370184)               | CLEAN     | **ACCEPTED** (final re-verification)                                  |
| #11 docs set 1        | 9 files under `management/`                                                                    | `6522e24` | PASS (42563195584)               | CLEAN     | Superset of #12 baseline docs                                         |
| #12 cycle-2 docs      | same 9 files                                                                                   | `52f671a` | **FAIL** (format-only)           | UNSTABLE  | **SUPERSEDE** — see below                                             |
| #13 SEC-001/M09/M04   | +`SEC001_IDP_DOSSIER`, `M03_REVIEW_RECORD`, `M09_REMOTE_MCP_DESIGN`, `UAE_COMPLIANCE_REGISTER` | `d182eb3` | PASS (42563577781)               | CLEAN     | Builds on #11 content                                                 |
| #15 acceptance record | `M03_REVIEW_RECORD` verdict update                                                             | `12759a1` | format fix pushed, rerun pending | CLEAN     | Stacked on #13                                                        |

## Overlaps and ancestry

- All docs PRs (#11, #12, #13, #15) share base `75b191a` and touch the same
  `management/` files → they conflict textually if merged out of order.
  #13 and #15 are stacked (each includes #11's files).
- **#7 vs #9: no overlapping files** (M02: `oauth.mjs`/`server.mjs`/tests;
  M03: `db/`/`workflow/`/`store.mjs`/etc.). GitHub reports both CLEAN
  against current main. Sequential merge in either order is textually safe;
  semantically M03-2 webhook wiring needs M02 merged (documented gate, not
  a merge conflict).
- **#9 vs main:** merge-base `75b191a`, 0 behind — no rebase required.
- **#7 vs main:** merge-base `92b07f2`, 1 behind (the `75b191a` docs commit)
  — no rebase required; docs-only delta.
- `cleanup-m01-followups` (dispatcher cycle 3, head `7c22699`): touches
  `audit.mjs` + tests; base `75b191a`. No PR yet at matrix time — do not
  merge a branch without a PR + exact-head CI.

## Consolidation recommendation

- **Supersede #12**: its cycle-2 state (M03 "in_review") is superseded by
  #13/#15 (final ACCEPT). Close #12 after #13+#15 merge; do not merge its
  stale ledger. Its branch is retained (deletion not authorized).
- **Keep #11 → #13 → #15 as a stacked docs chain**; merge in that order,
  or squash into one docs merge. #15 only updates the review record.
- #7 and #9 are independent of the docs chain and of each other.

## Safe minimal merge sequence (owner-authorized only)

1. #11 (docs baseline) → 2. #13 (SEC-001/M09/M04) → 3. #15 (acceptance record)
   → 4. #7 (M02) → 5. #9 (M03-1) → 6. close #12 as superseded.
   After each merge: re-verify `main` CI + rerun the full gate suite
   (typecheck/lint/format/test/audit) at the new head.
2. Only then: M03-2 branch from merged main.

## Unresolved security items at merge time (tracked, not blocking simulation merges)

SEC-001 (real IdP — #1 + dossier), MCP surface (#8), issues #2/#4/#5/#6
(cleanup branch in progress), F-M03-01…05 (M03-2 scope).

## Human decisions required

- [ ] Authorize merges #11, #13, #15 (docs chain)
- [ ] Authorize merge #7 (simulation baseline; SEC-001 stays open)
- [ ] Authorize merge #9 (accepted; rebase not required)
- [ ] SEC-001 IdP selection (see dossier — legal/DPO sign-off)
- [ ] Confirm #12 supersede/close
