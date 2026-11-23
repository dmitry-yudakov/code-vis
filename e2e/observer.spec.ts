import { test, expect, fulfillArenaSnapshot, type APIRequestContext, type Page } from './arena-stream';
import type { ArenaSnapshot, CheckoutsResponse, PublicSession } from '../src/shared/types';

async function fixture(request: APIRequestContext) {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const { project } = await (await request.post('/api/projects', { data: { name: `Observer ${Date.now()}`, checkoutIds: [checkouts.find(c => c.relativePath === 'alpha')!.id] } })).json();
  const { session } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json() as { session: PublicSession };
  return session;
}
async function open(page: Page) {
  await page.getByRole('button', { name: /^More$/, exact: true }).click();
  await page.getByRole('button', { name: 'Observer', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Observer', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function voiceMocks(page: Page, sessionId: string, commands?: string[]) {
  await page.addInitScript(({ sessionId, commands }) => {
    const track = Object.assign(new EventTarget(), { enabled: false, onended: null, stop() {} });
    const stats = { starts: 0, spoken: [] as string[] };
    (window as unknown as { observerVoiceStats: typeof stats }).observerVoiceStats = stats;
    class AudioNode {
      onprocessorerror = null;
      port = { onmessage: null as ((event: { data: unknown }) => void) | null, close() {},
        postMessage: () => queueMicrotask(() => this.port.onmessage?.({ data: 'stopped' })) };
      connect() { return this; }
      disconnect() {}
      play() { setTimeout(() => {
        for (let i = 0; i < 18; i++) {
          const data = new Float32Array(2048); if (i < 3) data.fill(0.15);
          this.port.onmessage?.({ data });
        }
      }, 10); }
    }
    class AudioInput {
      sampleRate = 16000; state = 'running'; destination = {}; onstatechange = null;
      audioWorklet = { async addModule() {} }; async resume() {} async close() {}
      createMediaStreamSource() { return { connect(node: AudioNode) { node.play(); return node; }, disconnect() {} }; }
    }
    class Utterance { voice = undefined; onend?: () => void; onerror = null; constructor(public text: string) {} }
    Object.defineProperty(window, 'AudioContext', { value: AudioInput });
    Object.defineProperty(window, 'AudioWorkletNode', { value: AudioNode });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => { stats.starts++; return { getTracks: () => [track] }; } });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: Utterance });
    Object.defineProperty(window, 'speechSynthesis', { value: {
      getVoices: () => [{ name: 'Test voice', lang: 'en', localService: true }], cancel() {},
      speak(utterance: Utterance) {
        if (track.enabled) throw new Error('Playback reached an enabled microphone');
        stats.spoken.push(utterance.text); setTimeout(() => utterance.onend?.(), 10);
      },
    } });
    const utterances = commands ?? ['What needs me?', `Tell session ${sessionId} to continue`, 'Send it', 'Stop listening'];
    const original = window.fetch.bind(window);
    window.fetch = async (url, init) => {
      if (url === '/api/voice') {
        if (init?.method === 'POST' && track.enabled) throw new Error('Transcription reached an enabled microphone');
        return Response.json(init?.method === 'POST' ? { text: utterances.shift() ?? 'Stop listening' } : { configured: true, language: 'en' });
      }
      return original(url, init);
    };
  }, { sessionId, commands });
}

