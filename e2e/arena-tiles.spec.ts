import { expect, test, fulfillArenaSnapshot, pushArenaSnapshot, type APIRequestContext, type Locator, type Page } from './arena-stream';
import type { ArenaSnapshot, CheckoutsResponse, DurableProject, PublicSession } from '../src/shared/types';

async function sessions(request: APIRequestContext, count = 2) {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const { project } = await (await request.post('/api/projects', { data: {
    name: `Tile project ${Date.now()}`, checkoutIds: [checkouts.find(item => item.relativePath === 'alpha')!.id],
  } })).json() as { project: DurableProject };
  const created: PublicSession[] = [];
  for (let i = 0; i < count; i++) created.push((await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json()).session);
  return { project, created };
}
const cardFor = (page: Page, id: string) => page.locator('.arena-card').filter({ has: page.locator(`.arena-card-open[href*="${id}"]`) });

async function openTiles(page: Page) {
  await page.addInitScript(() => localStorage.setItem('code-ai:device:arena-layout', 'tiles'));
  await page.goto('/arena');
  await expect(page.getByRole('button', { name: 'Tiles', exact: true })).toHaveAttribute('aria-pressed', 'true');
}

for (const theme of ['light', 'dark']) test(`quick reply commands complete locally and retain images on save failure: ${theme}`, async ({ page, request }, testInfo) => {
  await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
  const { created: [session] } = await sessions(request, 1);
  await openTiles(page);
  const card = cardFor(page, session.id), input = card.getByRole('textbox');
  let posts = 0;
  page.on('request', request => { if (request.url().endsWith('/api/agent/message')) posts++; });
  await input.fill('/');
  const suggestions = page.getByRole('listbox', { name: 'Chat commands', exact: true });
  await expect(suggestions.getByRole('option')).toHaveCount(4);
  await expect(input).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('quick-reply-commands.png'), animations: 'disabled' });
  await input.press('Escape');
  await expect(suggestions).toHaveCount(0);
  await pasteImage(input);
  await input.fill('/auto');
  await input.press('Tab');
  await expect(input).toHaveValue('/autoclose');
  await page.route(`**/api/sessions/${session.id}`, route => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 503, json: { error: 'Permission unavailable.' } }) : route.continue());
  await input.press('Enter');
  await expect(card.getByRole('alert')).toContainText('Permission unavailable.');
  await expect(input).toHaveValue('/autoclose');
  await expect(card.locator('.attachment-chip.image')).toHaveCount(1);
  await page.unroute(`**/api/sessions/${session.id}`);
  await input.press('Enter');
  await expect(input).toBeEmpty();
  await expect(card).toContainText('Auto-close enabled.');
  await expect(card.locator('.attachment-chip.image')).toHaveCount(1);
  expect(posts).toBe(0);
  expect((await (await request.get(`/api/sessions/${session.id}`)).json()).session.allowAgentArchive).toBe(true);
  await input.fill('Do X /autoclose o');
  await expect(suggestions.getByRole('option')).toHaveCount(2);
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(input).toHaveValue('Do X /autoclose off');
  await input.press('Enter');
  await expect(input).toBeEmpty();
  await expect(card.locator('.arena-tile-preview')).toContainText('First turn complete.');
  const saved = (await (await request.get(`/api/sessions/${session.id}`)).json()).session as PublicSession;
  expect(saved.allowAgentArchive).toBe(false);
  expect(saved.messages[0]).toMatchObject({ text: 'Do X', imageAttachments: [{ mediaType: 'image/png' }] });
  expect(posts).toBe(1);
  await expect(page).toHaveURL(/\/arena$/);
});

test('quick reply new, archive and close reuse session actions without provider messages', async ({ page, request }) => {
  const { created } = await sessions(request, 3);
  await openTiles(page);
  let posts = 0;
  page.on('request', request => { if (request.url().endsWith('/api/agent/message')) posts++; });
  for (const [index, command] of ['/archive', '/close'].entries()) {
    const card = cardFor(page, created[index].id);
    await card.getByRole('textbox').fill(command);
    await card.getByRole('textbox').press('Enter');
    await expect(card).toHaveCount(0);
    expect((await request.get(`/api/sessions/${created[index].id}`)).status()).toBe(404);
    await expect(page).toHaveURL(/\/arena$/);
  }
  const source = created[2], input = cardFor(page, source.id).getByRole('textbox');
  await input.fill('/new');
  await input.press('Enter');
  await expect(page).toHaveURL(/\?session=/);
  const nextId = new URL(page.url()).searchParams.get('session')!;
  const next = (await (await request.get(`/api/sessions/${nextId}`)).json()).session as PublicSession;
  expect(next.id).not.toBe(source.id);
  expect(next.projectId).toBe(source.projectId);
  expect(next.repositories).toEqual(source.repositories);
  expect(next.messages).toHaveLength(0);
  expect((await request.get(`/api/sessions/${source.id}`)).ok()).toBe(true);
  expect(posts).toBe(0);
});

