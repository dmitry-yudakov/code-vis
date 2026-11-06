import { fulfillArenaSnapshot } from './arena-stream';
import { expect, test, type APIRequestContext, type Page } from './arena-stream';
import type { ArenaSnapshot, CheckoutsResponse, DurableProject, PublicSession } from '../src/shared/types';

const WORKSPACE_KEY = 'code-ai:device:v1:workspace';
const href = (session: PublicSession) => `/?session=${session.id}`;
const composer = (page: Page) => page.getByRole('complementary', { name: 'Conversation', exact: true }).locator('textarea');

test.afterEach(async ({ request }) => {
  const { active } = await (await request.get('/api/agent/runs')).json() as { active: { runId: string }[] };
  await Promise.all(active.map(run => request.post('/api/agent/cancel', { data: { runId: run.runId } })));
  await expect.poll(async () => ((await (await request.get('/api/agent/runs')).json()).active as unknown[]).length).toBe(0);
});

async function fixture(request: APIRequestContext, project?: DurableProject) {
  if (!project) {
    const catalog = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
    const checkoutId = catalog.checkouts.find(item => item.relativePath === 'alpha')!.id;
    const response = await request.post('/api/projects', { data: { name: `URL workspace ${Date.now()}`, checkoutIds: [checkoutId] } });
    expect(response.ok()).toBe(true);
    project = (await response.json()).project as DurableProject;
  }
  const response = await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } });
  expect(response.ok()).toBe(true);
  return { project, session: (await response.json()).session as PublicSession };
}

async function expectSession(page: Page, session: PublicSession) {
  await expect(page).toHaveURL(new RegExp(`\\?session=${session.id}$`));
  await expect(page.getByRole('combobox', { name: 'All sessions', exact: true })).toHaveValue(session.id);
  await expect(composer(page)).toBeVisible();
}

