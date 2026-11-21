import { sessionTab } from './session-tabs';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import type { ArenaSnapshot, CheckoutsResponse, DurableProject, PublicSession } from '../src/shared/types';

async function project(request: APIRequestContext, repository = 'beta') {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const checkout = checkouts.find(item => item.relativePath === repository)!;
  const response = await request.post('/api/projects', { data: { name: `Agent archive ${Date.now()}`, checkoutIds: [checkout.id] } });
  return { project: (await response.json()).project as DurableProject, checkout };
}

async function open(page: Page, request: APIRequestContext, allowed = true) {
  const target = await project(request);
  const response = await request.post('/api/sessions', { data: { projectId: target.project.id, provider: 'claude', allowAgentArchive: allowed } });
  expect(response.ok()).toBe(true);
  const { session } = await response.json() as { session: PublicSession };
  await page.goto(`/?session=${session.id}`);
  const conversation = page.getByRole('complementary', { name: 'Conversation', exact: true });
  await expect(conversation).toBeVisible();
  return { ...target, session, conversation };
}

async function saved(request: APIRequestContext, id: string) {
  const response = await request.get(`/api/sessions/${id}`);
  expect(response.ok()).toBe(true);
  return (await response.json()).session as PublicSession;
}

async function send(page: Page, text: string) {
  const conversation = page.getByRole('complementary', { name: 'Conversation', exact: true });
  await conversation.locator('textarea').fill(text);
  await expect(conversation.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await conversation.getByRole('button', { name: 'Send', exact: true }).click();
}

for (const theme of ['light', 'dark']) for (const width of [1280, 390]) {
  test(`explicit permission in setup and conversation survives reload: ${theme} ${width}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    const target = await project(request);
    await page.goto('/arena');
    await page.getByRole('button', { name: `New session in ${target.project.name}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New session', exact: true });
    await dialog.getByRole('button', { name: 'Settings', exact: true }).click();
    const allow = dialog.getByRole('checkbox', { name: 'Allow agent to archive', exact: true });
    await expect(allow).not.toBeChecked();
    await allow.check();
    const control = dialog.locator('label').filter({ hasText: 'Allow agent to archive' });
    const label = await control.locator('.MuiFormControlLabel-label').boundingBox();
    const checkbox = await control.locator('.MuiCheckbox-root').boundingBox();
    expect(Math.abs(label!.y + label!.height / 2 - checkbox!.y - checkbox!.height / 2)).toBeLessThan(5);
    await page.screenshot({ path: testInfo.outputPath('setup-permission.png'), animations: 'disabled' });
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    const creation = page.waitForResponse(response => response.url().endsWith('/api/sessions') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Create and open', exact: true }).click();
    const session = (await (await creation).json()).session as PublicSession;
    expect(session.allowAgentArchive).toBe(true);
    const conversation = page.getByRole('complementary', { name: 'Conversation', exact: true });
    const composer = conversation.locator('.instruction-composer');
    const settings = composer.getByRole('button', { name: 'Session settings', exact: true });
    await expect(conversation.locator('header').getByRole('button', { name: 'Session settings', exact: true })).toHaveCount(0);
    await expect(settings).toHaveAttribute('aria-expanded', 'false');
    const model = await composer.locator('.model-menu').boundingBox();
    const more = await settings.boundingBox();
    expect(more!.x).toBeGreaterThanOrEqual(model!.x + model!.width);
    expect(Math.abs(more!.y + more!.height / 2 - model!.y - model!.height / 2)).toBeLessThan(5);
    await composer.getByRole('textbox', { name: 'Instruction', exact: true }).fill('Keep this draft while changing settings.');
    await settings.click();
    const inlinePermission = composer.getByRole('checkbox', { name: 'Allow agent to archive', exact: true });
    await expect(inlinePermission).toBeChecked();
    await expect(settings).toHaveAttribute('aria-expanded', 'true');
    const permissionBounds = await composer.locator('label').filter({ hasText: 'Allow agent to archive' }).boundingBox();
    if (width === 1280) {
      expect(permissionBounds!.x).toBeGreaterThanOrEqual(more!.x + more!.width);
      expect(Math.abs(permissionBounds!.y + permissionBounds!.height / 2 - more!.y - more!.height / 2)).toBeLessThan(5);
    }
    expect(await composer.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await expect(composer.getByRole('button', { name: 'Send', exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('conversation-permission.png'), animations: 'disabled' });
    await settings.click();
    await expect(settings).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('checkbox', { name: 'Allow agent to archive', exact: true })).toBeHidden();
    await settings.focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('checkbox', { name: 'Allow agent to archive', exact: true })).toBeChecked();
    await expect(composer.getByRole('textbox', { name: 'Instruction', exact: true })).toHaveValue('Keep this draft while changing settings.');
    await composer.getByRole('button', { name: /^Model and effort for this agent/ }).click();
    await expect(settings).toHaveAttribute('aria-expanded', 'true');
    await expect(inlinePermission).toBeChecked();
    await page.keyboard.press('Escape');
    await page.getByRole('checkbox', { name: 'Allow agent to archive', exact: true }).uncheck();
    await expect.poll(async () => (await saved(request, session.id)).allowAgentArchive).toBe(false);
    await page.reload();
    await page.getByRole('button', { name: 'Session settings', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Allow agent to archive', exact: true })).not.toBeChecked();
  });
}

test('unchecked permission overrides a conversational archive request', async ({ page, request }) => {
  const { session, conversation } = await open(page, request, false);
  await send(page, 'Finish this and archive the session [archive-complete]');
  await expect(conversation.locator('.chat-message.assistant.complete')).toHaveCount(1);
  const current = await saved(request, session.id);
  expect(current.allowAgentArchive).not.toBe(true);
  expect(current.agentArchiveCheck).toBeUndefined();
  expect(current.messages).toHaveLength(2);
});

for (const theme of ['light', 'dark']) for (const width of [1280, 390]) {
  test(`auto-close commands save permission without an agent turn: ${theme} ${width}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    const { session, conversation } = await open(page, request, false);
    let turns = 0;
    page.on('request', request => { if (request.url().endsWith('/api/agent/message')) turns += 1; });
    const composer = conversation.locator('.instruction-composer');
    const input = composer.getByRole('textbox', { name: 'Instruction', exact: true });
    await input.fill('/autoclose');
    await input.press('Enter');
    await expect(composer.getByRole('status')).toHaveText('Auto-close enabled.');
    await expect(input).toBeEmpty();
    await expect(input).toBeFocused();
    expect((await saved(request, session.id)).allowAgentArchive).toBe(true);
    await composer.getByRole('button', { name: 'Session settings', exact: true }).click();
    await expect(composer.getByRole('checkbox', { name: 'Allow agent to archive', exact: true })).toBeChecked();
    await page.screenshot({ path: testInfo.outputPath('autoclose-enabled.png'), animations: 'disabled' });
    expect(await composer.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.reload();
    await conversation.getByRole('button', { name: 'Session settings', exact: true }).click();
    await expect(composer.getByRole('checkbox', { name: 'Allow agent to archive', exact: true })).toBeChecked();
    await input.fill('/autoclose off');
    await composer.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(composer.getByRole('status')).toHaveText('Auto-close disabled.');
    await expect(input).toBeFocused();
    await expect(composer.getByRole('checkbox', { name: 'Allow agent to archive', exact: true })).not.toBeChecked();
    await input.fill(' /AUTOCLOSE on ');
    await input.press('Enter');
    await expect(composer.getByRole('status')).toHaveText('Auto-close enabled.');
    expect((await saved(request, session.id)).messages).toHaveLength(0);
    expect(turns).toBe(0);
    await page.reload();
    expect((await saved(request, session.id)).allowAgentArchive).toBe(true);
  });
}

test('failed auto-close commands keep the draft for keyboard retry', async ({ page, request }) => {
  const { session, conversation } = await open(page, request, false);
  let fail = true;
  await page.route(`**/api/sessions/${session.id}`, route => {
    if (route.request().method() === 'PATCH' && fail) {
      fail = false;
      return route.fulfill({ status: 503, json: { error: 'Permission could not be saved. Try again.' } });
    }
    return route.continue();
  });
  const input = conversation.getByRole('textbox', { name: 'Instruction', exact: true });
  await input.fill('/autoclose');
  await input.press('Enter');
  await expect(conversation.getByRole('alert')).toHaveText('Permission could not be saved. Try again.');
  await expect(input).toHaveValue('/autoclose');
  expect((await saved(request, session.id)).allowAgentArchive).not.toBe(true);
  await input.press('Enter');
  await expect(conversation.locator('.instruction-composer').getByRole('status')).toHaveText('Auto-close enabled.');
  await expect(input).toBeEmpty();
  expect((await saved(request, session.id)).messages).toHaveLength(0);
});

test('inline auto-close sends the remaining text while code examples stay literal', async ({ page, request }) => {
  const { session, conversation } = await open(page, request, false);
  const input = conversation.getByRole('textbox', { name: 'Instruction', exact: true });
  for (const [index, text] of ['/autoclose later', '/autoclose\nAlso do some work'].entries()) {
    await input.fill(text);
    await input.press('Enter');
    await expect(conversation.locator('.chat-message.assistant.complete')).toHaveCount(index + 1);
    await expect(input).toBeEmpty();
    expect((await saved(request, session.id)).allowAgentArchive).toBe(true);
    expect((await saved(request, session.id)).messages.filter(message => message.role === 'user').at(-1)?.text).toBe(text.replace('/autoclose', '').trim());
  }
  await input.fill('/autoclose off');
  await input.press('Enter');
  await expect(input).toBeEmpty();
  await send(page, 'Explain `/autoclose` without enabling it.');
  await expect(conversation.locator('.chat-message.assistant.complete')).toHaveCount(3);
  expect((await saved(request, session.id)).allowAgentArchive).not.toBe(true);
});

test('a delayed command saves once and preserves newer text and attachments', async ({ page, request }) => {
  const { session, conversation } = await open(page, request, false);
  const composer = conversation.locator('.instruction-composer');
  const input = composer.getByRole('textbox', { name: 'Instruction', exact: true });
  await composer.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Keep this evidence') });
  const attachment = composer.getByRole('button', { name: 'Remove file notes.txt', exact: true });
  await expect(attachment).toBeVisible();
  let patches = 0;
  let release!: () => void;
  const resume = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/sessions/${session.id}`, async route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    patches += 1;
    await resume;
    await route.continue();
  });
  try {
    await input.fill('/autoclose');
    await input.press('Enter');
    await expect.poll(() => patches).toBe(1);
    await input.press('Enter');
    await input.fill('Keep this new draft.');
  } finally { release(); }
  await expect(composer.getByRole('status')).toHaveText('Auto-close enabled.');
  await expect(input).toHaveValue('Keep this new draft.');
  await expect(attachment).toBeVisible();
  expect(patches).toBe(1);
  expect((await saved(request, session.id)).messages).toHaveLength(0);
  await input.fill('/autoclose off');
  await input.press('Enter');
  await expect(composer.getByRole('status')).toHaveText('Auto-close disabled.');
  await expect(input).toBeEmpty();
  await expect(attachment).toBeVisible();
});

for (const revisit of [false, true]) test(`a pending command stays with its session after switching conversations: revisit ${revisit}`, async ({ page, request }) => {
  const { session, conversation, project } = await open(page, request, false);
  const sibling = (await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json()).session as PublicSession;
  await page.reload();
  let held = false;
  let release!: () => void;
  const resume = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/sessions/${session.id}`, async route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    held = true;
    await resume;
    await route.continue();
  });
  const input = conversation.getByRole('textbox', { name: 'Instruction', exact: true });
  try {
    await input.fill('/autoclose');
    await input.press('Enter');
    await expect.poll(() => held).toBe(true);
    await sessionTab(page, sibling.id).click();
    await input.fill('Draft for the other conversation.');
    if (revisit) {
      await sessionTab(page, session.id).click();
      await input.fill('Edited after returning.');
      await input.fill('/autoclose');
      await conversation.getByRole('button', { name: 'Session settings', exact: true }).click();
    }
  } finally { release(); }
  await expect.poll(async () => (await saved(request, session.id)).allowAgentArchive).toBe(true);
  if (revisit) {
    await expect(conversation.getByRole('checkbox', { name: 'Allow agent to archive', exact: true })).toBeChecked();
    await expect(input).toHaveValue('/autoclose');
  } else {
    await expect(input).toHaveValue('Draft for the other conversation.');
    await sessionTab(page, session.id).click();
    await expect(input).toBeEmpty();
  }
  await expect(conversation.locator('.instruction-composer').getByRole('status')).toHaveCount(0);
  expect((await saved(request, sibling.id)).allowAgentArchive).not.toBe(true);
});

test('failed permission saves roll back visibly and remain retryable', async ({ page, request }) => {
  const { session, conversation } = await open(page, request, false);
  let fail = true;
  await page.route(`**/api/sessions/${session.id}`, route => {
    if (route.request().method() === 'PATCH' && fail) {
      fail = false;
      return route.fulfill({ status: 503, json: { error: 'Permission could not be saved. Try again.' } });
    }
    return route.continue();
  });
  await conversation.getByRole('button', { name: 'Session settings', exact: true }).click();
  const allow = page.getByRole('checkbox', { name: 'Allow agent to archive', exact: true });
  await allow.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Permission could not be saved' })).toBeVisible();
  await expect(allow).not.toBeChecked();
  expect((await saved(request, session.id)).allowAgentArchive).not.toBe(true);
  await allow.check();
  await expect.poll(async () => (await saved(request, session.id)).allowAgentArchive).toBe(true);
});

test('KEEP_OPEN remains an ordinary usable conversation with no hidden chat messages', async ({ page, request }) => {
  const { session, conversation } = await open(page, request);
  await send(page, 'Explain the remaining work [archive-keep-open]');
  await expect.poll(async () => (await saved(request, session.id)).agentArchiveCheck?.status).toBe('kept-open');
  await conversation.getByRole('button', { name: 'Session settings', exact: true }).click();
  await expect(page.getByText('Agent kept this session open.', { exact: true })).toBeVisible();
  await expect(conversation.getByRole('button', { name: /^(Check completion|Retry check)$/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await send(page, 'Continue explaining.');
  await expect(conversation.locator('.chat-message.assistant.complete')).toHaveCount(2);
  expect((await saved(request, session.id)).messages).toHaveLength(4);
});

test('permission can be enabled during a coding turn', async ({ page, request }) => {
  const { session, conversation } = await open(page, request, false);
  await send(page, 'Finish the task [archive-complete] [archive-check-delay]');
  const input = conversation.getByRole('textbox', { name: 'Instruction', exact: true });
  await expect(conversation.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await input.fill('/autoclose');
  await input.press('Enter');
  await expect(conversation.locator('.instruction-composer').getByRole('status')).toHaveText('Auto-close enabled.');
  await expect(page.getByText(/^Archived by agent:/)).toBeVisible({ timeout: 15_000 });
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  expect(snapshot.machines.flatMap(machine => machine.archivedSessions).find(item => item.id === session.id)?.agentArchiveCheck?.status).toBe('archived');
});

test('revoking during a delayed check prevents its archive decision', async ({ page, request }) => {
  const { session, conversation } = await open(page, request);
  await send(page, 'Finish the task [archive-complete] [archive-check-delay]');
  await expect.poll(async () => (await saved(request, session.id)).agentArchiveCheck?.status).toBe('checking');
  const input = conversation.getByRole('textbox', { name: 'Instruction', exact: true });
  await input.fill('/autoclose off');
  await input.press('Enter');
  await expect.poll(async () => (await saved(request, session.id)).allowAgentArchive).toBe(false);
  // The fixture returns its stale ARCHIVE decision after 2.5 seconds.
  await page.waitForTimeout(2800);
  expect((await saved(request, session.id)).agentArchiveCheck).toBeUndefined();
  await expect(conversation).toBeVisible();
});

test('a completed follow-up receives its own check while an older decision is pending', async ({ page, request }) => {
  const { session } = await open(page, request);
  await send(page, 'Finish task one [archive-complete] [archive-check-delay]');
  await expect.poll(async () => (await saved(request, session.id)).agentArchiveCheck?.status).toBe('checking');
  await send(page, 'Also finish task two [archive-complete]');
  await expect(page.getByText(/^Archived by agent:/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.goto(`/?session=${session.id}`);
  const current = await saved(request, session.id);
  expect(current.messages).toHaveLength(4);
  expect(current.agentArchiveCheck).toBeUndefined();
  await expect(page.getByRole('complementary', { name: 'Conversation', exact: true }).locator('.chat-message.assistant.complete')).toHaveCount(2);
});

for (const width of [1280, 390]) test(`failed decisions preserve the reply and recheck automatically after a follow-up: ${width}`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 844 });
  const { session, conversation } = await open(page, request);
  await send(page, 'Review this [archive-check-invalid]');
  await expect.poll(async () => (await saved(request, session.id)).agentArchiveCheck?.status).toBe('failed');
  const first = await saved(request, session.id);
  await conversation.getByRole('button', { name: 'Session settings', exact: true }).click();
  await expect(page.getByText('Completion check unavailable. Session kept open.', { exact: true })).toBeVisible();
  const composer = conversation.locator('.instruction-composer');
  expect(await composer.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect(composer.getByRole('button', { name: 'Send', exact: true })).toBeInViewport();
  await expect(composer.getByRole('button', { name: /^(Check completion|Retry check)$/ })).toHaveCount(0);
  expect((await saved(request, session.id)).messages).toEqual(first.messages);
  await send(page, 'Continue reviewing [archive-keep-open]');
  await expect.poll(async () => (await saved(request, session.id)).agentArchiveCheck?.status).toBe('kept-open');
  const current = await saved(request, session.id);
  expect(current.agentArchiveCheck?.id).not.toBe(first.agentArchiveCheck!.id);
  expect(current.messages.slice(0, first.messages.length)).toEqual(first.messages);
  expect(current.messages).toHaveLength(4);
  await expect(composer.getByRole('button', { name: /^(Check completion|Retry check)$/ })).toHaveCount(0);
});

test('a late pre-archive response cannot reopen the removed conversation', async ({ page, request }) => {
  const { session } = await open(page, request);
  let held = false;
  let released = false;
  let release!: () => void;
  const resume = new Promise<void>(resolve => { release = resolve; });
  await page.route(new RegExp(`/api/sessions/${session.id}(?:\\?.*)?$`), async route => {
    if (held || route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const data = await response.json() as { session?: PublicSession };
    if ((data.session?.messages.length ?? 0) < 2) return route.fulfill({ response });
    held = true;
    await resume;
    await route.fulfill({ response }).catch(() => undefined);
    released = true;
  });
  try {
    await send(page, 'Complete the task [archive-complete] [archive-check-delay]');
    await expect.poll(() => held).toBe(true);
    await expect(page.getByText(/^Archived by agent:/)).toBeVisible({ timeout: 15_000 });
  } finally { release(); }
  await expect.poll(() => released).toBe(true);
  await expect(page).not.toHaveURL(new RegExp(`session=${session.id}`));
  await expect(sessionTab(page, session.id)).toHaveCount(0);
});

test('agent archive releases a queued idea and remains restorable with its final response', async ({ page, request }) => {
  const target = await project(request, 'alpha');
  const arena = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  for (const machine of arena.machines) for (const earlier of machine.sessions) {
    if (earlier.lastActivity && earlier.repositoryCheckoutIds.includes(target.checkout.id)) {
      expect((await request.post(`/api/sessions/${earlier.id}/archive`, { data: { expectedRevision: earlier.revision } })).ok()).toBe(true);
    }
  }
  const create = async (allowAgentArchive: boolean) => (await (await request.post('/api/sessions', {
    data: { projectId: target.project.id, provider: 'claude', allowAgentArchive },
  })).json()).session as PublicSession;
  const source = await create(true);
  const next = await create(false);
  await page.goto(`/?session=${source.id}`);
  await send(page, 'Finish earlier work [archive-complete] [archive-check-delay]');
  await expect.poll(async () => (await saved(request, source.id)).agentArchiveCheck?.status).toBe('checking');
  const accepted = await page.evaluate(async session => {
    const response = await fetch('/api/agent/message', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, participantId: session.primaryAgentId, messageId: crypto.randomUUID(),
        text: 'Explain the next queued idea.', mode: 'ask', diagramAttachments: [], waitForCheckout: true }) });
    const result = { status: response.status, state: response.headers.get('X-CodeAI-Run-State') };
    await response.body?.cancel();
    return result;
  }, next);
  expect(accepted).toEqual({ status: 200, state: 'queued' });
  await expect.poll(async () => (await saved(request, next.id)).messages.at(-1)?.role, { timeout: 15_000 }).toBe('assistant');
  await page.goto('/arena/archived');
  const archivedCard = page.getByRole('article').filter({ hasText: target.project.name });
  await expect(archivedCard.getByText('Archived by agent', { exact: true })).toBeVisible();
  await archivedCard.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect.poll(async () => (await request.get(`/api/sessions/${source.id}`)).status()).toBe(200);
  const restored = await saved(request, source.id);
  expect(restored.messages).toHaveLength(2);
  expect(restored.messages.at(-1)?.role).toBe('assistant');
});