test('inline quick reply retries its exact cleaned payload after uncertain delivery and reload', async ({ page, request }) => {
  const { created: [session] } = await sessions(request, 1);
  let readable = true, patches = 0, accepted = false;
  const messages: unknown[] = [];
  await page.route(`**/api/sessions/${session.id}`, route => {
    if (route.request().method() === 'PATCH') {
      patches++;
      session.allowAgentArchive = route.request().postDataJSON().allowAgentArchive;
      return route.fulfill({ json: { session } });
    }
    return route.fulfill({ status: readable ? 200 : 503, json: readable ? { session } : {} });
  });
  await page.route('**/api/agent/message', route => {
    messages.push(route.request().postDataJSON());
    if (!accepted) { readable = false; return route.abort(); }
    return route.fulfill({ headers: { 'X-CodeAI-Run-Id': crypto.randomUUID() }, body: '' });
  });
  await openTiles(page);
  const card = cardFor(page, session.id), input = card.getByRole('textbox');
  await input.fill('Do X /autoclose');
  await input.press('Enter');
  await expect(card.getByRole('button', { name: 'Check / retry', exact: true })).toBeVisible();
  await expect(input).toHaveValue('Do X');
  await page.reload();
  await expect(input).toHaveValue('Do X');
  readable = true; accepted = true;
  await card.getByRole('button', { name: 'Check / retry', exact: true }).click();
  await expect(input).toBeEmpty();
  expect(patches).toBe(1);
  expect(messages).toHaveLength(2);
  expect(messages[0]).toEqual(messages[1]);
  expect(messages[0]).toMatchObject({ text: 'Do X' });
});

test('quick reply autoclose targets its machine during a run without requiring a provider', async ({ page, request }) => {
  const { created: [session] } = await sessions(request, 1);
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const local = snapshot.machines.find(machine => machine.machine.kind === 'local')!;
  local.sessions = local.sessions.filter(item => item.id === session.id);
  const remote = structuredClone(local);
  remote.machine = { ...remote.machine, id: crypto.randomUUID(), kind: 'remote', label: 'Command executor' };
  remote.providers.claude.available = false;
  remote.runs.active = [{ runId: crypto.randomUUID(), sessionId: session.id, participantId: session.primaryAgentId,
    state: 'running', enqueuedAt: Date.now(), pendingPermissionCount: 0, pendingPermissions: [] }];
  snapshot.machines.push(remote);
  await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
  const patches: unknown[] = [];
  let posts = 0;
  page.on('request', request => { if (request.url().endsWith('/agent/message')) posts++; });
  await page.route(`**/api/machines/${remote.machine.id}/sessions/${session.id}`, route => {
    if (route.request().method() === 'PATCH') {
      patches.push(route.request().postDataJSON());
      return route.fulfill({ json: { session: { ...session, allowAgentArchive: true } } });
    }
    return route.fulfill({ json: { session } });
  });
  await openTiles(page);
  const home = page.getByRole('region', { name: local.machine.label, exact: true }).getByRole('textbox');
  const card = page.getByRole('region', { name: 'Command executor', exact: true }).locator('.arena-card');
  await home.fill('Home draft');
  const input = card.getByRole('textbox');
  await input.fill('/autoclose');
  await expect(card.getByRole('button', { name: 'Run command', exact: true })).toBeEnabled();
  await input.press('Enter');
  await expect(input).toBeEmpty();
  await expect(card).toContainText('Auto-close enabled.');
  expect(patches).toEqual([{ allowAgentArchive: true, expectedAllowAgentArchive: false }]);
  await input.fill('Do X /autoclose');
  await input.press('Enter');
  await expect(input).toHaveValue('Do X');
  await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await expect(home).toHaveValue('Home draft');
  expect(posts).toBe(0);
});

async function pasteImage(input: Locator, options: { count?: number; text?: boolean; corrupt?: boolean } = {}) {
  return input.evaluate(async (element, options) => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 100;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#3366cc'; context.fillRect(0, 0, 160, 100);
    const blob = options.corrupt ? new Blob(['invalid image']) : await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
    const transfer = new DataTransfer();
    for (let i = 0; i < (options.count ?? 1); i++) transfer.items.add(new File([blob], 'screenshot.png', { type: 'image/png' }));
    if (options.text) transfer.setData('text/plain', 'Copied text');
    const event = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, options);
}

