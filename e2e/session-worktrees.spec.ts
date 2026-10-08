import { spawn, execFile as callbackExecFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { CheckoutsResponse, PublicSession } from '../src/shared/types';

let server: ChildProcess; let directory: string; let source: string; let origin: string;
const execFile = promisify(callbackExecFile);
const git = async (...args: string[]) => (await execFile('git', args, { cwd: source, env: {
  ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0',
} })).stdout.trim();
test.beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-worktrees-browser-'));
  source = path.join(directory, 'source'); await mkdir(source);
  await git('init', '-q'); await git('config', 'user.name', 'Browser fixture'); await git('config', 'user.email', 'test@example.invalid');
  await writeFile(path.join(source, 'a.txt'), 'baseline'); await writeFile(path.join(source, '.gitignore'), '.env.local\n');
  await git('add', '.'); await git('commit', '-qm', 'fixture');
  await writeFile(path.join(source, 'a.txt'), 'source human work'); await writeFile(path.join(source, '.env.local'), 'source private setup');
  const socket = createServer(); await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as { port: number }).port; await new Promise<void>((resolve) => socket.close(() => resolve()));
  origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port)], {
    env: { ...process.env, CODEAI_SECURITY_LEVEL: 'guarded', CODEAI_REMOTE_ACCESS: 'local', CODEAI_REPOSITORIES_ROOT: source,
      CODEAI_DATA_DIR: path.join(directory, 'data'), CODEAI_WORKTREES_ROOT: path.join(directory, 'worktrees'), CODEAI_INSTALLATION_ROOT: source,
      CODEAI_CLAUDE_BIN: path.resolve('test/fixtures/fake-claude.mjs'), CODEAI_CODEX_BIN: path.resolve('test/fixtures/not-a-real-codex'),
      CLAUDE_CONFIG_DIR: path.resolve('test/fixtures/provider-homes/claude'), CODEX_HOME: path.resolve('test/fixtures/provider-homes/codex'),
      CODEAI_FAKE_MODE: 'checkpoint', CODEAI_DIST_DIR: process.env.CODEAI_DIST_DIR || '.next-e2e',
    }, stdio: 'ignore',
  });
  await expect.poll(async () => { try { return (await fetch(`${origin}/api/health`)).status; } catch { return 0; } }, { timeout: 20_000 }).toBe(200);
});
test.afterAll(async () => {
  if (server?.exitCode === null) { const stopped = new Promise<void>((resolve) => server.once('exit', () => resolve())); server.kill('SIGTERM'); await stopped; }
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('execution and managed checkout choices remain independent in the desktop launcher', async ({ page }) => {
  const catalog = await (await page.request.get(`${origin}/api/checkouts`)).json() as CheckoutsResponse;
  const { session: blocker } = await (await page.request.post(`${origin}/api/sessions`, {
    data: { provider: 'claude', checkoutId: catalog.checkouts.find((checkout) => !checkout.worktree)!.id },
  })).json() as { session: PublicSession };
  await page.route('**/api/health', async (route) => {
    const response = await route.fetch(); const health = await response.json();
    health.executions.docker = { enabled: true, providers: health.executions.local.providers };
    await route.fulfill({ response, json: health });
  });
  await page.route('**/api/checkouts', async (route) => {
    const response = await route.fetch(); const data = await response.json();
    // This browser fixture is CodeAI's self project. Supply an eligible source capability here;
    // actual Docker origin/mount validation is covered by the server and real-daemon tests.
    for (const checkout of data.checkouts) if (!checkout.worktree) delete checkout.worktreeCreation?.dockerUnavailableReason;
    await route.fulfill({ response, json: data });
  });
  await page.goto(origin); await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: 'No project' }).click();
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  const form = page.locator('.new-session-menu').getByRole('form', { name: 'Create project session' });
  await form.getByRole('combobox', { name: 'Repository', exact: true }).selectOption({ label: 'source' });
  await form.getByRole('combobox', { name: 'Session checkout' }).selectOption('worktree');
  for (const execution of ['docker', 'local', 'docker']) {
    await form.getByRole('combobox', { name: 'Execution', exact: true }).selectOption(execution);
    await expect(form.getByRole('combobox', { name: 'Session checkout' })).toHaveValue('worktree');
    await expect(form.getByRole('button', { name: 'Start session', exact: true })).toBeEnabled();
  }
  const payloads: Array<Record<string, unknown>> = [];
  const snapshot = await (await page.request.get(`${origin}/api/arena`)).json();
  const machine = snapshot.machines[0];
  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    payloads.push(route.request().postDataJSON());
    await route.fulfill({ status: 409, json: { error: 'fixture retry', worktreeConflict: {
      machineId: machine.machine.id, kind: 'turn', blockingTurns: [{ sessionId: blocker.id, state: 'needs-you' }],
    } } });
  });
  await form.getByRole('button', { name: 'Start session', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText(blocker.title);
  await expect(form.getByRole('alert')).toContainText('waiting for you');
  await form.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.poll(() => payloads.length).toBe(2);
  expect(payloads[0]).toMatchObject({ execution: 'docker', checkoutMode: 'worktree', creationRequestId: expect.any(String) });
  expect(payloads[1]).toEqual(payloads[0]);
});

