import { sessionTab } from './session-tabs';
import { fulfillArenaSnapshot, pushArenaSnapshot, restartArenaSubscription } from './arena-stream';
import { expect, test } from './arena-stream';
import type { APIRequestContext, Page } from './arena-stream';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ArenaSnapshot, CheckoutsResponse, DurableSession, PublicSession } from '../src/shared/types';

async function openProject(page: Page, request: APIRequestContext, count = 3, visitAll = true) {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const { project } = await (await request.post('/api/projects', { data: {
    name: `Title bar ${Date.now()}`, checkoutIds: [checkouts.find((checkout) => checkout.name === 'alpha')!.id],
  } })).json();
  const sessions: PublicSession[] = [];
  for (let index = 0; index < count; index++) {
    const response = await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } });
    expect(response.status()).toBe(201);
    const { session } = await response.json() as { session: PublicSession };
    const filename = path.resolve('test-results/server-data/session-store-v2/sessions', `${session.id}.json`);
    const stored = JSON.parse(await readFile(filename, 'utf8')) as DurableSession;
    stored.title = `View ${index + 1}: a long session title for the header overflow`;
    await writeFile(filename, JSON.stringify(stored));
    sessions.push({ ...session, title: stored.title });
  }
  await page.goto('/');
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(project.name) }).click();
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab')).toHaveCount(count);
  if (visitAll) {
    const titles = page.locator('.workspace-tab-title');
    const order = await titles.allTextContents();
    for (const session of sessions) await sessionTab(page, session.id).click();
    expect(await titles.allTextContents()).toEqual(order);
    if (sessions.length) await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { selected: true })).toHaveAccessibleName(sessions.at(-1)!.title);
  }
  return { project, sessions };
}

async function finishReply(page: Page) {
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await conversation.locator('textarea').fill('Explain the project.');
  await conversation.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(conversation.locator('.chat-message.assistant.complete')).toBeVisible();
  await expect(conversation.getByRole('button', { name: 'Archive session', exact: true })).toBeEnabled();
  return conversation;
}

async function expectSelectedInView(page: Page) {
  await expect.poll(async () => {
    const list = (await page.locator('.workspace-tablist .MuiTabs-scroller').boundingBox())!;
    const tab = (await page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { selected: true }).boundingBox())!;
    return Boolean(tab && list && tab.x >= list.x - 1 && tab.x + tab.width <= list.x + list.width + 1);
  }).toBe(true);
}

async function visibleControls(page: Page) {
  return page.locator('button, select, input, textarea, a, summary').evaluateAll((nodes) => nodes.filter((node) => {
    const element = node as HTMLElement;
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      && !element.closest('[hidden], [inert]');
  }).length);
}

test('empty projects keep one accessible archive chevron in both themes and sizes', async ({ page, request }) => {
  await openProject(page, request, 0);
  const archive = page.getByRole('button', { name: 'Archived sessions', exact: true });
  await expect(page.getByRole('combobox', { name: 'All sessions', exact: true })).toHaveCount(0);
  for (const theme of ['Light', 'Dark']) {
    await page.locator('.more-menu > button').click();
    await page.getByRole('button', { name: theme, exact: true }).click();
    await page.locator('.more-menu > button').click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await archive.focus();
      await archive.press('Enter');
      await expect(page.getByRole('region', { name: 'Project archive', exact: true })).toContainText('No archived sessions');
      await archive.press('Escape');
      await expect(archive).toBeFocused();
      await page.locator('.app-header').screenshot({ path: `/tmp/codeai-empty-project-${theme.toLowerCase()}-${width}.png` });
    }
  }
});

