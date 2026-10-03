import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { ArenaSnapshot, DurableSession } from '../src/shared/types';

let server: ChildProcess;
let directory: string;
let origin: string;
const sessionPath = (id: string) => path.join(directory, 'data', 'session-store-v2', 'sessions', `${id}.json`);
const ageSession = async (id: string) => {
  const session = JSON.parse(await readFile(sessionPath(id), 'utf8')) as DurableSession;
  session.updatedAt = new Date(Date.now() - 49 * 60 * 60 * 1_000).toISOString();
  await writeFile(sessionPath(id), JSON.stringify(session));
};

test.beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-auto-archive-e2e-'));
  const checkout = path.join(directory, 'repositories');
  await mkdir(checkout);
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

test('polling archives old conversations, closes their views, and preserves restored work', async ({ page }) => {
  const projectName = 'Automatic archive journey';
  const retainedText = 'This conversation survives automatic archiving.';
  const { project } = await (await page.request.post(`${origin}/api/projects`, { data: { name: projectName } })).json();
  const { session } = await (await page.request.post(`${origin}/api/sessions`, { data: { projectId: project.id, provider: 'claude' } })).json();
  const original = JSON.parse(await readFile(sessionPath(session.id), 'utf8')) as DurableSession;
  original.title = 'A conversation to retain';
  original.messages.push({ id: randomUUID(), role: 'user', authorId: original.participants.find((item) => item.kind === 'human')!.id,
    addressedParticipantId: original.primaryAgentId, text: retainedText,
    createdAt: original.updatedAt, status: 'sent', diagramAttachments: [], mode: 'ask' });
  await writeFile(sessionPath(session.id), JSON.stringify(original));
  await page.goto(origin);
  const picker = page.getByRole('combobox', { name: 'All sessions', exact: true });
  await picker.selectOption(session.id);
  const openViews = page.getByRole('tablist', { name: 'Open session views' });
  await expect(openViews.getByRole('tab')).toHaveCount(1);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await expect(conversation).toContainText(retainedText);

  // A disconnected executor may report a cached archive that has since been restored.
  const initial = await (await page.request.get(`${origin}/api/arena`)).json() as ArenaSnapshot;
  const offline = structuredClone(initial);
  const owner = offline.machines[0];
  owner.machine.state = 'offline';
  owner.archivedSessions = [{ ...owner.sessions.find((item) => item.id === session.id)!,
    revision: original.revision + 1, archivedAt: new Date().toISOString() }];
  owner.sessions = owner.sessions.filter((item) => item.id !== session.id);
  let projection: ArenaSnapshot | undefined = offline;
  await page.route('**/api/arena', async (route) => {
    if (projection) await route.fulfill({ json: projection, headers: { 'x-e2e-archive-projection': 'cached' } });
    else await route.continue();
  });
  await page.waitForResponse((response) => response.url().endsWith('/api/arena')
    && response.headers()['x-e2e-archive-projection'] === 'cached');
  await page.getByLabel('More', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Archive session', exact: true })).toBeDisabled();
  await expect(openViews.getByRole('tab')).toHaveCount(1);
  await page.getByLabel('More', { exact: true }).click();
  projection = undefined;

  await ageSession(session.id);
  await expect(openViews.getByRole('tab')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('code-ai:device:v1:workspace') || '{}') as {
      scopes?: Record<string, { openSessionIds?: string[] }>;
    };
    return Object.values(stored.scopes || {}).flatMap((scope) => scope.openSessionIds || []);
  })).not.toContain(session.id);
  await expect(picker.locator(`option[value="${session.id}"]`)).toHaveCount(0);
  const archivedSnapshot = await (await page.request.get(`${origin}/api/arena`)).json() as ArenaSnapshot;

  await page.getByRole('link', { name: 'Arena', exact: true }).click();
  const arena = page.getByRole('main', { name: 'Arena' });
  await arena.getByRole('tab', { name: /Archived/ }).click();
  const archivedProject = arena.getByRole('region', { name: projectName });
  await archivedProject.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(archivedProject).toHaveCount(0);
  await arena.getByRole('tab', { name: /Active/ }).click();
  await arena.getByRole('region', { name: projectName }).getByRole('button', { name: `Open ${original.title}`, exact: true }).click();
  await expect(openViews.getByRole('tab')).toHaveCount(1);
  await expect(conversation).toContainText(retainedText);

  // A delayed online archive response must not close the newer restored revision.
  projection = archivedSnapshot;
  // The second poll observes the UI after the first snapshot's reconciliation has completed.
  for (let poll = 0; poll < 2; poll += 1) {
    await page.waitForResponse((response) => response.url().endsWith('/api/arena')
      && response.headers()['x-e2e-archive-projection'] === 'cached');
  }
  await page.getByLabel('More', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Archive session', exact: true })).toBeEnabled();
  await expect(openViews.getByRole('tab')).toHaveCount(1);
  await page.getByLabel('More', { exact: true }).click();
  projection = undefined;
  const restored = JSON.parse(await readFile(sessionPath(session.id), 'utf8')) as DurableSession;
  expect(restored.messages).toEqual(original.messages);
  expect(restored.participants).toEqual(original.participants);
  expect(restored.version).toBe(original.version);
  expect(Date.now() - Date.parse(restored.updatedAt)).toBeLessThan(60_000);

  const { session: old } = await (await page.request.post(`${origin}/api/sessions`, { data: { projectId: project.id, provider: 'claude' } })).json();
  await ageSession(old.id);
  await page.reload();
  await expect(picker.locator(`option[value="${session.id}"]`)).toHaveCount(1);
  await expect(picker.locator(`option[value="${old.id}"]`)).toHaveCount(0);
  await expect(openViews.getByRole('tab')).toHaveCount(1);
});