for (const theme of ['light', 'dark']) for (const phone of [false, true]) {
  test(`observer briefing and canonical follow-up keep ordinary drafts: ${theme} ${phone ? 'phone' : 'desktop'}`, async ({ page, request }, testInfo) => {
    const session = await fixture(request);
    await page.setViewportSize({ width: phone ? 390 : 1280, height: phone ? 844 : 900 });
    await page.addInitScript(theme => localStorage.setItem('code-ai:theme', theme), theme);
    await page.goto(`/?session=${session.id}`);
    const composer = page.getByRole('complementary', { name: 'Conversation', exact: true }).getByRole('textbox', { name: 'Instruction', exact: true });
    await composer.fill('Keep my ordinary draft');
    const dialog = await open(page);
    await dialog.getByRole('button', { name: 'Briefing', exact: true }).click();
    await expect(dialog.getByLabel('Observer conversation')).toContainText('active sessions.');
    await dialog.getByRole('textbox', { name: 'Ask Observer', exact: true }).fill(`Tell session ${session.id} to use the existing library and continue`);
    await dialog.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Send follow-up', exact: true })).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Message to session' })).toHaveValue('Use the existing library and continue.');
    await dialog.screenshot({ path: testInfo.outputPath(`observer-${theme}-${phone ? 'phone' : 'desktop'}.png`) });
    await dialog.getByRole('button', { name: 'Send follow-up', exact: true }).click();
    await expect(dialog.getByLabel('Observer conversation')).toContainText('Sent.');
    const saved = (await (await request.get(`/api/sessions/${session.id}`)).json()).session as PublicSession;
    expect(saved.messages.filter(m => m.role === 'user' && m.text === 'Use the existing library and continue.')).toHaveLength(1);
    await dialog.getByRole('textbox', { name: 'Ask Observer' }).fill(`What did session ${session.id} finish?`);
    await dialog.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(dialog.getByLabel('Observer conversation')).toContainText('Recent saved text includes the existing library follow-up.');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(composer).toHaveValue('Keep my ordinary draft');
    await open(page);
    await expect(dialog.getByLabel('Observer conversation')).toContainText('Sent.');
  });
}