for (const theme of ['light', 'dark']) test(`tile clipboard images can be removed and sent without text: ${theme}`, async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(theme => localStorage.setItem('code-ai:theme', theme), theme);
  const { created } = await sessions(request);
  await openTiles(page);
  const first = cardFor(page, created[0].id), second = cardFor(page, created[1].id);
  const input = first.getByRole('textbox');
  await expect(first.locator('.arena-tile-reply')).not.toContainText('Claude · Ask');
  await input.fill('Keep this draft');
  expect(await pasteImage(input, { text: true })).toBe(false);
  await expect(first.locator('.attachment-chip.image')).toHaveCount(0);
  expect(await pasteImage(input)).toBe(true);
  await expect(first.locator('.attachment-chip.image')).toHaveCount(1);
  await expect(input).toHaveValue('Keep this draft');
  await expect(first.locator('.attachment-chip.image img')).toHaveJSProperty('naturalWidth', 160);
  await expect(second.locator('.attachment-chip.image')).toHaveCount(0);
  await first.getByRole('button', { name: 'Remove image 1', exact: true }).click();
  await expect(first.locator('.attachment-chip.image')).toHaveCount(0);
  await input.fill('');
  await pasteImage(input);
  await expect(first.locator('.attachment-chip.image')).toHaveCount(1);
  await expect(first.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await first.screenshot({ path: testInfo.outputPath(`tile-image-${theme}.png`) });
  await input.press('Enter');
  await expect(first.locator('.attachment-chip.image')).toHaveCount(0);
  await expect(first.locator('.arena-tile-preview')).toContainText('Image files:');
  const saved = (await (await request.get(`/api/sessions/${created[0].id}`)).json()).session as PublicSession;
  const user = saved.messages.find(message => message.role === 'user')!;
  expect(user.role === 'user' && user.imageAttachments).toEqual([{ mediaType: 'image/png', bytes: expect.any(Number) }]);
  expect(user.role === 'user' && user.text).toContain('attached image');
  await expect(page).toHaveURL(/\/arena$/);
});

test('tile image preparation blocks sending, survives view changes and enforces the image limit', async ({ page, request }) => {
  const { created: [session] } = await sessions(request, 1);
  let posts = 0;
  await page.route('**/api/agent/message', route => { posts++; return route.abort(); });
  await page.goto('/arena');
  await page.getByRole('button', { name: 'Tiles', exact: true }).click();
  const card = cardFor(page, session.id), input = card.getByRole('textbox');
  await input.fill('Keep text while preparing');
  await page.evaluate(() => {
    const original = window.createImageBitmap.bind(window);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    window.createImageBitmap = (async (source: ImageBitmapSource) => { await gate; return original(source); }) as typeof createImageBitmap;
    Object.assign(window, { releaseTileImage: () => { window.createImageBitmap = original; release(); } });
  });
  await pasteImage(input);
  await expect(card.getByRole('status')).toHaveText('Preparing images…');
  await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await input.press('Enter');
  expect(posts).toBe(0);
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await page.evaluate(() => (window as unknown as { releaseTileImage(): void }).releaseTileImage());
  await page.getByRole('button', { name: 'Tiles', exact: true }).click();
  await expect(card.locator('.attachment-chip.image')).toHaveCount(1);
  await pasteImage(input, { count: 4 });
  await expect(card.locator('.attachment-chip.image')).toHaveCount(4);
  await expect(card.getByRole('alert')).toContainText('at most 4 images');
  await card.getByRole('button', { name: 'Remove image 1', exact: true }).click();
  await pasteImage(input, { corrupt: true });
  await expect(card.getByRole('alert')).toContainText('could not be read');
  await expect(card.locator('.attachment-chip.image')).toHaveCount(3);
  await expect(input).toHaveValue('Keep text while preparing');
  expect(posts).toBe(0);
});