for (const path of ['/arena', '/arena/inbox', '/arena/archived']) {
  test(`direct entry and reload preserve ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('main', { name: 'Arena', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('main', { name: 'Arena', exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  });
}

test('separate browser tabs retain their conversation, project and draft across reload and restored URLs', async ({ page, context, request }) => {
  const first = await fixture(request);
  const second = await fixture(request);
  await page.goto(href(first.session));
  await expectSession(page, first.session);
  await composer(page).fill('Draft belonging to the first browser tab');
  const other = await context.newPage();
  await other.goto(href(second.session));
  await expectSession(other, second.session);
  await composer(other).fill('Draft belonging to the second browser tab');
  await page.reload();
  await expectSession(page, first.session);
  await expect(page.locator('.project-search-trigger')).toContainText(first.project.name);
  await expect(composer(page)).toHaveValue('Draft belonging to the first browser tab');
  await other.reload();
  await expectSession(other, second.session);
  await expect(composer(other)).toHaveValue('Draft belonging to the second browser tab');
  // Browser session restore carries the tab's storage alongside its URL.
  const saved = await page.evaluate(key => sessionStorage.getItem(key), WORKSPACE_KEY);
  const restored = await context.newPage();
  await restored.addInitScript(({ key, value }) => sessionStorage.setItem(key, value!), { key: WORKSPACE_KEY, value: saved });
  await restored.goto(href(first.session));
  await expectSession(restored, first.session);
  await expect(composer(restored)).toHaveValue('Draft belonging to the first browser tab');
});

test('two tabs of the same conversation keep independent drafts', async ({ page, context, request }) => {
  const { session } = await fixture(request);
  await page.goto(href(session));
  await composer(page).fill('First edit');
  const other = await context.newPage();
  await other.goto(href(session));
  await composer(other).fill('Second edit');
  await page.reload();
  await expect(composer(page)).toHaveValue('First edit');
  await other.reload();
  await expect(composer(other)).toHaveValue('Second edit');
});

test('legacy workspace drafts migrate once and tab storage wins on subsequent reloads', async ({ page, request }) => {
  const { session, project } = await fixture(request);
  await page.addInitScript(({ key, projectId, sessionId }) => localStorage.setItem(key, JSON.stringify({ version: 1, scopes: {
    [`project:${projectId}`]: { openSessionIds: [sessionId], focusedSessionId: sessionId,
      views: { [sessionId]: { composer: 'Legacy draft', unread: 0, canvasViews: {} } } },
  } })), { key: WORKSPACE_KEY, projectId: project.id, sessionId: session.id });
  await page.goto(href(session));
  await expect(composer(page)).toHaveValue('Legacy draft');
  await composer(page).fill('Updated tab draft');
  await page.reload();
  await expect(composer(page)).toHaveValue('Updated tab draft');
});

test('activation follows a conversation moved to No project and retains its draft', async ({ page, request }) => {
  const { session, project } = await fixture(request);
  await page.goto(href(session));
  await expectSession(page, session);
  await composer(page).fill('Draft survives project removal');
  const response = await request.delete(`/api/projects/${project.id}`, { data: { expectedRevision: project.revision } });
  expect(response.ok()).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.project-search-trigger')).toContainText('No project');
  await expectSession(page, session);
  await expect(composer(page)).toHaveValue('Draft survives project removal');
  await page.reload();
  await expect(composer(page)).toHaveValue('Draft survives project removal');
});

test('a delayed activation snapshot cannot erase a send that starts while it is in flight', async ({ page, request }) => {
  const { session } = await fixture(request);
  await page.goto(href(session));
  await expectSession(page, session);
  let releaseSnapshot!: () => void;
  let entered!: () => void;
  const pending = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { releaseSnapshot = resolve; });
  await page.route(`**/api/sessions/${session.id}`, async route => {
    entered();
    await gate;
    await route.fulfill({ json: { session } });
  });
  let releaseSend!: () => void;
  const sendGate = new Promise<void>(resolve => { releaseSend = resolve; });
  await page.route('**/api/agent/message', async route => {
    await sendGate;
    await route.fulfill({ status: 409, json: { error: 'Fixture send ended' } });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await pending;
  await composer(page).fill('New instruction after activation');
  await page.getByRole('complementary', { name: 'Conversation', exact: true }).getByRole('button', { name: 'Send', exact: true }).click();
  const message = page.locator('.chat-message.user').filter({ hasText: 'New instruction after activation' });
  await expect(message).toBeVisible();
  releaseSnapshot();
  await expect(message).toBeVisible();
  releaseSend();
  await page.unrouteAll({ behavior: 'wait' });
});

test('activation attaches another tab’s live turn and approval, then delivers its saved reply once', async ({ page, context, request }) => {
  const { session } = await fixture(request);
  await page.goto(href(session));
  await expectSession(page, session);
  await composer(page).fill('Keep the observing tab’s draft');
  const other = await context.newPage();
  await other.goto(href(session));
  await expectSession(other, session);
  await other.getByLabel(/^Mode: /).click();
  await other.getByRole('radio', { name: 'Agent', exact: true }).click();
  await composer(other).fill('Run from the other browser tab');
  let sends = 0;
  context.on('request', outgoing => { if (new URL(outgoing.url()).pathname === '/api/agent/message') sends++; });
  await other.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(other.getByRole('button', { name: 'Deny', exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: 'Deny', exact: true })).toBeVisible();
  await expect(composer(page)).toHaveValue('Keep the observing tab’s draft');
  await page.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(page.locator('.chat-message.assistant.complete')).toContainText('Edit denied');
  await expect(page.locator('.chat-message.user')).toHaveCount(1);
  await expect(composer(page)).toHaveValue('Keep the observing tab’s draft');
  expect(sends).toBe(1);
  await page.reload();
  await expect(page.locator('.chat-message.assistant.complete')).toHaveCount(1);
  await expect(composer(page)).toHaveValue('Keep the observing tab’s draft');
});

test('session links support new tabs and Back/Forward without remounting the shell', async ({ page, context, request }) => {
  const first = await fixture(request);
  const second = await fixture(request, first.project);
  await page.goto(href(first.session));
  await composer(page).fill('Retained through history');
  await page.evaluate(() => { document.querySelector('.app-shell')!.setAttribute('data-persistent-shell', 'yes'); });
  await page.getByRole('combobox', { name: 'All sessions', exact: true }).selectOption(second.session.id);
  await expectSession(page, second.session);
  await page.goBack();
  await expectSession(page, first.session);
  await expect(composer(page)).toHaveValue('Retained through history');
  await page.goForward();
  await expectSession(page, second.session);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-persistent-shell', 'yes');
  const link = page.locator(`.workspace-tab-title[href="${href(first.session)}"]`);
  await expect(link).toHaveCount(1);
  const popupPromise = context.waitForEvent('page');
  await link.click({ modifiers: ['Control'] });
  const popup = await popupPromise;
  await expectSession(popup, first.session);
  await expectSession(page, second.session);
  await link.click();
  await expectSession(page, first.session);
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { selected: true })).toBeFocused();
});

test('empty project and No project URLs remain empty after reload and browser history', async ({ page, request }) => {
  const { project, session } = await fixture(request);
  await page.goto(href(session));
  await expectSession(page, session);
  await page.locator('.workspace-tab.active').focus();
  await page.keyboard.press('Delete');
  await expect(page).toHaveURL(new RegExp(`\\?project=${project.id}$`));
  await expect(composer(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'No open sessions', exact: true })).toBeVisible();
  await page.goto('/?project=none');
  await expect(page.locator('.project-search-trigger')).toContainText('No project');
  await expect(composer(page)).toHaveCount(0);
  await page.reload();
  await expect(page).toHaveURL(/\?project=none$/);
  await expect(composer(page)).toHaveCount(0);
});

for (const query of ['session=bad', 'session=55555555-5555-4555-8555-555555555555', 'session=55555555-5555-4555-8555-555555555555&machine=66666666-6666-4666-8666-666666666666']) {
  test(`unavailable destinations retain their URL and offer recovery: ${query}`, async ({ page }) => {
    await page.goto(`/?${query}`);
    await expect(page.getByRole('region', { name: 'Workspace unavailable', exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(query.replace('?', '\\?').replace('&', '&') + '$'));
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    await expect(composer(page)).toHaveCount(0);
  });
}

test('an archived conversation link offers Archive while keeping the original destination', async ({ page, request }) => {
  const { session } = await fixture(request);
  const response = await request.post(`/api/sessions/${session.id}/archive`, { data: { expectedRevision: session.revision } });
  expect(response.ok()).toBe(true);
  await page.goto(href(session));
  await expect(page.getByRole('region', { name: 'Workspace unavailable', exact: true })).toContainText('archived');
  await expect(page).toHaveURL(new RegExp(`\\?session=${session.id}$`));
  await page.getByRole('region', { name: 'Workspace unavailable', exact: true }).getByRole('link', { name: 'Archive', exact: true }).click();
  await expect(page).toHaveURL(/\/arena\/archived$/);
});

test('an externally archived tab preserves its URL and reopens that conversation after Restore and activation', async ({ page, request }) => {
  const first = await fixture(request);
  const second = await fixture(request, first.project);
  await page.goto(href(second.session));
  await expectSession(page, second.session);
  await page.getByRole('combobox', { name: 'All sessions', exact: true }).selectOption(first.session.id);
  await expectSession(page, first.session);
  await composer(page).fill('Keep this draft through external archive');
  const response = await request.post(`/api/sessions/${first.session.id}/archive`, { data: { expectedRevision: first.session.revision } });
  expect(response.ok()).toBe(true);
  const archived = (await response.json()).session as { revision: number };
  await expect(page.getByRole('region', { name: 'Workspace unavailable', exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`\\?session=${first.session.id}$`));
  expect((await request.post(`/api/sessions/${first.session.id}/restore`, { data: { expectedRevision: archived.revision } })).ok()).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expectSession(page, first.session);
  await expect(composer(page)).toHaveValue('Keep this draft through external archive');
});

test('activation fetches current messages without replacing the unsent draft, and failure can retry', async ({ page, request }) => {
  const { session } = await fixture(request);
  await page.goto(href(session));
  await expectSession(page, session);
  await composer(page).fill('Keep this unsent draft');
  const newer = structuredClone(session);
  newer.revision++;
  newer.messages.push({ id: '77777777-7777-4777-8777-777777777777', role: 'user',
    authorId: newer.participants.find(item => item.kind === 'human')!.id, addressedParticipantId: newer.primaryAgentId,
    createdAt: new Date().toISOString(), text: 'Saved by another browser', status: 'sent', diagramAttachments: [], mode: 'ask' });
  let fail = true;
  let reads = 0;
  await page.route(`**/api/sessions/${session.id}`, async route => {
    reads++;
    await route.fulfill(fail ? { status: 503, json: { error: 'Temporary fixture failure' } } : { json: { session: newer } });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('region', { name: 'Notifications' })).toContainText('Could not refresh this conversation');
  await expect(composer(page)).toHaveValue('Keep this unsent draft');
  fail = false;
  await page.getByRole('region', { name: 'Notifications' }).getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Conversation', exact: true })).toContainText('Saved by another browser');
  await expect(composer(page)).toHaveValue('Keep this unsent draft');
  expect(reads).toBe(2);
});

test('a delayed conversation response cannot replace a later destination', async ({ page, request }) => {
  const first = await fixture(request);
  const second = await fixture(request);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const pending = new Promise<void>(resolve => { entered = resolve; });
  await page.route(`**/api/sessions/${first.session.id}`, async route => {
    entered();
    await gate;
    await route.fulfill({ json: { session: first.session } }).catch(() => {});
  });
  await page.goto(href(first.session));
  await pending;
  // A client transition leaves the old request in the same mounted shell.
  await page.evaluate(url => history.pushState(null, '', url), href(second.session));
  await expectSession(page, second.session);
  release();
  await expectSession(page, second.session);
});

test('an explicit host id canonicalizes away and an attached executor retains its identity', async ({ page, request }) => {
  const { session } = await fixture(request);
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const local = snapshot.machines.find(entry => entry.machine.kind === 'local')!;
  await page.goto(`${href(session)}&machine=${local.machine.id}`);
  await expectSession(page, session);
  const remoteId = '88888888-8888-4888-8888-888888888888';
  const remote = structuredClone(local);
  remote.machine = { ...remote.machine, id: remoteId, kind: 'remote', label: 'URL fixture executor' };
  const remoteSession = { ...session, id: '99999999-9999-4999-8999-999999999999' };
  remote.sessions = [{ ...remote.sessions.find(item => item.id === session.id)!, id: remoteSession.id }];
  await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: { ...snapshot, machines: [...snapshot.machines, remote] } }));
  await page.route(`**/api/machines/${remoteId}/sessions/${remoteSession.id}`, route => route.fulfill({ json: { session: remoteSession } }));
  await page.route(`**/api/machines/${remoteId}/sessions?*`, route => route.fulfill({ json: { sessions: [remoteSession] } }));
  await page.route(`**/api/machines/${remoteId}/agent/runs*`, route => route.fulfill({ json: { active: [], recent: [] } }));
  await page.goto(`/?session=${remoteSession.id}&machine=${remoteId}`);
  await expect(page.getByRole('combobox', { name: 'All sessions', exact: true })).toHaveValue(remoteSession.id);
  await expect(composer(page)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'All sessions', exact: true })).toHaveValue(remoteSession.id);
  await expect(page).toHaveURL(new RegExp(`machine=${remoteId}$`));
});
