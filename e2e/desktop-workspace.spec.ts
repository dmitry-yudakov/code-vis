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