for (const theme of ['light', 'dark']) test(`creates and retains a managed worktree in ${theme}`, async ({ page }) => {
  await page.addInitScript((value) => localStorage.setItem('code-ai:theme', value), theme);
  const { checkouts } = await (await page.request.get(`${origin}/api/checkouts`)).json() as CheckoutsResponse;
  const sourceId = checkouts.find((checkout) => !checkout.worktree)!.id;
  const name = `Worktree ${theme} ${Date.now()}`;
  const { project } = await (await page.request.post(`${origin}/api/projects`, { data: { name, checkoutIds: [sourceId] } })).json();
  await page.goto(origin); await page.locator('.project-search-trigger').click(); await page.getByRole('option', { name: new RegExp(name) }).click();
  const form = page.getByRole('form', { name: 'Create project session' });
  await expect(form.getByRole('combobox', { name: 'Session checkout' })).toHaveValue('current');
  await form.getByRole('combobox', { name: 'Session checkout' }).selectOption('worktree');
  await expect(form).toContainText('uncommitted changes and local setup stay in the current checkout');
  await expect(form).toContainText(`Source: source`);
  const created = page.waitForResponse((response) => response.url().endsWith('/api/sessions') && response.request().method() === 'POST');
  await form.getByRole('button', { name: 'Create and open' }).focus(); await page.keyboard.press('Enter');
  const response = await created; expect(response.status()).toBe(201);
  const { session } = await response.json() as { session: PublicSession }; expect(session.worktree).toBeDefined();
  expect(session.projectId).toBe(project.id);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await expect(conversation).toContainText(`Worktree · ${session.worktree!.branch} · Source: source`);
  const header = (await conversation.locator(':scope > header').boundingBox())!;
  const transcript = (await conversation.locator('.conversation-scroll').boundingBox())!;
  expect(header.height).toBeLessThan(130); expect(transcript.height).toBeGreaterThan(300);
  await page.reload(); await expect(conversation).toContainText(session.worktree!.branch);
  const destination = path.join(directory, 'worktrees', session.worktree!.id);
  expect(await readFile(path.join(destination, 'a.txt'), 'utf8')).toBe('baseline');
  await expect(readFile(path.join(destination, '.env.local'))).rejects.toThrow();
  await conversation.locator('.mode-menu summary').click(); await conversation.getByRole('radio', { name: 'Agent', exact: true }).click();
  await conversation.locator('textarea').fill('Checkpoint change'); await conversation.getByRole('button', { name: 'Send' }).click();
  await conversation.getByRole('button', { name: 'Allow', exact: true }).click();
  await expect(conversation.locator('.chat-message.assistant').last()).toContainText('Checkpoint fixture finished.');
  expect(await readFile(path.join(destination, 'a.txt'), 'utf8')).toBe('provider edit');
  expect(await readFile(path.join(source, 'a.txt'), 'utf8')).toBe('source human work');
  await conversation.getByRole('button', { name: 'Undo this turn' }).click(); await conversation.getByRole('button', { name: 'Confirm Undo' }).click();
  await expect(conversation.getByLabel('Turn recovery')).toContainText('Checkout files restored');
  expect(await readFile(path.join(destination, 'a.txt'), 'utf8')).toBe('baseline');
  await page.screenshot({ path: test.info().outputPath(`worktree-${theme}.png`) });
  const nextResponse = page.waitForResponse((result) => result.url().endsWith('/api/sessions') && result.request().method() === 'POST');
  await conversation.getByRole('button', { name: 'New chat', exact: true }).click();
  const next = (await (await nextResponse).json()).session as PublicSession;
  expect(next.repositories).toEqual(session.repositories); expect(next.worktree).toEqual(session.worktree);
  await expect(conversation).toContainText('New chat shares this worktree');
  await page.getByLabel('More', { exact: true }).click(); await page.getByRole('button', { name: 'Archive session', exact: true }).click();
  await page.getByRole('link', { name: 'Arena', exact: true }).click();
  const arena = page.getByRole('main', { name: 'Arena' });
  await expect(arena).toBeVisible(); await arena.getByRole('tab', { name: /Archived/ }).click();
  const restoreResponse = page.waitForResponse((result) => result.url().endsWith(`/sessions/${next.id}/restore`) && result.request().method() === 'POST');
  await arena.getByRole('region', { name }).getByRole('button', { name: 'Restore', exact: true }).click();
  expect((await restoreResponse).status()).toBe(200);
  expect(await readFile(path.join(destination, 'a.txt'), 'utf8')).toBe('baseline');
  const restored = (await (await page.request.get(`${origin}/api/sessions/${next.id}`)).json()).session as PublicSession;
  expect(restored.worktree).toEqual(session.worktree);
});

