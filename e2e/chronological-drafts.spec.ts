import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { AgentEvent, AssistantMessage, CheckoutsResponse, DurableProject, PublicSession, UserMessage } from '../src/shared/types';

interface DraftFixture {
  requests: Array<{ messageId: string; participantId: string; text: string; mode: UserMessage['mode']; fileAttachments?: Array<{ name: string; text: string }>; imageAttachments?: unknown[] }>;
  accept(): void;
  finish(failed?: boolean): void;
  activity(text: string): void;
  disconnect(): void;
  readable: boolean;
  discoveryReadable: boolean;
  allowRetry: boolean;
  session: PublicSession;
  otherSessionId?: string;
}
declare global { interface Window { draftFixture: DraftFixture } }

async function openDraftFixture(page: Page, request: APIRequestContext, reply: 'stream' | 'accepted-error' | 'uncertain' | 'gateway-error' | 'rejected' | 'conflict' = 'stream', withHistory = false) {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const checkout = checkouts.find((item) => item.relativePath === 'alpha')!;
  const project = (await (await request.post('/api/projects', { data: { name: `Chronological drafts ${Date.now()}`, checkoutIds: [checkout.id] } })).json()).project as DurableProject;
  const session = (await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json()).session as PublicSession;
  const otherSessionId = withHistory ? ((await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json()).session as PublicSession).id : undefined;
  if (withHistory) for (let index = 0; index < 50; index++) {
    const text = `Historical answer ${index + 1}. This earlier conversation remains readable while another turn is working.`;
    session.messages.push({ id: crypto.randomUUID(), role: 'assistant', authorId: session.primaryAgentId,
      createdAt: new Date().toISOString(), status: 'complete', rawMarkdown: text, blocks: [{ kind: 'markdown', markdown: text }] });
  }
  await page.addInitScript(({ session, reply, otherSessionId }) => {
    const original = window.fetch.bind(window);
    const runId = crypto.randomUUID();
    const encoder = new TextEncoder();
    let release: (() => void) | undefined;
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
    let accepted = false;
    let finished = false;
    const emit = (event: AgentEvent) => stream?.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
    const fixture: DraftFixture = {
      requests: [], session, otherSessionId, readable: true, discoveryReadable: true, allowRetry: false,
      disconnect() { stream?.error(new TypeError('Fixture stream disconnected')); },
      activity(text) {
        const user = fixture.session.messages.find((message) => message.id === fixture.requests.at(-1)?.messageId) as UserMessage | undefined;
        if (!user?.turn) throw new Error('The fixture turn has not been accepted.');
        const sequence = user.turn.sequence + 1;
        user.turn = { ...user.turn, sequence, lifecycle: 'running', entries: [...user.turn.entries, {
          id: crypto.randomUUID(), kind: 'assistant', firstSequence: sequence, sequence, attempt: 1, complete: true, text,
        }] };
        emit({ type: 'turn-activity', runId, turn: user.turn });
      },
      accept() {
        const sent = fixture.requests.at(-1)!;
        if ((!['uncertain', 'gateway-error', 'conflict'].includes(reply) || fixture.allowRetry) && reply !== 'rejected') {
          accepted = true;
          fixture.session.messages.push({ id: sent.messageId, role: 'user', authorId: session.participants.find((item) => item.kind === 'human')!.id,
            addressedParticipantId: sent.participantId, text: sent.text, createdAt: new Date().toISOString(), status: 'sending', mode: sent.mode, diagramAttachments: [],
            fileAttachments: sent.fileAttachments?.map((file) => ({ ...file, bytes: encoder.encode(file.text).length, digest: '0'.repeat(64) })),
            imageAttachments: sent.imageAttachments?.map(() => ({ mediaType: 'image/png', bytes: 100 })),
            turn: { version: 1, runId, userMessageId: sent.messageId, participantId: sent.participantId, acceptedAt: new Date().toISOString(),
              lifecycle: 'queued', sequence: 0, entries: [], incomplete: false, history: 'saved' },
          });
        }
        if (reply === 'uncertain' && !fixture.allowRetry) fixture.readable = false;
        release?.();
      },
      finish(failed = false) {
        const sent = fixture.requests.at(-1)!;
        finished = true;
        const user = fixture.session.messages.find((message) => message.id === sent.messageId) as UserMessage;
        if (user) {
          user.status = failed ? 'failed' : 'sent';
          if (user.turn) user.turn = { ...user.turn, lifecycle: failed ? 'failed' : 'completed', sequence: 1 };
        }
        if (failed) emit({ type: 'error', runId, code: 'internal', message: 'Fixture turn failed after acceptance.', retryable: true, delivery: 'possibly-sent' });
        else {
          const answer: AssistantMessage = { id: crypto.randomUUID(), role: 'assistant', authorId: sent.participantId, createdAt: new Date().toISOString(),
            status: 'complete', rawMarkdown: 'Finished fixture turn.', blocks: [{ kind: 'markdown', markdown: 'Finished fixture turn.' }] };
          fixture.session.messages.push(answer);
          emit({ type: 'assistant-message', runId, message: answer });
        }
        emit({ type: 'done', runId, durationMs: 1, cancelled: false });
        stream?.close();
      },
    };
    window.draftFixture = fixture;
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.pathname === '/api/agent/message' && init?.method === 'POST') {
        fixture.requests.push(JSON.parse(String(init.body)));
        await new Promise<void>((resolve) => { release = resolve; });
        if (reply === 'uncertain' && !fixture.allowRetry) throw new TypeError('Fixture connection lost');
        if (reply === 'gateway-error' && !fixture.allowRetry) return Response.json({ error: 'The execution machine is unreachable.' }, { status: 502 });
        if (reply === 'conflict' && !fixture.allowRetry) return Response.json({
          error: 'This session already has an agent turn queued or running.',
          activeRun: { runId, sessionId: session.id, participantId: session.primaryAgentId, state: 'running',
            enqueuedAt: Date.now(), pendingPermissionCount: 0, pendingPermissions: [] },
        }, { status: 409 });
        if (reply === 'accepted-error' || reply === 'rejected') return Response.json({ error: 'Fixture request failed.' }, { status: reply === 'rejected' ? 400 : 500 });
        return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }), {
          headers: { 'Content-Type': 'application/x-ndjson', 'X-CodeAI-Run-Id': runId },
        });
      }
      if (url.pathname === `/api/sessions/${session.id}` && (!init?.method || init.method === 'GET')) {
        if (!fixture.readable) throw new TypeError('Fixture reconciliation unavailable');
        return Response.json({ session: fixture.session });
      }
      if (otherSessionId && url.pathname === '/api/sessions' && (!init?.method || init.method === 'GET')) {
        const response = await original(input, init);
        const data = await response.json();
        if (Array.isArray(data.sessions)) data.sessions = data.sessions.map((item: PublicSession) => item.id === session.id ? fixture.session : item);
        return Response.json(data, { status: response.status });
      }
      if (url.pathname === '/api/agent/runs' && !fixture.discoveryReadable) throw new TypeError('Fixture discovery unavailable');
      if (url.pathname === '/api/agent/cancel' && reply === 'conflict') {
        fixture.allowRetry = true;
        return Response.json({ ok: true });
      }
      if (url.pathname === '/api/agent/runs') return Response.json({ active: accepted && !finished ? [{
        runId, sessionId: session.id, participantId: session.primaryAgentId, state: 'queued', enqueuedAt: Date.now(),
        pendingPermissionCount: 0, pendingPermissions: [], queuePosition: 1,
      }] : [], recent: [] });
      if (url.pathname === '/api/agent/stream') return new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }), {
        headers: { 'Content-Type': 'application/x-ndjson', 'X-CodeAI-Run-Id': runId },
      });
      return original(input, init);
    };
  }, { session, reply, otherSessionId });
  await page.goto('/');
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(project.name) }).click();
  if (otherSessionId) await page.getByRole('combobox', { name: 'All sessions', exact: true }).selectOption(session.id);
  await expect(page.getByRole('combobox', { name: 'All sessions', exact: true })).toHaveValue(session.id);
  return page.getByRole('textbox', { name: 'Instruction', exact: true });
}

