import { test, expect, type APIRequestContext, type Page } from './arena-stream';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { CheckoutsResponse, DurableSession, PublicSession, UserMessage } from '../src/shared/types';
import { createTurn } from '../src/shared/turnActivity';
import { durableSessionSchema } from '../src/shared/sessionSchema';

const conversation = (page: Page) => page.getByRole('complementary', { name: 'Conversation', exact: true });
const composer = (page: Page) => conversation(page).getByRole('textbox', { name: 'Instruction', exact: true });
const dataDir = process.env.CODEAI_E2E_DATA_DIR || path.resolve('test-results/server-data');

async function fixture(request: APIRequestContext, hugeAnswer = false) {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const project = (await (await request.post('/api/projects', { data: {
    name: `Incremental ${crypto.randomUUID()}`, checkoutIds: [checkouts.find(item => item.relativePath === 'alpha')!.id],
  } })).json()).project;
  const created = (await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json()).session as PublicSession;
  const sibling = (await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json()).session as PublicSession;
  const filename = path.join(dataDir, 'session-store-v2/sessions', `${created.id}.json`);
  const saved = JSON.parse(await readFile(filename, 'utf8')) as DurableSession;
  const human = saved.participants.find(item => item.kind === 'human')!;
  saved.version = 17;
  saved.messages = Array.from({ length: 80 }, (_, index) => index % 2 ? {
    id: crypto.randomUUID(), role: 'assistant', authorId: saved.primaryAgentId, createdAt: saved.createdAt, status: 'complete',
    rawMarkdown: `Saved answer ${index}\n\n${'A useful saved paragraph.\n\n'.repeat(index === 79 ? 1 : 100)}`,
    blocks: [{ kind: 'markdown', markdown: `Saved answer ${index}\n\n${'A useful saved paragraph.\n\n'.repeat(index === 79 ? 1 : 100)}` }],
  } : { id: crypto.randomUUID(), role: 'user', authorId: human.id, addressedParticipantId: saved.primaryAgentId,
    text: `Saved question ${index}`, createdAt: saved.createdAt, status: 'sent', diagramAttachments: [] });
  const latestUser = saved.messages[78] as UserMessage;
  const fileText = 'Complete saved file evidence.\n'.repeat(2000);
  latestUser.fileAttachments = [{ name: 'evidence.txt', text: fileText, bytes: Buffer.byteLength(fileText), digest: createHash('sha256').update(fileText).digest('hex') }];
  latestUser.turn = { ...createTurn('saved-run', latestUser.id, saved.primaryAgentId, saved.createdAt), lifecycle: 'completed', sequence: 2, entries: [
    { kind: 'tool', id: 'saved-tool', firstSequence: 1, sequence: 1, attempt: 1, tool: 'Read', summary: 'Saved tool', status: 'succeeded', output: 'Saved tool output.\n'.repeat(700) },
    { kind: 'assistant', id: 'saved-final', firstSequence: 2, sequence: 2, attempt: 1, text: '', complete: true, canonicalMessageId: saved.messages[79].id },
  ] };
  if (hugeAnswer && saved.messages[79].role === 'assistant') {
    const answer = `Saved answer 79\n\n${'Long answer paragraph.\n\n'.repeat(2000)}Tail marker`;
    saved.messages[79].rawMarkdown = answer;
    saved.messages[79].blocks = [{ kind: 'markdown', markdown: answer }];
  }
  expect(durableSessionSchema.safeParse(saved).success).toBe(true);
  await writeFile(filename, JSON.stringify(saved));
  return { session: saved, sibling, fileText };
}

test.afterEach(async ({ request }) => {
  const { active } = await (await request.get('/api/agent/runs')).json();
  for (const run of active) await request.post('/api/agent/cancel', { data: { runId: run.runId } });
  await expect.poll(async () => (await (await request.get('/api/agent/runs')).json()).active.length).toBe(0);
});

