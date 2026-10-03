import { expect, test } from '@playwright/test';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CheckoutsResponse, DurableSession, PublicSession } from '../src/shared/types';

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
  // The old name allows setup and budget measurement against the pre-story build too.
  const picker = page.getByRole('combobox', { name: /^(All sessions|Session)$/ });
  while (await page.locator('.workspace-tab-close').count()) await page.locator('.workspace-tab-close').click();
  for (const session of sessions) await picker.selectOption(session.id);
  await expect(page.getByRole('tab', { selected: true })).toHaveAccessibleName(sessions.at(-1)!.title);
  return { project, sessions };
}

async function expectSelectedInView(page: Page) {
  await expect.poll(async () => {
    const list = (await page.getByRole('tablist', { name: 'Open session views' }).boundingBox())!;
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

async function expectSessionChevronVisible(picker: Locator) {
  const visible = await picker.screenshot({ animations: 'disabled' });
  const glyph = picker.locator('span');
  await glyph.evaluate((element) => { element.style.visibility = 'hidden'; });
  try {
    const hidden = await picker.screenshot({ animations: 'disabled' });
    expect(visible.equals(hidden), 'The All sessions chevron must change the rendered pixels').toBe(false);
  } finally {
    await glyph.evaluate((element) => { element.style.removeProperty('visibility'); });
  }
}

test('title-bar tabs return the separate row to the canvas in both themes', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openProject(page, request, 1);
  // Record the same fixture on the pre-change build before asserting the new frame.
  console.log(`Title-bar fixture visible controls: ${await visibleControls(page)}`);
  const header = page.locator('.app-header');
  await expect(header.getByRole('tablist', { name: 'Open session views' })).toBeVisible();
  await expect(header.getByRole('combobox', { name: 'All sessions', exact: true })).toHaveAttribute('title', 'All sessions');
  await expect(header.getByRole('combobox', { name: 'Session', exact: true })).toHaveCount(0);
  const picker = header.locator('.all-sessions-picker');
  await picker.hover();
  await expectSessionChevronVisible(picker);
  await page.mouse.move(0, 100);
  await picker.locator('select').focus();
  await picker.locator('select').press('ArrowDown');
  await expectSessionChevronVisible(picker);
  const canvas = (await page.locator('.canvas-workspace').boundingBox())!;
  expect(canvas.y).toBe(48);
  expect(canvas.height).toBe(852);
  const count = await visibleControls(page);
  expect(count).toBeLessThanOrEqual(27); // Same one-session fixture measured on the pre-story build.
  await page.locator('.more-menu summary').click();
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await page.locator('.more-menu summary').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await picker.hover();
  await expectSessionChevronVisible(picker);
  await page.mouse.move(0, 100);
  await picker.locator('select').focus();
  await picker.locator('select').press('ArrowDown');
  await expectSessionChevronVisible(picker);
  expect(await visibleControls(page)).toBe(count);
  await expectSelectedInView(page);
  await page.screenshot({ path: '/tmp/codeai-story73-dark.png' });
  await page.locator('.more-menu summary').click();
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await page.locator('.more-menu summary').click();
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

  // The close button applies the same neighbour focus as Delete, including overflow.
  await page.getByRole('button', { name: `Close ${sessions[7].title} view`, exact: true }).click();
  await expect(tabs).toHaveCount(7);
  await expect(tabs.last()).toBeFocused();
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
    const bounds = tab.parentElement!.getBoundingClientRect();
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
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await page.reload();
  await expect(page.locator('.canvas-workspace')).toBeHidden();
  await expect(conversation.locator('textarea')).toHaveValue('Remember this draft');
  await expect(page.getByRole('tab', { selected: true })).toHaveAccessibleName(sessions[1].title);
  await conversation.getByLabel(/^Mode: /).click();
  await conversation.getByRole('radio', { name: 'Agent', exact: true }).click();
  await conversation.locator('textarea').fill('Request an edit approval');
  await conversation.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(conversation.getByRole('article', { name: 'Approval required: Edit' })).toBeVisible();
  const selected = page.getByRole('tab', { selected: true });
  await expect(selected).toHaveClass(/awaiting-approval/);
  await expect(selected.locator('.approval-badge')).toHaveText('1');
  await expectSelectedInView(page);
  await expect(page.locator('.workspace-tab-close')).toBeDisabled();
  await selected.press('Delete');
  await expect(page.getByRole('tab')).toHaveCount(2);
  await picker.selectOption(sessions[0].id);
  await expect(page.locator('.workspace-tab-close')).toBeEnabled();
  await picker.selectOption(sessions[1].id);
  await conversation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.workspace-tab-close')).toBeEnabled();
});

test.afterEach(async ({ request }) => {
  const { active } = await (await request.get('/api/agent/runs')).json();
  for (const run of active) await request.post('/api/agent/cancel', { data: { runId: run.runId } });
});