async function image(page: Page, color = '#e03030') {
  await page.evaluate(async (color) => {
    const canvas = document.createElement('canvas'); canvas.width = 10; canvas.height = 10;
    const context = canvas.getContext('2d')!; context.fillStyle = color; context.fillRect(0, 0, 10, 10);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), 'image/png'));
    const dataTransfer = new DataTransfer(); dataTransfer.items.add(new File([blob], 'draft.png', { type: 'image/png' }));
    document.querySelector('.instruction-composer')!.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }));
  }, color);
}

async function textFile(page: Page, name: string, text: string) {
  await page.evaluate(({ name, text }) => {
    const dataTransfer = new DataTransfer(); dataTransfer.items.add(new File([text], name, { type: 'text/plain' }));
    document.querySelector('.instruction-composer')!.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }));
  }, { name, text });
}

test('acceptance headers clear the submitted draft before any event, while Enter only drafts during the turn', async ({ page, request }) => {
  const field = await openDraftFixture(page, request);
  await field.fill('First instruction');
  await image(page);
  await expect(page.locator('.attachment-chip.image')).toHaveCount(1);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.draftFixture.requests.length)).toBe(1);
  await page.evaluate(() => window.draftFixture.accept());
  await expect(field).toHaveValue('');
  await expect(page.locator('.attachment-chip.image')).toHaveCount(0);
  await expect(field).toBeEditable();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  await expect(page.locator('.chat-message.user').getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await field.fill('Next draft');
  await field.press('Enter');
  expect(await page.evaluate(() => window.draftFixture.requests.length)).toBe(1);
  await page.evaluate(() => window.draftFixture.finish());
  await expect(page.locator('.chat-message.assistant')).toContainText('Finished fixture turn.');
  await expect(field).toHaveValue('Next draft');
});

