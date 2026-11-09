import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

describe('Store - no imports', () => {
  beforeAll(async () => {
    await Promise.resolve();
  });

  afterAll(async () => {
    await Promise.resolve();
  });

  beforeEach(() => {
    // sync cleanup
  });

  it('should work', () => {
    expect(true).toBe(true);
  });

  it('async test', async () => {
    const result = await Promise.resolve(42);
    expect(result).toBe(42);
  });
});
