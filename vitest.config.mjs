import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // TECH-006: use threads, not the default forks pool. Under Node 24 the
    // forks child-process env teardown races better-sqlite3's native
    // Statement destructor (RemoveEnvironmentCleanupHook assertion,
    // SIGABRT in an arbitrary test file). Threads reduces the failure
    // rate ~6x (independent re-measure: forks 4/10 vs threads 9/10)
    // but does not eliminate it (TECH-006 remains open).
    pool: 'threads',
    environment: 'node',
    include: ['tests/**/*.test.mjs'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'tests/', '*.config.*', '*.mjs'],
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
