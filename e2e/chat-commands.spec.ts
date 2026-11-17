import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { ArenaSnapshot, CheckoutsResponse, DurableProject, PublicSession } from '../src/shared/types';

async function open(page: Page, request: APIRequestContext, siblings = 0) {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const { project } = await (await request.post('/api/projects', { data: {
    name: `Commands ${Date.now()}`, checkoutIds: [checkouts.find(checkout => checkout.name === 'beta')!.id],
  } })).json() as { project: DurableProject };
  const sessions: PublicSession[] = [];
  for (let index = 0; index <= siblings; index++) {
    const response = await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } });
    expect(response.ok()).toBe(true);
    sessions.push((await response.json()).session);
  }
  await page.goto(`/?session=${sessions[0].id}`);
  const conversation = page.getByRole('complementary', { name: 'Conversation', exact: true });
  const input = conversation.getByRole('textbox', { name: 'Instruction', exact: true });
  await expect(input).toBeVisible();
  return { project, sessions, conversation, input };
}

async function saved(request: APIRequestContext, id: string) {
  return (await (await request.get(`/api/sessions/${id}`)).json()).session as PublicSession;
}

for (const theme of ['light', 'dark']) for (const width of [1280, 390]) {
  test(`keyboard commands and inline next session: ${theme} ${width}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    const { project, sessions: [session], input } = await open(page, request);
    let turns = 0;
    page.on('request', request => { if (request.url().endsWith('/api/agent/message')) turns++; });
    await input.fill('/');
    const suggestions = page.getByRole('listbox', { name: 'Chat commands', exact: true });
    await expect(suggestions.getByRole('option')).toHaveCount(4);
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    await input.press('ArrowUp');
    await expect(suggestions.getByRole('option', { selected: true })).toContainText('/close');
    await input.press('ArrowDown');
    await expect(suggestions.getByRole('option', { selected: true })).toContainText('/autoclose');
    await page.screenshot({ path: testInfo.outputPath('commands.png'), animations: 'disabled' });
    await input.press('Tab');
    await expect(input).toHaveValue('/autoclose');
    await expect(input).toBeFocused();
    await input.press('Enter');
    await expect(input).toBeEmpty();
    expect((await saved(request, session.id)).allowAgentArchive).toBe(true);
    await input.fill('/autoclose o');
    await expect(suggestions.getByRole('option')).toHaveCount(2);
    await input.press('ArrowDown');
    await input.press('Enter');
    await expect(input).toHaveValue('/autoclose off');
    await input.press('Enter');
    await expect(input).toBeEmpty();
    expect((await saved(request, session.id)).allowAgentArchive).toBe(false);
    await input.fill('/ar');
    await input.press('Enter');
    await expect(input).toHaveValue('/archive');
    await input.press('Enter');
    const setup = page.getByRole('region', { name: 'New session', exact: true });
    const first = setup.getByRole('textbox', { name: 'First message (optional)', exact: true });
    await expect(setup).toBeVisible();
    await expect(first).toBeFocused();
    await expect(first).toBeInViewport();
    expect(await first.evaluate(node => {
      const box = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    })).toBe(true);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(setup.getByLabel('Project', { exact: true })).toHaveValue(project.id);
    expect((await request.get(`/api/sessions/${session.id}`)).status()).toBe(404);
    expect(turns).toBe(0);
    expect(await page.locator('body').evaluate(node => node.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('inline-setup.png'), animations: 'disabled' });
    await first.fill('Begin the next task from the keyboard.');
    await first.press('Enter');
    await expect(page.getByRole('complementary', { name: 'Conversation', exact: true })).toContainText('Begin the next task from the keyboard.');
    await expect(input).toBeFocused();
    const current = (await (await request.get(`/api/sessions?projectId=${project.id}`)).json()).sessions as PublicSession[];
    expect(current).toHaveLength(1);
    expect(current[0].id).not.toBe(session.id);
    expect(current[0].messages[0]).toMatchObject({ role: 'user', text: 'Begin the next task from the keyboard.' });
  });
}

test('completion supports click, Escape, Shift+Enter and ordinary text', async ({ page, request }) => {
  const { input, conversation } = await open(page, request);
  const suggestions = page.getByRole('listbox', { name: 'Chat commands', exact: true });
  await input.fill('/');
  await input.press('Escape');
  await expect(suggestions).toHaveCount(0);
  await expect(input).toHaveValue('/');
  await input.fill('/auto');
  await suggestions.getByRole('option', { name: /^\/autoclose Allow/ }).click();
  await expect(input).toHaveValue('/autoclose');
  await expect(input).toBeFocused();
  await input.fill('/archive');
  await input.press('Shift+Enter');
  await expect(input).toHaveValue('/archive\n');
  await expect(suggestions).toHaveCount(0);
  for (const text of ['/model', '/src/app', 'Explain /autoclose']) {
    await input.fill(text);
    await expect(suggestions).toHaveCount(0);
  }
  await input.press('Enter');
  await expect(conversation.locator('.chat-message.assistant.complete')).toHaveCount(1);
});

test('new creates a fresh conversation and keeps the source history', async ({ page, request }) => {
  const { sessions: [session], input } = await open(page, request);
  await input.fill('/new');
  await input.press('Enter');
  await expect(page).not.toHaveURL(new RegExp(session.id));
  await expect(input).toBeEmpty();
  await expect(input).toBeFocused();
  expect((await saved(request, session.id)).archivedAt).toBeUndefined();
  const nextId = new URL(page.url()).searchParams.get('session')!;
  const next = await saved(request, nextId);
  expect(next.projectId).toBe(session.projectId);
  expect(next.repositories).toEqual(session.repositories);
  expect(next.messages).toHaveLength(0);
});

test('failed archive and new commands retain evidence and retry once', async ({ page, request }) => {
  const { sessions: [session], input, conversation } = await open(page, request);
  const composer = conversation.locator('.instruction-composer');
  await composer.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Keep these notes') });
  const attachment = composer.getByRole('button', { name: 'Remove file notes.txt', exact: true });
  await expect(attachment).toBeVisible();
  await page.route(`**/api/sessions/${session.id}/archive`, route => route.fulfill({ status: 503, json: { error: 'Archive unavailable.' } }), { times: 1 });
  await input.fill('/close');
  await input.press('Enter');
  await expect(composer.getByRole('alert')).toContainText('Could not archive');
  await expect(input).toHaveValue('/close');
  await expect(attachment).toBeVisible();
  await page.route('**/api/sessions', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, json: { error: 'Creation unavailable.' } }) : route.continue(), { times: 1 });
  await input.fill('/new');
  await input.press('Enter');
  await expect(composer.getByRole('alert')).toContainText('Could not create');
  await expect(input).toHaveValue('/new');
  await expect(attachment).toBeVisible();
  await input.press('Enter');
  await expect(page).not.toHaveURL(new RegExp(session.id));
  expect((await saved(request, session.id)).messages).toHaveLength(0);
});

test('archive keeps another open project session focused', async ({ page, request }) => {
  const { sessions, input } = await open(page, request, 1);
  await page.getByRole('combobox', { name: 'All sessions', exact: true }).selectOption(sessions[1].id);
  await page.getByRole('combobox', { name: 'All sessions', exact: true }).selectOption(sessions[0].id);
  await input.fill('/close');
  await input.press('Enter');
  await expect(page).toHaveURL(new RegExp(sessions[1].id));
  await expect(input).toBeFocused();
  await expect(page.getByRole('region', { name: 'New session', exact: true })).toHaveCount(0);
});

test('agent archival also focuses inline setup for the final session', async ({ page, request }) => {
  const { input } = await open(page, request);
  await input.fill('/autoclose');
  await input.press('Enter');
  await expect(input).toBeEmpty();
  await input.fill('Finish the task [archive-complete]');
  await input.press('Enter');
  await expect(page.getByRole('region', { name: 'New session', exact: true })
    .getByRole('textbox', { name: 'First message (optional)', exact: true })).toBeFocused({ timeout: 15_000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('archive controls focus inline setup, retain failed setup and support Undo', async ({ page, request }) => {
  const { project, sessions: [session] } = await open(page, request);
  await page.getByRole('button', { name: /^Archive this session:/ }).click();
  const setup = page.getByRole('region', { name: 'New session', exact: true });
  const first = setup.getByRole('textbox', { name: 'First message (optional)', exact: true });
  await expect(first).toBeFocused();
  await page.route('**/api/sessions', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, json: { error: 'Setup unavailable.' } }) : route.continue(), { times: 1 });
  await first.fill('Keep this setup draft');
  await first.press('Enter');
  await expect(setup.getByRole('alert')).toContainText('Setup unavailable.');
  await expect(first).toHaveValue('Keep this setup draft');
  await expect(setup.getByRole('button', { name: 'Retry', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Undo archive', exact: true }).click();
  await expect.poll(async () => (await request.get(`/api/sessions/${session.id}`)).status()).toBe(200);
  await expect(first).toHaveValue('Keep this setup draft');
  await setup.getByRole('button', { name: 'Retry', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('complementary', { name: 'Conversation', exact: true })).toContainText('Keep this setup draft');
  expect((await saved(request, session.id)).messages).toHaveLength(0);
  expect((await (await request.get(`/api/sessions?projectId=${project.id}`)).json()).sessions).toHaveLength(2);
});

test('an active session without an open view prevents automatic setup', async ({ page, request }) => {
  const { sessions, input } = await open(page, request, 1);
  await input.fill('/archive');
  await input.press('Enter');
  await expect(page).not.toHaveURL(new RegExp(sessions[0].id));
  await expect(page.getByRole('region', { name: 'New session', exact: true })).toHaveCount(0);
  expect((await saved(request, sessions[1].id)).archivedAt).toBeUndefined();
});

test('a delayed archive does not open setup after navigating to another project', async ({ page, request }) => {
  const { sessions: [session], input } = await open(page, request);
  const { project } = await (await request.post('/api/projects', { data: { name: `Other commands ${Date.now()}` } })).json();
  let release!: () => void;
  const resume = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/sessions/${session.id}/archive`, async route => { await resume; await route.continue(); });
  await input.fill('/close');
  const archiveRequest = page.waitForRequest(request => request.url().endsWith(`/${session.id}/archive`));
  await input.press('Enter');
  await archiveRequest;
  await page.evaluate(id => window.history.pushState(null, '', `/?project=${id}`), project.id);
  await expect(page.locator('.project-search-trigger')).toContainText(project.name);
  release();
  await expect.poll(async () => (await request.get(`/api/sessions/${session.id}`)).status()).toBe(404);
  await expect(page).toHaveURL(`/?project=${project.id}`);
  await expect(page.getByRole('region', { name: 'New session', exact: true })).toHaveCount(0);
});