test('delayed acceptance preserves an equal newer text generation and newly attached evidence', async ({ page, request }) => {
  const field = await openDraftFixture(page, request);
  await field.fill('Same instruction'); await image(page);
  await textFile(page, 'original.txt', 'Original evidence');
  await expect(page.locator('.attachment-chip.image')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Remove file original.txt' })).toBeVisible();
  const originalImage = await page.locator('.attachment-chip.image img').getAttribute('src');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.draftFixture.requests.length)).toBe(1);
  await field.fill(''); await field.fill('Same instruction');
  await image(page, '#3050e0'); await textFile(page, 'next.txt', 'Next draft evidence');
  await expect(page.locator('.attachment-chip.image')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Remove file next.txt' })).toBeVisible();
  const nextImage = await page.locator('.attachment-chip.image img').last().getAttribute('src');
  await page.evaluate(() => window.draftFixture.accept());
  await expect(field).toHaveValue('Same instruction');
  await expect(page.locator('.attachment-chip.image')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Remove file original.txt' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove file next.txt' })).toBeVisible();
  expect(await page.evaluate(() => window.draftFixture.requests[0].imageAttachments)).toEqual([{ dataUrl: originalImage }]);
  expect(await page.evaluate(() => window.draftFixture.requests[0].fileAttachments)).toEqual([{ name: 'original.txt', text: 'Original evidence' }]);
  await page.evaluate(() => window.draftFixture.finish());
  await expect(field).toHaveValue('Same instruction');
  await expect(page.locator('.attachment-chip.image')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.draftFixture.requests.length)).toBe(2);
  expect(await page.evaluate(() => window.draftFixture.requests[1].imageAttachments)).toEqual([{ dataUrl: nextImage }]);
  expect(await page.evaluate(() => window.draftFixture.requests[1].fileAttachments)).toEqual([{ name: 'next.txt', text: 'Next draft evidence' }]);
});

test('durable acceptance wins over an HTTP failure', async ({ page, request }) => {
  const field = await openDraftFixture(page, request, 'accepted-error');
  await field.fill('Accepted despite HTTP failure');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.draftFixture.requests.length)).toBe(1);
  await page.evaluate(() => window.draftFixture.accept());
  await expect(field).toHaveValue('');
  await expect(page.locator('.chat-message.user')).toHaveCount(1);
  expect(await page.evaluate(() => window.draftFixture.requests.length)).toBe(1);
});

test('a definite rejection preserves the draft and its submitted evidence', async ({ page, request }) => {
  const field = await openDraftFixture(page, request, 'rejected');
  await field.fill('Rejected instruction'); await image(page);
  await expect(page.locator('.attachment-chip.image')).toHaveCount(1);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.draftFixture.requests.length)).toBe(1);
  await page.evaluate(() => window.draftFixture.accept());
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await expect(field).toHaveValue('Rejected instruction');
  await expect(page.locator('.attachment-chip.image')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Check delivery', exact: true })).toHaveCount(0);
});

