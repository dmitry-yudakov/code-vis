import { expect, test, fulfillArenaSnapshot, pushArenaSnapshot, type APIRequestContext, type Page } from './arena-stream';
import type { ArenaSnapshot, CheckoutsResponse, DurableProject, PublicSession } from '../src/shared/types';

async function fixture(request: APIRequestContext) {
  const sessions: PublicSession[] = [];
  for (let i = 0; i < 3; i++) sessions.push((await (await request.post('/api/sessions', { data: { provider: 'claude' } })).json()).session);
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const owner = snapshot.machines.find(machine => machine.machine.kind === 'local')!;
  owner.projects = []; owner.archivedSessions = [];
  owner.sessions = sessions.map(session => owner.sessions.find(item => item.id === session.id)!);
  const now = Date.now();
  owner.sessions.forEach((session, i) => {
    session.title = ['Working session', 'Fresh reply', 'Older reply'][i];
    const createdAt = new Date(now - (i === 2 ? 20 * 3_600_000 : 60_000)).toISOString();
    // A recent metadata edit must not warm an old reply.
    session.updatedAt = new Date(now).toISOString();
    session.lastActivity = { messageId: crypto.randomUUID(), runId: crypto.randomUUID(), createdAt, status: 'complete' };
    session.lastMessage = { author: 'Claude', role: 'assistant', text: 'Ready for your review.', truncated: false };
  });
  owner.runs = { active: [{ runId: crypto.randomUUID(), sessionId: sessions[0].id, participantId: sessions[0].primaryAgentId,
    state: 'running', enqueuedAt: now, startedAt: now, pendingPermissionCount: 0, pendingPermissions: [] }], recent: [] };
  return { snapshot, owner };
}

const card = (page: Page, title: string) => page.locator('.arena-card').filter({ has: page.getByRole('link', { name: `Open ${title}`, exact: true }) });

