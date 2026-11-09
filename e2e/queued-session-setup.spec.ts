import { expect, test, type APIRequestContext } from './arena-stream';
import type { CheckoutsResponse, DurableProject, PublicSession, RunDiscovery } from '../src/shared/types';

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
    await expect(page.getByRole('tooltip')).toHaveText('Starts after earlier sessions on this repository are archived. Keep CodeAI running.');
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
    await page.goto('/arena');
    const shortcut = page.getByRole('button', { name: `New session in ${project.name}`, exact: true });
    await shortcut.click();
    const dialog = page.getByRole('dialog', { name: 'New session', exact: true });
    const message = dialog.getByRole('textbox', { name: 'First message (optional)' });
    await message.fill('Queue this task');
    await dialog.getByRole('button', { name: 'Queue session', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(recovery === 'uncertain' ? 'Delivery status is unknown' : 'queue is full');
    expect(messages[0]).toMatchObject({ text: 'Queue this task', waitForCheckout: true });
    await expect(dialog.getByRole('button', { name: 'Queue session', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled();
    if (recovery === 'uncertain') await expect(message).toBeDisabled();
    await dialog.getByRole('button', { name: 'Close setup', exact: true }).click();
    await shortcut.click();
    await expect(message).toHaveValue('Queue this task');
    reconciliationUnavailable = false;
    if (recovery === 'edit-and-send') {
      // A definitive rejection permits a new instruction; Enter must use the normal start action.
      await message.fill('');
      await expect(dialog.getByRole('button', { name: 'Queue session', exact: true })).toBeDisabled();
      await expect(dialog.getByRole('button', { name: 'Create and open', exact: true })).toBeEnabled();
      await message.fill('Start the edited task now');
      await expect(dialog.getByText('Starts after earlier sessions on this repository are archived. Keep CodeAI running.', { exact: true })).toHaveCount(0);
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

test('a queued project task remains idle across reload and follow-ups, then runs after archive', async ({ page, request }) => {
  const catalog = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const checkout = catalog.checkouts.find(item => item.relativePath === 'alpha')!;
  await archiveEarlierFixtureSessions(request, checkout.id);
  const project = (await (await request.post('/api/projects', { data: { name: `Project queue ${Date.now()}`, checkoutIds: [checkout.id] } })).json()).project as DurableProject;
  const current = (await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json()).session as PublicSession;
  const activeRunIds: string[] = [];
  try {
    await page.goto('/arena');
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
    await page.getByRole('button', { name: `New session in ${project.name}`, exact: true }).click();
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
    await page.reload();
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
