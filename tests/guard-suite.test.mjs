import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

function discover(dir) {
  return readdirSync(dir).flatMap(entry => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      return discover(full);
    }
    return entry.endsWith('.test.mjs') ? full : [];
  });
}

describe('guarded test runner (TECH-009 R2)', () => {
  // A killed worker used to hide its whole file while the run still looked green. The guard
  // needs an accurate floor, so adding or deleting a test file must move the floor with it.
  it('floor file never exceeds the tests on disk', () => {
    const floor = JSON.parse(readFileSync(path.join(root, 'tests', '.test-floor.json'), 'utf8'));
    expect(floor.files).toBeLessThanOrEqual(discover(path.join(root, 'tests')).length);
    expect(floor.tests).toBeGreaterThan(0);
  });

  it('package.json test script runs the guard, not bare vitest', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts.test).toBe('node scripts/guard-suite.mjs');
    expect(pkg.scripts['test:raw']).toBe('vitest run');
  });

  it('CI invokes pnpm test', () => {
    const ci = readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toMatch(/run: pnpm test/);
  });
});
