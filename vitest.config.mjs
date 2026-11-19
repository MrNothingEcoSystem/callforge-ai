import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // TECH-006: use threads, not the default forks pool. Under Node 24 the
    // forks child-process env teardown races better-sqlite3's native
    // Statement destructor (RemoveEnvironmentCleanupHook assertion,
    // SIGABRT in an arbitrary test file). Measured on main: forks failed
    // 3/20 full-suite runs; threads failed 0/20 (108/108 each run).
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
