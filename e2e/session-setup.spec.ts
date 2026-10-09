import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { CheckoutsResponse, DurableProject, PublicSession } from '../src/shared/types';

async function project(request: APIRequestContext, name = `Setup ${Date.now()}`, repository = 'alpha') {
  const catalog = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const checkout = catalog.checkouts.find((item) => item.relativePath === repository);
  if (!checkout) throw new Error(`Missing fixture checkout: ${JSON.stringify(catalog)}`);
  const response = await request.post('/api/projects', { data: { name, checkoutIds: [checkout.id] } });
  return { project: (await response.json()).project as DurableProject, catalog, checkout };
}
async function openSetup(page: Page, target: DurableProject) {
  await page.goto('/arena');
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New session', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Project', { exact: true }).selectOption(target.id);
  await dialog.getByLabel('Provider', { exact: true }).selectOption('claude');
  return dialog;
}

test('same-project Arena card opens a background turn that completed before acceptance returned', async ({ page, request }) => {
  const { project: target } = await project(request);
  const source = (await (await request.post('/api/sessions', { data: { projectId: target.id, provider: 'claude' } })).json()).session as PublicSession;
  await page.goto('/'); await chooseProject(page, target);
  await expect(page.getByRole('combobox', { name: 'All sessions', exact: true })).toHaveValue(source.id);
  await page.locator('.conversation-drawer textarea').fill('Keep the source draft');
  await page.getByRole('link', { name: 'Arena', exact: true }).click();
  // Buffer the real provider response so the accepted run is already retained when launch returns.
  await page.route('**/api/agent/message', async (route) => route.fulfill({ response: await route.fetch() }));
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New session', exact: true });
  await dialog.getByLabel('Project', { exact: true }).selectOption(target.id);
  await dialog.getByLabel('Provider', { exact: true }).selectOption('claude');
  await dialog.getByLabel('Mode', { exact: true }).selectOption('ask');
  await dialog.getByRole('textbox').fill('Background Arena completion');
  await dialog.getByRole('button', { name: 'Start in background', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/\/arena$/);
  await page.getByRole('button', { name: 'Open Background Arena completion', exact: true }).click();
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await expect(conversation).toContainText('Background Arena completion');
  await expect(conversation).toContainText('First turn complete.');
  await expect(conversation.locator('.chat-message.user.sent')).toHaveCount(1);
  await page.getByRole('tab', { name: new RegExp(source.title) }).click();
  await expect(conversation.locator('textarea')).toHaveValue('Keep the source draft');
});

test('same-project background approvals and replies stay connected while another launch queues', async ({ page, request }) => {
  const { project: target } = await project(request);
  const source = (await (await request.post('/api/sessions', { data: { projectId: target.id, provider: 'claude' } })).json()).session as PublicSession;
  await page.goto('/'); await chooseProject(page, target);
  await expect(page.getByRole('combobox', { name: 'All sessions', exact: true })).toHaveValue(source.id);
  const launches: PublicSession[] = [];
  const start = async (text: string, mode: 'ask' | 'agent') => {
    await page.getByRole('link', { name: 'Arena', exact: true }).click();
    await page.getByRole('button', { name: 'New session', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New session', exact: true });
    await dialog.getByLabel('Project', { exact: true }).selectOption(target.id);
    await dialog.getByLabel('Provider', { exact: true }).selectOption('claude');
    await dialog.getByLabel('Mode', { exact: true }).selectOption(mode);
    await dialog.getByRole('textbox').fill(text);
    const created = page.waitForResponse((response) => response.url().endsWith('/api/sessions') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Start in background', exact: true }).click();
    launches.push((await (await created).json()).session);
    await expect(dialog).not.toBeVisible();
    await page.getByRole('button', { name: `Open ${text}`, exact: true }).click();
  };
  try {
    await start('Background approval connection', 'agent');
    const conversation = page.getByRole('complementary', { name: 'Conversation' });
    await expect(conversation).toContainText('Background approval connection');
    await expect(conversation.getByRole('button', { name: 'Allow', exact: true })).toBeVisible();
    await start('Background queued connection', 'ask');
    await expect(conversation).toContainText('Background queued connection');
    await expect(page.getByRole('tab', { name: /Background approval connection/ })).toHaveClass(/awaiting-approval/);
    await expect(page.getByRole('tab', { name: /Background queued connection/ })).toHaveClass(/queued/);
    await page.getByRole('tab', { name: /Background approval connection/ }).click();
    await conversation.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect(conversation).toContainText('Edit approved — I applied it.');
    await page.getByRole('tab', { name: /Background queued connection/ }).click();
    await expect(conversation).toContainText('First turn complete.');
    await expect(conversation.locator('.chat-message.user.sent')).toHaveCount(1);
  } finally {
    for (const session of launches) {
      const discovery = await (await request.get(`/api/agent/runs?sessionId=${session.id}`)).json();
      for (const run of discovery.active) await request.post('/api/agent/cancel', { data: { runId: run.runId } });
    }
  }
});

for (const scope of ['same-project', 'other-project']) test(`${scope} background startup failure replays its retained error without reload`, async ({ page, request }) => {
  const { project: target } = await project(request);
  const sourceProject = scope === 'same-project' ? target : (await project(request, `Other ${Date.now()}`, 'beta')).project;
  const source = (await (await request.post('/api/sessions', { data: { projectId: sourceProject.id, provider: 'claude' } })).json()).session as PublicSession;
  await page.goto('/'); await chooseProject(page, sourceProject);
  await expect(page.getByRole('combobox', { name: 'All sessions', exact: true })).toHaveValue(source.id);
  const runId = crypto.randomUUID();
  const failure = 'The turn checkpoint could not be saved. The agent did not start.';
  await page.route('**/api/agent/message', async (route) => {
    const body = route.request().postDataJSON();
    const saved = (await (await request.get(`/api/sessions/${body.sessionId}`)).json()).session as PublicSession;
    saved.messages.push({ id: body.messageId, role: 'user', authorId: saved.participants.find((item) => item.kind === 'human')!.id,
      addressedParticipantId: body.participantId, text: body.text, createdAt: new Date().toISOString(),
      status: 'failed', delivery: 'not-sent', mode: body.mode, diagramAttachments: [] });
    const run = { runId, sessionId: saved.id, participantId: body.participantId, mode: body.mode,
      state: 'finished', enqueuedAt: Date.now(), finishedAt: Date.now(), pendingPermissionCount: 0,
      pendingPermissions: [], outcome: 'failed', status: failure };
    await page.route(`**/api/sessions/${saved.id}`, (snapshot) => snapshot.fulfill({ json: { session: saved } }));
    await page.route(/\/api\/agent\/runs(?:\?.*)?$/, (discovery) => discovery.fulfill({ json: { active: [], recent: [run] } }));
    await page.route(`**/api/agent/stream?runId=${runId}`, (stream) => stream.fulfill({
      headers: { 'Content-Type': 'application/x-ndjson', 'X-CodeAI-Replay-Events': '2', 'X-CodeAI-Run-Finished': 'true' },
      body: [JSON.stringify({ type: 'error', runId, code: 'internal', message: failure, retryable: true, delivery: 'not-sent' }),
        JSON.stringify({ type: 'done', runId, durationMs: 0, cancelled: false })].join('\n') + '\n',
    }));
    await route.fulfill({ headers: { 'X-CodeAI-Run-Id': runId }, body: '' });
  });
  await page.getByRole('link', { name: 'Arena', exact: true }).click();
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New session', exact: true });
  await dialog.getByLabel('Project', { exact: true }).selectOption(target.id);
  await dialog.getByLabel('Provider', { exact: true }).selectOption('claude');
  await dialog.getByRole('textbox').fill('Background failed connection');
  await dialog.getByRole('button', { name: 'Start in background', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('region', { name: 'Notifications' }).getByRole('button', { name: 'Open session', exact: true }).click();
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await expect(conversation).toContainText('Background failed connection');
  await expect(page.getByRole('region', { name: 'Notifications' })).toContainText(failure);
  await expect(conversation.locator('.chat-message.user.failed')).toHaveCount(1);
});

test('same-project background stream reconnects after a failed attachment when its Arena card reopens', async ({ page, request }) => {
  const { project: target } = await project(request);
  const source = (await (await request.post('/api/sessions', { data: { projectId: target.id, provider: 'claude' } })).json()).session as PublicSession;
  await page.goto('/'); await chooseProject(page, target);
  await expect(page.getByRole('combobox', { name: 'All sessions', exact: true })).toHaveValue(source.id);
  let releaseFailure!: () => void;
  const failure = new Promise<void>((resolve) => { releaseFailure = resolve; });
  let attachments = 0;
  await page.route('**/api/agent/stream?runId=*', async (route) => {
    attachments++;
    if (attachments === 1) { await failure; await route.abort(); }
    else await route.continue();
  });
  let launched: PublicSession | undefined;
  try {
    await page.getByRole('link', { name: 'Arena', exact: true }).click();
    await page.getByRole('button', { name: 'New session', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New session', exact: true });
    await dialog.getByLabel('Project', { exact: true }).selectOption(target.id);
    await dialog.getByLabel('Provider', { exact: true }).selectOption('claude');
    await dialog.getByLabel('Mode', { exact: true }).selectOption('agent');
    await dialog.getByRole('textbox').fill('Background stream retry');
    const created = page.waitForResponse((response) => response.url().endsWith('/api/sessions') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Start in background', exact: true }).click();
    launched = (await (await created).json()).session;
    await expect(dialog).not.toBeVisible();
    await expect.poll(() => attachments).toBe(1);
    await page.getByRole('button', { name: 'Open Background stream retry', exact: true }).click();
    const conversation = page.getByRole('complementary', { name: 'Conversation' });
    await expect(conversation).toContainText('Background stream retry');
    releaseFailure();
    await expect(page.getByRole('region', { name: 'Notifications' })).toContainText('Lost the connection to a running turn.');
    await expect(page.getByRole('tab', { name: /Background stream retry/ })).not.toHaveClass(/working|awaiting-approval/);
    await page.getByRole('link', { name: 'Arena', exact: true }).click();
    await page.getByRole('button', { name: 'Open Background stream retry', exact: true }).click();
    await expect.poll(() => attachments).toBe(2);
    await expect(conversation.getByRole('button', { name: 'Allow', exact: true })).toBeVisible();
    await conversation.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect(conversation).toContainText('Edit approved — I applied it.');
    expect(attachments).toBe(2);
  } finally {
    releaseFailure();
    if (launched) {
      const discovery = await (await request.get(`/api/agent/runs?sessionId=${launched.id}`)).json();
      for (const run of discovery.active) await request.post('/api/agent/cancel', { data: { runId: run.runId } });
    }
  }
});

test('opening a completed Arena turn preserves the next agent and mode after a running mode change', async ({ page, request }) => {
  const { project: target } = await project(request);
  const session = (await (await request.post('/api/sessions', { data: { projectId: target.id, provider: 'claude' } })).json()).session as PublicSession;
  await page.goto('/'); await chooseProject(page, target);
  await expect(page.getByRole('combobox', { name: 'All sessions', exact: true })).toHaveValue(session.id);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  try {
    await conversation.getByLabel(/^Mode: /).click();
    await conversation.getByRole('radio', { name: 'Agent', exact: true }).click();
    await conversation.locator('textarea').fill('Completed Arena choices');
    await conversation.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(conversation.getByRole('button', { name: 'Allow', exact: true })).toBeVisible();
    await conversation.getByLabel(/^Mode: /).click();
    const changing = page.waitForResponse('**/api/agent/mode');
    await conversation.getByRole('radio', { name: 'Plan', exact: true }).click();
    expect((await changing).status()).toBe(200);
    await expect(conversation.getByRole('button', { name: 'Execute plan', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Completed Arena choices/ })).not.toHaveClass(/working|awaiting-approval/);

    await conversation.locator('.add-agent-menu summary').click();
    await conversation.getByLabel('Role').selectOption('reviewer');
    await conversation.getByRole('button', { name: 'Add participant', exact: true }).click();
    await expect(conversation.locator('.participant-chip.active')).toContainText('Claude Reviewer');
    await conversation.getByLabel(/^Mode: /).click();
    await conversation.getByRole('radio', { name: 'Ask', exact: true }).click();
    await conversation.locator('textarea').fill('Keep the next turn draft');
    let retainedEvents = '';
    await page.route('**/api/agent/stream?runId=*', async (route) => {
      const response = await route.fetch();
      retainedEvents = await response.text();
      await route.fulfill({ response });
    });
    await page.getByRole('link', { name: 'Arena', exact: true }).click();
    const replay = page.waitForResponse((response) => response.url().includes('/api/agent/stream?runId='));
    await page.getByRole('button', { name: 'Open Completed Arena choices', exact: true }).click();
    const stream = await replay;
    expect(stream.headers()['x-codeai-run-finished']).toBe('true');
    expect(retainedEvents).toContain('"type":"mode-changed"');
    // Wait for replay and its final snapshot refresh before checking idle selections.
    await page.waitForLoadState('networkidle');
    await expect(conversation.locator('.participant-chip.active')).toContainText('Claude Reviewer');
    await expect(conversation.getByLabel(/^Mode: Ask/)).toBeVisible();
    await expect(conversation.locator('textarea')).toHaveValue('Keep the next turn draft');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('code-ai:device:v1:preferences') || '{}')))
      .toMatchObject({ mode: 'ask' });
    await expect(page.locator('.toast').filter({ hasText: 'Reconnected to' })).toHaveCount(0);
    await expect(conversation.locator('.chat-message.user')).toHaveCount(1);
    await expect(conversation.locator('.chat-message.assistant')).toHaveCount(1);
  } finally {
    const discovery = await (await request.get(`/api/agent/runs?sessionId=${session.id}`)).json();
    for (const run of discovery.active) await request.post('/api/agent/cancel', { data: { runId: run.runId } });
  }
});

test('a rejected first turn can change mode and model while retaining its created session', async ({ page, request }) => {
  const { project: target } = await project(request);
  await page.route('**/api/health', async (route) => {
    const health = await (await route.fetch()).json();
    const choices = { models: [{ id: 'replacement', label: 'Replacement model', efforts: ['low', 'high'] }], efforts: ['low', 'high'] };
    Object.assign(health.providers.claude, choices);
    Object.assign(health.executions.local.providers.claude, choices);
    await route.fulfill({ json: health });
  });
  const turns: Array<Record<string, unknown>> = [];
  await page.route('**/api/agent/message', async (route) => {
    turns.push(route.request().postDataJSON());
    if (turns.length === 1) return route.fulfill({ status: 400, json: { error: 'The selected model is no longer offered.' } });
    return route.fulfill({ status: 200, headers: { 'X-CodeAI-Run-Id': 'accepted-retry' }, body: '' });
  });
  const dialog = await openSetup(page, target);
  await dialog.getByRole('textbox').fill('Keep this draft and session');
  await dialog.getByRole('button', { name: 'Start in background', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('no longer offered');
  await expect(dialog.getByLabel('Project', { exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('Provider', { exact: true })).toBeDisabled();
  await dialog.getByLabel('Mode', { exact: true }).selectOption('plan');
  const menu = dialog.locator('.model-menu'); await menu.locator('summary').click();
  await menu.getByRole('radio', { name: 'Replacement model', exact: true }).click();
  await menu.getByRole('radiogroup', { name: 'Effort', exact: true }).getByRole('radio', { name: 'High', exact: true }).click();
  await dialog.getByRole('button', { name: 'Start in background', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(turns).toHaveLength(2);
  expect(turns[1]).toMatchObject({ sessionId: turns[0].sessionId, text: 'Keep this draft and session', mode: 'plan', model: 'replacement', effort: 'high' });
  expect(turns[1].messageId).not.toBe(turns[0].messageId);
  expect((await (await request.get(`/api/sessions?projectId=${target.id}`)).json()).sessions).toHaveLength(1);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('code-ai:device:v1:preferences') || '{}')))
    .toMatchObject({ mode: 'plan', models: { claude: { model: 'replacement', effort: 'high' } } });
});

test('normal composer keeps valid text files from a selection containing an invalid binary', async ({ page, request }) => {
  const { project: target } = await project(request);
  await request.post('/api/sessions', { data: { projectId: target.id, provider: 'claude' } });
  await page.goto('/'); await chooseProject(page, target);
  await page.locator('.instruction-composer input[type=file]').setInputFiles([
    { name: 'valid.txt', mimeType: 'text/plain', buffer: Buffer.from('Keep valid evidence') },
    { name: 'binary.txt', mimeType: 'text/plain', buffer: Buffer.from([0, 1, 2]) },
  ]);
  await expect(page.locator('.instruction-composer')).toContainText('valid.txt');
  await expect(page.locator('.instruction-composer')).not.toContainText('binary.txt');
  await expect(page.getByRole('region', { name: 'Notifications' }).getByRole('alert')).toContainText('UTF-8 text file');
});

for (const theme of ['light', 'dark']) test(`${theme}: setup Enter starts a file/image turn in background, preserves Arena, and Open reaches it`, async ({ page, request }) => {
  await page.addInitScript((value) => localStorage.setItem('code-ai:theme', value), theme);
  const { project: target } = await project(request);
  const dialog = await openSetup(page, target);
  const input = dialog.getByRole('textbox'); await expect(input).toBeFocused();
  await dialog.locator('input[type=file]').setInputFiles([{ name: 'error.txt', mimeType: 'text/plain', buffer: Buffer.from('Exact report 🌍\n') }]);
  await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48;
    canvas.getContext('2d')!.fillRect(0, 0, 64, 48);
    const encoded = atob(canvas.toDataURL('image/png').split(',')[1]);
    const transfer = new DataTransfer(); transfer.items.add(new File([Uint8Array.from(encoded, (point) => point.charCodeAt(0))], 'screen.png', { type: 'image/png' }));
    document.querySelector('.session-setup-dialog textarea')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await expect(dialog.getByRole('img')).toHaveCount(1);
  await input.fill('Fix the reported issue');
  await expect(dialog.getByRole('button', { name: 'Start in background', exact: true })).toBeInViewport();
  const preview = dialog.getByRole('button', { name: 'Preview image 1' });
  const previewBounds = (await preview.boundingBox())!;
  const thumbnail = (await preview.locator('img').boundingBox())!;
  expect(thumbnail.x + thumbnail.width).toBeLessThanOrEqual(previewBounds.x + previewBounds.width + 1);
  expect(thumbnail.y + thumbnail.height).toBeLessThanOrEqual(previewBounds.y + previewBounds.height + 1);
  await page.screenshot({ path: `test-results/session-setup-${theme}.png` });
  let createdId = ''; let messages = 0;
  page.on('response', async (response) => { if (response.url().endsWith('/api/sessions') && response.request().method() === 'POST' && response.status() === 201) createdId = (await response.json()).session.id; });
  page.on('request', (req) => { if (req.url().endsWith('/api/agent/message')) messages++; });
  await input.press('Enter');
  await expect(dialog).not.toBeVisible(); await expect(page).toHaveURL(/\/arena$/);
  await expect(page.getByRole('button', { name: 'New session', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Open session', exact: true })).toBeVisible();
  await expect.poll(() => createdId).not.toBe('');
  await expect.poll(async () => (await (await request.get(`/api/sessions/${createdId}`)).json()).session.messages.length).toBeGreaterThan(0);
  const saved = (await (await request.get(`/api/sessions/${createdId}`)).json()).session as PublicSession;
  const initial = saved.messages[0]; expect(initial.role).toBe('user');
  if (initial.role === 'user') { expect(initial.fileAttachments?.[0]).toMatchObject({ name: 'error.txt', text: 'Exact report 🌍\n' }); expect(initial.imageAttachments).toHaveLength(1); }
  expect(messages).toBe(1);
  await page.getByRole('button', { name: 'Open session', exact: true }).click();
  await expect(page).toHaveURL(/\/$/); await expect(page.locator('.conversation-drawer')).toContainText('error.txt');
});

test('empty input opens idle session, and Cancel/reopen keeps separate setup evidence', async ({ page, request }) => {
  const { project: target } = await project(request);
  const dialog = await openSetup(page, target);
  await dialog.getByRole('textbox').fill('Keep this setup draft');
  await dialog.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes') });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await expect(dialog.getByRole('textbox')).toHaveValue('Keep this setup draft');
  await expect(dialog).toContainText('notes.txt');
  await dialog.getByRole('button', { name: 'Remove file notes.txt' }).click();
  await dialog.getByRole('textbox').fill('  ');
  let turns = 0; page.on('request', (req) => { if (req.url().endsWith('/api/agent/message')) turns++; });
  await dialog.getByRole('textbox').press('Enter');
  await expect(page).toHaveURL(/\/$/); await expect(page.locator('.conversation-drawer textarea')).toBeVisible();
  expect(turns).toBe(0);
});

test('lost creation retries the same UUID and retained errors keep settings frozen', async ({ page, request }) => {
  const { project: target } = await project(request);
  let first = true; const ids: string[] = [];
  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    ids.push(route.request().postDataJSON().creationRequestId);
    const response = await route.fetch();
    if (first) { first = false; return route.abort('connectionreset'); }
    return route.fulfill({ response });
  });
  const dialog = await openSetup(page, target);
  await dialog.getByRole('textbox').fill('Start once'); await dialog.getByRole('textbox').press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('Creation status is unknown');
  await expect(dialog.getByLabel('Project', { exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(dialog).not.toBeVisible(); expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
  const sessions = (await (await request.get(`/api/sessions?projectId=${target.id}`)).json()).sessions;
  expect(sessions).toHaveLength(1);
});

test('managed gear setup targets CodeAI while preserving the source task and its files', async ({ page, request }) => {
  const { project: source, catalog } = await project(request);
  const { project: self, checkout } = await project(request, `Installation ${Date.now()}`, 'installation');
  await request.post('/api/sessions', { data: { projectId: source.id, provider: 'claude' } });
  const preparedContext = { projectId: self.id, checkoutId: checkout.id, bindingsFingerprint: 'a'.repeat(64) };
  const creations: unknown[] = [];
  await page.route('**/api/codeai-session', async (route) => {
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : undefined;
    if (!body) return route.fulfill({ json: { available: true, machineId: catalog.hostId, phase: 'idle', checkoutId: checkout.id, checkoutName: 'CodeAI' } });
    if (body.action === 'prepare') return route.fulfill({ json: { preparedContext, project: self } });
    creations.push(body);
    const response = await request.post('/api/sessions', { data: { projectId: self.id, provider: body.provider,
      instructions: body.instructions, creationRequestId: body.creationRequestId, execution: 'local' } });
    return route.fulfill({ status: response.status(), json: await response.json() });
  });
  await page.goto('/'); await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(source.name) }).click();
  const sourceInput = page.locator('.conversation-drawer textarea'); await sourceInput.fill('Keep my current task');
  await page.locator('.instruction-composer input[type=file]').setInputFiles({ name: 'source.txt', mimeType: 'text/plain', buffer: Buffer.from('keep source evidence') });
  await page.locator('.more-menu > summary').click(); await page.getByRole('button', { name: 'New CodeAI session', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New CodeAI session' });
  await expect(dialog.getByRole('textbox')).toBeFocused();
  await dialog.getByRole('textbox').fill('Fix CodeAI'); await dialog.getByRole('textbox').press('Enter');
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.more-menu > summary')).toBeFocused();
  await expect(sourceInput).toHaveValue('Keep my current task'); await expect(page.locator('.instruction-composer')).toContainText('source.txt');
  await expect(page.locator('.project-search-trigger')).toContainText(source.name);
  expect(creations).toMatchObject([{ action: 'create', preparedContext }]);
});

for (const width of [1280, 390]) test(`setup model and effort choices remain usable at ${width}px`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 720 });
  const { project: target } = await project(request);
  await page.route('**/api/health', async (route) => {
    const health = await (await route.fetch()).json();
    const choices = { models: [{ id: 'setup-model', label: 'Setup model', efforts: ['low', 'high'] }], efforts: ['low', 'high'] };
    Object.assign(health.providers.claude, choices);
    Object.assign(health.executions.local.providers.claude, choices);
    await route.fulfill({ json: health });
  });
  const dialog = await openSetup(page, target);
  const menu = dialog.locator('.model-menu');
  await menu.locator('summary').click();
  await menu.getByRole('radio', { name: 'Setup model', exact: true }).click();
  await menu.getByRole('radiogroup', { name: 'Effort', exact: true }).getByRole('radio', { name: 'High', exact: true }).click();
  await expect(menu.locator('summary')).toHaveText('Setup model · High');
  await expect(dialog.getByRole('button', { name: 'Create and open', exact: true })).toBeInViewport();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await expect(menu.locator('summary')).toHaveText('Setup model · High');
});

test('empty completion after Cancel does not navigate and announces the created session', async ({ page, request }) => {
  const { project: target } = await project(request);
  let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch(); await held; return route.fulfill({ response });
  });
  const dialog = await openSetup(page, target);
  await dialog.getByRole('button', { name: 'Create and open' }).click();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  release();
  await expect(page.getByRole('button', { name: 'Open session', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/arena$/);
});

async function managedSetup(page: Page, request: APIRequestContext, self: DurableProject, catalog: CheckoutsResponse, checkoutId: string,
  waitPrepare?: Promise<void>, waitCreate?: Promise<void>) {
  await page.route('**/api/codeai-session', async (route) => {
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : undefined;
    if (!body) return route.fulfill({ json: { available: true, machineId: catalog.hostId, phase: 'idle', checkoutId, checkoutName: 'CodeAI' } });
    if (body.action === 'prepare') { await waitPrepare; return route.fulfill({ json: { preparedContext: { projectId: self.id, checkoutId, bindingsFingerprint: 'a'.repeat(64) }, project: self } }); }
    const response = await request.post('/api/sessions', { data: { projectId: self.id, provider: body.provider, instructions: body.instructions, creationRequestId: body.creationRequestId } });
    await waitCreate; return route.fulfill({ status: response.status(), json: await response.json() });
  });
}
async function chooseProject(page: Page, target: DurableProject) {
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(target.name) }).click();
}
async function gear(page: Page) {
  await page.locator('.more-menu > summary').click();
  await page.getByRole('button', { name: 'New CodeAI session', exact: true }).click();
  return page.getByRole('dialog', { name: 'New CodeAI session' });
}

test('same-project empty gear launch focuses once, and title-tab return keeps keyboard focus', async ({ page, request }) => {
  const { project: self, catalog, checkout } = await project(request, `Focus ${Date.now()}`, 'installation');
  const old = (await (await request.post('/api/sessions', { data: { projectId: self.id, provider: 'claude' } })).json()).session as PublicSession;
  await managedSetup(page, request, self, catalog, checkout.id);
  await page.goto('/'); await chooseProject(page, self);
  await page.getByRole('combobox', { name: 'All sessions', exact: true }).selectOption(old.id);
  const dialog = await gear(page);
  await expect(dialog.getByRole('textbox')).toBeFocused();
  await dialog.getByRole('textbox').press('Enter');
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.conversation-drawer textarea')).toBeFocused();
  await expect(page.getByRole('tab')).toHaveCount(2);
  const selected = page.getByRole('tab', { selected: true });
  await selected.press('ArrowLeft'); await expect(selected).toBeFocused();
  await selected.press('ArrowRight'); await expect(selected).toBeFocused();
});

test('delayed background gear launch pins source choices through navigation and tab return', async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('code-ai:device:v1:preferences', JSON.stringify({ version: 1, mode: 'ask', provider: 'claude' })));
  const { project: source } = await project(request);
  const { project: self, catalog, checkout } = await project(request, `Delayed ${Date.now()}`, 'installation');
  const sessions: PublicSession[] = [];
  for (let index = 0; index < 2; index++) sessions.push((await (await request.post('/api/sessions', { data: { projectId: source.id, provider: 'claude' } })).json()).session);
  let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
  await managedSetup(page, request, self, catalog, checkout.id, undefined, held);
  await page.goto('/'); await chooseProject(page, source);
  const picker = page.getByRole('combobox', { name: 'All sessions', exact: true });
  await picker.selectOption(sessions[0].id);
  const dialog = await gear(page); await dialog.getByLabel('Mode', { exact: true }).selectOption('plan');
  await dialog.getByRole('textbox').fill('Work in background'); await dialog.getByRole('textbox').press('Enter');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await picker.selectOption(sessions[1].id); release();
  await expect(page.getByRole('button', { name: 'Open session', exact: true })).toBeVisible();
  await picker.selectOption(sessions[0].id);
  await expect(page.locator('.conversation-drawer').getByLabel(/^Mode: Ask\./)).toBeVisible();
});

test('cancelled CodeAI preparation cannot overwrite a newly opened Arena draft', async ({ page, request }) => {
  const { project: target } = await project(request);
  const { project: self, catalog, checkout } = await project(request, `Preparation ${Date.now()}`, 'installation');
  let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
  await managedSetup(page, request, self, catalog, checkout.id, held);
  await page.goto('/arena'); await gear(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  const dialog = await openSetup(page, target);
  await dialog.getByRole('textbox').fill('Keep this newer draft'); release();
  await expect(dialog.getByRole('textbox')).toHaveValue('Keep this newer draft');
  await expect(dialog.getByLabel('Project', { exact: true })).toHaveValue(target.id);
  await expect(dialog).toHaveAccessibleName('New session');
});

test('narrow setup retains valid files and guards Shift Enter, composition, repeat, Escape and focus return', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { project: target } = await project(request);
  const dialog = await openSetup(page, target);
  await dialog.locator('input[type=file]').setInputFiles([
    { name: 'good.txt', mimeType: 'text/plain', buffer: Buffer.from('keep') },
    { name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from([0]) },
  ]);
  await expect(dialog).toContainText('good.txt'); await expect(dialog.getByRole('alert')).toContainText('bad.txt');
  const box = (await dialog.boundingBox())!; expect(box.width).toBeLessThanOrEqual(390); expect(box.x).toBeGreaterThanOrEqual(0);
  await expect(dialog.getByRole('button', { name: 'Retry', exact: true })).toBeInViewport();
  await dialog.getByRole('textbox').fill('Keep this message'); await dialog.getByRole('textbox').press('Shift+Enter');
  await expect(dialog.getByRole('textbox')).toHaveValue('Keep this message\n');
  let creates = 0; page.on('request', (req) => { if (req.url().endsWith('/api/sessions') && req.method() === 'POST') creates++; });
  await dialog.getByRole('textbox').evaluate((input) => {
    for (const field of [{ isComposing: true }, { repeat: true }]) input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...field }));
  });
  expect(creates).toBe(0);
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'New session', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await expect(dialog.getByRole('textbox')).toHaveValue('Keep this message\n');
});

test('navigation while an empty launch is fetching its saved target prevents delayed automatic opening', async ({ page, request }) => {
  const { project: target } = await project(request);
  let createdId = ''; let fetching = false; let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch(); createdId = (await response.json()).session.id; return route.fulfill({ response });
  });
  await page.route('**/api/sessions/*', async (route) => {
    if (!createdId || !route.request().url().endsWith(createdId)) return route.continue();
    fetching = true; const response = await route.fetch(); await held; return route.fulfill({ response });
  });
  const dialog = await openSetup(page, target); await dialog.getByRole('textbox').press('Enter');
  await expect.poll(() => fetching).toBe(true); await page.getByRole('link', { name: /^Inbox/ }).first().click(); release();
  await expect(page.getByRole('region', { name: 'Notifications' }).getByRole('button', { name: 'Open session', exact: true })).toBeVisible(); await expect(page).toHaveURL(/\/arena\/inbox$/);
});

test('report-only setup labels evidence captured in another project and starts without selecting its session', async ({ page, request }) => {
  const { project: elsewhere, catalog } = await project(request);
  const { project: self } = await project(request, `Reports setup ${Date.now()}`, 'installation');
  const source = (await (await request.post('/api/sessions', { data: { projectId: elsewhere.id, provider: 'claude' } })).json()).session as PublicSession;
  const report = await request.post('/api/immersive/report', { data: { version: 1, kind: 'capture', at: new Date().toISOString(), browser: 'Setup test',
    note: 'Captured during another task', errors: [], diagnostics: { version: 1, browser: 'Setup test', events: [] },
    context: { machineId: catalog.hostId, projectId: elsewhere.id, sessionId: source.id } } });
  expect(report.ok()).toBe(true); const reportId = (await report.json()).name;
  const dialog = await openSetup(page, self); await dialog.getByText('Attach CodeAI report', { exact: true }).click();
  const choice = dialog.locator('.session-setup-reports label').filter({ hasText: 'Captured during another task' });
  await expect(choice).toContainText(elsewhere.name); await choice.getByRole('checkbox').check();
  await expect(dialog).toContainText('Investigate the attached CodeAI report.');
  let sent: { sessionId: string; reportAttachments: Array<{ reportId: string }> } | undefined;
  page.on('request', (req) => { if (req.url().endsWith('/api/agent/message')) sent = req.postDataJSON(); });
  await dialog.getByRole('button', { name: 'Start in background' }).click();
  await expect(dialog).not.toBeVisible(); await expect(page).toHaveURL(/\/arena$/);
  expect(sent?.reportAttachments).toEqual([{ reportId }]); expect(sent?.sessionId).not.toBe(source.id);
});

test('regular composer Retry rehydrates exact file evidence alongside a newer pending file', async ({ page, request }) => {
  const { project: target } = await project(request);
  await request.post('/api/sessions', { data: { projectId: target.id, provider: 'claude' } });
  await page.goto('/'); await chooseProject(page, target);
  const composer = page.locator('.instruction-composer');
  await composer.locator('input[type=file]').setInputFiles({ name: 'original.txt', mimeType: 'text/plain', buffer: Buffer.from('Exact original 🌍\n') });
  await composer.locator('textarea').fill('Keep my evidence'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const cancelled = page.locator('.chat-message.user.cancelled'); await expect(cancelled).toHaveCount(1);
  await composer.getByRole('button', { name: 'Remove file original.txt' }).click();
  await composer.locator('input[type=file]').setInputFiles({ name: 'newer.txt', mimeType: 'text/plain', buffer: Buffer.from('Keep newer evidence') });
  await cancelled.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(composer).toContainText('original.txt'); await expect(composer).toContainText('newer.txt');
  let files: unknown;
  await page.route('**/api/agent/message', (route) => { files = route.request().postDataJSON().fileAttachments; return route.fulfill({ status: 503, json: { error: 'Inspection only' } }); });
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => files).toEqual([{ name: 'newer.txt', text: 'Keep newer evidence' }, { name: 'original.txt', text: 'Exact original 🌍\n' }]);
});