test('archive/new commands respect live-turn guards while autoclose remains usable', async ({ page, request }) => {
  const { input, conversation, sessions: [session] } = await open(page, request);
  await input.fill('Wait for reload cancellation.');
  await input.press('Enter');
  await expect(conversation.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  for (const command of ['/archive', '/new']) {
    await input.fill(command);
    await input.press('Enter');
    await expect(conversation.locator('.instruction-composer').getByRole('alert')).toHaveText('Wait for this turn to finish.');
    await expect(input).toHaveValue(command);
  }
  await input.fill('/autoclose');
  await input.press('Enter');
  await expect(input).toBeEmpty();
  expect((await saved(request, session.id)).allowAgentArchive).toBe(true);
  await conversation.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('inline setup closes on project navigation while its draft remains recoverable', async ({ page, request }) => {
  const { input } = await open(page, request);
  await input.fill('/archive');
  await input.press('Enter');
  const first = page.getByRole('region', { name: 'New session', exact: true }).getByRole('textbox');
  await expect(first).toBeFocused();
  await first.fill('Retain the original project draft');
  const { project } = await (await request.post('/api/projects', { data: { name: `Navigate commands ${Date.now()}` } })).json();
  await page.evaluate(id => window.history.pushState(null, '', `/?project=${id}`), project.id);
  await expect(page.locator('.project-search-trigger')).toContainText(project.name);
  await expect(page.getByRole('region', { name: 'New session', exact: true })).toHaveCount(0);
  await page.locator('.welcome-screen').getByRole('button', { name: 'New session', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'New session', exact: true });
  await expect(setup.getByRole('textbox')).toHaveValue('Retain the original project draft');
  await expect(setup).toContainText('A setup draft is already pending for another target.');
});

test('a sibling created in another browser prevents automatic setup', async ({ page, request }) => {
  const { project, input } = await open(page, request);
  const response = await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } });
  const { session } = await response.json() as { session: PublicSession };
  await input.fill('/close');
  await input.press('Enter');
  await expect(page.getByText(/^Archived “/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'New session', exact: true })).toHaveCount(0);
  expect((await saved(request, session.id)).archivedAt).toBeUndefined();
});

