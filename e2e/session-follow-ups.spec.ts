import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { CheckoutsResponse, PublicSession, RunDiscovery } from '../src/shared/types';
import { sessionTab } from './session-tabs';

let server: ChildProcess;
let directory: string;
let origin: string;

test.beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-follow-ups-e2e-'));
  const socket = createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '-p', String(port)], {
    env: { ...process.env, CODEAI_REMOTE_ACCESS: 'local', CODEAI_SECURITY_LEVEL: 'guarded', CODEAI_DATA_DIR: directory,
      CODEAI_REPOSITORIES_ROOT: path.resolve('test/fixtures/projects'), CODEAI_REPOSITORIES_DEPTH: '2',
      CODEAI_CLAUDE_BIN: path.resolve('test/fixtures/fake-claude.mjs'), CODEAI_CODEX_BIN: path.resolve('test/fixtures/fake-codex.mjs'),
      CODEX_HOME: path.resolve('test/fixtures/provider-homes/codex'), CODEAI_FAKE_CODEX_MODE: 'steer',
      CODEAI_DIST_DIR: process.env.CODEAI_DIST_DIR || process.env.CODEAI_WEB2_DIST_DIR || '.next-e2e',
    }, stdio: 'ignore',
  });
  await expect.poll(async () => {
    try { return (await fetch(`${origin}/api/projects`)).status; } catch { return 0; }
  }, { timeout: 20_000 }).toBe(200);
});

