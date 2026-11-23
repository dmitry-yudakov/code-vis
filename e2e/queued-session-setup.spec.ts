import { expect, test, fulfillArenaSnapshot, pushArenaSnapshot, type APIRequestContext } from './arena-stream';
import type { ArenaSnapshot, CheckoutsResponse, DurableProject, PublicSession, RunDiscovery } from '../src/shared/types';

for (const theme of ['light', 'dark']) for (const width of [1280, 390]) {
  test(`queue setup closes before creation and acceptance respond: ${theme} ${width}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    const catalog = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
    const checkout = catalog.checkouts.find(item => item.relativePath === 'alpha')!;
    const project = (await (await request.post('/api/projects', { data: { name: `Optimistic queue ${theme} ${width} ${Date.now()}`, checkoutIds: [checkout.id] } })).json()).project as DurableProject;
    let releaseCreation!: () => void;
    let releaseMessage!: () => void;
    const creationHeld = new Promise<void>(resolve => { releaseCreation = resolve; });
    const messageHeld = new Promise<void>(resolve => { releaseMessage = resolve; });
    let creations = 0;
    let messages = 0;
    await page.route('**/api/sessions', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      creations++;
      await creationHeld;
      const response = await route.fetch();
      await route.fulfill({ response });
    });
    await page.route('**/api/agent/message', async route => {
      messages++;
      expect(route.request().postDataJSON()).toMatchObject({ text: 'Keep this queued idea', waitForCheckout: true,
        fileAttachments: [{ name: 'idea.txt', text: 'Keep this evidence' }] });
      await messageHeld;
      await route.fulfill({ status: 200, headers: { 'X-CodeAI-Run-Id': 'optimistic-queue', 'X-CodeAI-Run-State': 'queued' }, body: '' });
    });
    try {
      await page.goto(`/?project=${project.id}`);
      const shortcut = page.locator('.app-header').getByRole('button', { name: 'New session', exact: true });
      await shortcut.click();
      await page.getByRole('button', { name: 'Queue session…', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'New session', exact: true });
      const notices = page.getByRole('region', { name: 'Notifications', exact: true });
      await dialog.getByRole('textbox').fill('Keep this queued idea');
      await dialog.locator('input[type=file]').setInputFiles({ name: 'idea.txt', mimeType: 'text/plain', buffer: Buffer.from('Keep this evidence') });
      await dialog.getByRole('button', { name: 'Queue session', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(shortcut).toBeFocused();
      await expect(notices.getByText('Queueing session…', { exact: true })).toBeVisible();
      expect(creations).toBe(1);
      expect(messages).toBe(0);
      await page.screenshot({ path: testInfo.outputPath('queue-pending.png'), animations: 'disabled' });
      await page.getByRole('link', { name: 'Arena', exact: true }).click();
      await page.getByRole('button', { name: `New session in ${project.name}`, exact: true }).click();
      await expect(dialog.getByRole('status')).toHaveText('Queueing session…');
      await expect(dialog.getByRole('button', { name: 'Queue session', exact: true })).toHaveCount(0);
      await dialog.getByRole('button', { name: 'Close setup', exact: true }).click();
      releaseCreation();
      await expect.poll(() => messages).toBe(1);
      await expect(dialog).toBeHidden();
      await expect(notices.getByText('Queueing session…', { exact: true })).toBeVisible();
      await expect(notices.getByText('Session queued. It will start after earlier sessions are archived.', { exact: true })).toHaveCount(0);
      releaseMessage();
      await expect(page.getByText('Session queued. It will start after earlier sessions are archived.', { exact: true })).toBeVisible();
      await expect(notices.getByText('Queueing session…', { exact: true })).toHaveCount(0);
      await expect(page).toHaveURL(/\/arena$/);
      expect(creations).toBe(1);
      expect(messages).toBe(1);
      await page.screenshot({ path: testInfo.outputPath('queue-accepted.png'), animations: 'disabled' });
    } finally {
      releaseCreation(); releaseMessage();
    }
  });
}

for (const recovery of ['rejected', 'uncertain'] as const) {
  test(`optimistic queue restores ${recovery} creation after navigation`, async ({ page, request }, testInfo) => {
    const catalog = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
    const checkout = catalog.checkouts.find(item => item.relativePath === 'alpha')!;
    const project = (await (await request.post('/api/projects', { data: { name: `Queue creation ${recovery} ${Date.now()}`, checkoutIds: [checkout.id] } })).json()).project as DurableProject;
    const creations: unknown[] = [];
    let releaseCreation!: () => void;
    const creationHeld = new Promise<void>(resolve => { releaseCreation = resolve; });
    await page.route('**/api/sessions', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      creations.push(route.request().postDataJSON());
      if (creations.length > 1) return route.continue();
      // An uncertain response can hide a successfully persisted session.
      if (recovery === 'uncertain') await route.fetch();
      await creationHeld;
      return recovery === 'uncertain' ? route.abort('failed')
        : route.fulfill({ status: 409, json: { error: 'Creation unavailable. Try again.', creationState: 'none' } });
    });
    const messages: unknown[] = [];
    await page.route('**/api/agent/message', route => {
      messages.push(route.request().postDataJSON());
      return route.fulfill({ status: 200, headers: { 'X-CodeAI-Run-Id': 'creation-retry', 'X-CodeAI-Run-State': 'queued' }, body: '' });
    });
    try {
      await page.goto(`/?project=${project.id}`);
      await page.locator('.app-header').getByRole('button', { name: 'New session', exact: true }).click();
      await page.getByRole('button', { name: 'Queue session…', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'New session', exact: true });
      await dialog.getByRole('textbox').fill('Retain this queued setup /autoclose');
      await dialog.locator('input[type=file]').setInputFiles({ name: 'idea.txt', mimeType: 'text/plain', buffer: Buffer.from('Retained evidence') });
      await dialog.getByRole('button', { name: 'Queue session', exact: true }).click();
      await expect(dialog).toBeHidden();
      await page.getByRole('link', { name: 'Arena', exact: true }).click();
      releaseCreation();
      const notice = page.getByRole('region', { name: 'Notifications', exact: true });
      await expect(notice.getByRole('alert')).toContainText(recovery === 'uncertain' ? 'Creation status is unknown' : 'Creation unavailable');
      await expect(dialog).toBeHidden();
      await expect(page.getByText('Queueing session…', { exact: true })).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath('queue-creation-failed.png'), animations: 'disabled' });
      if (recovery === 'rejected') await page.getByRole('button', { name: `New session in ${project.name}`, exact: true }).click();
      else await notice.getByRole('button', { name: 'Review setup', exact: true }).click();
      await expect(notice.getByRole('button', { name: 'Review setup', exact: true })).toHaveCount(0);
      await expect(dialog.getByRole('textbox')).toHaveValue('Retain this queued setup');
      await expect(dialog).toContainText('idea.txt');
      if (recovery === 'uncertain') await expect(dialog.getByRole('textbox')).toBeDisabled();
      await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText('Session queued. It will start after earlier sessions are archived.', { exact: true })).toBeVisible();
      expect(creations).toHaveLength(2);
      for (const creation of creations) expect(creation).toMatchObject({ allowAgentArchive: true });
      if (recovery === 'uncertain') expect(creations[1]).toEqual(creations[0]);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ text: 'Retain this queued setup', waitForCheckout: true,
        fileAttachments: [{ name: 'idea.txt', text: 'Retained evidence' }] });
      expect((await (await request.get(`/api/sessions?projectId=${project.id}`)).json()).sessions).toHaveLength(1);
      await expect(page).toHaveURL(/\/arena$/);
    } finally {
      releaseCreation();
    }
  });
}

for (const theme of ['light', 'dark']) for (const width of [1280, 390]) {
  test(`queue setup opens inside a project and retains its draft: ${theme} ${width}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    const catalog = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
    const checkout = catalog.checkouts.find(item => item.relativePath === 'alpha')!;
    const project = (await (await request.post('/api/projects', { data: { name: `Open project queue ${theme} ${width} ${Date.now()}`, checkoutIds: [checkout.id] } })).json()).project as DurableProject;
    await page.goto(`/?project=${project.id}`);
    const newSession = page.locator('.app-header').getByRole('button', { name: 'New session', exact: true });
    await newSession.click();
    const menu = page.locator('.desktop-picker-paper:visible');
    await expect(menu.getByRole('button', { name: 'Start session', exact: true })).toBeEnabled();
    const queueSetup = menu.getByRole('button', { name: 'Queue session…', exact: true });
    await expect(queueSetup).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('project-queue-menu.png'), animations: 'disabled' });
    await queueSetup.click();
    const dialog = page.getByRole('dialog', { name: 'New session', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Project', { exact: true })).toHaveValue(project.id);
    const input = dialog.getByRole('textbox', { name: 'First message (optional)' });
    await expect(input).toBeFocused();
    const queue = dialog.getByRole('button', { name: 'Queue session', exact: true });
    await expect(queue).toBeDisabled();
    await input.fill('Work on this project next');
    await expect(queue).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('project-queue-setup.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(newSession).toBeFocused();
    await newSession.click();
    await queueSetup.click();
    await expect(input).toHaveValue('Work on this project next');
    await expect(page).toHaveURL(`/?project=${project.id}`);
    expect((await (await request.get(`/api/sessions?projectId=${project.id}`)).json()).sessions).toHaveLength(0);
  });
}