for (const theme of ['light', 'dark']) for (const layout of ['tiles', 'list', 'phone']) {
  test(`Running, Ready and Idle remain distinct: ${theme} ${layout}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width: layout === 'phone' ? 390 : 1440, height: 1000 });
    await page.addInitScript(theme => localStorage.setItem('code-ai:theme', theme), theme);
    const { snapshot, owner } = await fixture(request);
    await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
    await page.goto('/arena');
    if (layout === 'tiles') await page.getByRole('button', { name: 'Tiles', exact: true }).click();
    const working = card(page, 'Working session'), ready = card(page, 'Fresh reply'), idle = card(page, 'Older reply');
    await expect(working.locator('.arena-state')).toHaveText('Running');
    await expect(working.locator('.arena-state')).toHaveClass(/MuiChip-colorInfo/);
    await expect(ready.locator('.arena-state')).toHaveText('Ready');
    await expect(ready.locator('.arena-state')).toHaveClass(/MuiChip-colorSuccess/);
    await expect(ready.locator('.arena-state')).toHaveAttribute('title', 'Reply completed within the last hour');
    await expect(idle.locator('.arena-state')).toHaveText('Idle');
    await expect(idle.locator('.arena-state')).toHaveClass(/MuiChip-colorDefault/);
    await expect(ready.locator('.arena-card-attention')).toHaveText('1 unread');
    await page.getByRole('main', { name: 'Arena' }).screenshot({ path: testInfo.outputPath('statuses.png'), animations: 'disabled' });
    expect(await page.getByRole('main', { name: 'Arena' }).evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);

    // Successful completion changes Running to Ready and retains one unread item across expiry.
    const run = owner.runs.active[0];
    owner.sessions[0].lastActivity = { messageId: crypto.randomUUID(), runId: run.runId, createdAt: new Date().toISOString(), status: 'complete' };
    owner.runs = { active: [], recent: [{ ...run, state: 'finished', outcome: 'completed', finishedAt: Date.now() }] };
    await pushArenaSnapshot(page);
    await expect(working.locator('.arena-state')).toHaveText('Ready');
    await expect(working.locator('.arena-card-attention')).toHaveText('1 unread');
    owner.runs.recent = [];
    await pushArenaSnapshot(page);
    await expect(working.locator('.arena-card-attention')).toHaveText('1 unread');
    await page.reload();
    await expect(working.locator('.arena-card-attention')).toHaveText('1 unread');
  });
}

test('Ready ages without a server change and read completion stays read after reload', async ({ page, request }) => {
  const { snapshot } = await fixture(request);
  await page.clock.install();
  await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
  await page.goto('/arena');
  const ready = card(page, 'Fresh reply');
  await expect(ready.locator('.arena-state')).toHaveText('Ready');
  await page.clock.fastForward(3_600_000);
  await expect(ready.locator('.arena-state')).toHaveText('Idle');
  await expect(ready.locator('.arena-card-attention')).toHaveText('1 unread');
  await page.getByRole('tab', { name: /^Inbox/ }).click();
  const item = page.locator('.arena-inbox-item').filter({ hasText: 'Fresh reply' });
  await item.getByRole('button', { name: 'Mark read', exact: true }).click();
  await expect(item).toHaveClass(/read/);
  await page.reload();
  await expect(item).toHaveClass(/read/);
  await page.getByRole('tab', { name: /^Active/ }).click();
  await expect(ready.locator('.arena-card-attention')).toHaveCount(0);
});

for (const archived of [false, true]) test(`older executor read markers migrate before run expiry: archived ${archived}`, async ({ page, request }) => {
  const { snapshot, owner } = await fixture(request);
  const summary = owner.sessions[1];
  delete summary.lastActivity!.runId;
  const at = Date.parse(summary.lastActivity!.createdAt), runId = crypto.randomUUID();
  owner.runs.recent = [{ runId, sessionId: summary.id, participantId: summary.agents[0].id, state: 'finished', outcome: 'completed',
    enqueuedAt: at - 1_000, startedAt: at - 1_000, finishedAt: at + 10, pendingPermissionCount: 0, pendingPermissions: [] }];
  if (archived) {
    owner.sessions = owner.sessions.filter(item => item.id !== summary.id);
    owner.archivedSessions = [{ ...summary, archivedAt: new Date().toISOString() }];
  }
  await page.addInitScript(({ id }) => localStorage.setItem('code-ai:device:v1:arena', JSON.stringify({ version: 1, acknowledgedIds: [id] })),
    { id: `machine:${owner.machine.id}:run:${runId}` });
  await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
  await page.goto('/arena');
  const target = card(page, 'Fresh reply');
  const canonical = `machine:${owner.machine.id}:completion:${summary.id}:${summary.lastActivity!.messageId}`;
  await expect.poll(() => page.evaluate(id => JSON.parse(localStorage.getItem('code-ai:device:v1:arena')!).acknowledgedIds.includes(id), canonical)).toBe(true);
  owner.runs.recent = [];
  if (archived) { owner.sessions.push(summary); owner.archivedSessions = []; }
  await pushArenaSnapshot(page);
  await expect(target.locator('.arena-state')).toHaveText('Ready');
  await expect(target.locator('.arena-card-attention')).toHaveCount(0);
});

test('a saved provider reply stays unread until its conversation loads, then stays Ready after reading', async ({ page, request }) => {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const { project } = await (await request.post('/api/projects', { data: { name: `Status delivery ${Date.now()}`, checkoutIds: [checkouts.find(item => item.relativePath === 'alpha')!.id] } })).json() as { project: DurableProject };
  const { session } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json() as { session: PublicSession };
  const response = await request.post('/api/agent/message', { data: { sessionId: session.id, participantId: session.primaryAgentId,
    messageId: crypto.randomUUID(), text: 'Reply with a short status update.', mode: 'ask', diagramAttachments: [] } });
  expect(response.ok()).toBe(true);
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const owner = snapshot.machines.find(item => item.machine.kind === 'local')!;
  const summary = owner.sessions.find(item => item.id === session.id)!;
  const completed = owner.runs.recent.find(item => item.sessionId === session.id)!;
  expect(summary.lastActivity?.runId).toBe(completed.runId);
  owner.sessions = [summary]; owner.projects = [project];
  // Simulate registry eviction using the real persisted summary.
  owner.runs.recent = [];
  await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
  await page.goto('/arena');
  const target = page.locator('.arena-card').filter({ has: page.locator(`.arena-card-open[href*="${session.id}"]`) });
  await expect(target.locator('.arena-state')).toHaveText('Ready');
  await expect(target.locator('.arena-card-attention')).toHaveText('1 unread');

  await page.route(`**/api/sessions/${session.id}`, route => route.fulfill({ status: 503, json: { error: 'Unavailable for this check' } }));
  await page.route('**/api/sessions?**', route => route.fulfill({ status: 503, json: { error: 'Unavailable for this check' } }));
  await target.getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`session=${session.id}`));
  await expect(page.getByRole('region', { name: 'Workspace unavailable', exact: true })).toBeVisible();
  await page.goto('/arena');
  await expect(target.locator('.arena-card-attention')).toHaveText('1 unread');
  await page.unroute(`**/api/sessions/${session.id}`);
  await page.unroute('**/api/sessions?**');
  await target.getByRole('link').click();
  await expect(page.getByRole('complementary', { name: 'Conversation', exact: true })).toBeVisible();
  await expect(page.locator('.chat-message.assistant.complete').first()).toBeVisible();
  await page.getByRole('link', { name: /^Arena/ }).click();
  await expect(target.locator('.arena-state')).toHaveText('Ready');
  await expect(target.locator('.arena-card-attention')).toHaveCount(0);
  await page.reload();
  await expect(target.locator('.arena-card-attention')).toHaveCount(0);

  // A reply arriving while its already-open conversation is in a background browser tab stays
  // unread until the tab becomes visible; successful viewing leaves the Ready cue in place.
  await target.getByRole('link').click();
  await expect(page.getByRole('textbox', { name: 'Instruction', exact: true })).toBeVisible();
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }));
  await page.getByRole('textbox', { name: 'Instruction', exact: true }).fill('Reply once more.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.chat-message.assistant.complete')).toHaveCount(2);
  const updated = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  owner.sessions = updated.machines.find(item => item.machine.kind === 'local')!.sessions.filter(item => item.id === session.id);
  await pushArenaSnapshot(page);
  await page.getByRole('link', { name: /^Arena/ }).click();
  await expect(target.locator('.arena-card-attention')).toHaveText('1 unread');
  await target.getByRole('link').click();
  await expect(page.locator('.chat-message.assistant.complete')).toHaveCount(2);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.getByRole('link', { name: /^Arena/ }).click();
  await expect(target.locator('.arena-state')).toHaveText('Ready');
  await expect(target.locator('.arena-card-attention')).toHaveCount(0);
});