test('title-bar tabs use matching large chevrons without slash separators or idle dots', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProject(page, request, 1);
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  const header = page.locator('.app-header');
  await expect(header.getByRole('tablist', { name: 'Open session views' })).toBeVisible();
  await expect(header.locator('.breadcrumb-separator, .workspace-tab-state')).toHaveCount(0);
  await expect(header.getByRole('combobox')).toHaveCount(0);
  const archive = header.getByRole('button', { name: 'Archived sessions', exact: true });
  await expect(archive).toHaveAttribute('title', 'Archived sessions');
  await expect(archive).toHaveText('');
  for (const icon of await header.locator('.project-search-trigger .shell-icon, .session-archive-menu .shell-icon').all()) {
    expect((await icon.boundingBox())!.width).toBeGreaterThanOrEqual(22);
  }
  await expect(header.getByRole('button', { name: 'New session', exact: true })).toHaveText(/New/);
  const canvas = (await page.locator('.canvas-workspace').boundingBox())!;
  expect(canvas.y).toBe(52);
  expect(canvas.height).toBe(844);
  const count = await visibleControls(page);
  expect(count).toBeLessThanOrEqual(36);
  for (const theme of ['Light', 'Dark']) for (const width of [1440, 390]) {
    await page.locator('.more-menu > button').click();
    await page.getByRole('button', { name: theme, exact: true }).click();
    await page.locator('.more-menu > button').click();
    await page.setViewportSize({ width, height: 900 });
    await expectSelectedInView(page);
    const project = (await page.locator('.project-search-trigger').boundingBox())!;
    const strip = (await page.locator('.workspace-tabs').boundingBox())!;
    expect(project.x + project.width).toBeLessThanOrEqual(strip.x);
    await page.screenshot({ path: `/tmp/codeai-active-tabs-${theme.toLowerCase()}-${width}.png`, animations: 'disabled' });
  }
});