test('tile image replies keep exact evidence through rejection and uncertain retry', async ({ page, request }) => {
  const { created: [session] } = await sessions(request, 1);
  let readable = true;
  const sent: Array<{ messageId: string; imageAttachments: Array<{ dataUrl: string }> }> = [];
  await page.route(`**/api/sessions/${session.id}`, route => route.fulfill({ status: readable ? 200 : 503, json: readable ? { session } : {} }));
  await page.route('**/api/agent/message', route => {
    sent.push(route.request().postDataJSON());
    if (sent.length === 1) return route.fulfill({ status: 429, json: { error: 'Queue full' } });
    if (sent.length === 2) { readable = false; return route.abort(); }
    return route.fulfill({ headers: { 'X-CodeAI-Run-Id': crypto.randomUUID() }, body: '' });
  });
  await page.goto('/arena');
  await page.getByRole('button', { name: 'Tiles', exact: true }).click();
  const card = cardFor(page, session.id), input = card.getByRole('textbox');
  await input.fill('Inspect this screenshot');
  await pasteImage(input);
  await expect(card.locator('.attachment-chip.image')).toHaveCount(1);
  await input.press('Enter');
  await expect(card.getByRole('alert')).toContainText('Queue full');
  await expect(card.locator('.attachment-chip.image')).toHaveCount(1);
  await input.press('Enter');
  await expect(card.getByRole('button', { name: 'Check / retry', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Remove image 1', exact: true })).toBeDisabled();
  await expect(input).not.toBeEditable();
  await page.getByRole('link', { name: /^Inbox/ }).last().click();
  await page.getByRole('tab', { name: /^Active/ }).click();
  await expect(card.locator('.attachment-chip.image')).toHaveCount(1);
  readable = true;
  await card.getByRole('button', { name: 'Check / retry', exact: true }).click();
  await expect(card.locator('.attachment-chip.image')).toHaveCount(0);
  expect(sent[1]).toEqual(sent[2]);
  expect(sent[1].imageAttachments).toHaveLength(1);
  expect(sent[1].imageAttachments[0].dataUrl).toMatch(/^data:image\/png;base64,/);
  await input.fill('A following text-only reply');
  await input.press('Enter');
  await expect.poll(() => sent.length).toBe(4);
  expect(sent[3].imageAttachments).toEqual([]);
});

test('reloading an uncertain image-only reply permits checking without replaying it without its image', async ({ page, request }) => {
  const { created: [session] } = await sessions(request, 1);
  let readable = true;
  const sent: Array<{ messageId: string; participantId: string; text: string }> = [];
  await page.route(`**/api/sessions/${session.id}`, route => route.fulfill({ status: readable ? 200 : 503, json: readable ? { session } : {} }));
  await page.route('**/api/agent/message', route => { sent.push(route.request().postDataJSON()); readable = false; return route.abort(); });
  await page.goto('/arena');
  await page.getByRole('button', { name: 'Tiles', exact: true }).click();
  const card = cardFor(page, session.id), input = card.getByRole('textbox');
  await pasteImage(input);
  await expect(card.locator('.attachment-chip.image')).toHaveCount(1);
  await input.press('Enter');
  await expect(card.getByRole('button', { name: 'Check / retry', exact: true })).toBeVisible();
  await page.reload();
  await expect(card.locator('.attachment-chip.image')).toHaveCount(0);
  readable = true;
  await card.getByRole('button', { name: 'Check delivery', exact: true }).click();
  await expect(card.getByRole('alert')).toContainText('original images are no longer available');
  expect(sent).toHaveLength(1);
  session.messages.push({ id: sent[0].messageId, role: 'user', authorId: session.participants.find(item => item.kind === 'human')!.id,
    addressedParticipantId: sent[0].participantId, text: sent[0].text, createdAt: new Date().toISOString(), status: 'sent', diagramAttachments: [] });
  await card.getByRole('button', { name: 'Check delivery', exact: true }).click();
  await expect(card.getByRole('status')).toHaveText('Sent');
  await expect(input).toBeEditable();
  expect(sent).toHaveLength(1);
});

test('tile replies send on Enter, keep Shift+Enter and composition, and put Send inside the field', async ({ page, request }) => {
  const { created: [session] } = await sessions(request, 1);
  const sent: Array<{ text: string }> = [];
  await page.route('**/api/agent/message', route => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ headers: { 'X-CodeAI-Run-Id': crypto.randomUUID() }, body: '' });
  });
  await page.goto('/arena');
  await page.getByRole('button', { name: 'Tiles', exact: true }).click();
  const card = cardFor(page, session.id), input = card.getByRole('textbox');
  const send = card.getByRole('button', { name: 'Send', exact: true });
  await expect(card.getByRole('combobox')).toHaveCount(0);
  await expect(send).toBeDisabled();
  await input.fill('First line');
  await input.press('Shift+Enter');
  await input.pressSequentially('Second line');
  await expect(input).toHaveValue('First line\nSecond line');
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', repeat: true });
  expect(sent).toHaveLength(0);
  const field = await input.locator('..').boundingBox(), button = await send.boundingBox();
  expect(button!.x).toBeGreaterThanOrEqual(field!.x);
  expect(button!.x + button!.width).toBeLessThanOrEqual(field!.x + field!.width);
  expect(button!.y + button!.height).toBeLessThanOrEqual(field!.y + field!.height);
  await input.press('Enter');
  await expect.poll(() => sent.map(message => message.text)).toEqual(['First line\nSecond line']);
  await expect(input).toHaveValue('');
  await input.fill('Send with the inline arrow');
  await send.click();
  await expect.poll(() => sent.map(message => message.text)).toEqual(['First line\nSecond line', 'Send with the inline arrow']);
  await expect(page).toHaveURL(/\/arena$/);
});

