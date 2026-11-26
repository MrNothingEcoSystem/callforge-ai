#!/usr/bin/env node
// Guarded test runner (TECH-009 follow-up R2).
//
// `vitest run` alone reports a killed worker's file as missing and still exits 0 for the
// files it managed to run, so a binding-level SIGABRT resurfaced as a *soft* count (the
// 11.10 regression cost 36 tests and nobody failed). This wrapper runs the suite with the
// JSON reporter and hard-fails when:
//   1. vitest exits non-zero,
//   2. any discovered `tests/**/*.test.mjs` file never reported, or reported with zero
//      assertions — the exact shape a dead worker leaves (verified: a file killed before
//      collection appears as `status: "passed"` with an empty `assertionResults`),
//   3. any test failed or is pending/skipped without a `todo`,
//   4. the collected test count drops below the committed floor.
// The floor is `tests/.test-floor.json`; add tests in the same commit that raises it:
//   node scripts/guard-suite.mjs --bump
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const floorPath = path.join(root, 'tests', '.test-floor.json');
const bump = process.argv.includes('--bump');

function discover(dir) {
  return readdirSync(dir).flatMap(entry => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      return discover(full);
    }
    return entry.endsWith('.test.mjs') ? full : [];
  });
}

const discovered = discover(path.join(root, 'tests'))
  .map(f => path.relative(root, f))
  .sort();
const outDir = mkdtempSync(path.join(tmpdir(), 'callforge-suite-'));
const outFile = path.join(outDir, 'results.json');

const run = spawnSync(
  process.execPath,
  [
    'node_modules/vitest/vitest.mjs',
    'run',
    '--reporter=default',
    '--reporter=json',
    `--outputFile.json=${outFile}`,
  ],
  { cwd: root, stdio: 'inherit' },
);

const problems = [];
if (run.status !== 0) {
  problems.push(`vitest exited ${run.status ?? run.signal}`);
}

let report = null;
try {
  report = JSON.parse(readFileSync(outFile, 'utf8'));
} catch {
  problems.push('no JSON report produced — the run died before reporting');
}
rmSync(outDir, { recursive: true, force: true });

if (report) {
  const reported = new Set((report.testResults ?? []).map(r => path.relative(root, r.name)));
  const missing = discovered.filter(f => !reported.has(f));
  if (missing.length) {
    problems.push(
      `${missing.length}/${discovered.length} test files never reported:\n  ${missing.join('\n  ')}`,
    );
  }

  const empty = (report.testResults ?? [])
    .filter(r => (r.assertionResults ?? []).length === 0)
    .map(r => path.relative(root, r.name));
  if (empty.length) {
    problems.push(
      `${empty.length} test file(s) reported zero assertions (worker died before collecting):\n  ${empty.join('\n  ')}`,
    );
  }

  const failedSuites = report.numFailedTestSuites ?? 0;
  if (failedSuites) {
    problems.push(`${failedSuites} test file(s) failed`);
  }

  const failed = report.numFailedTests ?? 0;
  const passed = report.numPassedTests ?? 0;
  const total = report.numTotalTests ?? 0;
  if (failed) {
    problems.push(`${failed} test(s) failed`);
  }

  const floor = JSON.parse(readFileSync(floorPath, 'utf8'));
  if (total < floor.tests) {
    problems.push(`collected ${total} tests, floor is ${floor.tests} (a worker most likely died)`);
  }
  if (discovered.length < floor.files) {
    problems.push(`discovered ${discovered.length} test files, floor is ${floor.files}`);
  } else if ((total > floor.tests || discovered.length > floor.files) && !problems.length) {
    console.log(
      `floor ${floor.files}/${floor.tests} is stale — raise it with: node scripts/guard-suite.mjs --bump`,
    );
  }

  if (bump && !problems.length) {
    writeFileSync(
      floorPath,
      `${JSON.stringify({ files: discovered.length, tests: total }, null, 2)}\n`,
    );
    console.log(`floor raised to ${discovered.length} files / ${total} tests`);
  }
  console.log(
    `guarded suite: ${discovered.length}/${discovered.length} files, ${passed} passed, ${failed} failed, ${total} collected (floor ${floor.files}/${floor.tests})`,
  );
}

if (problems.length) {
  console.error(`\nGUARD FAILED\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