test('all active sessions remain tabs through overflow, view closing, reload and keyboard navigation', async ({ page, request }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  const { sessions } = await openProject(page, request, 8);
  const tabs = page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab');
  await tabs.last().press('ArrowRight');
  await expect(tabs.first()).toBeFocused();
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await expectSelectedInView(page);
  await tabs.first().press('ArrowLeft');
  await expect(tabs.last()).toBeFocused();
  await expectSelectedInView(page);
  await tabs.last().press('Delete');
  await expect(tabs).toHaveCount(8);
  await expectSelectedInView(page);
  await sessionTab(page, sessions[7].id).click();
  await expectSelectedInView(page);
  // View closing retains active tabs and drafts without requiring a second picker to reopen them.
  await page.reload();
  await expect(tabs).toHaveCount(8);
  await expectSelectedInView(page);
  for (const width of [900, 850, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expectSelectedInView(page);
    for (const control of [page.getByRole('button', { name: 'Archived sessions', exact: true }), page.locator('.project-search-trigger')]) {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    // Scroll arrows let pointer users reach every active tab without hiding it in a menu.
    const left = page.getByRole('button', { name: 'Scroll session tabs left', exact: true });
    const right = page.getByRole('button', { name: 'Scroll session tabs right', exact: true });
    if (width >= 600) {
      await expect(left).toBeVisible();
      await expect(right).toBeVisible();
    } else {
      // Phones keep room for the title and archive action; scroll by touch or keyboard.
      await expect(left).toBeHidden();
      await expect(right).toBeHidden();
      expect((await tabs.first().boundingBox())!.width).toBeGreaterThanOrEqual(80);
    }
  }
  await page.setViewportSize({ width: 900, height: 900 });
  await tabs.first().click();
  await expectSelectedInView(page);
  await expect(page.getByRole('button', { name: 'Scroll session tabs left', exact: true })).toHaveAttribute('tabindex', '-1');
  const scroller = page.locator('.workspace-tablist .MuiTabs-scroller');
  const beforeScroll = await scroller.evaluate(node => node.scrollLeft);
  await page.getByRole('button', { name: 'Scroll session tabs right', exact: true }).press('Enter');
  await expect.poll(() => scroller.evaluate(node => node.scrollLeft)).toBeGreaterThan(beforeScroll);
  await sessionTab(page, sessions[0].id).click();
  await expectSelectedInView(page);
  const selected = page.getByRole('tab', { selected: true });
  await selected.press('ArrowRight');
  expect(await selected.evaluate((tab) => {
    const bounds = tab.closest('.MuiTabs-scroller')!.getBoundingClientRect();
    const box = tab.getBoundingClientRect();
    const style = getComputedStyle(tab);
    const extent = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
    return tab.matches(':focus-visible') && style.outlineStyle !== 'none'
      && box.left - extent >= bounds.left && box.right + extent <= bounds.right;
  })).toBe(true);
});

test('session tabs grow into free space and shrink before scrolling', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProject(page, request, 1);
  const tabs = page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab');
  const wide = (await tabs.first().boundingBox())!.width;
  expect(wide).toBeGreaterThanOrEqual(300);
  await openProject(page, request, 6);
  await expect(tabs).toHaveCount(6);
  expect((await tabs.first().boundingBox())!.width).toBeLessThan(wide);
  expect(await page.locator('.workspace-tablist .MuiTabs-scroller').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await expectSelectedInView(page);
});

test('archive selects the visible neighbour even when sibling sessions have never been opened', async ({ page, request }) => {
  await openProject(page, request, 3, false);
  const tabs = page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab');
  const names = await tabs.evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
  const selected = page.getByRole('tab', { selected: true });
  const index = names.indexOf(await selected.getAttribute('aria-label'));
  const neighbour = names[index === names.length - 1 ? index - 1 : index + 1]!;
  await selected.getByRole('button', { name: /^Archive this session:/ }).click();
  await expect(tabs).toHaveCount(2);
  await expect(selected).toHaveAccessibleName(neighbour);
  await expect(selected).toBeFocused();
  await expect(page.getByRole('complementary', { name: 'Conversation' }).locator('textarea')).toBeVisible();
});

test('subscription additions appear as scoped tabs without loading their conversations', async ({ page, request }) => {
  const { project, sessions } = await openProject(page, request, 1);
  const { session: added } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json();
  const { session: loose } = await (await request.post('/api/sessions', { data: { provider: 'claude' } })).json();
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const owner = snapshot.machines.find(machine => machine.sessions.some(item => item.id === added.id))!;
  // A second machine's cached copy must never become a tab in the selected local scope.
  const remote = structuredClone(owner);
  remote.machine.id = '99999999-9999-4999-8999-999999999999';
  remote.machine.kind = 'remote';
  remote.sessions = [{ ...owner.sessions.find(item => item.id === added.id)!, id: '88888888-8888-4888-8888-888888888888' }];
  snapshot.machines.push(remote);
  owner.runs.active.push({ runId: crypto.randomUUID(), sessionId: added.id, participantId: added.primaryAgentId,
    state: 'queued', enqueuedAt: Date.now(), pendingPermissionCount: 0, pendingPermissions: [], status: 'Queued on another device', queuePosition: 2 });
  const reads: string[] = [];
  page.on('request', sent => { if (sent.url().includes(`/sessions/${added.id}`)) reads.push(sent.url()); });
  await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
  await restartArenaSubscription(page);
  await expect(sessionTab(page, added.id)).toHaveCount(1);
  await expect(sessionTab(page, added.id).locator('.queue-badge')).toHaveText('Q2');
  await expect(sessionTab(page, loose.id)).toHaveCount(0);
  await expect(sessionTab(page, remote.sessions[0].id)).toHaveCount(0);
  await expect(sessionTab(page, sessions[0].id)).toHaveAttribute('aria-selected', 'true');
  expect(reads).toEqual([]);
  await sessionTab(page, added.id).click();
  await expect(page.getByRole('complementary', { name: 'Conversation' }).locator('textarea')).toBeVisible();
  await expect(sessionTab(page, added.id)).toHaveAttribute('aria-selected', 'true');
});

test('project archive restores a session directly to the bench with retry and retained draft', async ({ page, request }) => {
  const { project, sessions } = await openProject(page, request, 2);
  const { project: otherProject } = await (await request.post('/api/projects', { data: { name: `Other archive ${Date.now()}` } })).json();
  const { session: other } = await (await request.post('/api/sessions', { data: { projectId: otherProject.id, provider: 'claude' } })).json();
  expect((await request.post(`/api/sessions/${other.id}/archive`, { data: { expectedRevision: other.revision } })).ok()).toBe(true);
  const composer = page.getByRole('complementary', { name: 'Conversation', exact: true }).locator('textarea');
  await composer.fill('Draft survives project archive');
  await page.getByRole('button', { name: `Archive this session: ${sessions[1].title}`, exact: true }).click();
  const archive = page.getByRole('button', { name: 'Archived sessions', exact: true });
  await archive.press('ArrowDown');
  const panel = page.getByRole('region', { name: 'Project archive', exact: true });
  await expect(panel).toContainText(sessions[1].title);
  await expect(panel).not.toContainText(other.title);
  const restore = panel.getByRole('button', { name: `Restore ${sessions[1].title}`, exact: true });
  // The opening refresh may deliver the newly archived row after the initial ArrowDown.
  await archive.press('ArrowDown');
  await expect(restore).toBeFocused();
  await page.route(`**/api/sessions/${sessions[1].id}/restore`, route => route.fulfill({ status: 503, json: { error: 'Restore temporarily unavailable.' } }), { times: 1 });
  await restore.click();
  await expect(page.getByRole('region', { name: 'Notifications', exact: true }).getByRole('alert')).toContainText('Restore temporarily unavailable.');
  await expect(restore).toBeEnabled();
  expect((await request.get(`/api/sessions/${sessions[1].id}`)).status()).toBe(404);
  await restore.click();
  await expect(page).toHaveURL(new RegExp(`\\?session=${sessions[1].id}$`));
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('tab', { selected: true })).toHaveAccessibleName(sessions[1].title);
  await expect(composer).toHaveValue('Draft survives project archive');
  await page.reload();
  await expect(composer).toHaveValue('Draft survives project archive');
  await archive.click();
  await expect(panel).toContainText('No archived sessions');
  await archive.press('Escape');
  await expect(archive).toBeFocused();
  expect((await (await request.get(`/api/sessions/${sessions[1].id}`)).json()).session.projectId).toBe(project.id);
});

for (const theme of ['Light', 'Dark']) for (const width of [1440, 390]) {
  test(`project archive scopes and recovers its list in ${theme} at ${width}px`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const { project, sessions } = await openProject(page, request, 1);
    const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
    const owner = snapshot.machines.find(machine => machine.sessions.some(item => item.id === sessions[0].id))!;
    const base = owner.sessions.find(item => item.id === sessions[0].id)!;
    const archive = (title: string, projectId: string | undefined, archivedAt: string) => ({ ...base,
      id: crypto.randomUUID(), title, projectId, archivedAt, updatedAt: '2026-11-16T12:00:00Z' });
    owner.archivedSessions = [archive('Older project work', project.id, '2026-11-14T12:00:00Z'),
      archive('Loose work', undefined, '2026-11-16T12:00:00Z'),
      archive('Newer project work', project.id, '2026-11-15T12:00:00Z')];
    snapshot.machines.push({ ...owner, machine: { ...owner.machine, id: crypto.randomUUID(), kind: 'remote', label: 'Other machine' },
      sessions: [], archivedSessions: [archive('Other machine work', project.id, '2026-11-16T12:00:00Z')] });
    let unavailable = false;
    await page.route('**/api/arena', route => fulfillArenaSnapshot(route, unavailable
      ? { status: 503, json: { error: 'Archive refresh unavailable.' } } : { json: snapshot }));
    await page.reload();
    await page.locator('.more-menu > button').click();
    await page.getByRole('button', { name: theme, exact: true }).click();
    await page.locator('.more-menu > button').click();
    const trigger = page.getByRole('button', { name: 'Archived sessions', exact: true });
    await trigger.press('ArrowDown');
    const panel = page.getByRole('region', { name: 'Project archive', exact: true });
    await expect(panel.locator('li .MuiListItemText-primary')).toHaveText(['Newer project work', 'Older project work']);
    await expect(panel.getByRole('button', { name: 'Restore Newer project work', exact: true })).toBeFocused();
    expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    const triggerBox = (await trigger.boundingBox())!;
    expect(triggerBox.x + triggerBox.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath('project-archive.png'), animations: 'disabled' });
    await page.locator('.app-header').screenshot({ path: testInfo.outputPath('header.png'), animations: 'disabled' });

    owner.machine.state = 'offline';
    await pushArenaSnapshot(page);
    await expect(panel).toContainText('This machine is offline.');
    for (const restore of await panel.getByRole('button', { name: /^Restore / }).all()) await expect(restore).toBeDisabled();
    unavailable = true;
    await trigger.click();
    await trigger.click();
    await expect(panel.getByRole('alert')).toBeVisible();
    await expect(panel.locator('li')).toHaveCount(2);
    unavailable = false;
    owner.machine.state = 'online';
    await panel.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(panel.getByRole('alert')).toHaveCount(0);
    for (const restore of await panel.getByRole('button', { name: /^Restore / }).all()) await expect(restore).toBeEnabled();
    await page.goto('/?project=none');
    await trigger.click();
    await expect(panel.locator('li .MuiListItemText-primary')).toHaveText(['Loose work']);
  });
}

