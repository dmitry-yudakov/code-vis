import { expect, test, type Page } from '@playwright/test';
import type { CheckoutsResponse, DurableProject, PublicSession, RunDescriptor } from '../src/shared/types';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

const arena = (page: Page) => page.getByRole('main', { name: 'Arena', exact: true });

test('five open run responses leave approval commands usable and workspace updates resume', async ({ page, request }) => {
  await page.goto('/arena');
  const catalog = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const { project } = await (await request.post('/api/projects', { data: {
    name: `Connection budget ${Date.now()}`, checkoutIds: [catalog.checkouts.find(value => value.relativePath === 'alpha')!.id],
  } })).json() as { project: DurableProject };
  await expect(arena(page).getByRole('region', { name: project.name, exact: true })).toBeVisible();
  const sessions: PublicSession[] = [];
  for (let index = 0; index < 5; index++) sessions.push((await (await request.post('/api/sessions', {
    data: { projectId: project.id, provider: 'claude' },
  })).json()).session as PublicSession);
  try {
    const results = await page.evaluate(async values => {
      const pending: AbortController[] = [];
      const held: Response[] = [];
      (window as typeof window & { abortBudgetRuns?: () => void }).abortBudgetRuns = () => {
        pending.forEach(value => value.abort()); held.length = 0;
      };
      return Promise.all(values.map(async (session, index) => {
        const controller = new AbortController(); pending.push(controller);
        const response = await fetch('/api/agent/message', { method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.id,
            participantId: session.primaryAgentId, messageId: crypto.randomUUID(), text: `Budget approval ${index}`,
            mode: 'agent', diagramAttachments: [] }) });
        held.push(response);
        // Deliberately keep all five bodies open, including queued work.
        return { status: response.status, runId: response.headers.get('x-codeai-run-id') };
      }));
    }, sessions);
    expect(results.every(value => value.status === 200 && value.runId)).toBe(true);
    await expect(arena(page).getByText(/Showing the last good overview/)).toBeVisible();
    const owned = new Set(sessions.map(value => value.id));
    const permission = async () => {
      const runs = (await (await request.get('/api/agent/runs')).json()).active as RunDescriptor[];
      const run = runs.find(value => owned.has(value.sessionId) && value.pendingPermissions.length);
      return run && { runId: run.runId, requestId: run.pendingPermissions[0].requestId };
    };
    await expect.poll(permission).toBeTruthy();
    const target = (await permission())!;
    const status = await page.evaluate(async value => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5_000);
      try {
        return (await fetch('/api/agent/permission', { method: 'POST', signal: controller.signal,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...value, decision: 'deny' }) })).status;
      } finally { clearTimeout(timeout); }
    }, target);
    expect(status).toBe(200);
    await expect(arena(page).getByText(/Showing the last good overview/)).toHaveCount(0, { timeout: 10_000 });
  } finally {
    await page.evaluate(() => (window as typeof window & { abortBudgetRuns?: () => void }).abortBudgetRuns?.());
    const ids = new Set(sessions.map(value => value.id));
    const runs = (await (await request.get('/api/agent/runs')).json()).active as RunDescriptor[];
    await Promise.all(runs.filter(value => ids.has(value.sessionId)).map(value => request.post('/api/agent/cancel', { data: { runId: value.runId } })));
  }
});

test('an idle Arena keeps one subscription through heartbeats without polling', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/arena') requests.push(request.headers().accept ?? 'application/json');
  });
  await page.goto('/arena');
  await expect(arena(page).getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
  await expect.poll(() => requests.includes('application/x-ndjson')).toBe(true);
  // Settle initial activation, then cover two heartbeat intervals and five former poll intervals.
  await page.waitForTimeout(400);
  const count = requests.length;
  await page.waitForTimeout(11_000);
  expect(requests).toHaveLength(count);
  await expect(arena(page).getByText(/Showing the last good overview/)).toHaveCount(0);
});