test('tile replies follow the mode changed inside the session and ignore old tile overrides', async ({ page, request }) => {
  const { created: [session] } = await sessions(request, 1);
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const machineId = snapshot.machines.find(machine => machine.machine.kind === 'local')!.machine.id;
  await page.addInitScript(({ machineId, sessionId }) => {
    sessionStorage.setItem('code-ai:tab:arena-replies:v1', JSON.stringify({ version: 1, drafts: {
      [`${machineId}:${sessionId}`]: { text: 'Use the current session mode', mode: 'ask' },
    } }));
  }, { machineId, sessionId: session.id });
  const sent: Array<{ text: string; mode: string }> = [];
  await page.route('**/api/agent/message', route => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ headers: { 'X-CodeAI-Run-Id': crypto.randomUUID() }, body: '' });
  });
  await page.goto(`/?session=${session.id}`);
  const conversation = page.getByRole('complementary', { name: 'Conversation', exact: true });
  await conversation.getByRole('button', { name: /^Mode:/ }).click();
  await page.getByRole('radio', { name: /^Plan/ }).click();
  await page.getByRole('link', { name: 'Arena', exact: true }).click();
  await page.getByRole('button', { name: 'Tiles', exact: true }).click();
  const card = cardFor(page, session.id);
  await expect(card.getByRole('combobox')).toHaveCount(0);
  await expect(card.locator('.arena-tile-reply')).not.toContainText('Claude · Plan');
  await expect(card.getByRole('textbox')).toHaveValue('Use the current session mode');
  await card.getByRole('textbox').press('Enter');
  await expect.poll(() => sent.map(({ text, mode }) => ({ text, mode }))).toEqual([{ text: 'Use the current session mode', mode: 'plan' }]);
});

for (const theme of ['light', 'dark']) test(`desktop tiles preview messages, preserve drafts and remember arrangement: ${theme}`, async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(theme => localStorage.setItem('code-ai:theme', theme), theme);
  const { project, created } = await sessions(request, 3);
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const machine = snapshot.machines.find(machine => machine.machine.kind === 'local')!;
  machine.sessions = machine.sessions.filter(session => created.some(item => item.id === session.id));
  machine.projects = machine.projects.filter(item => item.id === project.id);
  machine.sessions[0].lastMessage = { author: 'Claude', role: 'assistant', text: 'The parser change is ready for review.\n\n' + 'Details are available in the conversation. '.repeat(12), truncated: true };
  machine.sessions[1].title = 'Check the remaining repository changes';
  machine.sessions[2].title = 'Prepare the next task';
  await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
  await page.goto('/arena');
  await page.getByRole('button', { name: 'Tiles', exact: true }).click();
  const group = page.getByRole('region', { name: project.name, exact: true });
  const cards = group.locator('.arena-card');
  await expect(cards).toHaveCount(3);
  const a = await cards.nth(0).boundingBox(), b = await cards.nth(1).boundingBox();
  expect(b!.x).toBeGreaterThan(a!.x + a!.width);
  expect(b!.y).toBe(a!.y);
  const preview = cards.filter({ hasText: 'The parser change is ready' });
  await expect(preview).toContainText('Latest message · Claude');
  await preview.getByRole('button', { name: 'Show more', exact: true }).click();
  await expect(preview.getByRole('button', { name: 'Show less', exact: true })).toHaveAttribute('aria-expanded', 'true');
  const reply = cards.nth(1).getByRole('textbox');
  await reply.fill('Keep this reply while I check another session');
  await page.getByRole('link', { name: /^Inbox/ }).last().click();
  await page.getByRole('tab', { name: /^Active/ }).click();
  await expect(reply).toHaveValue('Keep this reply while I check another session');
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(group.locator('.arena-tile-body')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tiles', exact: true }).click();
  await expect(reply).toHaveValue('Keep this reply while I check another session');
  expect(await page.getByRole('main', { name: 'Arena' }).evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`tiles-${theme}.png`) });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Tiles', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(reply).toHaveValue('Keep this reply while I check another session');
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.getByRole('button', { name: 'Tiles', exact: true })).toHaveCount(0);
  await expect(group.locator('.arena-tile-body')).toHaveCount(0);
  expect(await page.getByRole('main', { name: 'Arena' }).evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`phone-${theme}.png`) });
});