test('pending project restore is submitted once and respects a newer session and composer focus', async ({ page, request }) => {
  const { sessions } = await openProject(page, request, 3);
  await page.getByRole('button', { name: `Archive this session: ${sessions[2].title}`, exact: true }).click();
  await page.getByRole('button', { name: 'Archived sessions', exact: true }).click();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route(`**/api/sessions/${sessions[2].id}/restore`, async route => {
    requests++;
    await held;
    await route.continue();
  });
  const restore = page.getByRole('button', { name: `Restore ${sessions[2].title}`, exact: true });
  await restore.click();
  await expect(restore).toBeDisabled();
  await expect(restore).toHaveText('Restoring…');
  await page.getByRole('tab', { name: sessions[0].title, exact: true }).click();
  const composer = page.getByRole('complementary', { name: 'Conversation', exact: true }).locator('textarea');
  await composer.fill('Keep typing while restore finishes');
  const response = page.waitForResponse(response => response.url().endsWith(`/api/sessions/${sessions[2].id}/restore`));
  release();
  expect((await response).ok()).toBe(true);
  // Wait for the restore orchestrator's refresh, then allow its focus callback to run.
  await expect(page.getByRole('region', { name: 'Notifications', exact: true }).getByRole('status')).toContainText(`Restored “${sessions[2].title}”.`);
  await expect(sessionTab(page, sessions[2].id)).toHaveCount(1);
  await expect(page).toHaveURL(new RegExp(`\\?session=${sessions[0].id}$`));
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue('Keep typing while restore finishes');
  expect(requests).toBe(1);
});

