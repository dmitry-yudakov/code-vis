import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { CheckoutsResponse, PublicSession } from '../src/shared/types';

async function openWorkspace(page: Page, request: APIRequestContext, withSession = true) {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const { project } = await (await request.post('/api/projects', { data: {
    name: `Workspace design ${Date.now()}`, checkoutIds: [checkouts.find(item => item.name === 'alpha')!.id],
  } })).json();
  let session: PublicSession | undefined;
  if (withSession) {
    const response = await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } });
    expect(response.status()).toBe(201);
    session = (await response.json()).session;
  }
  await page.goto('/');
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(project.name) }).click();
  if (session) await page.getByRole('combobox', { name: 'All sessions', exact: true }).selectOption(session.id);
  return session;
}

for (const appearance of ['light', 'dark']) {
  for (const width of [1440, 360]) {
    test(`activity bar keeps global navigation anchored with clear selection: ${appearance} ${width}`, async ({ page, request }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(theme => localStorage.setItem('code-ai:theme', theme), appearance);
      await openWorkspace(page, request);
      const bar = page.getByRole('navigation', { name: 'Views', exact: true });
      const history = bar.getByRole('button', { name: 'History', exact: true });
      const input = page.getByRole('textbox', { name: 'Instruction', exact: true });
      await input.fill('Keep this draft while navigating');
      await history.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(history).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(history).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('complementary', { name: 'Canvas history', exact: true })).toBeVisible();

      const barBox = (await bar.boundingBox())!;
      const selectedBox = (await history.boundingBox())!;
      expect(selectedBox.x).toBeGreaterThan(barBox.x + 2);
      expect(selectedBox.x + selectedBox.width).toBeLessThan(barBox.x + barBox.width - 2);
      const selection = await history.evaluate(node => {
        // Resolve the tokens independently of MUI's animated selection background.
        const probe = document.createElement('span');
        probe.style.color = 'var(--plot)';
        probe.style.backgroundColor = 'var(--plot-wash)';
        node.append(probe);
        const color = getComputedStyle(probe).color;
        const background = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return {
          marker: getComputedStyle(node, '::before').content,
          markerHeight: parseFloat(getComputedStyle(node, '::before').height),
          focus: getComputedStyle(node).outlineStyle,
          color, background,
        };
      });
      expect(selection.marker).not.toBe('none');
      expect(selection.markerHeight).toBeGreaterThan(0);
      expect(selection.markerHeight).toBeLessThan(selectedBox.height);
      expect(selection.focus).toBe('solid');
      await history.hover();
      await expect(history).toHaveCSS('color', selection.color);
      await expect(history).toHaveCSS('background-color', selection.background);
      await page.screenshot({ path: testInfo.outputPath('workspace.png'), animations: 'disabled' });

      const arena = bar.getByRole('link', { name: 'Arena', exact: true });
      const inbox = bar.getByRole('link', { name: /^Inbox/ });
      const more = bar.getByRole('button', { name: 'More', exact: true });
      const positions = async () => Promise.all([arena.boundingBox(), inbox.boundingBox(), more.boundingBox()]);
      const anchored = await positions();
      expect(anchored[0]!.y).toBeGreaterThan(700);
      expect(anchored[1]!.y - anchored[0]!.y - anchored[0]!.height).toBeLessThanOrEqual(8);
      expect(anchored[2]!.y - anchored[1]!.y - anchored[1]!.height).toBeLessThanOrEqual(8);
      expect(900 - anchored[2]!.y - anchored[2]!.height).toBeLessThanOrEqual(12);

      await arena.click();
      await expect(page.getByRole('main', { name: 'Arena', exact: true })).toBeVisible();
      await expect(history).toHaveCount(0);
      await expect(arena).toHaveAttribute('aria-current', 'page');
      await expect(arena).toHaveCSS('color', selection.color);
      await expect(arena).toHaveCSS('background-color', selection.background);
      expect(await positions()).toEqual(anchored);
      await page.screenshot({ path: testInfo.outputPath('arena.png'), animations: 'disabled' });
      await inbox.click();
      await expect(page).toHaveURL(/\/arena\/inbox$/);
      await expect(inbox).toHaveAttribute('aria-current', 'page');
      await expect(inbox).toHaveCSS('color', selection.color);
      await expect(inbox).toHaveCSS('background-color', selection.background);
      expect(await positions()).toEqual(anchored);
      await page.goBack();
      await page.goBack();
      await expect(history).toBeVisible();
      expect(await positions()).toEqual(anchored);
      await history.click();
      await expect(history).toHaveAttribute('aria-pressed', 'false');
      await expect(input).toHaveValue('Keep this draft while navigating');

      await more.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('.desktop-picker-paper:visible').getByRole('group', { name: 'Theme', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(more).toBeFocused();

      await page.getByRole('tab', { selected: true }).getByRole('button', { name: /^Close tab:/ }).click();
      await expect(page.getByRole('heading', { name: 'No open sessions', exact: true })).toBeVisible();
      await expect(history).toHaveCount(0);
      expect(await positions()).toEqual(anchored);
      await page.reload();
      await expect(page.getByRole('heading', { name: 'No open sessions', exact: true })).toBeVisible();
      expect(await positions()).toEqual(anchored);
    });
  }

  for (const width of [1440, 1000, 360]) {
    test(`conversation starters preserve drafts and stay within the workspace: ${appearance} ${width}`, async ({ page, request }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(theme => localStorage.setItem('code-ai:theme', theme), appearance);
      const session = (await openWorkspace(page, request))!;
      const conversation = page.getByRole('complementary', { name: 'Conversation' });
      const input = conversation.getByRole('textbox', { name: 'Instruction' });
      const send = conversation.getByRole('button', { name: 'Send', exact: true });
      const starters = conversation.getByRole('region', { name: 'Get started' });
      await expect(starters).toBeVisible();
      await expect(send).toBeDisabled();
      for (const label of ['Explore the project', 'Review changes', 'Plan a change']) {
        const starter = starters.getByRole('button', { name: label, exact: true });
        await starter.focus();
        await page.keyboard.press('Enter');
        await expect(input).not.toHaveValue('');
        await expect(input).toBeFocused();
        await expect(send).toBeEnabled();
        await expect(starter).toBeDisabled();
        // Choosing a starting point prepares a draft; it never sends a turn.
        const { session: stored } = await (await request.get(`/api/sessions/${session.id}`)).json();
        expect(stored.messages).toEqual([]);
        await input.fill('Keep my own draft');
        await expect(starters.getByRole('button', { name: 'Explore the project', exact: true })).toBeDisabled();
        await expect(input).toHaveValue('Keep my own draft');
        await input.fill('');
      }
      for (const element of [conversation, page.locator('.instruction-composer')]) {
        expect(await element.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      }
      const box = (await send.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(900);
      await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance);
    });
  }

  test(`welcome uses the workspace width and can start a session: ${appearance}`, async ({ page, request }) => {
    await page.addInitScript(theme => localStorage.setItem('code-ai:theme', theme), appearance);
    await openWorkspace(page, request, false);
    const welcome = page.locator('.welcome-screen');
    for (const width of [1440, 1000, 900, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(welcome.getByRole('heading', { name: 'Good ideas start here.' })).toBeVisible();
      const box = (await welcome.boundingBox())!;
      expect(box.x + box.width).toBe(width);
      expect(await welcome.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      const create = welcome.getByRole('button', { name: 'Create and open', exact: true });
      await create.scrollIntoViewIfNeeded();
      await expect(create).toBeVisible();
    }
    await welcome.getByRole('button', { name: 'Create and open', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Instruction' })).toBeFocused();
    await expect(page.getByRole('region', { name: 'Get started' })).toBeVisible();
  });
}
