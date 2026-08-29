import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['legacy/**', 'node_modules/**'],
    testTimeout: 10_000,
    // Provider suites spawn child Node processes; bounding file workers avoids OS-level spawn
    // failures while preserving useful parallelism across the offline suite.
    maxWorkers: 4,
  },
  resolve: { alias: { '@': new URL('src/', import.meta.url).pathname } },
});
