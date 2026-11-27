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
//   3. a file reports a worker-abort message, or is reported twice / without being on disk,
//   4. any test failed or is pending/skipped without a `todo`,
//   5. the collected test count drops below the committed floor.
// The floor is `tests/.test-floor.json`; add tests in the same commit that raises it:
//   node scripts/guard-suite.mjs --bump
// The evaluation itself lives in scripts/lib/suite-integrity.mjs so it can be unit-tested.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discover, evaluateReport } from './lib/suite-integrity.mjs';

const root = path.resolve(import.meta.dirname, '..');
const floorPath = path.join(root, 'tests', '.test-floor.json');
const bump = process.argv.includes('--bump');

const discovered = discover(root);
const floor = JSON.parse(readFileSync(floorPath, 'utf8'));
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

let report = null;
try {
  report = JSON.parse(readFileSync(outFile, 'utf8'));
} catch {
  report = null;
}
rmSync(outDir, { recursive: true, force: true });

const problems = evaluateReport({
  root,
  report,
  discovered,
  floor,
  exitStatus: typeof run.status === 'number' ? run.status : 1,
});

if (report) {
  const total = report.numTotalTests ?? 0;
  const passed = report.numPassedTests ?? 0;
  const failed = report.numFailedTests ?? 0;
  if (!problems.length && (total > floor.tests || discovered.length > floor.files)) {
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
