import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { CheckoutsResponse, PublicSession } from '../src/shared/types';

async function openWorkspace(page: Page, request: APIRequestContext, self = false) {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const { project } = await (await request.post('/api/projects', { data: {
    name: `Room for modules ${Date.now()}`, checkoutIds: [checkouts.find(item => item.name === (self ? 'installation' : 'alpha'))!.id],
  } })).json();
  const { session } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json() as { session: PublicSession };
  await page.goto('/');
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(project.name) }).click();
  await page.getByRole('combobox', { name: 'All sessions', exact: true }).selectOption(session.id);
  await expect(page.getByRole('textbox', { name: 'Instruction', exact: true })).toBeVisible();
  return session;
}

const views = (page: Page) => page.getByRole('navigation', { name: 'Views', exact: true });
const conversation = (page: Page) => page.locator('.conversation-drawer');
const canvas = (page: Page) => page.locator('.canvas-workspace');
const side = (page: Page) => page.locator('.repository-sidebar');
const layouts = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('code-ai:device:v1:view-panel-layouts')!).layouts);

for (const theme of ['light', 'dark']) {
  test(`desktop maximizes each pane and restores the saved arrangement: ${theme}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    const session = await openWorkspace(page, request);
    const input = page.getByRole('textbox', { name: 'Instruction', exact: true });
    await input.fill('Preserve my draft');
    await page.getByRole('button', { name: 'Canvas', exact: true }).click();
    await views(page).getByRole('button', { name: /^Repository/ }).click();
    const before = (await layouts(page))[session.id];
    const boxes = await Promise.all([canvas(page).boundingBox(), conversation(page).boundingBox(), side(page).boundingBox()]);
    for (const [label, pane] of [['Conversation', conversation(page)], ['Canvas', canvas(page)], ['Repository', side(page)]] as const) {
      await pane.getByRole('button', { name: `Maximize ${label}`, exact: true }).click();
      await expect(pane).toBeVisible();
      const box = (await pane.boundingBox())!;
      expect(box.width).toBe(1388);
      for (const other of [canvas(page), conversation(page), side(page)]) {
        if (await other.getAttribute('class') !== await pane.getAttribute('class')) await expect(other).toBeHidden();
      }
      // Maximize survives reload and restores the exact underlying flags and dimensions.
      await page.reload();
      await expect(pane.getByRole('button', { name: 'Restore layout', exact: true })).toBeVisible();
      await pane.getByRole('button', { name: 'Restore layout', exact: true }).click();
      await expect.poll(async () => (await layouts(page))[session.id]).toEqual(before);
      expect(await Promise.all([canvas(page).boundingBox(), conversation(page).boundingBox(), side(page).boundingBox()])).toEqual(boxes);
    }
    await expect(input).toHaveValue('Preserve my draft');
    await page.getByRole('button', { name: 'New session', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'New session', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await conversation(page).getByRole('button', { name: 'Maximize Conversation', exact: true }).click();
    await expect(conversation(page).getByRole('button', { name: 'Restore layout', exact: true })).toBeVisible();
    await input.press('Escape');
    await expect(page.locator('.app-shell')).not.toHaveClass(/pane-maximized/);
    await conversation(page).getByRole('button', { name: 'Maximize Conversation', exact: true }).click();
    await page.locator('.app-header').getByRole('button', { name: 'Conversation', exact: true }).click();
    await expect(page.locator('.app-shell')).not.toHaveClass(/pane-maximized/);
    await expect(conversation(page)).toBeHidden();
    await page.locator('.app-header').getByRole('button', { name: 'Conversation', exact: true }).click();
    await side(page).getByRole('button', { name: 'Maximize Repository', exact: true }).click();
    await views(page).getByRole('button', { name: /^Repository/ }).click();
    await expect(page.locator('.app-shell')).not.toHaveClass(/pane-maximized/);
    await expect(side(page)).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath('desktop-restored.png') });
  });

  test(`phone modules fill the width with compact chrome and usable controls: ${theme}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    await openWorkspace(page, request, true);
    const input = page.getByRole('textbox', { name: 'Instruction', exact: true });
    await input.fill('My next instruction');
    await expect(canvas(page)).toBeHidden();
    await expect(side(page)).toBeHidden();
    expect((await conversation(page).boundingBox())!.width).toBe(390);
    expect((await page.locator('.app-header').boundingBox())!.height).toBe(44);
    expect((await views(page).boundingBox())!.y).toBe(795);
    expect((await page.locator('.drawer-composer').boundingBox())!.height).toBeLessThan(170);
    await expect(input).toHaveCSS('font-size', '16px');
    expect((await input.boundingBox())!.height).toBeLessThan(40);
    for (const control of [views(page).getByRole('button', { name: 'Chat', exact: true }), views(page).getByRole('button', { name: 'Canvas', exact: true }),
      page.getByRole('button', { name: 'Maximize Conversation', exact: true }), page.getByRole('button', { name: 'Send', exact: true }), page.getByRole('button', { name: 'Attach', exact: true })]) {
      const box = (await control.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(40);
      expect(box.height).toBeGreaterThanOrEqual(40);
    }
    await page.screenshot({ path: testInfo.outputPath('phone-chat.png') });
    for (const [view, label, pane] of [['Chat', 'Conversation', conversation(page)], ['Canvas', 'Canvas', canvas(page)], ['History', 'History', side(page)]] as const) {
      await views(page).getByRole('button', { name: view, exact: true }).click();
      await pane.getByRole('button', { name: `Maximize ${label}`, exact: true }).click();
      await expect(page.locator('.app-header')).toBeHidden();
      await expect(views(page)).toBeHidden();
      expect(await pane.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
      const restore = (await pane.getByRole('button', { name: 'Restore layout', exact: true }).boundingBox())!;
      expect(restore.x).toBeGreaterThanOrEqual(0);
      expect(restore.x + restore.width).toBeLessThanOrEqual(390);
      await page.screenshot({ path: testInfo.outputPath(`phone-maximized-${view}.png`) });
      await pane.getByRole('button', { name: 'Restore layout', exact: true }).click();
      await expect(views(page)).toBeVisible();
    }
    await views(page).getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(input).toHaveValue('My next instruction');
    await input.fill('One\nTwo\nThree');
    expect((await input.boundingBox())!.height).toBeGreaterThan(65);
    await views(page).getByRole('button', { name: 'More', exact: true }).click();
    const menu = page.locator('.desktop-picker-paper:visible');
    await expect(menu.getByRole('link', { name: 'Arena', exact: true })).toBeVisible();
    await expect(menu.getByRole('link', { name: /^Inbox/ })).toBeVisible();
    await menu.getByRole('button', { name: 'Reports', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'CodeAI reports', exact: true })).toBeVisible();
    await expect(conversation(page)).toBeHidden();
    await views(page).getByRole('button', { name: 'Chat', exact: true }).click();
    await conversation(page).getByRole('button', { name: 'Attach', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New sketch', exact: true }).click();
    await expect(canvas(page)).toBeVisible();
    await expect(conversation(page)).toBeHidden();
    await expect(page.locator('.canvas-titleblock strong')).toHaveText('Sketch 1');
    await views(page).getByRole('button', { name: 'History', exact: true }).click();
    await expect(side(page)).toBeVisible();
    await page.keyboard.press('r');
    await expect(page.getByRole('button', { name: 'Rectangle (R)' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth)).toBe(true);
  });
}

test('desktop offers maximize only beside another pane; a phone always does', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWorkspace(page, request);
  const maximizeChat = conversation(page).getByRole('button', { name: 'Maximize Conversation', exact: true });
  const maximizeCanvas = canvas(page).getByRole('button', { name: 'Maximize Canvas', exact: true });
  const canvasToggle = page.locator('.app-header').getByRole('button', { name: 'Canvas', exact: true });

  // A new session shows the conversation alone: it already has the room.
  await expect(canvas(page)).toBeHidden();
  await expect(conversation(page)).toBeVisible();
  await expect(maximizeChat).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('desktop-chat-alone.png') });
  await canvasToggle.click();
  await expect(maximizeChat).toBeVisible();
  await expect(maximizeCanvas).toBeVisible();
  await canvasToggle.click();
  await expect(maximizeChat).toHaveCount(0);
  await views(page).getByRole('button', { name: /^Repository/ }).click();
  await expect(maximizeChat).toBeVisible();
  await views(page).getByRole('button', { name: /^Repository/ }).click();

  // The canvas alone has nothing to take room from either.
  await page.locator('.app-header').getByRole('button', { name: 'Conversation', exact: true }).click();
  await expect(canvas(page)).toBeVisible();
  await expect(maximizeCanvas).toHaveCount(0);
  await expect(page.locator('.canvas-topbar')).toHaveCount(0);
  expect((await page.locator('.canvas-stage').boundingBox())!.height).toBe((await canvas(page).boundingBox())!.height);
  await page.screenshot({ path: testInfo.outputPath('desktop-canvas-alone.png') });
  await page.locator('.app-header').getByRole('button', { name: 'Conversation', exact: true }).click();

  // Maximized, there is one pane on screen and Restore must stay. The canvas came back with the chat.
  await maximizeChat.click();
  await expect(conversation(page).getByRole('button', { name: 'Restore layout', exact: true })).toBeVisible();
  await conversation(page).getByRole('button', { name: 'Restore layout', exact: true }).click();
  await canvasToggle.click();
  await expect(maximizeChat).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(maximizeChat).toBeVisible();
});

