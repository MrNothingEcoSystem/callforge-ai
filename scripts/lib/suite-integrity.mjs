// Pure evaluation half of the guarded runner (scripts/guard-suite.mjs).
// Split out so the failure shapes can be unit-tested without spawning vitest.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** Every .test.mjs file under tests/ (recursive), relative to `root`, sorted. */
export function discover(root) {
  const walk = dir =>
    readdirSync(dir).flatMap(entry => {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        return walk(full);
      }
      return entry.endsWith('.test.mjs') ? [full] : [];
    });
  return walk(path.join(root, 'tests'))
    .map(f => path.relative(root, f))
    .sort();
}

const ABORTED = /Worker exited unexpectedly|SIGABRT|SIGSEGV/i;

/**
 * Returns the list of problems in one vitest JSON report. Empty list = complete run.
 * `exitStatus` is vitest's exit code (0 expected).
 */
export function evaluateReport({ root, report, discovered, floor, exitStatus = 0 }) {
  const problems = [];
  if (exitStatus !== 0) {
    problems.push(`vitest exited ${exitStatus}`);
  }
  if (!report) {
    problems.push('no JSON report produced — the run died before reporting');
    return problems;
  }

  const relative = r => path.relative(root, r.name);
  const reported = (report.testResults ?? []).map(relative);

  const missing = discovered.filter(f => !reported.includes(f));
  if (missing.length) {
    problems.push(
      `${missing.length}/${discovered.length} test files never reported:\n  ${missing.join('\n  ')}`,
    );
  }

  const empty = (report.testResults ?? [])
    .filter(r => (r.assertionResults ?? []).length === 0)
    .map(relative);
  if (empty.length) {
    problems.push(
      `${empty.length} test file(s) reported zero assertions (worker died before collecting):\n  ${empty.join('\n  ')}`,
    );
  }

  const aborted = (report.testResults ?? [])
    .filter(r => ABORTED.test(r.message ?? ''))
    .map(relative);
  if (aborted.length) {
    problems.push(
      `${aborted.length} test file(s) reported a worker abort message:\n  ${aborted.join('\n  ')}`,
    );
  }

  const duplicated = reported.filter((f, i) => reported.indexOf(f) !== i);
  if (duplicated.length) {
    problems.push(`test file(s) reported more than once:\n  ${duplicated.join('\n  ')}`);
  }

  const unknown = reported.filter(f => !discovered.includes(f));
  if (unknown.length) {
    problems.push(`report names files that are not on disk:\n  ${unknown.join('\n  ')}`);
  }

  const failedSuites = report.numFailedTestSuites ?? 0;
  if (failedSuites) {
    problems.push(`${failedSuites} test file(s) failed`);
  }

  const failed = report.numFailedTests ?? 0;
  const total = report.numTotalTests ?? 0;
  if (failed) {
    problems.push(`${failed} test(s) failed`);
  }
  if (total === 0) {
    problems.push('0 tests collected');
  }

  if (total < floor.tests) {
    problems.push(`collected ${total} tests, floor is ${floor.tests} (a worker most likely died)`);
  }
  if (discovered.length < floor.files) {
    problems.push(`discovered ${discovered.length} test files, floor is ${floor.files}`);
  }
  return problems;
}
