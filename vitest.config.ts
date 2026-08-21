import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['legacy/**', 'node_modules/**'],
    testTimeout: 10_000,
  },
  resolve: { alias: { '@': new URL('src/', import.meta.url).pathname } },
});
