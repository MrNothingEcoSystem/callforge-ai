import { it, expect } from 'vitest';

it('simple async test', async () => {
  await Promise.resolve(42);
  expect(true).toBe(true);
});