test('two tiles send real background replies without navigation and receive saved previews', async ({ page, request }) => {
  const { created } = await sessions(request);
  await page.goto('/arena');
  await page.getByRole('button', { name: 'Tiles', exact: true }).click();
  const first = cardFor(page, created[0].id), second = cardFor(page, created[1].id);
  const posted: Array<{ sessionId: string; messageId: string }> = [];
  page.on('request', req => { if (new URL(req.url()).pathname === '/api/agent/message') posted.push(req.postDataJSON()); });
  await first.getByRole('textbox').fill('Draw a simple architecture');
  await second.getByRole('textbox').fill('Keep a separate reply');
  await first.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(first.getByRole('textbox')).toHaveValue('');
  await expect(second.getByRole('textbox')).toHaveValue('Keep a separate reply');
  await expect(first.locator('.arena-tile-preview')).toContainText('Here is one architecture map.');
  await expect(first.locator('.arena-tile-preview')).not.toContainText('flowchart');
  await first.getByRole('button', { name: 'Show more', exact: true }).click();
  await expect(first.locator('.arena-tile-preview pre')).toContainText('flowchart');
  await second.getByRole('textbox').press('Enter');
  await expect(second.locator('.arena-tile-preview')).toContainText('First turn complete.');
  await expect(page).toHaveURL(/\/arena$/);
  expect(posted.map(item => item.sessionId)).toEqual(created.map(session => session.id));
  for (const session of created) {
    const saved = (await (await request.get(`/api/sessions/${session.id}`)).json()).session as PublicSession;
    expect(saved.messages.filter(message => message.role === 'user')).toHaveLength(1);
  }
});

test('Arena opens with code and tables in collapsed Markdown previews', async ({ page, request }) => {
  const { created: [session] } = await sessions(request, 1);
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const machine = snapshot.machines.find(machine => machine.machine.kind === 'local')!;
  machine.sessions = machine.sessions.filter(item => item.id === session.id);
  machine.sessions[0].lastMessage = { author: 'Claude', role: 'assistant', text: [
    '```js', 'const ready = true;', '```', '',
    '| Check | Status |', '| --- | --- |', '| Parser | Passed |', '| Build | Passed |', '| Browser | Passed |', '| Review | Passed |',
  ].join('\n'), truncated: false };
  await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));

  await openTiles(page);
  const preview = cardFor(page, session.id).locator('.arena-tile-preview');
  await expect(preview.locator('pre code')).toHaveText('const ready = true;');
  await expect(preview.getByRole('table')).toContainText('Passed');
  await expect(preview.getByRole('button', { name: 'Copy code' })).toHaveCount(0);
  await expect(preview.getByRole('region', { name: 'Markdown table' })).toHaveCount(0);

  await preview.getByRole('button', { name: 'Show more', exact: true }).click();
  await expect(preview.getByRole('button', { name: 'Copy code' })).toBeVisible();
  await expect(preview.getByRole('region', { name: 'Markdown table' }).getByRole('table')).toContainText('Passed');
  await preview.getByRole('button', { name: 'Show less', exact: true }).click();
  await expect(preview.locator('pre code')).toHaveText('const ready = true;');
  await expect(preview.getByRole('table')).toContainText('Passed');
  await expect(cardFor(page, session.id).getByRole('textbox')).toBeEditable();
});

test('Show more lazily reads the complete saved Markdown response and keeps the tile reply', async ({ page, request }, testInfo) => {
  const { created: [session, neighbor] } = await sessions(request, 2);
  const messageReads: string[] = [];
  await page.route(`**/api/sessions/${session.id}?view=message&messageId=*`, async route => {
    messageReads.push(new URL(route.request().url()).searchParams.get('messageId')!);
    if (messageReads.length === 1) return route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } });
    return route.continue();
  });
  await openTiles(page);
  const card = cardFor(page, session.id), preview = card.locator('.arena-tile-preview');
  const reply = card.getByRole('textbox');
  await reply.fill('Arena full Markdown fixture');
  await reply.press('Enter');
  await expect(preview.getByRole('heading', { name: 'Review summary' })).toBeVisible();
  await expect(preview.locator('strong')).toHaveText('parser');
  await expect(preview.getByText('Final verification passed.')).toHaveCount(0);
  expect(messageReads).toHaveLength(0);
  const saved = (await (await request.get(`/api/sessions/${session.id}`)).json()).session as PublicSession;
  const neighborCard = cardFor(page, neighbor.id);
  const neighborHeight = (await neighborCard.boundingBox())!.height;
  await reply.fill('Keep this draft while reading');
  await preview.getByRole('button', { name: 'Show more', exact: true }).click();
  await expect(preview.getByRole('alert')).toContainText('Could not load the full message');
  await expect(preview.getByRole('heading', { name: 'Review summary' })).toBeVisible();
  await preview.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(preview.getByRole('listitem')).toHaveText('Final verification passed.');
  await expect(preview.locator('pre code')).toContainText('const reviewed = true;');
  expect(messageReads).toEqual([saved.messages.at(-1)!.id, saved.messages.at(-1)!.id]);
  await expect(reply).toHaveValue('Keep this draft while reading');
  expect((await neighborCard.boundingBox())!.height).toBeLessThanOrEqual(neighborHeight);
  await page.screenshot({ path: testInfo.outputPath('arena-expanded-markdown.png') });
  await preview.getByRole('button', { name: 'Show less', exact: true }).click();
  await expect(preview.getByText('Final verification passed.')).toHaveCount(0);
  await preview.getByRole('button', { name: 'Show more', exact: true }).click();
  await expect(preview.getByRole('listitem')).toHaveText('Final verification passed.');
  expect(messageReads).toHaveLength(2);
  await expect(page).toHaveURL(/\/arena$/);
});

