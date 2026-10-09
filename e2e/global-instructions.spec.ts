import { openMachineSettings } from './machine-settings';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

// The end-to-end server reads its providers' global instructions from test/fixtures/provider-homes,
// and the fake Claude quotes the marker line of whatever instructions it was given.
const QUESTION = 'Quote the global instructions marker';
const WITH = 'Your global instructions say: pineapple.';
const WITHOUT = 'I have no global instructions.';

async function switchInstructions(request: APIRequestContext, baseURL: string, provider: 'claude' | 'codex', enabled: boolean) {
  const response = await request.patch('/api/instructions', { headers: { Origin: baseURL }, data: { provider, enabled } });
  expect(response.ok()).toBe(true);
}

test.afterEach(async ({ request, baseURL }) => {
  // Every other suite runs with both switches on, which is also what no record means.
  for (const provider of ['claude', 'codex'] as const) await switchInstructions(request, baseURL!, provider, true);
});

async function ask(page: Page, answer: string) {
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await conversation.locator('textarea').fill(QUESTION);
  await conversation.getByRole('button', { name: 'Send' }).click();
  await expect(conversation.locator('.chat-message.assistant').last()).toContainText(answer);
}

async function startSession(page: Page, instructions?: 'Use' | 'Isolate') {
  const tabs = page.getByRole('tab');
  const before = await tabs.count();
  await page.locator('.new-session-menu > summary').click();
  if (instructions) {
    await page.locator('.new-session-menu').getByText('Advanced settings', { exact: true }).click();
    await page.locator('.new-session-menu').getByLabel('Global instructions').selectOption({ label: instructions });
  }
  await page.getByRole('button', { name: 'Start session' }).click();
  await expect(tabs).toHaveCount(before + 1);
  await expect(page.locator('.new-session-menu[open]')).toHaveCount(0);
}

