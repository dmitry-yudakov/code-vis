import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { PublicSession } from '../src/shared/types';

let server: ChildProcess;
let directory: string;
let origin: string;
test.beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-native-e2e-'));
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port)], {
    env: { ...process.env, CODEAI_SECURITY_LEVEL: 'native', CODEAI_REMOTE_ACCESS: 'local',
      CODEAI_REPOSITORIES_ROOT: path.resolve('test/fixtures/projects'), CODEAI_REPOSITORIES_DEPTH: '2',
      CODEAI_DATA_DIR: directory, CODEAI_CLAUDE_BIN: path.resolve('test/fixtures/fake-claude.mjs'),
      CODEAI_CODEX_BIN: path.resolve('test/fixtures/not-a-real-codex'),
      CLAUDE_CONFIG_DIR: path.resolve('test/fixtures/provider-homes/claude'),
      CODEX_HOME: path.resolve('test/fixtures/provider-homes/codex'),
      CODEAI_DIST_DIR: '.next-e2e',
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

async function openFixture(page: Page, provider: 'claude' | 'codex', isolated = false) {
  const { checkouts } = await (await page.request.get(`${origin}/api/checkouts`)).json();
  const { project } = await (await page.request.post(`${origin}/api/projects`, { data: {
    name: `Native review ${provider} ${Date.now()}`, checkoutIds: [checkouts[0].id],
  } })).json();
  const { session } = await (await page.request.post(`${origin}/api/sessions`, { data: {
    projectId: project.id, provider, ...(isolated ? { instructions: 'isolated' } : {}),
  } })).json() as { session: PublicSession };
  await page.goto(origin);
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(project.name) }).click();
  await page.getByRole('combobox', { name: 'All sessions', exact: true }).selectOption(session.id);
  return session;
}

test('never falls back to Full access when it is the only supported mode', async ({ page }) => {
  await page.route('**/api/health', async (route) => {
    const health = await (await route.fetch()).json();
    const codex = { available: true, authenticated: true, supportedModes: ['full'],
      message: 'Ask and Plan unavailable: Guarded isolation failed.' };
    health.providers.codex = codex;
    health.executions.local.providers.codex = codex;
    await route.fulfill({ json: health });
  });
  await openFixture(page, 'codex');
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await expect(conversation.locator('.mode-menu summary')).toHaveText('Ask');
  await conversation.locator('textarea').fill('Do it');
  await expect(conversation.getByRole('button', { name: 'Send' })).toBeDisabled();
  await expect(conversation.locator('.inline-status')).toContainText('Ask and Plan unavailable');
  await conversation.locator('.mode-menu summary').click();
  await conversation.getByRole('radio', { name: 'Full access', exact: true }).click();
  await expect(conversation.locator('.mode-menu summary')).toHaveText('Full access');
  await expect(conversation.getByRole('button', { name: 'Send' })).toBeEnabled();
});

test('shows the isolation reason and permits an earlier Ask retry independently of the composer', async ({ page }) => {
  const session = await openFixture(page, 'claude', true);
  const patch = (snapshot: PublicSession) => snapshot.id !== session.id ? snapshot : { ...snapshot, messages: [
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'user', authorId: `${session.id}:human`,
      addressedParticipantId: session.primaryAgentId, text: 'Earlier Ask', createdAt: session.createdAt,
      status: 'failed', diagramAttachments: [], mode: 'ask' },
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', role: 'assistant', authorId: session.primaryAgentId,
      createdAt: session.createdAt, status: 'complete', rawMarkdown: 'A plan', blocks: [], mode: 'plan', planProposed: true },
  ] };
  await page.route('**/api/sessions?*', async (route) => {
    const data = await (await route.fetch()).json();
    await route.fulfill({ json: { ...data, sessions: data.sessions.map(patch) } });
  });
  await page.route(`**/api/sessions/${session.id}`, async (route) => {
    const data = await (await route.fetch()).json();
    await route.fulfill({ json: { ...data, session: patch(data.session) } });
  });
  await page.evaluate((sessionId) => {
    const key = 'code-ai:device:v1:workspace';
    const workspace = JSON.parse(localStorage.getItem(key)!);
    for (const scope of Object.values(workspace.scopes) as Array<{ views: Record<string, { defaultMode?: string }> }>) {
      if (scope.views[sessionId]) scope.views[sessionId].defaultMode = 'agent';
    }
    localStorage.setItem(key, JSON.stringify(workspace));
  }, session.id);
  await page.reload();
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  const reason = 'This session runs without your global instructions, and Claude loads them itself in Native writing modes.';
  await expect(conversation.locator('.mode-menu summary')).toHaveText('Agent');
  await expect(conversation.locator('.inline-status')).toHaveText(reason);
  await conversation.locator('textarea').fill('Do it');
  await expect(conversation.getByRole('button', { name: 'Send' })).toBeDisabled();
  await expect(conversation.getByRole('button', { name: 'Execute plan' })).toBeDisabled();
  await expect(conversation.locator('.plan-approval')).toContainText(reason);
  await expect(conversation.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled();
  const sent: string[] = [];
  await page.route('**/api/agent/message', async (route) => {
    sent.push(route.request().postDataJSON().mode);
    await route.fulfill({ status: 409, json: { error: 'Retry fixture received.' } });
  });
  await conversation.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(conversation.locator('.mode-menu summary')).toHaveText('Ask');
  await expect(conversation.locator('textarea')).toHaveValue('Do it\n\nEarlier Ask');
  await expect(conversation.getByRole('button', { name: 'Send' })).toBeEnabled();
  await conversation.getByRole('button', { name: 'Send' }).click();
  await expect.poll(() => sent).toEqual(['ask']);
});

