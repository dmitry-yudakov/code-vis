import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import type { CheckoutsResponse, PublicSession } from '../src/shared/types';

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

async function voiceMocks(page: Page, sessionId: string) {
  await page.addInitScript(sessionId => {
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
    const utterances = ['What needs me?', `Tell session ${sessionId} to continue`, 'Send it', 'Stop listening'];
    const original = window.fetch.bind(window);
    window.fetch = async (url, init) => {
      if (url === '/api/voice') {
        if (init?.method === 'POST' && track.enabled) throw new Error('Transcription reached an enabled microphone');
        return Response.json(init?.method === 'POST' ? { text: utterances.shift() ?? 'Stop listening' } : { configured: true, language: 'en' });
      }
      return original(url, init);
    };
  }, sessionId);
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
    await expect(dialog).toContainText('Use the existing library and continue.');
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
