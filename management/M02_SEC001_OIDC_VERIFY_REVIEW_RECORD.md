# Review record — M02 SEC-001 step 1, external OIDC token verification (PR #211)

Date: 2026-11-27 (cycle 236). Head reviewed: `f70d839` (then `29b51ca` while probing).
Method: fresh detached worktree at `/root/.hermes/cache/scratch/review-211`, read the diff,
then a scripted adversarial probe against the real modules with a locally generated RSA
keypair. Cycle-run probe, **not** a delegated auditor (no subagent tool in this runtime).

## What was probed

| #   | Attack / condition                                               | Result                                                                                                                  |
| --- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | Token signed with HMAC but header says `HS256`                   | rejected `Invalid token signature` — no internal-HMAC reuse                                                             |
| 2   | RSA token with `alg: ES256` header                               | rejected `Unsupported token algorithm`                                                                                  |
| 3   | `alg: none` with empty signature segment                         | rejected `Invalid token structure`                                                                                      |
| 4   | Valid signature, `scope: ["admin"]`, role `operator`             | scopes `["simulate","read"]` — escalation ignored (SEC-003 item)                                                        |
| 5   | Role `toString` / `constructor` / `__proto__` / `hasOwnProperty` | **initially threw** `state.roleScopes[role] is not iterable`, 500 on the guard; fixed in `29b51ca` with `Object.hasOwn` |
| 6   | Unknown `kid`, missing `kid`, key from a different pair          | rejected; signature verified before any claim is read                                                                   |
| 7   | `exp` in the past, `exp` absent, `nbf` in the future             | rejected `Token expired` / `Token not yet valid`                                                                        |
| 8   | `iss`/`aud` mismatch, empty tenant claim, numeric tenant claim   | rejected                                                                                                                |
| 9   | Both JWKS env sources set                                        | rejected at configure                                                                                                   |
| 10  | Keys file present, issuer missing                                | **initially** reported as `JWKS contains no usable RSA signing key`; fixed in `f70d839` — scalar config validated first |
| 11  | Startup with an empty key set                                    | `initialize()` rejects; no silent fallback to self-asserted identity                                                    |
| 12  | Whole suite at the head                                          | 296/296, tsc/eslint/prettier clean (re-run in the review worktree)                                                      |

## Verdict

**ACCEPT WITH FOLLOW-UPS** for the verification half of SEC-001. The algorithm allowlist,
mandatory `kid`, signature-before-claims ordering, exact `iss`/`aud`, role→scope re-derivation
and fail-closed startup all behave. Two defects found by the probe were fixed in-cycle and
re-probed (`29b51ca`, `f70d839`).

## Follow-ups

- **F1** — no test drives the `CALLFORGE_OIDC_JWKS_URL` branch (fetch path only exercised by
  inspection); needs a local HTTP fixture or a stubbed global fetch.
- **F2** — string-valued `exp`/`nbf` are not accepted (`exp` string reads as expired, `nbf`
  string is silently ignored). Numeric Date is the JWT standard, so this is a nicety.
- **F3** — key rotation means a process restart: the JWKS is loaded once, no background
  refresh or `kid`-miss refetch.
- **F4** — `clockSkewSeconds` is only settable programmatically via
  `CALLFORGE_OIDC_CLOCK_SKEW_SECONDS`; `NaN` falls back to 0, not the 5s default.
- **F5** — `/oauth/authorize` still mints HS256 tokens; nothing exchanges an IdP code or
  redirects to the IdP, so **M02 is not closed by this PR** and SEC-001 stays open until
  issuance moves to the IdP.