test('archive subscription can arrive before the archive response', async ({ page, request }) => {
  const { input, project, sessions: [session] } = await open(page, request);
  let release!: () => void;
  const resume = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/sessions/${session.id}/archive`, async route => {
    const response = await route.fetch();
    await resume;
    await route.fulfill({ response });
  });
  await input.fill('/archive');
  await input.press('Enter');
  try {
    await expect(page.getByRole('region', { name: 'New session', exact: true }).getByRole('textbox')).toBeFocused();
    await expect(page).toHaveURL(`/?project=${project.id}`);
    await expect(page.getByRole('region', { name: 'Workspace unavailable', exact: true })).toHaveCount(0);
  } finally { release(); }
  await expect(page.getByText(/^Archived “/)).toBeVisible();
});

test('inline setup reveals the canvas after a retained maximized project file', async ({ page, request }) => {
  const { project, sessions: [session] } = await open(page, request);
  await page.evaluate(id => window.history.pushState(null, '', `/?project=${id}`), project.id);
  const files = page.getByRole('complementary', { name: 'Files', exact: true });
  await files.getByRole('button', { name: 'pyproject.toml', exact: true }).click();
  const fileView = page.getByRole('region', { name: 'File view', exact: true });
  await fileView.getByRole('button', { name: 'Maximize File view', exact: true }).click();
  await page.getByRole('combobox', { name: 'All sessions', exact: true }).selectOption(session.id);
  const input = page.getByRole('complementary', { name: 'Conversation', exact: true }).getByRole('textbox', { name: 'Instruction', exact: true });
  await input.fill('/archive');
  await input.press('Enter');
  const first = page.getByRole('region', { name: 'New session', exact: true }).getByRole('textbox');
  await expect(first).toBeFocused();
  await expect(first).toBeInViewport();
  expect(await first.evaluate(node => {
    const box = node.getBoundingClientRect();
    return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })).toBe(true);
  await expect(page.getByRole('tab', { name: /pyproject.toml/ })).toHaveCount(1);
});

test('one snapshot archiving several open sessions uses the final surviving focus', async ({ page, request }) => {
  let heldSnapshot: ArenaSnapshot | undefined;
  await page.route('**/api/arena', async route => {
    heldSnapshot ??= await (await request.get('/api/arena')).json() as ArenaSnapshot;
    if (route.request().headers().accept === 'application/x-ndjson') {
      return route.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'snapshot', snapshot: heldSnapshot })}\n` });
    }
    return route.fulfill({ json: heldSnapshot });
  });
  const { project, sessions } = await open(page, request, 1);
  await page.getByRole('combobox', { name: 'All sessions', exact: true }).selectOption(sessions[1].id);
  await page.getByRole('combobox', { name: 'All sessions', exact: true }).selectOption(sessions[0].id);
  // Focused first reproduces navigation toward the other tab removed later in the same snapshot.
  for (const session of sessions) {
    const response = await request.post(`/api/sessions/${session.id}/archive`, { data: { expectedRevision: session.revision } });
    expect(response.ok()).toBe(true);
  }
  await page.unroute('**/api/arena');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('region', { name: 'New session', exact: true }).getByRole('textbox')).toBeFocused();
  await expect(page).toHaveURL(`/?project=${project.id}`);
  await expect(page.getByRole('region', { name: 'Workspace unavailable', exact: true })).toHaveCount(0);
});