test('observer errors preserve text and reload keeps a frozen exact-delivery preview', async ({ page, request }) => {
  const session = await fixture(request);
  await page.goto('/arena'); const dialog = await open(page);
  const input = dialog.getByRole('textbox', { name: 'Ask Observer' });
  await input.fill('[observer-invalid]'); await dialog.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('invalid answer'); await expect(input).toHaveValue('[observer-invalid]');
  await input.fill(`Tell session ${session.id} to continue`); await dialog.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Send follow-up' })).toBeVisible();
  let messageId: string | undefined;
  await page.route('**/api/agent/message', route => { messageId = route.request().postDataJSON().messageId; return route.abort(); });
  await page.route(`**/api/sessions/${session.id}`, route => {
    if (messageId) return route.fulfill({ status: 503, json: { error: 'Disconnected' } });
    return route.continue();
  });
  await dialog.getByRole('button', { name: 'Send follow-up' }).click();
  await expect(dialog.getByRole('button', { name: 'Check delivery' })).toBeVisible();
  await page.reload(); await open(page);
  await expect(dialog).toContainText('Use the existing library and continue.');
  await expect(dialog.getByRole('button', { name: 'Check delivery' })).toBeVisible();
  await page.unroute(`**/api/sessions/${session.id}`);
  await dialog.getByRole('button', { name: 'Check delivery' }).click();
  await expect(dialog.getByRole('button', { name: 'Check delivery' })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Cancel message' })).toHaveCount(0);
  await expect(input).toBeEditable();
  await dialog.getByRole('button', { name: 'Briefing', exact: true }).click();
  await expect(dialog.getByLabel('Observer conversation')).toContainText('active sessions.');
  await expect(dialog.getByRole('button', { name: 'Check delivery' })).toBeVisible();
  await page.unroute('**/api/agent/message');
  await dialog.getByRole('button', { name: 'Retry send', exact: true }).click();
  await expect(dialog.getByLabel('Observer conversation')).toContainText('Sent.');
  expect(messageId).toBeTruthy();
});

test('Observer shows both provider logos and switches provider by keyboard', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('code-ai:device:v1:preferences', JSON.stringify({ version: 1, provider: 'claude' })));
  await page.goto('/arena');
  const dialog = await open(page);
  const provider = dialog.getByRole('combobox', { name: /^Provider/ });
  await expect(provider.locator('[data-provider-logo="claude"]')).toBeVisible();
  await provider.press('ArrowDown');
  const list = page.getByRole('listbox');
  await expect(list.getByRole('option', { name: 'Claude', exact: true }).locator('[data-provider-logo="claude"]')).toBeVisible();
  const codex = list.getByRole('option', { name: 'Codex', exact: true });
  await expect(codex.locator('[data-provider-logo="codex"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('observer-provider-menu.png'), animations: 'disabled' });
  await page.keyboard.press('ArrowDown');
  await expect(codex).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(provider.locator('[data-provider-logo="codex"]')).toBeVisible();
  await expect(dialog).toContainText('Session excerpts are shared with Codex');
});

test('Observer revises an unsent message conversationally and preserves direct edits on failure', async ({ page, request }) => {
  const session = await fixture(request);
  await page.goto('/arena'); const dialog = await open(page);
  const input = dialog.getByRole('textbox', { name: 'Ask Observer' });
  await input.fill(`Tell session ${session.id} to continue`); await input.press('Enter');
  const message = dialog.getByRole('textbox', { name: 'Message to session' });
  await expect(message).toHaveValue('Use the existing library and continue.');
  await input.fill('Change that message to run focused tests first'); await input.press('Enter');
  await expect(message).toHaveValue('Run focused tests before continuing.');
  await message.fill('Run the Observer tests, then continue.');
  await input.fill('[observer-invalid]'); await input.press('Enter');
  await expect(dialog.getByRole('alert').last()).toContainText('invalid answer');
  await expect(message).toHaveValue('Run the Observer tests, then continue.');
  await dialog.getByRole('button', { name: 'Send follow-up', exact: true }).click();
  await expect(dialog.getByLabel('Observer conversation')).toContainText('Sent.');
  const saved = (await (await request.get(`/api/sessions/${session.id}`)).json()).session as PublicSession;
  expect(saved.messages.filter(m => m.role === 'user' && m.text === 'Run the Observer tests, then continue.')).toHaveLength(1);
});

for (const decision of ['approve', 'deny'] as const) test(`Observer ${decision === 'approve' ? 'approves' : 'denies'} a real pending request through its exact preview`, async ({ page, request }, testInfo) => {
  const session = await fixture(request);
  await page.setViewportSize({ width: decision === 'approve' ? 1280 : 390, height: 900 });
  await page.addInitScript(theme => localStorage.setItem('code-ai:theme', theme), decision === 'approve' ? 'light' : 'dark');
  if (decision === 'approve') await voiceMocks(page, session.id, ['Approve it', 'Stop listening']);
  const turn = request.post('/api/agent/message', { data: { sessionId: session.id, participantId: session.primaryAgentId,
    messageId: crypto.randomUUID(), mode: 'agent', text: 'Please edit the readme.', diagramAttachments: [] } });
  let runs: { active: Array<{ runId: string; pendingPermissionCount: number }> } = { active: [] };
  try {
    await expect.poll(async () => {
      runs = await (await request.get(`/api/agent/runs?sessionId=${session.id}`)).json();
      return runs.active.some(run => run.pendingPermissionCount > 0);
    }).toBe(true);
    await page.goto('/arena'); const dialog = await open(page);
    await dialog.getByRole('textbox', { name: 'Ask Observer' }).fill(`${decision} session ${session.id}`);
    await dialog.getByRole('button', { name: 'Ask', exact: true }).click();
    const confirm = dialog.getByRole('button', { name: decision === 'approve' ? 'Approve request' : 'Deny request', exact: true });
    await expect(confirm).toBeVisible();
    await expect(dialog.locator('pre')).toContainText('README.md');
    await dialog.screenshot({ path: testInfo.outputPath(`observer-${decision}.png`), animations: 'disabled' });
    if (decision === 'approve') await dialog.getByRole('button', { name: 'Voice', exact: true }).click();
    else await confirm.click();
    await expect(dialog.getByLabel('Observer conversation')).toContainText(decision === 'approve' ? 'Request approved.' : 'Request denied.');
    expect((await turn).ok()).toBe(true);
  } finally {
    for (const run of runs.active) await request.post('/api/agent/cancel', { data: { runId: run.runId } });
    await turn;
  }
});

test('Observer opens the existing restart confirmation and cancellation submits no build', async ({ page, request }) => {
  await fixture(request);
  let posts = 0;
  await page.route('**/api/codeai-lifecycle**', route => {
    if (route.request().method() === 'POST') posts++;
    return route.fulfill({ json: { available: true, phase: 'idle', releaseId: 'release-a' } });
  });
  await page.goto('/arena'); const dialog = await open(page);
  await dialog.getByRole('textbox', { name: 'Ask Observer' }).fill('Build and restart CodeAI');
  await dialog.getByRole('button', { name: 'Ask', exact: true }).click();
  const restart = page.getByRole('dialog', { name: 'Build and restart CodeAI?' });
  await expect(restart).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(restart).toContainText('uncommitted changes included');
  await restart.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(posts).toBe(0);
  await open(page);
  await dialog.getByRole('button', { name: 'Build & restart CodeAI', exact: true }).click();
  await expect(restart).toBeVisible();
  expect(posts).toBe(0);
});

test('Observer refuses a stale approval and cancellation keeps the original run identity', async ({ page, request }) => {
  const session = await fixture(request);
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const machine = snapshot.machines.find(m => m.machine.kind === 'local')!;
  machine.sessions = machine.sessions.filter(s => s.id === session.id);
  const runId = crypto.randomUUID(), requestId = crypto.randomUUID();
  const run = { runId, sessionId: session.id, participantId: session.primaryAgentId, state: 'needs-you' as const,
    enqueuedAt: Date.now(), pendingPermissionCount: 1,
    pendingPermissions: [{ requestId, participantId: session.primaryAgentId, tool: 'Bash', detail: 'npm test' }] };
  machine.runs.active = [run];
  await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
  await page.route('**/api/agent/runs?**', route => route.fulfill({ json: machine.runs }));
  let action: object = { kind: 'permission', machineId: machine.machine.id, sessionId: session.id, runId, requestId, decision: 'allow' };
  await page.route('**/api/observer', route => route.fulfill({ json: { answer: 'Review this action.', action,
    mentions: [], total: 1, included: 1, observedAt: new Date().toISOString() } }));
  const decisions: unknown[] = [], cancellations: unknown[] = [];
  await page.route('**/api/agent/permission', route => { decisions.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); });
  await page.route('**/api/agent/cancel', route => { cancellations.push(route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); });
  await page.goto('/arena'); const dialog = await open(page);
  const input = dialog.getByRole('textbox', { name: 'Ask Observer' });
  await input.fill('Approve this session'); await input.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Approve request', exact: true })).toBeVisible();
  await input.fill('Send it'); await input.press('Enter');
  await expect(dialog.getByRole('alert').last()).toContainText('There is no message ready to send.');
  await input.fill('Deny it'); await input.press('Enter');
  await expect(dialog.getByRole('alert').last()).toContainText('does not match the current preview');
  expect(decisions).toHaveLength(0);
  run.pendingPermissions[0].requestId = crypto.randomUUID();
  await dialog.getByRole('button', { name: 'Approve request', exact: true }).click();
  await expect(dialog.getByRole('alert').last()).toContainText('changed or was resolved');
  expect(decisions).toHaveLength(0);
  action = { kind: 'cancel-turn', machineId: machine.machine.id, sessionId: session.id, runId };
  await input.fill('Cancel this turn instead'); await input.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Cancel turn', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel turn', exact: true }).click();
  await expect(dialog.getByLabel('Observer conversation')).toContainText('Turn cancellation requested.');
  expect(cancellations).toEqual([{ runId }]);
});

