import { spawn, execFile as callbackExecFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const execFile = promisify(callbackExecFile);
let server: ChildProcess;
let directory: string;
let checkout: string;
let origin: string;
const git = async (...args: string[]) => (await execFile('git', args, { cwd: checkout,
  env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0' },
})).stdout;

test.beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-checkpoints-e2e-'));
  checkout = path.join(directory, 'checkout'); await mkdir(checkout);
  await git('init', '-q'); await git('config', 'user.name', 'Checkpoint test'); await git('config', 'user.email', 'checkpoint@example.invalid');
  await writeFile(path.join(checkout, 'a.txt'), 'committed'); await git('add', '.'); await git('commit', '-qm', 'fixture');
  await writeFile(path.join(checkout, 'a.txt'), 'staged work'); await git('add', 'a.txt');
  await writeFile(path.join(checkout, 'a.txt'), 'human work');
  await writeFile(path.join(checkout, 'local.txt'), 'human untracked');
  await writeFile(path.join(checkout, '.env.local'), 'synthetic private original');
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port)], {
    env: { ...process.env, CODEAI_SECURITY_LEVEL: 'guarded', CODEAI_REMOTE_ACCESS: 'local',
      CODEAI_REPOSITORIES_ROOT: checkout, CODEAI_DATA_DIR: path.join(directory, 'data'),
      CODEAI_CLAUDE_BIN: path.resolve('test/fixtures/fake-claude.mjs'), CODEAI_CODEX_BIN: path.resolve('test/fixtures/not-a-real-codex'),
      CLAUDE_CONFIG_DIR: path.resolve('test/fixtures/provider-homes/claude'), CODEX_HOME: path.resolve('test/fixtures/provider-homes/codex'),
      CODEAI_FAKE_MODE: 'checkpoint', CODEAI_DIST_DIR: '.next-e2e',
    }, stdio: 'ignore',
  });
  await expect.poll(async () => {
    try { return (await fetch(`${origin}/api/health`)).status; } catch { return 0; }
  }, { timeout: 20_000 }).toBe(200);
});
test.afterAll(async () => {
  if (server?.exitCode === null) {
    const stopped = new Promise<void>((resolve) => server.once('exit', () => resolve()));
    server.kill('SIGTERM'); await stopped;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('offers durable Undo, confirms its scope, restores real uncommitted work, and refuses later edits', async ({ page }) => {
  const { checkouts } = await (await page.request.get(`${origin}/api/checkouts`)).json();
  const { project } = await (await page.request.post(`${origin}/api/projects`, { data: { name: 'Checkpoint journey', checkoutIds: [checkouts[0].id] } })).json();
  const { session } = await (await page.request.post(`${origin}/api/sessions`, { data: { projectId: project.id, provider: 'claude' } })).json();
  await page.addInitScript(() => { if (!localStorage.getItem('code-ai:theme')) localStorage.setItem('code-ai:theme', 'dark'); });
  await page.goto(origin);
  await page.locator('.project-search-trigger').click(); await page.getByRole('option', { name: /Checkpoint journey/ }).click();
  await page.getByRole('combobox', { name: 'Session', exact: true }).selectOption(session.id);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  const originalStatus = await git('status', '--porcelain');
  const index = await readFile(path.join(checkout, '.git/index'));
  const change = async () => {
    await conversation.locator('.mode-menu summary').click(); await conversation.getByRole('radio', { name: 'Agent', exact: true }).click();
    await conversation.locator('textarea').fill('Checkpoint change'); await conversation.getByRole('button', { name: 'Send' }).click();
    await conversation.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect(conversation.locator('.chat-message.assistant').last()).toContainText('Checkpoint fixture finished.');
    await expect(conversation.getByRole('button', { name: 'Undo this turn' })).toBeEnabled();
  };
  await change(); await page.screenshot({ path: test.info().outputPath('recovery-dark.png') }); await page.reload();
  await expect(conversation.getByRole('button', { name: 'Undo this turn' })).toBeEnabled();
  await page.evaluate(() => localStorage.setItem('code-ai:theme', 'light')); await page.reload();
  await expect(page.locator('[data-theme="light"]').first()).toBeVisible();
  await conversation.getByRole('button', { name: 'Undo this turn' }).click();
  await expect(conversation.getByLabel('Turn recovery')).toContainText('external actions');
  await expect(conversation.getByLabel('Turn recovery')).toContainText('Git history and index');
  await page.screenshot({ path: test.info().outputPath('recovery-confirm-light.png') });
  await conversation.getByRole('button', { name: 'Keep changes' }).click();
  expect(await readFile(path.join(checkout, 'a.txt'), 'utf8')).toBe('provider edit');
  await conversation.getByRole('button', { name: 'Undo this turn' }).click();
  await conversation.getByRole('button', { name: 'Confirm Undo' }).click();
  await expect(conversation.getByLabel('Turn recovery')).toContainText('Checkout files restored');
  expect(await readFile(path.join(checkout, 'a.txt'), 'utf8')).toBe('human work');
  expect(await readFile(path.join(checkout, 'local.txt'), 'utf8')).toBe('human untracked');
  await expect(readFile(path.join(checkout, 'new.txt'))).rejects.toThrow();
  expect(await readFile(path.join(checkout, '.env.local'), 'utf8')).toBe('synthetic private later');
  expect(await readFile(path.join(checkout, '.git/index'))).toEqual(index);
  expect(await git('status', '--porcelain')).toBe(originalStatus);
  await change(); await writeFile(path.join(checkout, 'a.txt'), 'later human edit');
  await conversation.getByRole('button', { name: 'Undo this turn' }).click(); await conversation.getByRole('button', { name: 'Confirm Undo' }).click();
  await expect(conversation.getByLabel('Turn recovery')).toContainText('newer changes');
  expect(await readFile(path.join(checkout, 'a.txt'), 'utf8')).toBe('later human edit');
  await page.reload(); await expect(conversation.locator('.chat-message.assistant')).toHaveCount(2);
});