test('archiving a background tab keeps the current session, Git status and keyboard focus', async ({ page, request }) => {
  await page.route('**/api/repository/status?**', route => route.fulfill({ json: { tree: {
    isRepository: true, branch: 'main', files: [{ path: 'README.md', status: 'modified', staged: false, unstaged: true }],
  } } }));
  const { sessions } = await openProject(page, request, 3);
  const selected = page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { selected: true });
  await expect(selected).toHaveAccessibleName(sessions[2].title);
  const changes = page.getByRole('button', { name: 'Repository, 1 file', exact: true });
  await expect(changes).toBeVisible();
  await page.getByRole('button', { name: `Archive this session: ${sessions[0].title}`, exact: true }).click();
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab')).toHaveCount(2);
  await expect(selected).toHaveAccessibleName(sessions[2].title);
  await expect(selected).toBeFocused();
  await expect(changes).toBeVisible();
  await expect(sessionTab(page, sessions[0].id)).toHaveCount(0);
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  expect(snapshot.machines.flatMap(machine => machine.archivedSessions).some(session => session.id === sessions[0].id)).toBe(true);
  // Tab reaches the selected tab's native archive button; Enter archives exactly once.
  await selected.press('Tab');
  const close = selected.getByRole('button', { name: /^Archive this session:/ });
  await expect(close).toBeFocused();
  await close.press('Enter');
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab')).toHaveCount(1);
  await expect(selected).toHaveAccessibleName(sessions[1].title);
  await expect(selected).toBeFocused();
});

