import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ArenaSnapshot, CheckoutsResponse, DurableSession, PublicSession } from '../src/shared/types';

async function openProject(page: Page, request: APIRequestContext, count = 3) {
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
  const picker = page.getByRole('combobox', { name: 'All sessions', exact: true });
  while (await page.getByRole('tab').count()) await page.getByRole('tab', { selected: true }).press('Delete');
  for (const session of sessions) await picker.selectOption(session.id);
  if (sessions.length) await expect(page.getByRole('tab', { selected: true })).toHaveAccessibleName(sessions.at(-1)!.title);
  return { project, sessions };
}

async function expectSelectedInView(page: Page) {
  await expect.poll(async () => {
    const list = (await page.locator('.workspace-tablist .MuiTabs-scroller').boundingBox())!;
    const tab = (await page.getByRole('tab', { selected: true }).boundingBox())!;
    return tab.x >= list.x - 1 && tab.x + tab.width <= list.x + list.width + 1;
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

test('empty-project session picker does not paint its placeholder over All sessions', async ({ page, request }) => {
  await openProject(page, request, 0);
  const picker = page.getByRole('combobox', { name: 'All sessions', exact: true });
  const control = page.locator('.all-sessions-picker');
  await expect(picker).toBeDisabled();
  await expect(picker.locator('option:checked')).toHaveText('No sessions yet');

  for (const theme of ['Light', 'Dark']) {
    await page.locator('.more-menu > button').click();
    await page.getByRole('button', { name: theme, exact: true }).click();
    await page.locator('.more-menu > button').click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await control.hover();
      const withPlaceholder = await control.screenshot({ animations: 'disabled' });
      await picker.locator('option:checked').evaluate((option) => { option.textContent = ''; });
      const withoutPlaceholder = await control.screenshot({ animations: 'disabled' });
      await picker.locator('option:checked').evaluate((option) => { option.textContent = 'No sessions yet'; });
      expect(withPlaceholder.equals(withoutPlaceholder), `${theme} at ${width}px: native placeholder must be invisible`).toBe(true);
      await page.locator('.app-header').screenshot({ path: `/tmp/codeai-empty-project-${theme.toLowerCase()}-${width}.png` });
    }
  }
});

test('title-bar tabs return the separate row to the canvas in both themes', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProject(page, request, 1);
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await expect(page.locator('.canvas-workspace')).toBeVisible();
  const header = page.locator('.app-header');
  await expect(header.getByRole('tablist', { name: 'Open session views' })).toBeVisible();
  await expect(header.getByRole('combobox', { name: 'All sessions', exact: true })).toHaveAttribute('title', 'All sessions');
  await expect(header.getByRole('combobox', { name: 'Session', exact: true })).toHaveCount(0);
  const picker = header.locator('.all-sessions-picker');
  await picker.hover();
  await expect(picker).toHaveText(/All sessions/);
  await expect(header.getByRole('button', { name: 'Archive session', exact: true })).toHaveText('Archive');
  await expect(header.getByRole('button', { name: 'New session', exact: true })).toHaveText(/New/);
  await page.mouse.move(0, 100);
  await picker.locator('select').focus();
  await picker.locator('select').press('ArrowDown');
  await expect(picker.locator('.all-sessions-label')).toBeVisible();
  const canvas = (await page.locator('.canvas-workspace').boundingBox())!;
  expect(canvas.y).toBe(48);
  expect(canvas.height).toBe(852);
  const count = await visibleControls(page);
  expect(count).toBeLessThanOrEqual(28); // One visible finish action added to the title bar.
  await page.locator('.more-menu > button').click();
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await page.locator('.more-menu > button').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await picker.hover();
  await expect(picker.locator('.all-sessions-label')).toBeVisible();
  await page.mouse.move(0, 100);
  await picker.locator('select').focus();
  await picker.locator('select').press('ArrowDown');
  await expect(picker.locator('.all-sessions-label')).toBeVisible();
  expect(await visibleControls(page)).toBe(count);
  await expectSelectedInView(page);
  await page.screenshot({ path: '/tmp/codeai-story73-dark.png' });
  await page.locator('.more-menu > button').click();
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await page.locator('.more-menu > button').click();
  await page.screenshot({ path: '/tmp/codeai-story73-light.png' });
});

test('title-bar tabs keep overflow selection visible, wrap arrows and reopen closed views', async ({ page, request }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  const { sessions } = await openProject(page, request, 8);
  const tabs = page.getByRole('tab');
  const picker = page.getByRole('combobox', { name: 'All sessions', exact: true });
  await expect(picker).toHaveCount(1);
  await expectSelectedInView(page);
  await tabs.last().press('ArrowRight');
  await expect(tabs.first()).toBeFocused();
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await expectSelectedInView(page);
  await tabs.first().press('ArrowLeft');
  await expect(tabs.last()).toBeFocused();
  await expectSelectedInView(page);
  await tabs.last().press('Delete');
  await expect(tabs).toHaveCount(7);
  await expect(tabs.last()).toBeFocused();
  await expectSelectedInView(page);
  await picker.selectOption(sessions[7].id);
  await expect(tabs).toHaveCount(8);
  await expectSelectedInView(page);
  // Native keyboard selection also opens an overflow view and updates the selected tab.
  const finalOption = await picker.locator('option').last().getAttribute('value');
  await picker.focus();
  await picker.press('End');
  await expect(picker).toHaveValue(finalOption!);
  await expectSelectedInView(page);
  await picker.selectOption(sessions[7].id);

  // Close tab applies the same neighbour focus as Delete, including overflow.
  await page.getByRole('button', { name: 'Session actions', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Close tab/ }).click();
  await expect(tabs).toHaveCount(7);
  await expect(tabs.last()).toBeFocused();
  await expectSelectedInView(page);
  await page.setViewportSize({ width: 900, height: 900 });
  await expectSelectedInView(page);
  await page.setViewportSize({ width: 850, height: 900 });
  await expectSelectedInView(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectSelectedInView(page);
  for (const control of [picker, page.locator('.project-search-trigger'), page.getByRole('group', { name: 'Layout' })]) {
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  await picker.selectOption(sessions[0].id);
  await expectSelectedInView(page);
  await page.getByRole('tab', { selected: true }).press('ArrowRight');
  expect(await page.getByRole('tab', { selected: true }).evaluate((tab) => {
    const bounds = tab.closest('.MuiTabs-scroller')!.getBoundingClientRect();
    const box = tab.getBoundingClientRect();
    const style = getComputedStyle(tab);
    const width = parseFloat(style.outlineWidth);
    const extent = width + parseFloat(style.outlineOffset);
    return tab.matches(':focus-visible') && style.outlineStyle !== 'none' && width > 0
      && box.left - extent >= bounds.left && box.right + extent <= bounds.right
      && box.top - extent >= bounds.top && box.bottom + extent <= bounds.bottom;
  })).toBe(true);
  await page.screenshot({ path: '/tmp/codeai-story73-phone.png' });
  while (await tabs.count()) await page.getByRole('tab', { selected: true }).press('Delete');
  await expect(picker).toBeFocused();
  await expect(picker).toHaveValue('');
  await expect(page.getByRole('heading', { name: 'No open sessions' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'No open sessions' })).toBeVisible();
  await expect(tabs).toHaveCount(0);
  await picker.selectOption(sessions[0].id);
  await expect(tabs).toHaveCount(1);
  await expectSelectedInView(page);
});

test('title-bar tabs preserve stored layouts and protect approval-blocked views', async ({ page, request }) => {
  const { sessions } = await openProject(page, request, 2);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  const picker = page.getByRole('combobox', { name: 'All sessions', exact: true });
  await expect(picker).toHaveCount(1);
  await conversation.locator('textarea').fill('Remember this draft');
  await page.reload();
  await expect(page.locator('.canvas-workspace')).toBeHidden();
  await expect(conversation.locator('textarea')).toHaveValue('Remember this draft');
  await expect(page.getByRole('tab', { selected: true })).toHaveAccessibleName(sessions[1].title);
  await conversation.getByLabel(/^Mode: /).click();
  await page.getByRole('radio', { name: 'Agent', exact: true }).click();
  await conversation.locator('textarea').fill('Request an edit approval');
  await conversation.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(conversation.getByRole('region', { name: 'Pending approvals' })).toContainText('Claude · Edit');
  const selected = page.getByRole('tab', { selected: true });
  await expect(selected).toHaveClass(/awaiting-approval/);
  await expect(selected.locator('.approval-badge')).toHaveText('1');
  await expectSelectedInView(page);
  await expect(page.getByRole('button', { name: 'Archive session', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Session actions', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /^Close tab/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Session actions', exact: true })).toBeFocused();
  await selected.press('Delete');
  await expect(page.getByRole('tab')).toHaveCount(2);
  await picker.selectOption(sessions[0].id);
  await expect(page.getByRole('button', { name: 'Archive session', exact: true })).toBeEnabled();
  await picker.selectOption(sessions[1].id);
  await conversation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Archive session', exact: true })).toBeEnabled();
});

test('header actions close a tab without archiving and archive completed sessions with Undo', async ({ page, request }) => {
  const { sessions } = await openProject(page, request, 2);
  const picker = page.getByRole('combobox', { name: 'All sessions', exact: true });
  let archiveRequests = 0;
  page.on('request', (sent) => { if (sent.method() === 'POST' && sent.url().endsWith('/archive')) archiveRequests++; });
  page.on('dialog', (dialog) => { throw new Error(`Unexpected confirmation: ${dialog.message()}`); });
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await conversation.locator('textarea').fill('Keep my draft when I close this tab');
  await page.getByRole('button', { name: 'Session actions', exact: true }).click();
  await expect(page.getByRole('menu')).toContainText('Keep this session in All sessions.');
  await page.getByRole('menuitem', { name: /^Close tab/ }).click();
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(page.getByRole('tab', { selected: true })).toBeFocused();
  expect(archiveRequests).toBe(0);
  await picker.selectOption(sessions[1].id);
  await expect(conversation.locator('textarea')).toHaveValue('Keep my draft when I close this tab');
  await expect(page.getByRole('tab')).toHaveCount(2);

  // Hold the archive to verify both header actions guard duplicate/competing requests.
  let releaseArchive!: () => void;
  const archiveGate = new Promise<void>((resolve) => { releaseArchive = resolve; });
  await page.route(`**/api/sessions/${sessions[1].id}/archive`, async (route) => {
    await archiveGate;
    await route.continue();
  });
  const archive = page.getByRole('button', { name: 'Archive session', exact: true });
  await archive.click();
  await expect(archive).toBeDisabled();
  await page.getByRole('button', { name: 'Session actions', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: /^Close tab/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  releaseArchive();
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(picker.locator(`option[value="${sessions[1].id}"]`)).toHaveCount(0);
  const toast = page.getByRole('status').filter({ hasText: `Archived “${sessions[1].title}”` });
  await expect(toast).toBeVisible();
  expect(archiveRequests).toBe(1);
  await toast.getByRole('button', { name: 'Undo archive' }).click();
  await expect(picker.locator(`option[value="${sessions[1].id}"]`)).toHaveCount(1);
  await picker.selectOption(sessions[1].id);
  await expect(page.getByRole('tab')).toHaveCount(2);
});

test('phone session actions offer archive and close the last tab with a clear empty state', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { sessions } = await openProject(page, request, 1);
  const picker = page.getByRole('combobox', { name: 'All sessions', exact: true });
  const actions = page.getByRole('button', { name: 'Session actions', exact: true });
  await actions.click();
  await expect(page.getByRole('menuitem', { name: /^Archive session/ })).toBeVisible();
  await page.getByRole('menuitem', { name: /^Close tab/ }).click();
  await expect(page.getByRole('heading', { name: 'No open sessions' })).toBeVisible();
  await expect(picker).toBeFocused();
  await picker.selectOption(sessions[0].id);
  await actions.click();
  await page.getByRole('menuitem', { name: /^Archive session/ }).click();
  await expect(page.getByRole('button', { name: 'Undo archive' })).toBeVisible();
  await expect(picker.locator(`option[value="${sessions[0].id}"]`)).toHaveCount(0);
});

test('header guards use machine-reported turns, offline state and the latest revision', async ({ page, request }) => {
  const { sessions } = await openProject(page, request, 1);
  const session = sessions[0];
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const owner = snapshot.machines.find((machine) => machine.sessions.some((item) => item.id === session.id))!;
  owner.machine.state = 'offline';
  let observation = 'offline';
  await page.route('**/api/arena', (route) => route.fulfill({ json: snapshot, headers: { 'x-header-state': observation } }));
  await page.waitForResponse((response) => response.headers()['x-header-state'] === 'offline');
  const archive = page.locator('.app-header').getByRole('button', { name: 'Archive session', exact: true });
  const actions = page.getByRole('button', { name: 'Session actions', exact: true });
  await expect(archive).toBeDisabled();
  await actions.click();
  await expect(page.getByRole('menuitem', { name: /^Close tab/ })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(actions).toBeFocused();

  owner.machine.state = 'online';
  owner.runs.active.push({ runId: 'another-device-run', sessionId: session.id, participantId: session.primaryAgentId,
    state: 'queued', enqueuedAt: Date.now(), pendingPermissionCount: 0, pendingPermissions: [], status: 'Queued on another device' });
  observation = 'queued';
  await page.waitForResponse((response) => response.headers()['x-header-state'] === 'queued');
  await expect(archive).toBeDisabled();
  await actions.click();
  await expect(page.getByRole('menuitem', { name: /^Close tab/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { selected: true }).press('Delete');
  await expect(page.getByRole('tab')).toHaveCount(1);

  // Another device saved this revision; the open transcript still holds the original one.
  const filename = path.resolve('test-results/server-data/session-store-v2/sessions', `${session.id}.json`);
  const stored = JSON.parse(await readFile(filename, 'utf8')) as DurableSession;
  stored.revision += 2;
  await writeFile(filename, JSON.stringify(stored));
  owner.sessions.find((item) => item.id === session.id)!.revision = stored.revision;
  owner.runs.active = [];
  observation = 'ready';
  await page.waitForResponse((response) => response.headers()['x-header-state'] === 'ready');
  await expect(archive).toBeEnabled();
  await page.route(`**/api/sessions/${session.id}/archive`, async (route) => {
    expect(route.request().postDataJSON()).toEqual({ expectedRevision: stored.revision });
    await route.continue();
  });
  await archive.click();
  await expect(page.getByRole('button', { name: 'Undo archive' })).toBeVisible();
});

test.afterEach(async ({ request }) => {
  const { active } = await (await request.get('/api/agent/runs')).json();
  for (const run of active) await request.post('/api/agent/cancel', { data: { runId: run.runId } });
});