test('failed delivery keeps the draft; uncertain retry keeps the same message UUID', async ({ page, request }) => {
  const { created: [session] } = await sessions(request, 1);
  let readable = true, posts = 0, accept = false;
  const messages: Array<{ messageId: string; text: string; participantId: string }> = [];
  await page.route(`**/api/sessions/${session.id}`, route => route.fulfill({ status: readable ? 200 : 503, json: readable ? { session } : { error: 'Temporarily unavailable' } }));
  await page.route('**/api/agent/message', async route => {
    posts++; messages.push(route.request().postDataJSON());
    if (posts === 1) return route.fulfill({ status: 429, json: { error: 'Queue full. Try again.' } });
    if (!accept) { readable = false; return route.abort(); }
    return route.fulfill({ status: 200, headers: { 'X-CodeAI-Run-Id': crypto.randomUUID() }, body: '' });
  });
  await page.goto('/arena');
  await page.getByRole('button', { name: 'Tiles', exact: true }).click();
  const card = cardFor(page, session.id), input = card.getByRole('textbox');
  await input.fill('Preserve my instruction');
  await card.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(card.getByRole('alert')).toContainText('Queue full');
  await expect(input).toHaveValue('Preserve my instruction');
  await expect(input).toBeEditable();
  await input.fill('The revised instruction');
  await card.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Check / retry', exact: true })).toBeVisible();
  await expect(input).not.toBeEditable();
  const originalAgentId = session.primaryAgentId;
  const originalAgent = session.participants.find(participant => participant.kind === 'agent')!;
  session.primaryAgentId = crypto.randomUUID();
  session.participants.push({ ...originalAgent, id: session.primaryAgentId });
  await page.reload();
  await expect(card.getByRole('button', { name: 'Check / retry', exact: true })).toBeVisible();
  await expect(input).toHaveValue('The revised instruction');
  readable = true; accept = true;
  await card.getByRole('button', { name: 'Check / retry', exact: true }).click();
  await expect(input).toHaveValue('');
  expect(messages).toHaveLength(3);
  expect(messages[1]).toEqual(messages[2]);
  expect(messages[2].participantId).toBe(originalAgentId);
  expect(messages[1].messageId).not.toBe(messages[0].messageId);
});