test('retries a lost creation response with the same identity and exposes managed binding restrictions', async ({ page }) => {
  await page.goto(origin); await page.locator('.project-search-trigger').click(); await page.getByRole('option', { name: 'No project' }).click();
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  const form = page.locator('.new-session-menu').getByRole('form', { name: 'Create project session' });
  await form.getByRole('combobox', { name: 'Repository', exact: true }).selectOption({ label: 'source' });
  await form.getByRole('combobox', { name: 'Session checkout' }).selectOption('worktree');
  const payloads: Array<Record<string, unknown>> = []; let saved: PublicSession | undefined;
  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    payloads.push(route.request().postDataJSON());
    if (payloads.length === 1) { saved = (await (await route.fetch()).json()).session; return route.abort('failed'); }
    return route.continue();
  });
  await form.getByRole('button', { name: 'Start session', exact: true }).click();
  await expect(form.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled();
  await form.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'All sessions', exact: true })).toHaveValue(saved!.id);
  expect(payloads).toHaveLength(2); expect(payloads[1]).toEqual(payloads[0]);
  await page.getByRole('button', { name: /^Changes(?:,|$)/ }).click();
  await expect(page.getByRole('region', { name: 'Session repositories' })).toContainText('Repository bindings are fixed');
  await page.reload();
  await page.locator('.project-search-trigger').click(); await page.getByRole('option', { name: 'No project' }).click();
  await expect(page.getByRole('complementary', { name: 'Conversation' })).toContainText(saved!.worktree!.branch);
});

test('Arena creates an independent worktree and labels its source and live branch', async ({ page }) => {
  await page.goto(`${origin}/arena`);
  const arena = page.getByRole('main', { name: 'Arena' });
  await arena.getByRole('button', { name: 'New session', exact: true }).click();
  const creation = page.getByRole('dialog', { name: 'New session', exact: true });
  await creation.getByRole('combobox', { name: 'Project', exact: true }).selectOption('');
  await creation.getByRole('combobox', { name: 'Repository', exact: true }).selectOption({ label: 'source' });
  await expect(creation.getByRole('combobox', { name: 'Session checkout' })).toHaveValue('current');
  await creation.getByRole('combobox', { name: 'Session checkout' }).selectOption('worktree');
  await expect(creation).toContainText('uncommitted changes and local setup stay in the current checkout');
  const payloads: Array<Record<string, unknown>> = [];
  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    payloads.push(route.request().postDataJSON());
    if (payloads.length > 1) return route.continue();
    const snapshot = await (await page.request.get(`${origin}/api/arena`)).json();
    await route.fulfill({ status: 409, json: { error: 'fixture busy', worktreeConflict: {
      machineId: snapshot.machines[0].machine.id, kind: 'recovery',
    } } });
  });
  await creation.getByRole('button', { name: 'Create and open', exact: true }).click();
  await expect(creation.getByRole('alert')).toContainText('Undo is using this repository');
  await expect(creation.getByRole('combobox', { name: 'Session checkout' })).toHaveValue('worktree');
  const response = page.waitForResponse((result) => result.url().endsWith('/api/sessions') && result.request().method() === 'POST');
  await creation.getByRole('button', { name: 'Retry', exact: true }).click();
  const { session } = await (await response).json() as { session: PublicSession };
  expect(session.worktree).toBeDefined();
  expect(payloads[1]).toEqual(payloads[0]);
  await expect(page.getByRole('complementary', { name: 'Conversation' })).toContainText(session.worktree!.branch);
  await page.getByRole('link', { name: 'Arena', exact: true }).click();
  await expect(arena.getByRole('button', { name: `Open ${session.title}`, exact: true })).toContainText(`Worktree · ${session.worktree!.branch} · Source: source`);
});