test('a scheduler rejection preserves evidence and permits a changed draft after cancelling its blocker', async ({ page, request }) => {
  const field = await openDraftFixture(page, request, 'conflict');
  await field.fill('Rejected instruction');
  await textFile(page, 'evidence.txt', 'Preserve this evidence');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.draftFixture.requests.length)).toBe(1);
  await page.evaluate(() => window.draftFixture.accept());
  const cancelBlocker = page.getByRole('button', { name: /^Cancel / });
  await expect(cancelBlocker).toBeVisible();
  await expect(field).toHaveValue('Rejected instruction');
  await expect(page.getByRole('button', { name: 'Remove file evidence.txt' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check delivery', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.draftFixture.session.messages)).toEqual([]);
  await cancelBlocker.click();
  await expect(cancelBlocker).toHaveCount(0);
  await field.fill('Changed instruction');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await field.press('Enter');
  await expect.poll(() => page.evaluate(() => window.draftFixture.requests.length)).toBe(2);
  const sent = await page.evaluate(() => window.draftFixture.requests);
  expect(sent[1]).toMatchObject({ text: 'Changed instruction', fileAttachments: [{ name: 'evidence.txt', text: 'Preserve this evidence' }] });
  expect(sent[1].messageId).not.toBe(sent[0].messageId);
  await page.evaluate(() => window.draftFixture.accept());
  await expect(field).toHaveValue('');
  await page.evaluate(() => window.draftFixture.finish());
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
});

test('a gateway failure with an absent snapshot keeps delivery uncertain', async ({ page, request }) => {
  const field = await openDraftFixture(page, request, 'gateway-error');
  await field.fill('Gateway-delayed instruction');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.draftFixture.requests.length)).toBe(1);
  await page.evaluate(() => window.draftFixture.accept());
  await expect(page.getByRole('button', { name: 'Check delivery', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await expect(field).toHaveValue('Gateway-delayed instruction');
});

test('ambiguous absence only permits Retry delivery of the original immutable body and message id', async ({ page, request }) => {
  const field = await openDraftFixture(page, request, 'uncertain');
  await field.fill('Keep uncertain instruction'); await image(page);
  await expect(page.locator('.attachment-chip.image')).toHaveCount(1);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.draftFixture.requests.length)).toBe(1);
  await page.evaluate(() => window.draftFixture.accept());
  await expect(page.getByRole('button', { name: 'Check delivery', exact: true })).toBeVisible();
  await expect(field).toHaveValue('Keep uncertain instruction');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await field.press('Enter');
  expect(await page.evaluate(() => window.draftFixture.requests.length)).toBe(1);
  await page.evaluate(() => { window.draftFixture.readable = true; });
  await page.getByRole('button', { name: 'Check delivery', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Retry delivery', exact: true })).toBeVisible();
  await field.fill('Newer draft'); await image(page);
  await expect(page.locator('.attachment-chip.image')).toHaveCount(2);
  await page.evaluate(() => { window.draftFixture.allowRetry = true; });
  await page.getByRole('button', { name: 'Retry delivery', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.draftFixture.requests.length)).toBe(2);
  expect(await page.evaluate(() => window.draftFixture.requests[1])).toEqual(await page.evaluate(() => window.draftFixture.requests[0]));
  await page.evaluate(() => window.draftFixture.accept());
  await expect(field).toHaveValue('Newer draft');
  await expect(page.locator('.attachment-chip.image')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Retry delivery', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
});

test('Retry explicitly replaces newer evidence and warns that the original images need reattaching', async ({ page, request }) => {
  const field = await openDraftFixture(page, request);
  await field.fill('Failed original instruction'); await image(page);
  await expect(page.locator('.attachment-chip.image')).toHaveCount(1);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.draftFixture.requests.length)).toBe(1);
  await page.evaluate(() => window.draftFixture.accept());
  await expect(field).toHaveValue('');
  await field.fill('Newer draft'); await image(page);
  await expect(page.locator('.attachment-chip.image')).toHaveCount(1);
  await page.evaluate(() => window.draftFixture.finish(true));
  await page.locator('.chat-message.user').getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(field).toHaveValue('Newer draft');
  await expect(page.locator('.attachment-chip.image')).toHaveCount(1);
  await page.getByRole('button', { name: 'Replace draft', exact: true }).click();
  await expect(field).toHaveValue('Failed original instruction');
  await expect(page.locator('.attachment-chip.image')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Notifications' })).toContainText('original image is not stored');
});

test('an empty session initializes the docked full-width conversation while the overlay band keeps the canvas visible', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDraftFixture(page, request);
  await expect(page.locator('.app-shell')).toHaveClass(/canvas-hidden/);
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.locator('.app-shell')).not.toHaveClass(/canvas-hidden/);
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(page.locator('.app-shell')).toHaveClass(/canvas-hidden/);
});

test('an accepted disconnected turn keeps Stop and blocks another send until its execution is reconciled', async ({ page, request }) => {
  const field = await openDraftFixture(page, request);
  await field.fill('Accepted then disconnected');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.draftFixture.requests.length)).toBe(1);
  await page.evaluate(() => window.draftFixture.accept());
  await expect(field).toHaveValue('');
  await field.fill('Next draft stays');
  await page.evaluate(() => { window.draftFixture.discoveryReadable = false; window.draftFixture.disconnect(); });
  await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  await field.press('Enter');
  expect(await page.evaluate(() => window.draftFixture.requests.length)).toBe(1);
  await page.evaluate(() => { window.draftFixture.discoveryReadable = true; });
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.draftFixture.finish());
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await expect(field).toHaveValue('Next draft stays');
});

