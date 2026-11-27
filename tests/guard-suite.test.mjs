import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { discover, evaluateReport } from '../scripts/lib/suite-integrity.mjs';

const root = path.resolve(import.meta.dirname, '..');
const floor = () => JSON.parse(readFileSync(path.join(root, 'tests', '.test-floor.json'), 'utf8'));

function fullReport() {
  const discovered = discover(root);
  return {
    report: {
      numTotalTests: Math.max(discovered.length, floor().tests),
      numFailedTests: 0,
      numFailedTestSuites: 0,
      testResults: discovered.map(name => ({
        name: path.join(root, name),
        status: 'passed',
        message: '',
        assertionResults: [{ status: 'passed' }],
      })),
    },
    discovered,
  };
}

function problems(mutate = () => {}) {
  const { report, discovered } = fullReport();
  mutate(report);
  return evaluateReport({ root, report, discovered, floor: floor() });
}

describe('guarded test runner (TECH-009 R2)', () => {
  // A killed worker used to hide its whole file while the run still looked green. The guard
  // needs an accurate floor, so adding or deleting a test file must move the floor with it.
  it('floor file never exceeds the tests on disk', () => {
    expect(floor().files).toBeLessThanOrEqual(discover(root).length);
    expect(floor().tests).toBeGreaterThan(0);
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

  it('CI can be dispatched manually', () => {
    const ci = readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toMatch(/^\s+workflow_dispatch:/m);
  });

  it('a complete report has no problems', () => {
    expect(problems()).toEqual([]);
  });

  it('a file missing from the report fails', () => {
    expect(problems(r => r.testResults.pop()).join('\n')).toContain('never reported');
  });

  it('a file with zero assertions fails', () => {
    expect(
      problems(r => {
        r.testResults[0].assertionResults = [];
      }).join('\n'),
    ).toContain('zero assertions');
  });

  it('a worker abort message fails even when assertions reported', () => {
    expect(
      problems(r => {
        r.testResults[0].message = 'Worker exited unexpectedly with signal SIGABRT';
      }).join('\n'),
    ).toContain('worker abort');
  });

  it('a duplicated entry fails', () => {
    expect(
      problems(r => {
        r.testResults.push({ ...r.testResults[0] });
      }).join('\n'),
    ).toContain('more than once');
  });

  it('a report naming an unknown file fails', () => {
    expect(
      problems(r => {
        r.testResults.push({ name: path.join(root, 'tests', 'ghost.test.mjs') });
      }).join('\n'),
    ).toContain('not on disk');
  });

  it('a count under the floor fails', () => {
    const report = { numTotalTests: 1, testResults: [] };
    const found = evaluateReport({
      root,
      report,
      discovered: ['tests/a.test.mjs'],
      floor: { files: 23, tests: 242 },
    });
    expect(found.join('\n')).toContain('floor is 242');
  });

  it('a non-zero exit fails', () => {
    const { report, discovered } = fullReport();
    const found = evaluateReport({ root, report, discovered, floor: floor(), exitStatus: 1 });
    expect(found.join('\n')).toContain('vitest exited 1');
  });

  it('a missing report fails', () => {
    const found = evaluateReport({ root, report: null, discovered: [], floor: floor() });
    expect(found.join('\n')).toContain('no JSON report');
  });
});