test.afterAll(async () => {
  if (server?.exitCode === null) {
    const stopped = new Promise<void>(resolve => server.once('exit', () => resolve()));
    server.kill('SIGTERM');
    await stopped;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

for (const [theme, width] of [['light', 1280], ['dark', 320]] as const) {
  test(`${theme} ${width}px queues, edits, removes and steers while the Codex session runs`, async ({ page, request }, testInfo) => {
    const { checkouts } = await (await request.get(`${origin}/api/checkouts`)).json() as CheckoutsResponse;
    const created = await request.post(`${origin}/api/sessions`, { data: {
      provider: 'codex', checkoutId: checkouts.find(item => item.relativePath === 'alpha')!.id, allowAgentArchive: false,
    } });
    expect(created.status()).toBe(201);
    const { session } = await created.json() as { session: PublicSession };
    const runs = async () => (await (await request.get(`${origin}/api/agent/runs?sessionId=${session.id}`)).json()) as RunDiscovery;
    const saved = async () => ((await (await request.get(`${origin}/api/sessions/${session.id}`)).json()) as { session: PublicSession }).session;
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(appearance => localStorage.setItem('code-ai:theme', appearance), theme);
    await page.goto(`${origin}/?session=${session.id}`);
    const conversation = page.getByRole('complementary', { name: 'Conversation', exact: true });
    const input = conversation.getByRole('textbox', { name: 'Instruction', exact: true });
    const queue = conversation.getByRole('button', { name: 'Queue', exact: true });
    const message = (text: string) => conversation.locator('.chat-message.user').filter({ hasText: text });
    await conversation.getByLabel(/^Mode: /).click();
    await page.getByRole('radio', { name: 'Ask', exact: true }).click();
    await input.fill('[wait-for-steer] Hold for a clarification.');
    await conversation.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(conversation.getByText('Waiting for steering input.')).toBeVisible();
    const activeRunId = (await runs()).active[0].runId;

    await input.fill('Do this afterwards.');
    await expect(queue).toBeInViewport();
    await input.press('Enter');
    await expect(message('Do this afterwards.').getByText('Queued', { exact: true })).toBeVisible();
    await expect(input).toHaveValue('');
    await input.fill('Drop this follow-up.');
    await queue.click();
    await expect(message('Drop this follow-up.').getByRole('button', { name: 'Remove', exact: true })).toBeVisible();
    await message('Drop this follow-up.').getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(message('Drop this follow-up.')).toContainText('cancelled');
    await input.fill('Please change direction.');
    await queue.click();
    await expect(message('Please change direction.').getByRole('button', { name: 'Steer', exact: true })).toBeVisible();
    await expect(conversation.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
    await input.fill('Keep this unsent draft.');
    await expect(queue).toBeEnabled();
    const actions = conversation.locator('.composer-actions');
    expect(await actions.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    const composerBounds = (await conversation.locator('.instruction-composer').boundingBox())!;
    const queueBounds = (await queue.boundingBox())!;
    expect(queueBounds.x + queueBounds.width).toBeLessThan(composerBounds.x + composerBounds.width);
    await page.screenshot({ path: testInfo.outputPath('queued-follow-ups.png'), animations: 'disabled' });

    await page.reload();
    await expect(input).toHaveValue('Keep this unsent draft.');
    const followUp = message('Do this afterwards.');
    await followUp.getByRole('button', { name: 'Edit message', exact: true }).click();
    await conversation.getByRole('textbox', { name: 'Queued message', exact: true }).fill('Do the revised follow-up afterwards.');
    await conversation.getByRole('button', { name: 'Save message', exact: true }).click();
    await expect(message('Do the revised follow-up afterwards.')).toBeVisible();
    expect((await runs()).active[0].runId).toBe(activeRunId);

    await message('Please change direction.').getByRole('button', { name: 'Steer', exact: true }).click();
    await expect(message('Please change direction.')).toContainText('Steered active turn');
    const replies = conversation.locator('.chat-message.assistant.complete');
    await expect(replies).toHaveCount(2);
    await expect(replies.first()).toContainText('Steered reply: Please change direction.');
    await expect(replies.last()).toContainText('Codex answer.');
    const messages = (await saved()).messages;
    expect(messages.filter(item => item.role === 'user' && item.steeredRunId)).toMatchObject([{ status: 'sent', steeredRunId: activeRunId }]);
    expect(messages.filter(item => item.role === 'user' && item.status === 'cancelled')).toHaveLength(1);
    const timeline = await conversation.locator('.chat-message:is(.user,.complete)').allTextContents();
    expect(timeline.findIndex(text => text.includes('Steered active turn'))).toBeLessThan(timeline.findIndex(text => text.includes('Steered reply:')));
    await expect.poll(async () => (await runs()).active).toEqual([]);
  });
}

test('attaches the promoted follow-up while another session is open', async ({ page, request }) => {
  const { checkouts } = await (await request.get(`${origin}/api/checkouts`)).json() as CheckoutsResponse;
  const { project } = await (await request.post(`${origin}/api/projects`, { data: {
    name: 'Follow-up handoff', checkoutIds: [checkouts.find(item => item.relativePath === 'alpha')!.id],
  } })).json();
  const createSession = async () => ((await (await request.post(`${origin}/api/sessions`, { data: {
    projectId: project.id, provider: 'codex', allowAgentArchive: false,
  } })).json()) as { session: PublicSession }).session;
  const first = await createSession();
  const second = await createSession();
  await page.goto(`${origin}/?session=${first.id}`);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  const input = conversation.getByRole('textbox', { name: 'Instruction', exact: true });
  await conversation.getByLabel(/^Mode: /).click();
  await page.getByRole('radio', { name: 'Ask', exact: true }).click();
  await input.fill('[wait-for-steer] Stay active until clarified.');
  await input.press('Enter');
  await expect(conversation.getByText('Waiting for steering input.')).toBeVisible();
  for (const text of ['Continue in the background', 'Release this turn']) {
    await input.fill(text);
    await expect(conversation.getByRole('button', { name: 'Queue', exact: true })).toBeEnabled();
    await input.press('Enter');
    await expect(conversation.locator('.chat-message.user').filter({ hasText: text }).getByText('Queued', { exact: true })).toBeVisible();
  }
  const { active, followUps } = await (await request.get(`${origin}/api/agent/runs?sessionId=${first.id}`)).json() as RunDiscovery;
  const [successor, steering] = followUps!;
  await sessionTab(page, second.id).click();
  await expect(page).toHaveURL(new RegExp(`session=${second.id}`));
  const attachment = page.waitForResponse(response => response.url().endsWith(`/api/agent/stream?runId=${successor.runId}`) && response.ok());
  const steered = await request.post(`${origin}/api/agent/steer`, { data: {
    runId: steering.runId, activeRunId: active[0].runId, expectedText: 'Release this turn',
  } });
  expect(steered.status()).toBe(200);
  await attachment;
  await expect(page).toHaveURL(new RegExp(`session=${second.id}`));
  await sessionTab(page, first.id).click();
  await expect(conversation.locator('.chat-message.assistant.complete')).toHaveCount(2);
});
