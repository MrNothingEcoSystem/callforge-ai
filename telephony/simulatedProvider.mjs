/**
 * Inert provider for tests and for a configured-but-not-live deployment.
 * Deterministic apart from the handle, which is derived from the request id, and
 * deliberately network-free: enabling it never spends money.
 *
 * The record of dials is bounded (TECH-015 F6): an unattended deployment or a
 * long-lived test process must not accumulate one object per dial forever. The
 * oldest entries are evicted once `MAX_RECORDED_CALLS` is reached; `totalDials`
 * stays monotonic so a test can still assert *how many* dials happened after
 * earlier evidence has been dropped.
 */

/** Upper bound on retained dial records. Older entries are evicted, newest kept. */
export const MAX_RECORDED_CALLS = 100;

function record(entry) {
  simulatedProvider.calls.push(entry);
  simulatedProvider.totalDials += 1;
  while (simulatedProvider.calls.length > MAX_RECORDED_CALLS) {
    simulatedProvider.calls.shift();
  }
}

export const simulatedProvider = {
  name: 'simulated',
  /** Test hook: queue dials to reject so retry/backoff can be proven. */
  queuedFailures: 0,
  /** Most recent dials, oldest first, capped at `MAX_RECORDED_CALLS`. */
  calls: [],
  /** Monotonic count of every dial attempted, including evicted records. */
  totalDials: 0,
  /** Test hook: clear the log and the queued failures. */
  reset() {
    simulatedProvider.calls.length = 0;
    simulatedProvider.totalDials = 0;
    simulatedProvider.queuedFailures = 0;
  },
  async dial({ idempotencyKey }) {
    const rejected = simulatedProvider.queuedFailures > 0;
    if (rejected) {
      simulatedProvider.queuedFailures -= 1;
    }
    record({ idempotencyKey, outcome: rejected ? 'rejected' : 'accepted' });
    if (rejected) {
      throw new Error('simulated carrier rejection');
    }
    return { providerRef: `sim-${idempotencyKey}` };
  },
};
