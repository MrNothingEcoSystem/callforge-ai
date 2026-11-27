import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_RECORDED_CALLS, simulatedProvider } from '../telephony/simulatedProvider.mjs';

describe('simulated provider dial log (TECH-015 F6)', () => {
  beforeEach(() => simulatedProvider.reset());

  it('records an accepted dial with its outcome and keeps a monotonic count', async () => {
    const { providerRef } = await simulatedProvider.dial({ idempotencyKey: 'k1' });
    expect(providerRef).toBe('sim-k1');
    expect(simulatedProvider.calls).toEqual([{ idempotencyKey: 'k1', outcome: 'accepted' }]);
    expect(simulatedProvider.totalDials).toBe(1);
  });

  it('records a queued failure as rejected and still throws', async () => {
    simulatedProvider.queuedFailures = 1;
    await expect(simulatedProvider.dial({ idempotencyKey: 'k2' })).rejects.toThrow(
      'simulated carrier rejection',
    );
    expect(simulatedProvider.calls).toEqual([{ idempotencyKey: 'k2', outcome: 'rejected' }]);
    expect(simulatedProvider.queuedFailures).toBe(0);
  });

  it('keeps the newest MAX_RECORDED_CALLS entries but counts every dial', async () => {
    const overflow = 25;
    for (let i = 0; i < MAX_RECORDED_CALLS + overflow; i += 1) {
      await simulatedProvider.dial({ idempotencyKey: `k${i}` });
    }
    expect(simulatedProvider.calls).toHaveLength(MAX_RECORDED_CALLS);
    expect(simulatedProvider.totalDials).toBe(MAX_RECORDED_CALLS + overflow);
    // oldest evicted, newest retained
    expect(simulatedProvider.calls[0].idempotencyKey).toBe(`k${overflow}`);
    expect(simulatedProvider.calls.at(-1).idempotencyKey).toBe(
      `k${MAX_RECORDED_CALLS + overflow - 1}`,
    );
  });

  it('reset() clears the log, the count and the queued failures', async () => {
    simulatedProvider.queuedFailures = 2;
    await simulatedProvider.dial({ idempotencyKey: 'k1' }).catch(() => {});
    simulatedProvider.reset();
    expect(simulatedProvider.calls).toEqual([]);
    expect(simulatedProvider.totalDials).toBe(0);
    expect(simulatedProvider.queuedFailures).toBe(0);
  });
});