test('phone approvals stay reachable while another pane is maximized', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkspace(page, request);
  await conversation(page).getByLabel(/^Mode: /).click();
  await page.getByRole('radio', { name: 'Agent', exact: true }).click();
  await conversation(page).locator('textarea').fill('Finish approval fixture.');
  await conversation(page).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(conversation(page).getByRole('button', { name: 'Allow once', exact: true })).toBeVisible();
  for (const [view, label, pane] of [['Canvas', 'Canvas', canvas(page)], ['History', 'History', side(page)]] as const) {
    await views(page).getByRole('button', { name: view, exact: true }).click();
    await expect(views(page).getByRole('button', { name: 'Chat, 1 action waiting for your approval', exact: true })).toBeVisible();
    await pane.getByRole('button', { name: `Maximize ${label}`, exact: true }).click();
    await expect(pane.getByRole('button', { name: 'Restore layout', exact: true })).toHaveAccessibleDescription('1 action waiting for your approval');
    await pane.getByRole('button', { name: 'Review 1 action waiting for your approval', exact: true }).click();
    await expect(conversation(page).getByRole('button', { name: 'Allow once', exact: true })).toBeVisible();
  }
  await conversation(page).getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(conversation(page).getByRole('button', { name: 'Send', exact: true })).toBeVisible();
});