for (const theme of ['light', 'dark'] as const) for (const width of [1440, 360]) {
  test(`${theme} ${width}: recent conversation is usable before the project list finishes`, async ({ page, request }) => {
    const { session, sibling } = await fixture(request);
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme => localStorage.setItem('code-ai:theme', theme), theme);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const reads: string[] = [];
    page.on('request', request => { if (request.method() === 'GET' && new URL(request.url()).pathname.startsWith('/api/sessions')) reads.push(request.url()); });
    await page.route('**/api/sessions?**', async route => { await gate; await route.continue(); });
    try {
      await page.goto(`/?session=${session.id}`);
      await expect(composer(page)).toBeVisible();
      await expect(conversation(page)).toContainText('Saved answer 79');
      await composer(page).fill('My independent next draft');
      expect(reads.filter(url => new URL(url).pathname.endsWith(`/${session.id}`))).toHaveLength(1);
      expect(reads.some(url => new URL(url).pathname.endsWith(`/${sibling.id}`))).toBe(false);
      expect(reads.filter(url => /\/api\/sessions\//.test(url)).every(url => new URL(url).searchParams.has('view'))).toBe(true);
      release();
      await expect(page.getByRole('combobox', { name: 'All sessions', exact: true }).locator('option')).toHaveCount(2);
      await expect(composer(page)).toHaveValue('My independent next draft');
      await mkdir('test-results/incremental-screenshots', { recursive: true });
      await page.screenshot({ path: `test-results/incremental-screenshots/${theme}-${width}.png`, animations: 'disabled' });
    } finally { release(); }
  });
}

test('history failure retains draft; retry prepends messages without moving the existing reading anchor', async ({ page, request }) => {
  const { session } = await fixture(request);
  await page.goto(`/?session=${session.id}`);
  await expect(composer(page)).toBeVisible();
  await composer(page).fill('Retained draft');
  let fail = true;
  await page.route('**/api/sessions/*?view=recent&before=*', async route => {
    if (fail) { fail = false; await route.fulfill({ status: 503, json: { error: 'History temporarily unavailable.' } }); }
    else await route.continue();
  });
  const earlier = conversation(page).getByRole('button', { name: 'Load earlier messages', exact: true });
  await earlier.click();
  await expect(conversation(page).getByRole('alert')).toContainText('temporarily unavailable');
  await expect(composer(page)).toHaveValue('Retained draft');
  const first = conversation(page).locator('[data-message-id]').first();
  const id = await first.getAttribute('data-message-id');
  const beforeY = (await first.boundingBox())!.y;
  await conversation(page).getByRole('button', { name: 'Retry earlier messages', exact: true }).click();
  await expect.poll(() => conversation(page).locator('[data-message-id]').count()).toBeGreaterThan(20);
  const afterY = (await conversation(page).locator(`[data-message-id="${id}"]`).boundingBox())!.y;
  expect(Math.abs(afterY - beforeY)).toBeLessThan(8);
  await expect(composer(page)).toHaveValue('Retained draft');
});

test('a delayed old page cannot replace a newer live reply or block complete approval review', async ({ page, request }) => {
  const { session } = await fixture(request);
  await page.goto(`/?session=${session.id}`);
  await expect(composer(page)).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/sessions/*?view=recent&before=*', async route => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await conversation(page).getByRole('button', { name: 'Load earlier messages', exact: true }).click();
    await conversation(page).getByLabel(/^Mode: /).click();
    await page.getByRole('radio', { name: /^Agent/ }).click();
    await composer(page).fill('[chronological-ui] Inspect the project while old history waits.');
    await conversation(page).getByRole('button', { name: 'Send', exact: true }).click();
    const approvals = conversation(page).getByRole('region', { name: 'Pending approvals' });
    await expect(approvals).toContainText('1 of 2');
    await composer(page).fill('Draft typed during the reply');
    await approvals.getByRole('button', { name: 'Deny', exact: true }).click();
    await expect(approvals).toContainText('1 of 1');
    await approvals.getByRole('button', { name: 'Allow once', exact: true }).click();
    await expect(conversation(page)).toContainText('Updated conversation.');
    release();
    await expect(conversation(page).getByRole('button', { name: 'Loading earlier messages…', exact: true })).toHaveCount(0);
    await expect(conversation(page)).toContainText('Updated conversation.');
    await expect(composer(page)).toHaveValue('Draft typed during the reply');
  } finally { release(); }
});

test('canonical nested replies can load complete details and export contains all unloaded history and evidence', async ({ page, request }) => {
  const { session, fileText } = await fixture(request, true);
  await page.goto(`/?session=${session.id}`);
  await expect(composer(page)).toBeVisible();
  await expect(conversation(page)).not.toContainText('Tail marker');
  const user = conversation(page).locator(`[data-message-id="${session.messages[78].id}"]`);
  await user.getByRole('button', { name: 'Load message details', exact: true }).first().click();
  await expect(user.locator('.turn-activity')).toContainText('Saved tool');
  await user.getByRole('button', { name: 'Load message details', exact: true }).last().click();
  await expect(conversation(page)).toContainText('Tail marker');
  await page.getByRole('button', { name: 'More', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export session', exact: true }).click();
  const downloaded = await download;
  const exported = JSON.parse(await readFile((await downloaded.path())!, 'utf8'));
  expect(exported.session.messages).toHaveLength(80);
  expect(exported.session.messages[78].fileAttachments[0].text).toBe(fileText);
  expect(exported.session).not.toHaveProperty('history');
  expect(exported.session).not.toHaveProperty('canvases');
  const full = JSON.stringify((await (await request.get(`/api/sessions/${session.id}`)).json()).session);
  const recent = JSON.stringify(await (await request.get(`/api/sessions/${session.id}?view=recent`)).json());
  expect(Buffer.byteLength(recent)).toBeLessThan(Buffer.byteLength(full) / 4);
});

test('a pending canvas read preserves click-time text and leaves later draft edits intact', async ({ page, request }) => {
  const { session } = await fixture(request);
  const sketch = { id: crypto.randomUUID(), sessionId: session.id, ordinal: 1, createdAt: session.createdAt, viewBox: [0, 0, 1600, 1000] };
  expect((await request.post(`/api/sessions/${session.id}/sketches`, { data: { sketch } })).ok()).toBe(true);
  await page.setViewportSize({ width: 360, height: 900 });
  const scope = `project:${session.projectId}`;
  const pose = { position: [1, 2, 3], rotationY: 0.5 };
  await page.addInitScript(({ scope, sessionId, sketchId, pose }) => {
    localStorage.setItem('code-ai:device:v1:workspace', JSON.stringify({ version: 1, scopes: {
      [scope]: { openSessionIds: [sessionId], focusedSessionId: sessionId, views: {
        [sessionId]: { composer: '', unread: 0, canvasViews: {}, activeDiagramId: sketchId,
          spatial: { placements: { [sketchId]: pose } } },
      } },
    } }));
  }, { scope, sessionId: session.id, sketchId: sketch.id, pose });
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = new Promise<void>(resolve => { entered = resolve; });
  await page.route(`**/api/sessions/${session.id}?view=canvas`, async route => {
    const response = await route.fetch();
    entered();
    await gate;
    await route.fulfill({ response });
  });
  const submissions: Array<{ text: string; diagramAttachments: Array<{ diagramId: string }> }> = [];
  await page.route('**/api/agent/message', async route => {
    submissions.push(route.request().postDataJSON());
    await route.fulfill({ status: 400, json: { error: 'End of captured send.' } });
  });
  try {
    await page.goto(`/?session=${session.id}`);
    await expect(composer(page)).toBeVisible();
    expect(await page.evaluate(({ scope, sessionId, sketchId }) => JSON.parse(sessionStorage.getItem('code-ai:device:v1:workspace')!)
      .scopes[scope].views[sessionId].spatial.placements[sketchId], { scope, sessionId: session.id, sketchId: sketch.id })).toEqual(pose);
    await composer(page).fill('Original instruction');
    await conversation(page).getByRole('button', { name: 'Send', exact: true }).click();
    await pending;
    await composer(page).fill('Later draft edit');
    release();
    await expect.poll(() => submissions.length).toBe(1);
    expect(submissions[0].text).toBe('Original instruction');
    expect(submissions[0].diagramAttachments.map(item => item.diagramId)).toEqual([sketch.id]);
    await expect(composer(page)).toHaveValue('Later draft edit');
  } finally { release(); }
});

test('a phone opens a recent conversation at a throttled mobile connection without sibling reads', async ({ page, context, request }) => {
  const { session, sibling } = await fixture(request);
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto('/arena');
  await expect(page.getByRole('main', { name: 'Arena', exact: true })).toBeVisible();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 64 * 1024, uploadThroughput: 32 * 1024 });
  const reads: string[] = [];
  page.on('request', request => { if (request.method() === 'GET' && /\/api\/sessions\//.test(request.url())) reads.push(request.url()); });
  const started = Date.now();
  try {
    await page.locator(`a[href="/?session=${session.id}"]`).first().click();
    await expect(composer(page)).toBeVisible({ timeout: 25_000 });
    await expect(conversation(page)).toContainText('Saved answer 79');
    const usableAfterMs = Date.now() - started;
    expect(reads.some(url => new URL(url).pathname.endsWith(`/${sibling.id}`))).toBe(false);
    await mkdir('test-results/incremental-screenshots', { recursive: true });
    const recent = JSON.stringify(await (await request.get(`/api/sessions/${session.id}?view=recent`)).json());
    const full = JSON.stringify(await (await request.get(`/api/sessions/${session.id}`)).json());
    await writeFile('test-results/incremental-screenshots/mobile-transfer.json', JSON.stringify({
      latencyMs: 150, downloadBytesPerSecond: 64 * 1024, usableAfterMs,
      recentBytes: Buffer.byteLength(recent), fullBytes: Buffer.byteLength(full), reads,
    }, null, 2));
  } finally {
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await cdp.detach();
  }
});