for (const theme of ['light', 'dark']) for (const phone of [false, true]) test(`Observer queued correction retains compare-and-save recovery: ${theme} ${phone ? 'phone' : 'desktop'}`, async ({ page, request }, testInfo) => {
  const session = await fixture(request);
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const machine = snapshot.machines.find(m => m.machine.kind === 'local')!;
  machine.sessions = machine.sessions.filter(s => s.id === session.id);
  const runId = crypto.randomUUID(), messageId = crypto.randomUUID();
  machine.runs.active = [{ runId, sessionId: session.id, participantId: session.primaryAgentId, state: 'queued',
    enqueuedAt: Date.now(), pendingPermissionCount: 0, pendingPermissions: [] }];
  session.messages.push({ id: messageId, role: 'user', text: 'Original queued instruction', turn: { runId, lifecycle: 'queued' } } as never);
  await page.setViewportSize({ width: phone ? 390 : 1280, height: phone ? 844 : 900 });
  await page.addInitScript(theme => localStorage.setItem('code-ai:theme', theme), theme);
  await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
  await page.route('**/api/agent/runs?**', route => route.fulfill({ json: machine.runs }));
  await page.route(`**/api/sessions/${session.id}`, route => route.fulfill({ json: { session } }));
  await page.route('**/api/observer', route => route.fulfill({ json: { answer: 'Review this correction.',
    action: { kind: 'edit-queued', machineId: machine.machine.id, sessionId: session.id, runId, text: 'Corrected queued instruction' },
    mentions: [], total: 1, included: 1, observedAt: new Date().toISOString() } }));
  const edits: unknown[] = [];
  await page.route('**/api/agent/queued-message', route => {
    edits.push(route.request().postDataJSON());
    const message = session.messages.find(m => m.id === messageId)!;
    if (message.role === 'user') message.text = 'Corrected queued instruction';
    machine.runs.active = []; // The edit was saved and its turn finished before response recovery.
    return route.abort();
  });
  await page.goto('/arena'); const dialog = await open(page);
  const input = dialog.getByRole('textbox', { name: 'Ask Observer' });
  await input.fill('Correct the queued message'); await input.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Save correction', exact: true })).toBeVisible();
  await dialog.getByText('Original message', { exact: true }).click();
  await expect(dialog).toContainText('Original queued instruction');
  await dialog.screenshot({ path: testInfo.outputPath(`observer-correction-${theme}-${phone ? 'phone' : 'desktop'}.png`), animations: 'disabled' });
  await dialog.getByRole('button', { name: 'Save correction', exact: true }).click();
  await expect(dialog.getByRole('alert').last()).toContainText('outcome is unknown');
  await dialog.getByRole('button', { name: 'Save correction', exact: true }).click();
  await expect(dialog.getByLabel('Observer conversation')).toContainText('Correction saved.');
  expect(edits).toEqual([{ runId, text: 'Corrected queued instruction', expectedText: 'Original queued instruction' }]);
});