test('a delayed archive response cannot remove a newly restored conversation', async ({ page, request }) => {
  const { input, sessions: [session] } = await open(page, request);
  let release!: () => void;
  const resume = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/sessions/${session.id}/archive`, async route => {
    const response = await route.fetch();
    await resume;
    await route.fulfill({ response });
  });
  await input.fill('/archive');
  await input.press('Enter');
  try {
    await expect(page.getByRole('region', { name: 'New session', exact: true }).getByRole('textbox')).toBeFocused();
    const arena = await (await request.get('/api/arena')).json() as ArenaSnapshot;
    const archived = arena.machines.flatMap(machine => machine.archivedSessions).find(item => item.id === session.id)!;
    const restored = await request.post(`/api/sessions/${session.id}/restore`, { data: { expectedRevision: archived.revision } });
    expect(restored.ok()).toBe(true);
    await page.evaluate(id => window.history.pushState(null, '', `/?session=${id}`), session.id);
    await expect(input).toBeVisible();
  } finally { release(); }
  await expect(page.getByRole('button', { name: 'Archive session', exact: true })).toBeEnabled();
  await expect(page).toHaveURL(new RegExp(`session=${session.id}$`));
  await expect(input).toBeVisible();
  expect((await saved(request, session.id)).archivedAt).toBeUndefined();
});