test('title-bar tabs preserve stored layouts and protect approval-blocked views', async ({ page, request }) => {
  const { sessions } = await openProject(page, request, 2);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await conversation.locator('textarea').fill('Remember this draft');
  await page.reload();
  await expect(page.locator('.canvas-workspace')).toBeHidden();
  await expect(conversation.locator('textarea')).toHaveValue('Remember this draft');
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { selected: true })).toHaveAccessibleName(sessions[1].title);
  await conversation.getByLabel(/^Mode: /).click();
  await page.getByRole('radio', { name: 'Agent', exact: true }).click();
  await conversation.locator('textarea').fill('Request an edit approval');
  await conversation.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(conversation.getByRole('region', { name: 'Pending approvals' })).toContainText('Claude · Edit');
  const selected = page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { selected: true });
  await expect(selected).toHaveClass(/awaiting-approval/);
  await expect(selected.locator('.approval-badge')).toHaveText('1');
  await expectSelectedInView(page);
  await expect(selected.getByRole('button', { name: /^Archive this session:/ })).toBeDisabled();
  await expect(conversation.locator(':scope > header').getByRole('button', { name: 'Archive session', exact: true })).toBeDisabled();
  await selected.press('Delete');
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab')).toHaveCount(2);
  await sessionTab(page, sessions[0].id).click();
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { selected: true }).getByRole('button', { name: /^Archive this session:/ })).toBeEnabled();
  // The live background tab remains protected too.
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { selected: false }).getByRole('button', { name: /^Archive this session:/ })).toBeDisabled();
  await sessionTab(page, sessions[1].id).click();
  await conversation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(selected.getByRole('button', { name: /^Archive this session:/ })).toBeEnabled();
});

