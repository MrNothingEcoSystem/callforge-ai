import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // TECH-006: forks pool SIGABRTs in better-sqlite3 Statement destructor
    // vs Node 24 env teardown (3/20 on forks, 0/20 on threads). Same fix
    // as PR #71; if PR #71 lands first this hunk is a trivial conflict.
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
