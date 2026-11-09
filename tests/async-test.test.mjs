import { describe, it, expect, beforeAll } from 'vitest';

describe('Test async', () => {
  beforeAll(async () => {
    await Promise.resolve();
  });

  it('async test with await', async () => {
    const result = await Promise.resolve(42);
    expect(result).toBe(42);
  });

  it('async test with multiple awaits', async () => {
    const a = await Promise.resolve(1);
    const b = await Promise.resolve(2);
    expect(a + b).toBe(3);
  });
});