test('Shift+Enter and IME confirmation preserve drafting; plain Enter sends once and stays blocked while busy', async ({ page, request }) => {
  const field = await openDraftFixture(page, request);
  await field.fill('First line');
  await field.press('Shift+Enter');
  await field.pressSequentially('Second line');
  await expect(field).toHaveValue('First line\nSecond line');
  await field.dispatchEvent('compositionstart', { data: '' });
  await field.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
  await field.dispatchEvent('compositionend', { data: 'confirmed' });
  expect(await page.evaluate(() => window.draftFixture.requests.length)).toBe(0);
  await expect(field).toHaveValue('First line\nSecond line');
  await field.press('Enter');
  await expect.poll(() => page.evaluate(() => window.draftFixture.requests.length)).toBe(1);
  expect(await page.evaluate(() => window.draftFixture.requests[0].text)).toBe('First line\nSecond line');
  await field.fill('Next draft');
  await field.press('Enter');
  expect(await page.evaluate(() => window.draftFixture.requests.length)).toBe(1);
  await page.evaluate(() => window.draftFixture.accept());
  await expect(field).toHaveValue('Next draft');
  await field.press('Shift+Enter');
  await field.pressSequentially('Still drafting');
  await field.press('Enter');
  expect(await page.evaluate(() => window.draftFixture.requests.length)).toBe(1);
  await expect(field).toHaveValue('Next draft\nStill drafting');
});

test('scroll anchors survive switching sessions, background activity and reconnect until Jump to latest', async ({ page, request }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  const field = await openDraftFixture(page, request, 'stream', true);
  const ids = await page.evaluate(() => ({ current: window.draftFixture.session.id, other: window.draftFixture.otherSessionId! }));
  const scroll = page.locator('.conversation-scroll');
  await expect(page.locator('.chat-message.assistant')).toHaveCount(50);
  await field.fill('Keep my reading position');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.draftFixture.requests.length)).toBe(1);
  await page.evaluate(() => window.draftFixture.accept());
  await expect(field).toHaveValue('');
  await scroll.evaluate(element => { element.scrollTop = 420; element.dispatchEvent(new Event('scroll')); });
  const anchor = await scroll.evaluate(element => element.scrollTop);
  expect(anchor).toBeGreaterThan(0);
  await page.getByRole('combobox', { name: 'All sessions', exact: true }).selectOption(ids.other);
  await expect(page.getByRole('combobox', { name: 'All sessions', exact: true })).toHaveValue(ids.other);
  await page.evaluate(() => window.draftFixture.activity('Activity received while reading another session.'));
  await page.getByRole('combobox', { name: 'All sessions', exact: true }).selectOption(ids.current);
  await expect(page.locator('.turn-activity')).toContainText('Activity received while reading another session.');
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(anchor);
  await page.evaluate(() => { window.draftFixture.discoveryReadable = false; window.draftFixture.disconnect(); });
  await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(anchor);
  await page.evaluate(() => { window.draftFixture.discoveryReadable = true; });
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.draftFixture.activity('Activity received after reconnect.'));
  await expect(page.locator('.turn-activity')).toContainText('Activity received after reconnect.');
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(anchor);
  await page.getByRole('button', { name: /Jump to latest/ }).click();
  await expect.poll(() => scroll.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(2);
});

test('local marked-canvas preparation failure keeps the draft sendable without delivery reconciliation', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const field = await openDraftFixture(page, request);
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await page.getByRole('button', { name: /Start a sketch/ }).click();
  await expect(page.locator('.sketch-sheet')).toBeVisible();
  await page.getByRole('button', { name: 'Pen (P)', exact: true }).click();
  const box = (await page.locator('svg.ink-layer').boundingBox())!;
  const saved = page.waitForResponse(response => response.url().endsWith('/annotations') && response.status() === 200);
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await saved;
  await field.fill('Preserve this drawing instruction');
  await page.evaluate(() => { HTMLCanvasElement.prototype.toDataURL = () => { throw new Error('Fixture export unavailable'); }; });
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'marked canvas could not be exported' })).toBeVisible();
  await expect(field).toHaveValue('Preserve this drawing instruction');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Check delivery', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.draftFixture.requests.length)).toBe(0);
});
