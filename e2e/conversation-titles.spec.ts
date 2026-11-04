import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import type { CheckoutsResponse, PublicSession } from '../src/shared/types';

async function openConversation(page: Page, request: APIRequestContext) {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const { project } = await (await request.post('/api/projects', { data: {
    name: `Conversation title ${Date.now()}`, checkoutIds: [checkouts.find(item => item.name === 'alpha')!.id],
  } })).json();
  const { session } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json() as { session: PublicSession };
  await page.goto('/');
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(project.name) }).click();
  await page.getByRole('combobox', { name: 'All sessions', exact: true }).selectOption(session.id);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  return { session, conversation };
}

test('a late title updates the open tab and header, permits another turn and survives reload', async ({ page, request }) => {
  const { session, conversation } = await openConversation(page, request);
  const prompt = 'Draw a simple architecture [title-pending]';
  await conversation.locator('textarea').fill(prompt);
  await conversation.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(conversation.locator('.chat-message.assistant.complete')).toHaveCount(1);
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { selected: true })).toHaveAccessibleName(prompt.slice(0, 56));
  await conversation.locator('textarea').fill('Please explain the implementation too.');
  await expect(conversation.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await conversation.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(conversation.locator('.chat-message.assistant.complete')).toHaveCount(2);
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { selected: true })).toHaveAccessibleName('Improve conversation titles', { timeout: 15_000 });
  await expect(conversation.locator('header > div > strong')).toHaveText('Improve conversation titles');
  // The title revision must not make the next canonical mutation conflict.
  await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: /^History/ }).click();
  const pin = page.getByRole('button', { name: 'Pin', exact: true }).first();
  await expect(pin).toBeVisible();
  const pinned = page.waitForResponse(response => response.url().endsWith(`/api/sessions/${session.id}/pins`) && response.request().method() === 'PUT');
  await pin.click();
  expect((await pinned).status()).toBe(200);
  const saved = (await (await request.get(`/api/sessions/${session.id}`)).json()).session as PublicSession;
  expect(saved.title).toBe('Improve conversation titles');
  expect(saved.messages).toHaveLength(4);
  expect(saved.pinnedDiagramIds).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { selected: true })).toHaveAccessibleName('Improve conversation titles');
});

test('a failed background title keeps the placeholder and the conversation usable', async ({ page, request }) => {
  const { session, conversation } = await openConversation(page, request);
  const prompt = 'Could you explain this repository? [title-failure]';
  await conversation.locator('textarea').fill(prompt);
  await conversation.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(conversation.locator('.chat-message.assistant.complete')).toHaveCount(1);
  await conversation.locator('textarea').fill('Continue with more detail.');
  await expect(conversation.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await conversation.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(conversation.locator('.chat-message.assistant.complete')).toHaveCount(2);
  await expect(page.getByRole('tablist', { name: 'Open session views', exact: true }).getByRole('tab', { selected: true })).toHaveAccessibleName(prompt.slice(0, 56));
  const saved = (await (await request.get(`/api/sessions/${session.id}`)).json()).session as PublicSession;
  expect(saved.title).toBe(prompt);
  expect(saved.messages).toHaveLength(4);
});
