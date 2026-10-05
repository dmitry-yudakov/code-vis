import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { CheckoutsResponse, DurableProject, PublicSession } from '../src/shared/types';

async function openSession(page: Page, request: APIRequestContext) {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const { project } = await (await request.post('/api/projects', { data: {
    name: `Live modes ${Date.now()}`, checkoutIds: [checkouts.find((checkout) => checkout.name === 'alpha')!.id],
  } })).json() as { project: DurableProject };
  const { session } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json() as { session: PublicSession };
  await page.goto('/');
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(project.name) }).click();
  await page.getByRole('combobox', { name: 'All sessions', exact: true }).selectOption(session.id);
  return session;
}

for (const theme of ['light', 'dark']) {
  test(`changes an approval-blocked Agent task to Plan in ${theme}`, async ({ page, request }) => {
    await page.addInitScript((value) => localStorage.setItem('code-ai:theme', value), theme);
    const session = await openSession(page, request);
    const conversation = page.getByRole('complementary', { name: 'Conversation' });
    await conversation.getByLabel(/^Mode: /).click();
    await conversation.getByRole('radio', { name: 'Agent', exact: true }).click();
    await conversation.locator('textarea').fill('Finish mode switch fixture.');
    await conversation.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(conversation.getByRole('button', { name: 'Allow', exact: true })).toBeVisible();
    await conversation.getByLabel(/^Mode: /).click();
    const changing = page.waitForResponse('**/api/agent/mode');
    await conversation.getByRole('radio', { name: 'Plan', exact: true }).click();
    expect((await changing).status()).toBe(200);
    await expect(conversation.getByRole('button', { name: 'Allow', exact: true })).toHaveCount(0);
    await expect(conversation.getByRole('button', { name: 'Execute plan', exact: true })).toBeVisible();
    await expect(conversation.getByLabel(/^Mode: Plan/)).toBeVisible();
    const { session: saved } = await (await request.get(`/api/sessions/${session.id}`)).json() as { session: PublicSession };
    expect(saved.messages.map((message) => [message.role, message.mode, message.status])).toEqual([
      ['user', 'agent', 'sent'], ['assistant', 'plan', 'complete'],
    ]);
  });
}

test('keeps the selected mode on reload and resumes the same Ask task as Agent', async ({ page, request }) => {
  const session = await openSession(page, request);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await conversation.getByLabel(/^Mode: /).click();
  await conversation.getByRole('radio', { name: 'Ask', exact: true }).click();
  await conversation.locator('textarea').fill('Wait for reload cancellation.');
  await conversation.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(conversation.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await conversation.getByLabel(/^Mode: /).click();
  await conversation.getByRole('radio', { name: 'Agent', exact: true }).click();
  await expect(conversation.getByRole('button', { name: 'Allow', exact: true })).toBeVisible();
  await page.reload();
  await expect(conversation.getByLabel(/^Mode: Agent/)).toBeVisible();
  await expect(conversation.getByRole('button', { name: 'Allow', exact: true })).toBeVisible();
  await conversation.getByRole('button', { name: 'Allow', exact: true }).click();
  await expect(conversation.getByText('Edit approved — I applied it.', { exact: true })).toBeVisible();
  const { session: saved } = await (await request.get(`/api/sessions/${session.id}`)).json() as { session: PublicSession };
  expect(saved.messages.map((message) => [message.role, message.mode])).toEqual([['user', 'ask'], ['assistant', 'agent']]);
});
