import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const e2ePort = Number(process.env.CODEAI_E2E_PORT || process.env.CODEAI_WEB2_E2E_PORT || 3024);
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: e2eBaseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{
    name: 'chrome',
    use: {
      ...devices['Desktop Chrome'],
      launchOptions: { executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] },
    },
  }],
  webServer: {
    command: `yarn next start -p ${e2ePort}`,
    url: `${e2eBaseUrl}/api/projects`,
    reuseExistingServer: true,
    timeout: 30_000,
    env: {
      ...process.env,
      CODEAI_PROJECTS_ROOT: path.resolve('test/fixtures/projects'),
      CODEAI_PROJECTS_DEPTH: '2',
      CODEAI_DATA_DIR: path.resolve('test-results/server-data'),
      CODEAI_CLAUDE_BIN: path.resolve('test/fixtures/fake-claude.mjs'),
      CODEAI_CODEX_BIN: path.resolve('test/fixtures/not-a-real-codex'),
      CODEAI_FAKE_TOOL_DELAY_MS: '600',
      CODEAI_DIST_DIR: process.env.CODEAI_DIST_DIR || process.env.CODEAI_WEB2_DIST_DIR || '.next-e2e',
    },
  },
});
