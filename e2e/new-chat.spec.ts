import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { CheckoutsResponse, DurableProject, PublicSession } from '../src/shared/types';

async function openSource(page: Page, request: APIRequestContext, loose = false) {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const { project } = await (await request.post('/api/projects', { data: {
    name: `New chat ${Date.now()}`, checkoutIds: [checkouts.find((checkout) => checkout.name === 'alpha')!.id],
  } })).json() as { project: DurableProject };
  const data = { ...(loose ? {} : { projectId: project.id }), provider: 'codex', role: 'tester', instructions: 'global' };
  const { session } = await (await request.post('/api/sessions', { data })).json() as { session: PublicSession };
  const { session: sibling } = await (await request.post('/api/sessions', { data })).json() as { session: PublicSession };
  await page.goto('/');
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: loose ? 'No project' : new RegExp(project.name) }).click();
  await page.getByRole('combobox', { name: 'All sessions', exact: true }).selectOption(sibling.id);
  await page.getByRole('combobox', { name: 'All sessions', exact: true }).selectOption(session.id);
  return { session, sibling };
}

async function offerCodex(page: Page, native = false) {
  await page.route('**/api/health', async (route) => {
    const health = await (await route.fetch()).json();
    const codex = { available: true, authenticated: true,
      supportedModes: ['ask', 'plan', 'agent', 'auto', ...(native ? ['full'] : [])],
      models: [{ id: 'test-model', label: 'Test model', efforts: ['low', 'high'] }], efforts: ['low', 'high'] };
    health.securityLevel = native ? 'native' : 'guarded';
    health.providers.codex = codex;
    health.executions.local.providers.codex = codex;
    await route.fulfill({ json: health });
  });
}

for (const choice of [
  { mode: 'plan', label: 'Plan', native: false, loose: false },
  { mode: 'auto', label: 'Auto', native: false, loose: true },
  { mode: 'full', label: 'Full access', native: true, loose: false },
]) {
  test(`starts a fresh ${choice.mode} chat with the same settings and closes only its source tab`, async ({ page, request }) => {
    await offerCodex(page, choice.native);
    const { session, sibling } = await openSource(page, request, choice.loose);
    const conversation = page.getByRole('complementary', { name: 'Conversation' });
    const newChat = conversation.getByRole('button', { name: 'New chat', exact: true });
    await expect(newChat).toBeVisible({ timeout: 2_000 });
    await conversation.getByLabel(/^Mode: /).click();
    await conversation.getByRole('radio', { name: choice.label, exact: true }).click();
    await conversation.locator('.model-menu summary').click();
    await conversation.getByRole('radio', { name: 'Test model', exact: true }).click();
    await conversation.getByRole('radio', { name: 'High', exact: true }).click();
    await conversation.locator('.model-menu summary').click();
    await conversation.locator('textarea').fill('Keep this draft in the old chat.');

    const createdResponse = page.waitForResponse((response) => response.url().endsWith('/api/sessions') && response.request().method() === 'POST');
    await newChat.click();
    const response = await createdResponse;
    expect(response.request().postDataJSON()).toEqual({ provider: 'codex', role: 'tester', execution: 'local', sourceSessionId: session.id });
    expect(response.status()).toBe(201);
    const { session: created } = await response.json() as { session: PublicSession };
    expect(created.projectId).toBe(session.projectId);
    expect(created.repositories).toEqual(session.repositories);
    expect(created.instructions).toBe('global');
    expect(created.messages).toEqual([]);
    expect(created.participants.find((participant) => participant.kind === 'agent')).toMatchObject({
      provider: 'codex', role: 'tester',
    });
    expect(created.primaryAgentId).not.toBe(session.primaryAgentId);
    await expect(page.getByRole('combobox', { name: 'All sessions', exact: true })).toHaveValue(created.id);
    await expect(page.getByRole('tab', { name: session.title, exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: sibling.title, exact: true })).toBeVisible();
    await expect(conversation.locator('textarea')).toHaveValue('');
    await expect(conversation.locator('.chat-message')).toHaveCount(0);
    await expect(conversation.getByLabel(/^Mode: /)).toHaveText(choice.label);
    await expect(conversation.locator('.model-menu summary')).toHaveText('Test model · High');
    await page.reload();
    if (choice.loose) {
      await page.locator('.project-search-trigger').click();
      await page.getByRole('option', { name: 'No project' }).click();
    }
    await expect(page.getByRole('combobox', { name: 'All sessions', exact: true })).toHaveValue(created.id);
    await expect(conversation.getByLabel(/^Mode: /)).toHaveText(choice.label);
    await expect(conversation.locator('.model-menu summary')).toHaveText('Test model · High');

    await page.setViewportSize({ width: 760, height: 800 });
    await expect(page.locator('.app-shell')).toHaveClass(/dock-capacity-1/);
    if (!await conversation.isVisible()) await page.getByRole('button', { name: 'Conversation', exact: true }).click();
    await expect(newChat).toBeVisible();
    const button = (await newChat.boundingBox())!;
    const header = (await conversation.locator(':scope > header').boundingBox())!;
    expect(button.x + button.width).toBeLessThanOrEqual(header.x + header.width);
    expect(button.x).toBeGreaterThanOrEqual(header.x);
    expect((await request.get(`/api/sessions/${session.id}`)).ok()).toBe(true);
    await page.getByRole('combobox', { name: 'All sessions', exact: true }).selectOption(session.id);
    if (choice.loose) {
      await expect(conversation).toBeHidden();
      await page.getByRole('button', { name: 'Conversation', exact: true }).click();
    }
    await expect(conversation.locator('textarea')).toHaveValue('Keep this draft in the old chat.');
  });
}

test('disables New chat while creating and keeps the original tab and draft after failure', async ({ page, request }) => {
  await offerCodex(page);
  const { session, sibling } = await openSource(page, request);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  const newChat = conversation.getByRole('button', { name: 'New chat', exact: true });
  await expect(newChat).toBeVisible({ timeout: 2_000 });
  await conversation.locator('textarea').fill('Keep me.');
  let creations = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    creations += 1;
    await pending;
    await route.fulfill({ status: 409, json: { error: 'New chat fixture failure.' } });
  });
  await newChat.click();
  await expect(newChat).toBeDisabled();
  await newChat.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  expect(creations).toBe(1);
  await expect(page.getByRole('tab', { name: session.title, exact: true })).toBeVisible();
  release();
  await expect(page.getByText('New chat fixture failure.', { exact: true })).toBeVisible();
  await expect(newChat).toBeEnabled();
  await expect(conversation.locator('textarea')).toHaveValue('Keep me.');
  await expect(page.getByRole('combobox', { name: 'All sessions', exact: true })).toHaveValue(session.id);
  await expect(page.getByRole('tab', { name: sibling.title, exact: true })).toBeVisible();
  let finishSend!: () => void;
  const preparing = new Promise<void>((resolve) => { finishSend = resolve; });
  await page.route('**/api/agent/message', async (route) => {
    await preparing;
    await route.fulfill({ status: 409, json: { error: 'Send fixture finished.' } });
  });
  await conversation.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(newChat).toBeDisabled();
  finishSend();
  await expect(newChat).toBeEnabled();
  await expect(page.getByRole('combobox', { name: 'All sessions', exact: true })).toHaveValue(session.id);
});
