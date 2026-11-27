# TECH-015 F6 — bounded simulated dial log (verification)

Follow-up F6 from `management/TECH015_REVIEW_RECORD.md` (verdict on PR #202): the simulated
provider appended one record per dial to a module-level array and never dropped anything, so an
unattended deployment or a long-lived test process accumulated memory per dial.

- Fix: `06cbf47` on `tech-015-f6-bounded-sim-log` (stacked on #205).
- `MAX_RECORDED_CALLS = 100`; `record()` evicts oldest-first after the push and keeps the newest
  entries. `totalDials` is monotonic, so eviction cannot hide how many dials occurred.
- Records now carry `outcome` (`accepted` / `rejected`), written before the throw so a rejection
  is still evidence and the record agrees with the effect.
- `reset()` added for test isolation and replaces the two ad-hoc field resets in
  `tests/m05-dial-sink.test.mjs`.

## Probe (read-only, both sides of the fix)

5000 dials against the module at `HEAD~1` and at `06cbf47`:

```
before: calls.length = 5000 | has cap = false
after:  calls.length = 100  | cap = 100 | totalDials = 5000
        oldest = n4900 | newest = n4999 | newest outcome = accepted
after reset: calls = 0 total = 0
```

Oldest-first eviction, monotonic count and reset all behave as designed. No network, no DB, no
behaviour change to the sink or to `provider.mjs`.

## Tests

4 new tests in `tests/telephony-simulated-provider.test.mjs` (accepted record + count, rejected
record still throws, overflow keeps newest 100 while counting 1025, reset clears). Full suite
234/234; eslint, prettier and tsc clean.

## Boundary

Test-support hygiene only. A real carrier adapter may stream to its own log; this cap governs the
in-memory simulated evidence, not `call_attempts`, which is the durable record.