test('two tabs receive project creation and session archive/restore without requesting another snapshot', async ({ page, context, request }) => {
  let reads = 0;
  const observe = (target: Page) => target.on('request', value => {
    if (new URL(value.url()).pathname === '/api/arena') reads++;
  });
  observe(page);
  await page.goto('/arena');
  const other = await context.newPage();
  observe(other);
  await other.goto('/arena');
  await expect(arena(page)).toBeVisible();
  await expect(arena(other)).toBeVisible();
  await page.waitForTimeout(400);
  const before = reads;
  const created = await request.post('/api/projects', { data: { name: `Pushed project ${Date.now()}` } });
  expect(created.ok()).toBe(true);
  const { project } = await created.json() as { project: DurableProject };
  for (const target of [page, other]) await expect(arena(target).getByRole('region', { name: project.name, exact: true })).toBeVisible();
  const started = await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } });
  expect(started.ok()).toBe(true);
  const { session } = await started.json() as { session: PublicSession };
  const card = (target: Page) => arena(target).getByRole('region', { name: project.name, exact: true })
    .getByRole('link', { name: `Open ${session.title}`, exact: true });
  for (const target of [page, other]) await expect(card(target)).toBeVisible();
  const archived = await request.post(`/api/sessions/${session.id}/archive`, { data: { expectedRevision: session.revision } });
  expect(archived.ok()).toBe(true);
  const archivedSession = (await archived.json()).session as PublicSession;
  for (const target of [page, other]) await expect(card(target)).toHaveCount(0);
  const restored = await request.post(`/api/sessions/${session.id}/restore`, { data: { expectedRevision: archivedSession.revision } });
  expect(restored.ok()).toBe(true);
  for (const target of [page, other]) await expect(card(target)).toBeVisible();
  expect(reads).toBe(before);
});

test('a disconnected browser retains its overview and recovers current state after reconnect', async ({ page }) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-stream-reconnect-'));
  await mkdir(path.join(directory, 'repositories'));
  const socket = createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const origin = `http://127.0.0.1:${port}`;
  let server: ChildProcess | undefined;
  const start = async () => {
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port)], {
      env: { ...process.env, CODEAI_SECURITY_LEVEL: 'guarded', CODEAI_REMOTE_ACCESS: 'local',
        CODEAI_REPOSITORIES_ROOT: path.join(directory, 'repositories'), CODEAI_DATA_DIR: path.join(directory, 'data'),
        CODEAI_WORKTREES_ROOT: path.join(directory, 'worktrees'),
        CODEAI_CLAUDE_BIN: path.resolve('test/fixtures/fake-claude.mjs'), CODEAI_CODEX_BIN: path.resolve('test/fixtures/not-a-real-codex'),
        CLAUDE_CONFIG_DIR: path.resolve('test/fixtures/provider-homes/claude'), CODEX_HOME: path.resolve('test/fixtures/provider-homes/codex'),
        CODEAI_DIST_DIR: '.next-e2e',
      }, stdio: 'ignore',
    });
    await expect.poll(async () => {
      try { return (await fetch(`${origin}/api/projects`)).status; } catch { return 0; }
    }, { timeout: 20_000 }).toBe(200);
  };
  const stop = async () => {
    if (server?.exitCode === null && server.signalCode === null) {
      const exited = new Promise<void>(resolve => server!.once('exit', () => resolve()));
      server.kill('SIGKILL'); await exited;
    }
  };
  try {
    await start();
    const name = `Reconnect project ${Date.now()}`;
    const existing = 'Retained while disconnected';
    expect((await page.request.post(`${origin}/api/projects`, { data: { name: existing } })).ok()).toBe(true);
    await page.goto(`${origin}/arena`);
    await expect(arena(page).getByRole('region', { name: existing, exact: true })).toBeVisible();
    await stop();
    await expect(arena(page).getByText(/Showing the last good overview/)).toBeVisible();
    await expect(arena(page).getByRole('region', { name: existing, exact: true })).toBeVisible();
    const now = new Date().toISOString();
    const project: DurableProject = { version: 1, revision: 0, id: crypto.randomUUID(), name, repositories: [], createdAt: now, updatedAt: now };
    await writeFile(path.join(directory, 'data', 'session-store-v2', 'projects', `${project.id}.json`), JSON.stringify(project));
    await start();
    await expect(arena(page).getByRole('region', { name, exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(arena(page).getByText(/Showing the last good overview/)).toHaveCount(0);
  } finally {
    await page.goto('about:blank');
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
});
