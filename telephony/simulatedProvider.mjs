/**
 * Inert provider for tests and for a configured-but-not-live deployment.
 * Deterministic apart from the handle, which is derived from the request id, and
 * deliberately network-free: enabling it never spends money.
 */
export const simulatedProvider = {
  name: 'simulated',
  /** Test hook: queue dials to reject so retry/backoff can be proven. */
  queuedFailures: 0,
  calls: [],
  async dial({ idempotencyKey }) {
    simulatedProvider.calls.push({ idempotencyKey });
    if (simulatedProvider.queuedFailures > 0) {
      simulatedProvider.queuedFailures -= 1;
      throw new Error('simulated carrier rejection');
    }
    return { providerRef: `sim-${idempotencyKey}` };
  },
};
