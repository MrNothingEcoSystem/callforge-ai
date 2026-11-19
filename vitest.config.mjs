import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // TECH-006 (root cause fixed): better-sqlite3 v11's Statement
    // destructor ran after Node 24 env teardown (RemoveEnvironmentCleanupHook
    // assertion, SIGABRT in an arbitrary test file; v11 threads 14/16,
    // forks 4/10). Upgrading better-sqlite3 to v12.11.1 fixed it:
    // 20/20 threads runs and 10/10 forks runs pass (108/108 tests each).
    // Threads pool retained (harmless; was the v11 mitigation).
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