test('Delete preserves drafts and tab archive shares failure, pending and Undo handling with the header', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { sessions } = await openProject(page, request, 2);
  let archiveRequests = 0;
  page.on('request', (sent) => { if (sent.method() === 'POST' && sent.url().endsWith('/archive')) archiveRequests++; });
  page.on('dialog', (dialog) => { throw new Error(`Unexpected confirmation: ${dialog.message()}`); });
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await conversation.locator('textarea').fill('Keep my draft when I close this tab');
  await page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { selected: true }).press('Delete');
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab')).toHaveCount(2);
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { selected: true })).toBeFocused();
  expect(archiveRequests).toBe(0);
  await sessionTab(page, sessions[1].id).click();
  await expect(conversation.locator('textarea')).toHaveValue('Keep my draft when I close this tab');
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab')).toHaveCount(2);

  await finishReply(page);
  const archive = conversation.locator(':scope > header').getByRole('button', { name: 'Archive session', exact: true });
  await expect(archive).toHaveCount(1);
  await page.reload();
  await expect(archive).toHaveCount(1);
  for (const theme of ['Light', 'Dark']) {
    await page.locator('.more-menu > button').click();
    await page.getByRole('button', { name: theme, exact: true }).click();
    await page.locator('.more-menu > button').click();
    await archive.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/codeai-story112-desktop-${theme.toLowerCase()}.png` });
  }
  // A failed archive retains the conversation and permits an explicit retry.
  const tabArchive = page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { selected: true }).getByRole('button', { name: /^Archive this session:/ });
  await conversation.locator('textarea').fill('Keep this draft through archive and Undo');
  await page.route(`**/api/sessions/${sessions[1].id}/archive`, route => route.fulfill({ status: 500, json: { error: 'Archive temporarily unavailable.' } }), { times: 1 });
  await tabArchive.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Archive temporarily unavailable.' })).toBeVisible();
  await expect(archive).toBeEnabled();
  await expect(tabArchive).toBeEnabled();
  await expect(tabArchive).toBeFocused();
  await expect(conversation.locator('textarea')).toHaveValue('Keep this draft through archive and Undo');
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab')).toHaveCount(2);

  // Hold the archive to verify both actions guard duplicate/competing requests.
  let releaseArchive!: () => void;
  const archiveGate = new Promise<void>((resolve) => { releaseArchive = resolve; });
  await page.route(`**/api/sessions/${sessions[1].id}/archive`, async (route) => {
    await archiveGate;
    await route.continue();
  });
  const archivedTitle = await page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { selected: true }).locator('.workspace-tab-title').innerText();
  await tabArchive.click();
  await expect(archive).toBeDisabled();
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { selected: true }).getByRole('button', { name: /^Archive this session:/ })).toBeDisabled();
  releaseArchive();
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab')).toHaveCount(1);
  await expect(sessionTab(page, sessions[1].id)).toHaveCount(0);
  const toast = page.getByRole('status').filter({ hasText: `Archived “${archivedTitle}”` });
  await expect(toast).toBeVisible();
  expect(archiveRequests).toBe(2);
  await toast.getByRole('button', { name: 'Undo archive' }).click();
  await expect(sessionTab(page, sessions[1].id)).toHaveCount(1);
  await sessionTab(page, sessions[1].id).click();
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab')).toHaveCount(2);
  await expect(conversation.locator('textarea')).toHaveValue('Keep this draft through archive and Undo');
  await expect(conversation.locator('.chat-message.assistant.complete')).toBeVisible();
});

test('phone tab archive persists after reload and header session actions fit in both themes', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { sessions } = await openProject(page, request, 1);
  await page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { selected: true }).press('Delete');
  await expect(page.getByRole('complementary', { name: 'Files', exact: true })).toBeVisible();
  await expect(sessionTab(page, sessions[0].id)).toBeFocused();
  await page.reload();
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab')).toHaveCount(1);
  await sessionTab(page, sessions[0].id).click();
  await expect(page.getByRole('complementary', { name: 'Conversation' }).locator(':scope > header')
    .getByRole('button', { name: 'Archive session', exact: true })).toBeEnabled();
  const conversation = await finishReply(page);
  const header = conversation.locator(':scope > header');
  const archive = header.getByRole('button', { name: 'Archive session', exact: true });
  const newChat = header.getByRole('button', { name: 'New chat', exact: true });
  await expect(conversation.locator('.message-actions').getByRole('button', { name: 'Archive session', exact: true })).toHaveCount(0);
  for (const theme of ['Light', 'Dark']) {
    await page.locator('.more-menu > button').click();
    await page.getByRole('button', { name: theme, exact: true }).click();
    await page.locator('.more-menu > button').click();
    await expectSelectedInView(page);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const action of [newChat, archive]) {
        await expect(action).toBeInViewport();
        const box = (await action.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(40);
        expect(box.height).toBeGreaterThanOrEqual(40);
        expect(box.x + box.width).toBeLessThanOrEqual(width - 8);
        expect(await action.evaluate(element => getComputedStyle(element).borderWidth)).toBe('0px');
      }
      const start = (await newChat.boundingBox())!;
      const end = (await archive.boundingBox())!;
      expect(end.x - start.x - start.width).toBeGreaterThanOrEqual(4);
      expect(await header.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: `/tmp/codeai-header-actions-phone-${theme.toLowerCase()}-${width}.png` });
    }
  }
  await page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { selected: true }).getByRole('button', { name: /^Archive this session:/ }).click();
  await expect(page.getByRole('button', { name: 'Undo archive' })).toBeVisible();
  await expect(sessionTab(page, sessions[0].id)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Archived sessions', exact: true })).toBeEnabled();
  await expect(page.getByRole('region', { name: 'New session', exact: true })
    .getByRole('textbox', { name: 'First message (optional)', exact: true })).toBeFocused();
  await page.reload();
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab')).toHaveCount(0);
  await expect(sessionTab(page, sessions[0].id)).toHaveCount(0);
});

test('overlapping tab archives keep separate pending guards and respect a newer selection', async ({ page, request }) => {
  const { sessions } = await openProject(page, request, 3);
  const archiveRequests: string[] = [];
  const releases = new Map<string, () => void>();
  for (const session of [sessions[2], sessions[0]]) {
    const gate = new Promise<void>(resolve => { releases.set(session.id, resolve); });
    await page.route(`**/api/sessions/${session.id}/archive`, async route => {
      archiveRequests.push(session.id);
      await gate;
      await route.continue();
    });
  }
  const archiveFirst = page.getByRole('button', { name: `Archive this session: ${sessions[0].title}`, exact: true });
  const archiveLast = page.getByRole('button', { name: `Archive this session: ${sessions[2].title}`, exact: true });
  await archiveLast.click();
  await expect(archiveLast).toBeDisabled();
  await sessionTab(page, sessions[1].id).click();
  await archiveFirst.click();
  await expect(archiveFirst).toBeDisabled();
  releases.get(sessions[2].id)!();
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab')).toHaveCount(2);
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { selected: true })).toHaveAccessibleName(sessions[1].title);
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { selected: true })).toBeFocused();
  await expect(archiveFirst).toBeDisabled();
  await page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { name: sessions[0].title, exact: true }).press('Delete');
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab')).toHaveCount(2);
  releases.get(sessions[0].id)!();
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab')).toHaveCount(1);
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { selected: true })).toHaveAccessibleName(sessions[1].title);
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { selected: true })).toBeFocused();
  expect(archiveRequests).toEqual([sessions[2].id, sessions[0].id]);
  for (const session of [sessions[0], sessions[2]]) {
    await expect(sessionTab(page, session.id)).toHaveCount(0);
  }
});

test('a delayed tab archive preserves focus in another session composer', async ({ page, request }) => {
  const { sessions } = await openProject(page, request, 2);
  let releaseArchive!: () => void;
  const gate = new Promise<void>(resolve => { releaseArchive = resolve; });
  await page.route(`**/api/sessions/${sessions[1].id}/archive`, async route => {
    await gate;
    await route.continue();
  });
  const archive = page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { selected: true }).getByRole('button', { name: /^Archive this session:/ });
  await archive.click();
  await expect(archive).toBeDisabled();
  await sessionTab(page, sessions[0].id).click();
  const input = page.getByRole('complementary', { name: 'Conversation' }).locator('textarea');
  await input.fill('Keep typing');
  const refreshed = page.waitForResponse(response => response.url().endsWith('/api/arena')
    && !response.request().headers().accept?.includes('application/x-ndjson'));
  releaseArchive();
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab')).toHaveCount(1);
  await expect(page.getByRole('status').filter({ hasText: `Archived “${sessions[1].title}”` })).toBeVisible();
  await (await refreshed).finished();
  // Archive completes after its Arena refresh; let its scheduled focus update run before typing.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(input).toBeFocused();
  await page.keyboard.type(' after archive');
  await expect(input).toHaveValue('Keep typing after archive');
});

test('tab and header archive guards use machine-reported turns, offline state and the latest revision', async ({ page, request }) => {
  const { sessions } = await openProject(page, request, 1);
  await finishReply(page);
  const session = sessions[0];
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const owner = snapshot.machines.find((machine) => machine.sessions.some((item) => item.id === session.id))!;
  owner.machine.state = 'offline';
  let observation = 'offline';
  await page.route('**/api/arena', (route) => fulfillArenaSnapshot(route, { json: snapshot, headers: { 'x-header-state': observation } }));
  await restartArenaSubscription(page);
  const archive = page.getByRole('complementary', { name: 'Conversation' }).getByRole('button', { name: 'Archive session', exact: true });
  const tabArchive = page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { selected: true }).getByRole('button', { name: /^Archive this session:/ });
  await expect(archive).toBeDisabled();
  await expect(tabArchive).toBeDisabled();
  await expect(tabArchive).toHaveAttribute('title', 'This execution machine is offline.');

  owner.machine.state = 'online';
  owner.runs.active.push({ runId: 'another-device-run', sessionId: session.id, participantId: session.primaryAgentId,
    state: 'queued', enqueuedAt: Date.now(), pendingPermissionCount: 0, pendingPermissions: [], status: 'Queued on another device' });
  observation = 'queued';
  await pushArenaSnapshot(page);
  await expect(archive).toBeDisabled();
  await expect(tabArchive).toBeDisabled();
  await page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { selected: true }).press('Delete');
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab')).toHaveCount(1);

  // Another device saved this revision; the open transcript still holds the original one.
  const filename = path.resolve('test-results/server-data/session-store-v2/sessions', `${session.id}.json`);
  const stored = JSON.parse(await readFile(filename, 'utf8')) as DurableSession;
  stored.revision += 2;
  await writeFile(filename, JSON.stringify(stored));
  owner.sessions.find((item) => item.id === session.id)!.revision = stored.revision;
  owner.runs.active = [];
  observation = 'ready';
  await pushArenaSnapshot(page);
  await expect(archive).toBeEnabled();
  await page.route(`**/api/sessions/${session.id}/archive`, async (route) => {
    expect(route.request().postDataJSON()).toEqual({ expectedRevision: stored.revision });
    await route.continue();
  });
  await tabArchive.click();
  await expect(page.getByRole('button', { name: 'Undo archive' })).toBeVisible();
});

test.afterEach(async ({ request }) => {
  const { active } = await (await request.get('/api/agent/runs')).json();
  for (const run of active) await request.post('/api/agent/cancel', { data: { runId: run.runId } });
});