test('runs Native modes, records their tags, isolates Claude, and keeps new sessions at Ask', async ({ page }) => {
  expect((await (await page.request.get(`${origin}/api/health`)).json()).securityLevel).toBe('native');
  const snapshot = await (await page.request.get(`${origin}/api/arena`)).json();
  expect(snapshot.machines[0].securityLevel).toBe('native');
  const { checkouts } = await (await page.request.get(`${origin}/api/checkouts`)).json();
  expect((await page.request.post(`${origin}/api/projects`, { data: {
    name: 'Native fixture', checkoutIds: [checkouts.find((checkout: { name: string }) => checkout.name === 'alpha').id],
  } })).ok()).toBe(true);
  await page.goto(origin);
  await page.locator('.new-session-menu summary').click();
  await page.getByRole('button', { name: 'Start session' }).click();
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await expect(conversation.locator('.execution-line')).toContainText('Native');
  for (const mode of ['Agent', 'Accept edits', 'Auto', 'Full access']) {
    await conversation.locator('.mode-menu summary').click();
    await conversation.getByRole('radio', { name: mode, exact: true }).click();
    await conversation.locator('textarea').fill('Hello');
    await conversation.getByRole('button', { name: 'Send' }).click();
    // The fake deliberately requests an edit in every interactive mode, including Full access.
    // A request the real CLI still sends must continue to reach the ordinary permission card.
    await conversation.getByRole('button', { name: 'Deny', exact: true }).click();
    await expect(conversation.locator('.chat-message.assistant').last()).toContainText('Edit denied');
    const label = mode === 'Agent' || mode === 'Auto' ? `Native · ${mode}` : mode;
    await expect(conversation.locator('.chat-message.user .mode-tag').last()).toHaveText(label);
    await expect(conversation.locator('.chat-message.assistant .mode-tag').last()).toHaveText(label);
  }
  await page.reload();
  await expect(conversation.locator('.mode-menu summary')).toHaveText('Full access');
  await page.locator('.new-session-menu summary').click();
  await page.locator('.new-session-menu').getByLabel('Global instructions').selectOption('isolated');
  await page.getByRole('button', { name: 'Start session' }).click();
  await expect(conversation.locator('.mode-menu summary')).toHaveText('Ask');
  await conversation.locator('.mode-menu summary').click();
  for (const mode of ['Agent', 'Accept edits', 'Auto', 'Full access']) {
    await expect(conversation.getByRole('radio', { name: mode, exact: true })).toBeDisabled();
    await expect(conversation.getByRole('radio', { name: mode, exact: true })).toHaveAttribute('title',
      'This session runs without your global instructions, and Claude loads them itself in Native writing modes.');
  }
  await page.goto(`${origin}/arena`);
  const security = page.getByRole('region', { name: 'Security level' });
  await expect(security).toContainText('Native — Local Claude and Codex write with your own setup');
  await expect(security).toContainText('Set CODEAI_SECURITY_LEVEL on this computer and restart CodeAI to change it.');
  await expect(security.locator('input, select, button')).toHaveCount(0);
});