for (const modifier of ['Control', 'Meta']) {
  test(`${modifier}+Enter queues only when the queue action is available`, async ({ page, request }) => {
    const catalog = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
    const checkout = catalog.checkouts.find(item => item.relativePath === 'alpha')!;
    const project = (await (await request.post('/api/projects', { data: { name: `Queue shortcut ${modifier} ${Date.now()}`, checkoutIds: [checkout.id] } })).json()).project as DurableProject;
    const messages: Array<{ waitForCheckout?: boolean }> = [];
    let creations = 0;
    page.on('request', req => { if (req.url().endsWith('/api/sessions') && req.method() === 'POST') creations++; });
    await page.route('**/api/agent/message', route => {
      messages.push(route.request().postDataJSON());
      return route.fulfill({ status: 429, json: { error: 'The machine queue is full. Your draft is kept.' } });
    });
    await page.goto('/arena');
    await page.getByRole('button', { name: `New session in ${project.name}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New session', exact: true });
    const message = dialog.getByRole('textbox', { name: 'First message (optional)' });
    await message.press(`${modifier}+Enter`);
    await expect(dialog).toBeVisible();
    expect(creations).toBe(0);
    await message.fill('Queue using the keyboard');
    await message.press('Shift+Enter');
    await expect(message).toHaveValue('Queue using the keyboard\n');
    for (const flags of [{ isComposing: true }, { repeat: true }]) {
      await message.dispatchEvent('keydown', { key: 'Enter', ctrlKey: modifier === 'Control', metaKey: modifier === 'Meta', ...flags });
    }
    expect(creations).toBe(0);
    await dialog.getByRole('button', { name: 'Settings', exact: true }).click();
    await dialog.getByLabel('Session checkout', { exact: true }).selectOption('worktree');
    await message.press(`${modifier}+Enter`);
    expect(creations).toBe(0);
    await dialog.getByLabel('Session checkout', { exact: true }).selectOption('current');
    await message.press(`${modifier}+Enter`);
    await page.getByRole('button', { name: 'Review setup', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('queue is full');
    expect(creations).toBe(1);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ waitForCheckout: true });
    // Modified Enter cannot switch or retry an error; ordinary Enter preserves the captured request.
    await message.press(`${modifier}+Enter`);
    expect(messages).toHaveLength(1);
    await message.press('Enter');
    await expect.poll(() => messages.length).toBe(2);
    expect(messages[1]).toEqual(messages[0]);
    expect(creations).toBe(1);
  });
}

for (const theme of ['light', 'dark']) for (const width of [1280, 390]) {
  test(`setup shows live active project sessions beside launch actions: ${theme} ${width}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    const catalog = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
    const checkout = catalog.checkouts.find(item => item.relativePath === 'alpha')!;
    const project = (await (await request.post('/api/projects', { data: { name: `Active hint ${theme} ${width} ${Date.now()}`, checkoutIds: [checkout.id] } })).json()).project as DurableProject;
    const otherProject = (await (await request.post('/api/projects', { data: { name: `Other hint ${theme} ${width} ${Date.now()}`, checkoutIds: [checkout.id] } })).json()).project as DurableProject;
    const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
    const machine = snapshot.machines.find(entry => entry.machine.kind === 'local')!;
    const session = { id: crypto.randomUUID(), revision: 0, title: 'Earlier work', projectId: project.id,
      repositoryCheckoutIds: [checkout.id], agents: [], updatedAt: new Date().toISOString() };
    machine.sessions.push(session);
    machine.sessions.push({ ...session, id: crypto.randomUUID(), projectId: otherProject.id });
    machine.archivedSessions.push({ ...session, id: crypto.randomUUID(), archivedAt: new Date().toISOString() });
    await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
    await page.goto('/arena');
    await page.getByRole('button', { name: `New session in ${project.name}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New session', exact: true });
    const actions = dialog.locator('.MuiDialogActions-root');
    await expect(actions.getByText('1 active session in this project', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Settings', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(actions.getByText('1 active session in this project', { exact: true })).toBeFocused();
    await expect(page.getByRole('tooltip', { name: /^Unarchived conversations/ })).toBeVisible();
    await dialog.getByRole('textbox').fill('Next task');
    await dialog.getByRole('button', { name: 'Queue session', exact: true }).hover();
    await expect(page.getByRole('tooltip', { name: /^Ctrl\/Cmd\+Enter/ })).toBeVisible();
    await dialog.getByRole('textbox').focus();
    await page.mouse.move(0, 0);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('active-project-hint.png'), animations: 'disabled' });
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await expect(dialog.getByRole('button', { name: 'Queue session', exact: true })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Start in background', exact: true })).toBeInViewport();
    machine.sessions.push({ ...session, id: crypto.randomUUID() });
    await pushArenaSnapshot(page);
    await expect(actions.getByText('2 active sessions in this project', { exact: true })).toBeVisible();
    await dialog.getByLabel('Project', { exact: true }).selectOption(otherProject.id);
    await expect(actions.getByText('1 active session in this project', { exact: true })).toBeVisible();
    await dialog.getByLabel('Project', { exact: true }).selectOption('');
    await expect(actions.getByText(/active sessions? in this project/)).toHaveCount(0);
    await dialog.getByLabel('Project', { exact: true }).selectOption(project.id);
    await expect(actions.getByText('2 active sessions in this project', { exact: true })).toBeVisible();
    machine.machine.state = 'offline';
    await pushArenaSnapshot(page);
    await expect(actions.getByText(/active sessions? in this project/)).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Queue session', exact: true })).toBeDisabled();
    machine.machine.state = 'online';
    await pushArenaSnapshot(page);
    await expect(actions.getByText('2 active sessions in this project', { exact: true })).toBeVisible();
    machine.sessions = machine.sessions.filter(item => item.projectId !== project.id);
    await pushArenaSnapshot(page);
    await expect(actions.getByText(/active sessions? in this project/)).toHaveCount(0);
  });
}

async function archiveEarlierFixtureSessions(request: APIRequestContext, checkoutId: string) {
  const sessions = (await (await request.get('/api/sessions')).json()).sessions as PublicSession[];
  const matching = sessions.filter(session => session.repositories.some(repository => repository.role === 'primary' && repository.checkoutId === checkoutId));
  const ids = new Set(matching.map(session => session.id));
  const runs = await (await request.get('/api/agent/runs')).json() as RunDiscovery;
  for (const run of runs.active.filter(run => ids.has(run.sessionId))) await request.post('/api/agent/cancel', { data: { runId: run.runId } });
  await expect.poll(async () => ((await (await request.get('/api/agent/runs')).json()) as RunDiscovery).active.filter(run => ids.has(run.sessionId)).length).toBe(0);
  for (const session of matching) {
    const saved = (await (await request.get(`/api/sessions/${session.id}`)).json()).session as PublicSession;
    expect((await request.post(`/api/sessions/${session.id}/archive`, { data: { expectedRevision: saved.revision } })).ok()).toBe(true);
  }
}

for (const theme of ['light', 'dark']) for (const width of [1280, 390]) {
  test(`queued setup preserves its draft and current checkout: ${theme} ${width}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    const catalog = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
    const checkout = catalog.checkouts.find(item => item.relativePath === 'alpha')!;
    const target = (await (await request.post('/api/projects', { data: { name: `Queued ${theme} ${width} ${Date.now()}`, checkoutIds: [checkout.id] } })).json()).project as DurableProject;
    await page.goto('/arena');
    const shortcut = page.getByRole('button', { name: `New session in ${target.name}`, exact: true });
    await shortcut.click();
    const dialog = page.getByRole('dialog', { name: 'New session', exact: true });
    const message = dialog.getByRole('textbox', { name: 'First message (optional)' });
    const queue = dialog.getByRole('button', { name: 'Queue session', exact: true });
    await expect(dialog.getByLabel('Start session', { exact: true })).toHaveCount(0);
    await expect(queue).toBeVisible();
    await expect(queue).toHaveClass(/MuiButton-outlined/);
    await expect(queue).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Create and open', exact: true })).toBeEnabled();
    await message.fill('Work after the current task');
    await expect(queue).toBeEnabled();
    await expect(dialog.getByRole('button', { name: 'Start in background', exact: true })).toBeEnabled();
    await queue.hover();
    await expect(page.getByRole('tooltip')).toHaveText('Ctrl/Cmd+Enter. Starts after earlier sessions on this repository are archived.');
    await message.focus();
    await message.fill('');
    await expect(queue).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Create and open', exact: true })).toBeEnabled();
    await message.fill('Work after the current task');
    await dialog.getByRole('button', { name: 'Close setup', exact: true }).click();
    await shortcut.click();
    await expect(queue).toBeEnabled();
    await expect(message).toHaveValue('Work after the current task');
    await expect(dialog.getByRole('button', { name: 'Start in background', exact: true })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('queued-setup.png'), animations: 'disabled' });
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await dialog.getByRole('button', { name: 'Settings', exact: true }).click();
    const checkoutChoice = dialog.getByLabel('Session checkout', { exact: true });
    await expect(checkoutChoice).toHaveValue('current');
    await checkoutChoice.selectOption('worktree');
    await expect(queue).toHaveCount(0);
    await checkoutChoice.selectOption('current');
    await expect(queue).toBeEnabled();
  });
}

for (const recovery of ['rejected', 'uncertain', 'edit-and-send'] as const) {
  test(`the queue action preserves delivery through ${recovery}`, async ({ page, request }) => {
    const catalog = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
    const checkout = catalog.checkouts.find(item => item.relativePath === 'alpha')!;
    const project = (await (await request.post('/api/projects', { data: { name: `Queue recovery ${recovery} ${Date.now()}`, checkoutIds: [checkout.id] } })).json()).project as DurableProject;
    const messages: Array<{ sessionId: string; messageId: string; text: string; waitForCheckout?: boolean }> = [];
    let creations = 0;
    let reconciliationUnavailable = recovery === 'uncertain';
    page.on('request', req => { if (req.url().endsWith('/api/sessions') && req.method() === 'POST') creations++; });
    await page.route('**/api/sessions/*', route => {
      if (reconciliationUnavailable && messages.length === 1 && route.request().method() === 'GET') return route.abort('failed');
      return route.continue();
    });
    await page.route('**/api/agent/message', route => {
      messages.push(route.request().postDataJSON());
      if (messages.length > 1) return route.continue();
      return recovery === 'uncertain' ? route.abort('failed')
        : route.fulfill({ status: 429, json: { error: 'The machine queue is full. Your draft is kept.' } });
    });
    await page.goto(`/?project=${project.id}`);
    const shortcut = page.locator('.app-header').getByRole('button', { name: 'New session', exact: true });
    await shortcut.click();
    await page.getByRole('button', { name: 'Queue session…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New session', exact: true });
    const message = dialog.getByRole('textbox', { name: 'First message (optional)' });
    await message.fill('Queue this task');
    await dialog.getByRole('button', { name: 'Queue session', exact: true }).click();
    await page.getByRole('button', { name: 'Review setup', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(recovery === 'uncertain' ? 'Delivery status is unknown' : 'queue is full');
    expect(messages[0]).toMatchObject({ text: 'Queue this task', waitForCheckout: true });
    await expect(dialog.getByRole('button', { name: 'Queue session', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled();
    if (recovery === 'uncertain') await expect(message).toBeDisabled();
    await dialog.getByRole('button', { name: 'Close setup', exact: true }).click();
    await shortcut.click();
    await page.getByRole('button', { name: 'Queue session…', exact: true }).click();
    await expect(message).toHaveValue('Queue this task');
    reconciliationUnavailable = false;
    if (recovery === 'edit-and-send') {
      // A definitive rejection permits a new instruction; Enter must use the normal start action.
      await message.fill('');
      await expect(dialog.getByRole('button', { name: 'Queue session', exact: true })).toBeDisabled();
      await expect(dialog.getByRole('button', { name: 'Create and open', exact: true })).toBeEnabled();
      await message.fill('Start the edited task now');
      await expect(dialog.getByText('Starts after earlier sessions on this repository are archived.', { exact: true })).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: 'Start in background', exact: true })).toBeEnabled();
      await message.press('Enter');
    } else await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(creations).toBe(1);
    expect(messages).toHaveLength(2);
    if (recovery === 'edit-and-send') {
      expect(messages[1]).not.toHaveProperty('waitForCheckout');
      expect(messages[1]).toMatchObject({ sessionId: messages[0].sessionId, text: 'Start the edited task now' });
      expect(messages[1].messageId).not.toBe(messages[0].messageId);
    } else expect(messages[1]).toEqual(messages[0]);
  });
}

test('a task queued inside an open conversation remains idle across reload and follow-ups, then runs after archive', async ({ page, request }) => {
  const catalog = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const checkout = catalog.checkouts.find(item => item.relativePath === 'alpha')!;
  await archiveEarlierFixtureSessions(request, checkout.id);
  const project = (await (await request.post('/api/projects', { data: { name: `Project queue ${Date.now()}`, checkoutIds: [checkout.id] } })).json()).project as DurableProject;
  const current = (await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json()).session as PublicSession;
  const activeRunIds: string[] = [];
  try {
    await page.goto(`/?session=${current.id}`);
    const composer = page.getByRole('complementary', { name: 'Conversation', exact: true }).getByRole('textbox', { name: 'Instruction', exact: true });
    await composer.fill('Keep this conversation draft');
    // Fetch only acceptance headers: cancelling this response detaches the browser, not the turn.
    const started = await page.evaluate(async session => {
      const response = await fetch('/api/agent/message', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, messageId: crypto.randomUUID(), participantId: session.primaryAgentId,
          text: 'Concurrent slot project queue', mode: 'ask', diagramAttachments: [] }) });
      const runId = response.headers.get('X-CodeAI-Run-Id');
      await response.body?.cancel();
      return { status: response.status, runId };
    }, current);
    expect(started.status).toBe(200); activeRunIds.push(started.runId!);
    await page.locator('.app-header').getByRole('button', { name: 'New session', exact: true }).click();
    await page.getByRole('button', { name: 'Queue session…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New session', exact: true });
    await dialog.getByRole('textbox').fill('Plan the next task after current work');
    await dialog.locator('input[type=file]').setInputFiles({ name: 'next.txt', mimeType: 'text/plain', buffer: Buffer.from('Evidence for the next task') });
    await dialog.getByLabel('Mode', { exact: true }).selectOption('plan');
    const accepted = page.waitForResponse(response => response.url().endsWith('/api/agent/message') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Queue session', exact: true }).click();
    const response = await accepted;
    const body = response.request().postDataJSON();
    expect(body).toMatchObject({ waitForCheckout: true, mode: 'plan', fileAttachments: [{ name: 'next.txt', text: 'Evidence for the next task' }] });
    expect(await response.headerValue('X-CodeAI-Run-State')).toBe('queued');
    activeRunIds.push((await response.headerValue('X-CodeAI-Run-Id'))!);
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Session queued. It will start after earlier sessions are archived.', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(`/?session=${current.id}`);
    await expect(composer).toHaveValue('Keep this conversation draft');
    await page.reload();
    await expect(composer).toHaveValue('Keep this conversation draft');
    await page.goto('/arena');
    const tile = page.locator('.arena-card').filter({ has: page.locator(`a[href*="session=${body.sessionId}"]`) });
    await expect(tile).toContainText('Queued');
    const snapshot = (await (await request.get(`/api/sessions/${body.sessionId}`)).json()).session as PublicSession;
    expect(snapshot.projectId).toBe(project.id);
    expect(snapshot.repositories.map(binding => binding.checkoutId)).toEqual([checkout.id]);
    expect(snapshot.worktree).toBeUndefined();
    expect(snapshot.messages.at(-1)).toMatchObject({ id: body.messageId, role: 'user', mode: 'plan', status: 'sending' });
    await expect.poll(async () => ((await (await request.get('/api/agent/runs')).json()) as RunDiscovery).active.some(run => run.runId === started.runId), { timeout: 25_000 }).toBe(false);
    expect(((await (await request.get('/api/agent/runs')).json()) as RunDiscovery).active.find(run => run.sessionId === body.sessionId)).toMatchObject({ state: 'queued' });
    // Follow-up work remains available even though another idea is waiting on this repository.
    const followup = await request.post('/api/agent/message', { data: { sessionId: current.id, messageId: crypto.randomUUID(), participantId: current.primaryAgentId,
      text: 'Continue the current conversation', mode: 'ask', diagramAttachments: [] } });
    expect(followup.ok()).toBe(true);
    await followup.text();
    expect(((await (await request.get('/api/agent/runs')).json()) as RunDiscovery).active.find(run => run.sessionId === body.sessionId)).toMatchObject({ state: 'queued' });
    const previous = (await (await request.get(`/api/sessions/${current.id}`)).json()).session as PublicSession;
    const archived = await request.post(`/api/sessions/${current.id}/archive`, { data: { expectedRevision: previous.revision } });
    expect(archived.ok()).toBe(true);
    const archivedAt = Date.parse((await archived.json()).session.archivedAt);
    await expect.poll(async () => {
      const saved = (await (await request.get(`/api/sessions/${body.sessionId}`)).json()).session as PublicSession;
      return saved.messages.find(message => message.role === 'assistant')?.status;
    }, { timeout: 25_000 }).toBe('complete');
    const discovery = await (await request.get('/api/agent/runs')).json() as RunDiscovery;
    const first = discovery.recent.find(run => run.runId === started.runId)!;
    const next = discovery.recent.find(run => run.sessionId === body.sessionId)!;
    expect(next.startedAt).toBeGreaterThanOrEqual(Math.max(first.finishedAt!, archivedAt));
  } finally {
    for (const runId of activeRunIds) await request.post('/api/agent/cancel', { data: { runId } });
  }
});

for (const theme of ['light', 'dark']) for (const width of [1280, 390]) {
  test(`edit a queued idea and retain failed saves: ${theme} ${width}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    const catalog = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
    const checkout = catalog.checkouts.find(item => item.relativePath === 'alpha')!;
    const project = (await (await request.post('/api/projects', { data: { name: `Editable idea ${theme} ${width} ${Date.now()}`, checkoutIds: [checkout.id] } })).json()).project as DurableProject;
    const current = (await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json()).session as PublicSession;
    const first = await request.post('/api/agent/message', { data: { sessionId: current.id, messageId: crypto.randomUUID(), participantId: current.primaryAgentId, text: 'Current work', mode: 'ask', diagramAttachments: [] } });
    expect(first.ok()).toBe(true); await first.text();
    const next = (await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json()).session as PublicSession;
    const messageId = crypto.randomUUID();
    await page.goto(`/?session=${next.id}`);
    const queued = await page.evaluate(async data => {
      const response = await fetch('/api/agent/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const runId = response.headers.get('X-CodeAI-Run-Id');
      await response.body?.cancel();
      return { status: response.status, runId };
    }, { sessionId: next.id, participantId: next.primaryAgentId, messageId, text: 'Original queued idea', mode: 'plan', waitForCheckout: true, diagramAttachments: [] });
    expect(queued.status).toBe(200);
    try {
      await page.reload();
      await page.getByRole('button', { name: 'Edit message', exact: true }).click();
      const field = page.getByRole('textbox', { name: 'Queued message', exact: true });
      await field.fill('Revised queued idea');
      await page.route('**/api/agent/queued-message', route => route.fulfill({ status: 503, json: { error: 'Storage unavailable. Try saving again.' } }));
      await page.getByRole('button', { name: 'Save message', exact: true }).click();
      await expect(page.getByRole('complementary', { name: 'Conversation', exact: true }).getByRole('alert')).toContainText('Storage unavailable');
      await expect(field).toHaveValue('Revised queued idea');
      const dismiss = page.getByRole('button', { name: 'Dismiss notification', exact: true });
      if (await dismiss.count()) { await dismiss.first().click(); await expect(dismiss).toHaveCount(0); }
      await page.screenshot({ path: testInfo.outputPath('queued-edit.png'), animations: 'disabled' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.unroute('**/api/agent/queued-message');
      await page.getByRole('button', { name: 'Save message', exact: true }).click();
      await expect(field).toHaveCount(0);
      const saved = (await (await request.get(`/api/sessions/${next.id}`)).json()).session as PublicSession;
      expect(saved.messages.at(-1)).toMatchObject({ id: messageId, role: 'user', text: 'Revised queued idea', mode: 'plan', turn: { runId: queued.runId } });
      await page.reload();
      await page.getByRole('button', { name: 'Edit message', exact: true }).click();
      await expect(field).toHaveValue('Revised queued idea');
      await field.fill('Unsaved local revision');
      expect((await request.post('/api/agent/queued-message', { data: { runId: queued.runId, expectedText: 'Revised queued idea', text: 'Another device saved this' } })).ok()).toBe(true);
      await page.getByRole('button', { name: 'Save message', exact: true }).click();
      await expect(page.getByRole('complementary', { name: 'Conversation', exact: true }).getByRole('alert')).toContainText('another device');
      await expect(field).toHaveValue('Unsaved local revision');
      await page.getByRole('button', { name: 'Cancel edit', exact: true }).click();
      await expect(field).toHaveCount(0);
      await page.reload();
      await page.getByRole('button', { name: 'Edit message', exact: true }).click();
      await expect(field).toHaveValue('Another device saved this');
    } finally {
      await request.post('/api/agent/cancel', { data: { runId: queued.runId } });
    }
  });
}