test('shows the global instructions in Machine settings, switches them, and isolates a session', async ({ page, request, baseURL }) => {
  for (const provider of ['claude', 'codex'] as const) await switchInstructions(request, baseURL!, provider, true);
  const { checkouts } = await (await request.get('/api/checkouts')).json() as { checkouts: { id: string; name: string }[] };
  const projectName = `E2E instructions ${Date.now()}`;
  const { project } = await (await request.post('/api/projects', {
    data: { name: projectName, checkoutIds: [checkouts.find((checkout) => checkout.name === 'alpha')!.id] },
  })).json() as { project: { id: string } };
  await page.goto('/');
  await expect(page.locator('.project-search-trigger')).toContainText(projectName);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  const line = conversation.locator('.execution-instructions');

  // A session on Default follows this machine's switch, which is on until it is changed.
  await startSession(page);
  await expect(line).toHaveText('global instructions');
  await ask(page, WITH);

  // Machine settings shows each provider's file, read-only, with the notes about when a switch applies.
  await page.getByRole('link', { name: 'Arena', exact: true }).click();
  const settings = await openMachineSettings(page);
  const section = settings.getByRole('region', { name: 'Global instructions' });
  await expect(section).toContainText('Takes effect on the next Docker Codex turn and in a Claude agent’s next provider session.');
  const rows = section.locator('.arena-instruction');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('code')).toHaveText(/test\/fixtures\/provider-homes\/claude\/CLAUDE\.md$/);
  await expect(rows.nth(1).locator('code')).toHaveText(/test\/fixtures\/provider-homes\/codex\/AGENTS\.md$/);
  await expect(rows.nth(1)).toContainText('Local Codex always uses this file. The switch applies to Docker Codex.');
  await expect(section).not.toContainText('share this file');
  await expect(rows.nth(0).locator('pre')).toBeHidden();
  await rows.nth(0).getByText('Show file').click();
  await expect(rows.nth(0).locator('pre')).toContainText('CODEAI-FIXTURE-MARKER: pineapple');
  await expect(section.locator('textarea, [contenteditable]')).toHaveCount(0);
  // Refresh reads the file again if it changed after settings opened.
  const reread = page.waitForResponse((response) => response.url().endsWith('/api/instructions') && response.request().method() === 'GET');
  await settings.getByRole('button', { name: 'Refresh', exact: true }).click();
  expect((await reread).ok()).toBe(true);

  // Switching Claude off is saved on this machine and survives a reload.
  const claudeSwitch = section.getByRole('checkbox', { name: 'Use global instructions for Claude' });
  await expect(claudeSwitch).toBeChecked();
  await claudeSwitch.click();
  await expect(claudeSwitch).not.toBeChecked();
  await expect(section.getByRole('checkbox', { name: 'Use global instructions for Codex' })).toBeChecked();
  await page.reload();
  await openMachineSettings(page);
  await expect(claudeSwitch).not.toBeChecked();

  // The Default session now runs without them, and says so under its composer.
  await page.goto('/');
  await expect(line).toHaveText('isolated');
  await startSession(page);
  await expect(line).toHaveText('isolated');
  await ask(page, WITHOUT);

  // A session created with Use keeps them whatever the machine's switch says.
  await startSession(page, 'Use');
  await expect(line).toHaveText('global instructions');
  await ask(page, WITH);

  // Isolate is the session's own too, and the device remembers the last choice for the next form.
  await page.getByRole('link', { name: 'Arena', exact: true }).click();
  await openMachineSettings(page);
  await claudeSwitch.click();
  await expect(claudeSwitch).toBeChecked();
  await page.goto('/');
  await expect(line).toHaveText('global instructions');
  await startSession(page, 'Isolate');
  await expect(line).toHaveText('isolated');
  await expect(line).toHaveAttribute('title', /^This agent runs without your global instructions\./);
  await ask(page, WITHOUT);
  await page.locator('.new-session-menu > summary').click();
  await expect(page.locator('.new-session-menu').getByLabel('Global instructions')).toHaveValue('isolated');
  await page.locator('.new-session-menu > summary').click();

  // The Arena's form opens at the remembered choice and carries the one made there.
  await page.getByRole('link', { name: 'Arena', exact: true }).click();
  const arena = page.getByRole('main', { name: 'Arena' });
  await arena.getByRole('button', { name: 'New session' }).click();
  const create = page.getByRole('dialog', { name: 'New session', exact: true });
  await expect(create.getByLabel('Global instructions')).toHaveValue('isolated');
  await create.getByLabel('Project').selectOption({ label: projectName });
  await expect(create.getByLabel('Global instructions').locator('option[value="isolated"]')).toHaveJSProperty('disabled', false);
  await create.getByText('Advanced settings', { exact: true }).click();
  await create.getByLabel('Global instructions').selectOption({ label: 'Default' });
  const created = page.waitForRequest((sent) => sent.url().endsWith('/api/sessions') && sent.method() === 'POST');
  await create.getByRole('button', { name: 'Create and open' }).click();
  expect((await created).postDataJSON()).not.toHaveProperty('instructions');
  await expect(line).toHaveText('global instructions');
  await ask(page, WITH);

  // With a local Codex on offer, the forms set Isolate aside for it and keep the device's own choice.
  await page.route('**/api/health', async (route) => {
    const response = await route.fetch();
    type Providers = { claude: object; codex: object };
    const body = await response.json() as { providers: Providers; executions: { local: { providers: Providers } } };
    for (const providers of [body.providers, body.executions.local.providers]) providers.codex = { ...providers.claude };
    await route.fulfill({ response, json: body });
  });
  await page.goto('/');
  await expect(line).toHaveText('global instructions');
  await startSession(page, 'Isolate');
  await page.getByRole('link', { name: 'Arena', exact: true }).click();
  await arena.getByRole('button', { name: 'New session' }).click();
  await create.getByLabel('Project').selectOption({ label: projectName });
  await expect(create.getByLabel('Global instructions')).toHaveValue('isolated');
  await create.getByLabel('Provider').selectOption({ label: 'Codex' });
  await expect(create.getByLabel('Global instructions')).toHaveValue('default');
  const isolate = create.getByLabel('Global instructions').locator('option[value="isolated"]');
  await expect(isolate).toHaveJSProperty('disabled', true);
  await expect(isolate).toHaveText('Isolate · Docker only for Codex');
  await expect(isolate).toHaveAttribute('title', 'Local Codex always loads your global AGENTS.md. Use Docker for an isolated Codex.');
  const codexCreated = page.waitForRequest((sent) => sent.url().endsWith('/api/sessions') && sent.method() === 'POST');
  await create.getByRole('button', { name: 'Create and open' }).click();
  expect((await codexCreated).postDataJSON()).toMatchObject({ provider: 'codex' });
  expect((await codexCreated).postDataJSON()).not.toHaveProperty('instructions');
  // Local Codex always loads its own file, and the device still remembers Isolate for the next form.
  await expect(line).toHaveText('global instructions');
  await page.locator('.new-session-menu > summary').click();
  await page.locator('.new-session-menu').getByLabel('New session provider').selectOption({ label: 'Claude' });
  await expect(page.locator('.new-session-menu').getByLabel('Global instructions')).toHaveValue('isolated');
  await page.locator('.new-session-menu > summary').click();

  // Local Codex always loads its own global file, so the server refuses to isolate it.
  const refused = await request.post('/api/sessions', { data: { provider: 'codex', projectId: project.id, instructions: 'isolated' } });
  expect(refused.status()).toBe(409);
  expect(await refused.json()).toEqual({ error: 'Local Codex always loads your global AGENTS.md. Use Docker for an isolated Codex.' });
});

test('keeps the line under the composer inside a narrow conversation panel', async ({ page, request }) => {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as { checkouts: { id: string; name: string }[] };
  const projectName = `E2E instructions narrow ${Date.now()}`;
  await request.post('/api/projects', { data: { name: projectName, checkoutIds: [checkouts.find((checkout) => checkout.name === 'alpha')!.id] } });
  // The longest state: the switch is on and this machine has nothing it can give.
  await page.route('**/api/health', async (route) => {
    const response = await route.fetch();
    const body = await response.json() as { instructions: { claude: { enabled: boolean; passable: boolean; present: boolean } } };
    body.instructions.claude = { enabled: true, passable: false, present: false };
    await route.fulfill({ response, json: body });
  });
  await page.goto('/');
  await expect(page.locator('.project-search-trigger')).toContainText(projectName);
  await startSession(page);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  const line = conversation.locator('.execution-line');
  const label = line.locator('.execution-instructions');
  const hint = line.locator('.execution-hint');
  await expect(label).toHaveText('global instructions unavailable');

  for (const width of [1280, 360, 320]) {
    await page.setViewportSize({ width, height: 800 });
    if (!await conversation.count()) await page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: /^Conversation/ }).click();
    await expect(label).toBeVisible();
    const [panel, labelBox, hintBox] = await Promise.all([conversation.boundingBox(), label.boundingBox(), hint.boundingBox()]);
    // Nothing reaches past the panel, the label is whole, and the mode's hint keeps room to be read.
    expect(labelBox!.x + labelBox!.width, `label at ${width}`).toBeLessThanOrEqual(panel!.x + panel!.width + 0.5);
    expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth), `label whole at ${width}`).toBe(true);
    expect(hintBox!.width, `hint at ${width}`).toBeGreaterThan(90);
  }
});
