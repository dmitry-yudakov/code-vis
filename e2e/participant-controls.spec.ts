import { expect, test } from './arena-stream';
import type { APIRequestContext, Page } from '@playwright/test';
import type { CheckoutsResponse, DurableProject, PublicSession } from '../src/shared/types';

async function fixture(request: APIRequestContext) {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const { project } = await (await request.post('/api/projects', { data: {
    name: `Participants ${Date.now()}`, checkoutIds: [checkouts.find(item => item.relativePath === 'alpha')!.id],
  } })).json() as { project: DurableProject };
  const { session } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json() as { session: PublicSession };
  return { project, session };
}
async function open(page: Page, session: PublicSession) {
  await page.goto(`/?session=${session.id}`);
  const conversation = page.getByRole('complementary', { name: 'Conversation', exact: true });
  const toggle = page.getByRole('group', { name: 'Layout', exact: true }).getByRole('button', { name: /^(Conversation|Chat)/ });
  await expect(toggle).toBeVisible();
  if (!await conversation.count()) await toggle.click();
  await expect(conversation).toBeVisible();
  return conversation;
}
function panel(page: Page) { return page.locator('.desktop-picker-paper:visible').filter({ has: page.locator('.participant-menu') }); }

for (const theme of ['light', 'dark']) for (const width of [1280, 390]) {
  test(`participant selection and message drafts are distinct: ${theme} ${width}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme => localStorage.setItem('code-ai:theme', theme), theme);
    const { session } = await fixture(request);
    await request.post(`/api/sessions/${session.id}/participants`, { data: { provider: 'claude', role: 'reviewer', requestId: crypto.randomUUID() } });
    const conversation = await open(page, session);
    const agents = conversation.getByRole('button', { name: 'Session agents', exact: true });
    const composer = conversation.getByRole('textbox', { name: 'Instruction', exact: true });
    await composer.fill('Keep my unsent message');
    await agents.click();
    const menu = panel(page);
    const recipients = menu.getByRole('region', { name: 'Next message to', exact: true });
    const handoffs = menu.getByRole('region', { name: 'Draft a message', exact: true });
    await expect(recipients.getByRole('button', { pressed: true })).toContainText('Main');
    await expect(handoffs.getByRole('button')).toHaveText('Review this → @Claude Reviewer');
    const providers = menu.getByRole('group', { name: 'Provider', exact: true });
    await expect(providers.getByRole('button', { name: 'Claude', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(providers.getByRole('button', { name: 'Codex', exact: true })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath('participants.png'), animations: 'disabled' });
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await menu.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await recipients.getByRole('button').filter({ hasText: 'Reviewer' }).click();
    await expect(composer).toHaveValue('Keep my unsent message');
    await agents.click();
    await menu.getByRole('button', { name: 'Make @Claude Reviewer the main agent', exact: true }).click();
    await agents.click();
    await recipients.getByRole('button').filter({ hasText: '@Claude', hasNotText: 'Reviewer' }).click();
    await agents.click();
    await handoffs.getByRole('button', { name: 'Review this → @Claude Reviewer', exact: true }).click();
    await expect(composer).toHaveValue(/Review the latest proposal or changes above/);
    await expect(conversation.locator('.chat-message.user')).toHaveCount(0);
    await expect(agents).toContainText('Reviewer');
    await agents.click();
    await menu.getByLabel('Role', { exact: true }).selectOption('coder');
    await menu.getByRole('button', { name: 'Add agent', exact: true }).click();
    await expect(agents).toContainText('Claude Coder');
    await page.reload();
    await agents.click();
    await expect(menu.getByLabel('Role', { exact: true })).toHaveValue('coder');
    await expect(recipients.locator('.participant-row').getByRole('button')).toHaveCount(3);
    await page.screenshot({ path: testInfo.outputPath('remembered-role.png'), animations: 'disabled' });
  });
}

test('a chosen role survives failed addition, reload, and both new-session forms', async ({ page, request }) => {
  const { project, session } = await fixture(request);
  const conversation = await open(page, session);
  const agents = conversation.getByRole('button', { name: 'Session agents', exact: true });
  await agents.click();
  await expect(panel(page).getByLabel('Role', { exact: true })).toHaveValue('reviewer');
  await panel(page).getByLabel('Role', { exact: true }).selectOption('tester');
  const requests: Array<{ role: string; requestId: string }> = [];
  await page.route(`**/api/sessions/${session.id}/participants`, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) return route.fulfill({ status: 503, json: { error: 'Try adding again.' } });
    return route.continue();
  });
  await panel(page).getByRole('button', { name: 'Add agent', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Notifications' })).toContainText('Try adding again.');
  await agents.click();
  await expect(panel(page).getByLabel('Role', { exact: true })).toHaveValue('tester');
  await panel(page).getByRole('button', { name: 'Add agent', exact: true }).click();
  await expect(agents).toContainText('Claude Tester');
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  await page.reload();
  await page.locator('.new-session-menu > button').click();
  const form = page.getByRole('form', { name: 'Create project session', exact: true });
  await expect(form.getByLabel('Role', { exact: true })).toHaveValue('tester');
  await form.getByLabel('Role', { exact: true }).selectOption('custom');
  const created = page.waitForResponse(response => response.url().endsWith('/api/sessions') && response.request().method() === 'POST');
  await form.getByRole('button', { name: 'Start session', exact: true }).click();
  const first = (await (await created).json()).session as PublicSession;
  expect(first.participants.find(item => item.id === first.primaryAgentId)).toMatchObject({ role: 'custom' });
  await page.goto('/arena');
  await page.getByRole('button', { name: `New session in ${project.name}`, exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'New session', exact: true });
  await expect(setup.getByLabel('Role', { exact: true })).toHaveValue('custom');
  await setup.getByLabel('Role', { exact: true }).selectOption('coder');
  await setup.getByRole('button', { name: /Model and effort/ }).click();
  await page.getByRole('radio', { name: 'Sonnet', exact: true }).click();
  await page.keyboard.press('Escape');
  const model = setup.getByRole('button', { name: /Model and effort/ });
  await expect(model).toContainText('Sonnet');
  await setup.getByRole('group', { name: 'Provider', exact: true }).getByRole('button', { name: 'Claude', exact: true }).click();
  await expect(model).toContainText('Sonnet');
  const next = page.waitForResponse(response => response.url().endsWith('/api/sessions') && response.request().method() === 'POST');
  await setup.getByRole('button', { name: 'Create and open', exact: true }).click();
  const second = (await (await next).json()).session as PublicSession;
  expect(second.participants.find(item => item.id === second.primaryAgentId)).toMatchObject({ role: 'coder' });
  await expect(page).toHaveURL(new RegExp(second.id));
  await page.reload();
  await agents.click();
  await expect(panel(page).getByLabel('Role', { exact: true })).toHaveValue('coder');
});

test('available providers can be switched with the keyboard and keep the chosen role', async ({ page, request }) => {
  const { session } = await fixture(request);
  await page.route('**/api/health', async route => {
    const response = await route.fetch();
    const data = await response.json();
    for (const providers of [data.providers, data.executions.local.providers]) providers.codex = { ...providers.claude };
    await route.fulfill({ response, json: data });
  });
  const conversation = await open(page, session);
  const agents = conversation.getByRole('button', { name: 'Session agents', exact: true });
  await agents.click();
  await panel(page).getByLabel('Role', { exact: true }).selectOption('coder');
  const codex = panel(page).getByRole('group', { name: 'Provider', exact: true }).getByRole('button', { name: 'Codex', exact: true });
  await codex.focus();
  await page.keyboard.press('Enter');
  await expect(codex).toHaveAttribute('aria-pressed', 'true');
  await expect(panel(page).getByLabel('Role', { exact: true })).toHaveValue('coder');
  await page.keyboard.press('Escape');
  await expect(agents).toBeFocused();
  await page.reload();
  await agents.click();
  await expect(codex).toHaveAttribute('aria-pressed', 'true');
  await expect(panel(page).getByLabel('Role', { exact: true })).toHaveValue('coder');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('code-ai:device:v1:preferences')!))).toMatchObject({ provider: 'codex', role: 'coder' });
  await page.unroute('**/api/health');
  await page.reload();
  await agents.click();
  await expect(codex).toBeDisabled();
  await expect(panel(page).getByRole('group', { name: 'Provider', exact: true }).getByRole('button', { name: 'Claude', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel(page).getByLabel('Role', { exact: true })).toHaveValue('coder');
});