test('observer microphone failure leaves text usable and closing abandons late inference', async ({ page, request }) => {
  await fixture(request);
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: () => Promise.reject(new DOMException('Microphone denied', 'NotAllowedError')) });
  });
  await page.goto('/arena'); const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Voice', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText(/Microphone|Spoken replies|speech voice/i);
  await expect(dialog.getByRole('textbox', { name: 'Ask Observer' })).toBeEditable();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/observer', async route => {
    await gate;
    await route.fulfill({ json: { answer: 'Late answer', mentions: [], total: 1, included: 1, observedAt: new Date().toISOString() } }).catch(() => {});
  });
  await dialog.getByRole('button', { name: 'Briefing', exact: true }).click();
  await expect(dialog).toContainText('Working…');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click(); release();
  await open(page);
  await expect(dialog.getByLabel('Observer conversation')).not.toContainText('Late answer');
});

test('one Voice gesture supports briefing, preview, confirmation and another listening turn', async ({ page, request }) => {
  const session = await fixture(request); await voiceMocks(page, session.id);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/arena'); const dialog = await open(page);
  await dialog.getByRole('button', { name: 'Voice', exact: true }).click();
  await expect(dialog.getByLabel('Observer conversation')).toContainText('Sent.');
  await expect(dialog.getByRole('button', { name: 'Voice', exact: true })).toBeEnabled();
  const stats = await page.evaluate(() => (window as unknown as { observerVoiceStats: { starts: number; spoken: string[] } }).observerVoiceStats);
  expect(stats.starts).toBe(1); expect(stats.spoken).toHaveLength(3);
  const saved = (await (await request.get(`/api/sessions/${session.id}`)).json()).session as PublicSession;
  expect(saved.messages.filter(m => m.role === 'user' && m.text === 'Use the existing library and continue.')).toHaveLength(1);
});

test('native navigation during voice inference resets audio controls and cannot speak the late answer', async ({ page, request }) => {
  const session = await fixture(request); await voiceMocks(page, session.id);
  await page.goto(`/?session=${session.id}`); const dialog = await open(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/observer', async route => {
    await gate;
    await route.fulfill({ json: { answer: 'Late answer', mentions: [], total: 1, included: 1, observedAt: new Date().toISOString() } }).catch(() => {});
  });
  await dialog.getByRole('button', { name: 'Voice', exact: true }).click();
  await expect(dialog.getByRole('status').first()).toContainText('Thinking');
  await page.evaluate(() => history.pushState(null, '', '/?project=none'));
  await expect(dialog.getByRole('button', { name: 'Stop voice', exact: true })).toHaveCount(0);
  release();
  await expect(dialog.getByRole('textbox', { name: 'Ask Observer' })).toBeEditable();
  expect(await page.evaluate(() => (window as unknown as { observerVoiceStats: { spoken: string[] } }).observerVoiceStats.spoken)).toHaveLength(0);
});