test('maximized Changes keeps its diff and does not reconcile away the underlying conversation', async ({ page, request }) => {
  await page.setViewportSize({ width: 1560, height: 900 });
  await page.route('**/api/repository/status?*', route => route.fulfill({ json: { tree: { isRepository: true, files: [{ path: 'example.ts', status: 'modified', staged: false, unstaged: true }] } } }));
  await page.route('**/api/repository/diff?*', route => route.fulfill({ json: { diff: { path: 'example.ts', unstaged: '@@ -1 +1 @@\n-old\n+new' } } }));
  const session = await openWorkspace(page, request);
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await views(page).getByRole('button', { name: /^Repository/ }).click();
  await side(page).locator('.repository-file').click();
  await expect(page.getByLabel('Unified diff')).toContainText('+new');
  const before = (await layouts(page))[session.id];
  await side(page).getByRole('button', { name: 'Maximize Repository', exact: true }).click();
  await expect(page.getByLabel('Unified diff')).toBeVisible();
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(side(page)).toBeVisible();
  await page.setViewportSize({ width: 1560, height: 900 });
  await side(page).getByRole('button', { name: 'Restore layout', exact: true }).click();
  await expect.poll(async () => (await layouts(page))[session.id]).toEqual(before);
  await expect(conversation(page)).toBeVisible();
  await expect(page.getByLabel('Unified diff')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.app-shell')).toHaveClass(/dock-capacity-0/);
  await expect(side(page)).toBeVisible();
  await expect(page.getByLabel('Unified diff')).toBeVisible();
  await side(page).getByRole('button', { name: 'Maximize Repository', exact: true }).click();
  await expect(side(page).getByRole('button', { name: 'Restore layout', exact: true })).toBeVisible();
  await expect(page.getByLabel('Unified diff')).toBeVisible();
  await side(page).getByRole('button', { name: 'Close file changes', exact: true }).click();
  await side(page).getByRole('button', { name: 'Restore layout', exact: true }).click();
});

test('phone Changes keeps long file lists and patches scrollable with Restore and Back in reach', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const files = Array.from({ length: 30 }, (_, index) => ({ path: `file-${index}.ts`, status: 'modified', staged: false, unstaged: true }));
  await page.route('**/api/repository/status?*', route => route.fulfill({ json: { tree: { isRepository: true, files } } }));
  await page.route('**/api/repository/diff?*', route => route.fulfill({ json: { diff: { path: 'file-29.ts', unstaged: '@@ -1 +1 @@\n' + Array.from({ length: 150 }, (_, index) => `+Patch line ${index + 1}`).join('\n') } } }));
  await openWorkspace(page, request);
  await views(page).getByRole('button', { name: /^Repository/ }).click();
  await side(page).getByRole('button', { name: 'Maximize Repository', exact: true }).click();
  const list = side(page).locator('.repository-summary-scroll');
  expect(await list.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await side(page).locator('.repository-file').last().click();
  const patch = side(page).locator('.diff-inspector-scroll');
  await expect(patch).toBeVisible();
  const toolbar = (await side(page).locator('.diff-inspector-toolbar').boundingBox())!;
  expect((await patch.boundingBox())!.y).toBe(toolbar.y + toolbar.height);
  expect((await patch.boundingBox())!.height).toBeGreaterThan(500);
  expect(await patch.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await patch.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect.poll(() => patch.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(2);
  await expect(side(page).getByRole('button', { name: 'Restore layout', exact: true })).toBeInViewport();
  await expect(side(page).getByRole('button', { name: 'Close file changes', exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('phone-long-diff.png') });
  await side(page).getByRole('button', { name: 'Close file changes', exact: true }).click();
  await expect(list).toBeVisible();
  await side(page).getByRole('button', { name: 'Restore layout', exact: true }).click();
  await expect(views(page)).toBeVisible();
});