test('tiles route duplicate session ids to their own machine and block offline replies', async ({ page, request }) => {
  const { created: [session] } = await sessions(request, 1);
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const local = snapshot.machines.find(machine => machine.machine.kind === 'local')!;
  local.sessions = local.sessions.filter(item => item.id === session.id);
  const remote = structuredClone(local);
  remote.machine = { ...remote.machine, id: crypto.randomUUID(), kind: 'remote', label: 'Tile executor' };
  const responseId = crypto.randomUUID();
  remote.sessions[0].lastActivity = { messageId: responseId, createdAt: new Date().toISOString(), status: 'complete' };
  remote.sessions[0].lastMessage = { author: 'Claude', role: 'assistant', text: 'Remote preview', truncated: true };
  snapshot.machines.push(remote);
  await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
  const targets: string[] = [];
  await page.route(`**/api/machines/${remote.machine.id}/sessions/${session.id}`, route => route.fulfill({ json: { session } }));
  await page.route(`**/api/machines/${remote.machine.id}/sessions/${session.id}?view=message&messageId=${responseId}`, route => route.fulfill({ json: {
    revision: session.revision, message: { id: responseId, role: 'assistant', rawMarkdown: '## Full remote response' },
  } }));
  await page.route(`**/api/machines/${remote.machine.id}/agent/message`, route => {
    targets.push(route.request().url());
    return route.fulfill({ headers: { 'X-CodeAI-Run-Id': crypto.randomUUID() }, body: '' });
  });
  await page.goto('/arena');
  await page.getByRole('button', { name: 'Tiles', exact: true }).click();
  const homeCard = page.getByRole('region', { name: local.machine.label, exact: true }).locator('.arena-card');
  const remoteCard = page.getByRole('region', { name: 'Tile executor', exact: true }).locator('.arena-card');
  await remoteCard.getByRole('button', { name: 'Show more', exact: true }).click();
  await expect(remoteCard.getByRole('heading', { name: 'Full remote response' })).toBeVisible();
  await expect(homeCard.getByRole('heading', { name: 'Full remote response' })).toHaveCount(0);
  await homeCard.getByRole('textbox').fill('Home draft');
  await remoteCard.getByRole('textbox').fill('Remote reply');
  remote.providers.claude.available = false; await pushArenaSnapshot(page);
  await expect(remoteCard.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await remoteCard.getByRole('textbox').press('Enter');
  expect(targets).toHaveLength(0);
  remote.providers.claude.available = true; await pushArenaSnapshot(page);
  remote.machine.state = 'offline'; await pushArenaSnapshot(page);
  await expect(remoteCard.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await expect(remoteCard.getByRole('textbox')).toHaveValue('Remote reply');
  remote.machine.state = 'online'; await pushArenaSnapshot(page);
  await remoteCard.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(remoteCard.getByRole('textbox')).toHaveValue('');
  await expect(homeCard.getByRole('textbox')).toHaveValue('Home draft');
  expect(targets).toEqual([expect.stringContaining(`/api/machines/${remote.machine.id}/agent/message`)]);
  delete remote.sessions[0].primaryAgentId;
  await pushArenaSnapshot(page);
  await remoteCard.getByRole('textbox').fill('A legacy-executor draft');
  await expect(remoteCard).toContainText('executor needs an update');
  await expect(remoteCard.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await remoteCard.getByRole('textbox').press('Enter');
  expect(targets).toHaveLength(1);
  await expect(page).toHaveURL(/\/arena$/);
});

test('uncertain delivery can be checked after reload even when the provider becomes unavailable', async ({ page, request }) => {
  const { created: [session] } = await sessions(request, 1);
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const remote = structuredClone(snapshot.machines.find(machine => machine.machine.kind === 'local')!);
  remote.machine = { ...remote.machine, id: crypto.randomUUID(), kind: 'remote', label: 'Recovery executor' };
  remote.sessions = remote.sessions.filter(item => item.id === session.id);
  snapshot.machines.push(remote);
  await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
  let readable = true, posts = 0;
  await page.route(`**/api/machines/${remote.machine.id}/sessions/${session.id}`, route => route.fulfill({ status: readable ? 200 : 503, json: readable ? { session } : {} }));
  await page.route(`**/api/machines/${remote.machine.id}/agent/message`, route => {
    posts++;
    const sent = route.request().postDataJSON();
    session.messages.push({ id: sent.messageId, authorId: session.participants.find(item => item.kind === 'human')!.id,
      role: 'user', addressedParticipantId: sent.participantId, text: sent.text, createdAt: new Date().toISOString(), status: 'sent', diagramAttachments: [] });
    readable = false;
    return route.abort();
  });
  await page.goto('/arena');
  await page.getByRole('button', { name: 'Tiles', exact: true }).click();
  const card = page.getByRole('region', { name: 'Recovery executor', exact: true }).locator('.arena-card');
  await card.getByRole('textbox').fill('Confirm this original reply');
  await card.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Check / retry', exact: true })).toBeVisible();
  remote.providers.claude.available = false;
  await page.reload();
  await expect(card.getByRole('textbox')).toHaveValue('Confirm this original reply');
  readable = true;
  await card.getByRole('button', { name: 'Check / retry', exact: true }).click();
  await expect(card.getByRole('textbox')).toHaveValue('');
  await expect(card.getByRole('status')).toContainText('Sent');
  expect(posts).toBe(1);
});

test('permission controls on a tile resolve the exact run without opening its conversation', async ({ page, request }) => {
  const { created: [session] } = await sessions(request, 1);
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const machine = snapshot.machines.find(machine => machine.machine.kind === 'local')!;
  machine.sessions = machine.sessions.filter(item => item.id === session.id);
  const runId = crypto.randomUUID(), requestId = crypto.randomUUID();
  machine.runs.active = [{ runId, sessionId: session.id, participantId: session.primaryAgentId, state: 'needs-you', enqueuedAt: Date.now(), pendingPermissionCount: 1,
    pendingPermissions: [{ requestId, participantId: session.primaryAgentId, tool: 'Bash', detail: 'git diff -- src/features/arena/Arena.tsx' }] }];
  await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
  let decision: unknown;
  await page.route('**/api/agent/permission', route => { decision = route.request().postDataJSON(); machine.runs.active = []; return route.fulfill({ json: { ok: true } }); });
  await page.goto('/arena');
  await page.getByRole('button', { name: 'Tiles', exact: true }).click();
  const card = cardFor(page, session.id);
  await expect(card).toContainText('git diff -- src/features/arena/Arena.tsx');
  await card.getByRole('textbox').fill('My next instruction');
  await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await card.getByRole('button', { name: 'Allow', exact: true }).click();
  expect(decision).toMatchObject({ runId, requestId, decision: 'allow' });
  await expect(card.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await expect(card.getByRole('textbox')).toHaveValue('My next instruction');
  await expect(page).toHaveURL(/\/arena$/);
});
