import { expect, test, type Page, type APIRequestContext, type Locator } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CheckoutsResponse, DurableProject, PublicSession } from '../src/shared/types';
import { createTurn, updateActivity, finishTurn, type ToolStatus } from '../src/shared/turnActivity';

async function openSession(page: Page, request: APIRequestContext, theme: 'light' | 'dark', instruction: string | null = '[chronological-ui] Inspect chat activity.') {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const checkout = checkouts.find(item => item.relativePath === 'alpha')!;
  const project = (await (await request.post('/api/projects', { data: { name: `Chronological UI ${Date.now()}`, checkoutIds: [checkout.id] } })).json()).project as DurableProject;
  const session = (await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json()).session as PublicSession;
  await page.addInitScript(theme => localStorage.setItem('code-ai:theme', theme), theme);
  await page.goto('/');
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(project.name) }).click();
  await expect(page.getByRole('combobox', { name: 'All sessions', exact: true })).toHaveValue(session.id);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await conversation.getByLabel(/^Mode: /).click();
  await page.getByRole('radio', { name: /^Agent/ }).click();
  if (instruction !== null) {
    await conversation.getByRole('textbox', { name: 'Instruction', exact: true }).fill(instruction);
    await conversation.getByRole('button', { name: 'Send', exact: true }).click();
  }
  return { conversation, session };
}

async function textContrast(nodes: Locator) {
  return nodes.evaluateAll(elements => elements.filter(element => element.getClientRects().length).map(element => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const over = (fore: number[], back: number[]) => fore.slice(0, 3).map((value, index) => value * fore[3] / 255 + back[index] * (1 - fore[3] / 255));
    const ancestors: Element[] = []; for (let node: Element | null = element; node; node = node.parentElement) ancestors.unshift(node);
    let background = [255, 255, 255];
    for (const ancestor of ancestors) background = over(rgba(getComputedStyle(ancestor).backgroundColor), background);
    const foreground = over(rgba(getComputedStyle(element).color), background);
    const luminance = (color: number[]) => color.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const a = luminance(foreground), b = luminance(background);
    return { text: element.textContent?.slice(0, 70), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
  }));
}
async function inViewport(target: Locator, page: Page) {
  await expect(target).toBeVisible();
  const box = (await target.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

test.afterEach(async ({ request }) => {
  const runs = await (await request.get('/api/agent/runs')).json();
  for (const run of runs.active ?? []) await request.post('/api/agent/cancel', { data: { runId: run.runId } });
});

test('Claude per-block snapshots deliver one final reply and keep intentional repeated commentary after reload', async ({ page, request }) => {
  const { conversation, session } = await openSession(page, request, 'light', '[block-snapshots-ui] Inspect the block snapshots.');
  await expect(conversation.locator('.chat-message.assistant.complete')).toHaveCount(1);
  await expect(conversation.locator('.activity-commentary')).toHaveCount(2);
  await expect(conversation.locator('.activity-commentary').first().locator('.assistant-blocks')).toHaveText('Same answer.');
  await expect(conversation.locator('.chat-message.assistant.complete')).toContainText('Same answer.Second final.');
  const saved = (await (await request.get(`/api/sessions/${session.id}`)).json()).session as PublicSession;
  expect(saved.messages).toHaveLength(2);
  const user = saved.messages[0];
  expect(user.role === 'user' && user.turn?.entries.filter(entry => entry.kind === 'assistant' && entry.canonicalMessageId)).toHaveLength(2);
  await page.reload();
  await expect(conversation.locator('.chat-message.assistant.complete')).toHaveCount(1);
  await expect(conversation.locator('.activity-commentary')).toHaveCount(2);
  await expect(conversation).not.toContainText('PRIVATE-THINKING');
});

test('saved Claude duplicate history displays once while raw evidence and intentional repetition survive', async ({ page, request }) => {
  const { conversation, session } = await openSession(page, request, 'light', null);
  const filename = path.resolve('test-results/server-data/session-store-v2/sessions', `${session.id}.json`);
  const raw = JSON.parse(await readFile(filename, 'utf8'));
  const userId = crypto.randomUUID(), replyId = crypto.randomUUID();
  let turn = createTurn('historical-claude-duplicates', userId, session.primaryAgentId, session.createdAt);
  const text = (message: string, index: number, value: string) => {
    const key = JSON.stringify(['text', '', message, index]);
    turn = updateActivity(turn, 1, { kind: 'assistant', key, text: value, complete: true, actor: { provider: 'claude' } });
    return key;
  };
  text(JSON.stringify(['msg_intentional']), 0, 'Final answer.');
  text('anonymous-18', 1, 'Final answer.');
  const finalKey = text(JSON.stringify(['msg_final']), 0, 'Final answer.');
  turn = finishTurn(turn, 'completed', { attempt: 1, key: finalKey, messageId: replyId });
  raw.version = 13;
  raw.messages = [{ id: userId, role: 'user', authorId: `${session.id}:human`, addressedParticipantId: session.primaryAgentId,
    createdAt: session.createdAt, status: 'sent', text: 'Inspect the saved reply.', diagramAttachments: [], turn: { ...turn, history: 'saved' } },
  { id: replyId, role: 'assistant', authorId: session.primaryAgentId, createdAt: session.createdAt,
    status: 'complete', rawMarkdown: 'Final answer.', blocks: [{ kind: 'markdown', markdown: 'Final answer.' }] }];
  const before = JSON.stringify(raw);
  await writeFile(filename, before);
  await page.reload();
  await expect(conversation.locator('.chat-message.assistant.complete')).toHaveCount(1);
  await expect(conversation.locator('.activity-commentary')).toHaveCount(1);
  await expect(conversation.locator('.activity-commentary')).toContainText('Final answer.');
  const saved = (await (await request.get(`/api/sessions/${session.id}`)).json()).session as PublicSession;
  expect(saved.messages[0].role === 'user' && saved.messages[0].turn?.entries).toHaveLength(2);
  expect(await readFile(filename, 'utf8')).toBe(before);
});

test('large activity bursts keep one live stream through approval and saved completion', async ({ page, request }) => {
  let reattachments = 0;
  page.on('request', event => { if (event.url().includes('/api/agent/stream?')) reattachments++; });
  const { conversation, session } = await openSession(page, request, 'light', '[history-burst-ui] Keep the turn observable.');
  const approvals = conversation.getByRole('region', { name: 'Pending approvals' });
  await expect(approvals.getByRole('button', { name: 'Allow once', exact: true })).toBeVisible();
  await approvals.getByRole('button', { name: 'Allow once', exact: true }).click();
  await expect(conversation).toContainText('Large activity burst completed.');
  await expect(approvals).toHaveCount(0);
  expect(reattachments).toBe(0);
  const saved = (await (await request.get(`/api/sessions/${session.id}`)).json()).session as PublicSession;
  const user = saved.messages[0];
  expect(user).toMatchObject({ status: 'sent', turn: { lifecycle: 'completed', history: 'saved' } });
  expect(Buffer.byteLength(JSON.stringify(user.role === 'user' ? user.turn : undefined))).toBeGreaterThan(700 * 1024);
  await page.reload();
  await expect(conversation.locator('.chat-message.assistant.complete')).toHaveCount(1);
  await expect(conversation).toContainText('Large activity burst completed.');
});

test('chat text stays selectable and copyable after interrupted panel resizing', async ({ page, request, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { conversation, session } = await openSession(page, request, 'light', null);
  session.messages.push({ id: crypto.randomUUID(), role: 'assistant', authorId: session.primaryAgentId,
    createdAt: new Date().toISOString(), status: 'complete', rawMarkdown: 'Copy this chat text.',
    blocks: [{ kind: 'markdown', markdown: 'Copy this chat text.' }] });
  await page.route('**/api/sessions**', async route => {
    if (new URL(route.request().url()).pathname === `/api/sessions/${session.id}`) return route.fulfill({ json: { session } });
    const response = await route.fetch();
    const data = await response.json();
    if (Array.isArray(data.sessions)) data.sessions = data.sessions.map((item: PublicSession) => item.id === session.id ? session : item);
    await route.fulfill({ response, json: data });
  });
  await page.reload();
  const text = conversation.locator('.assistant-blocks p');
  await expect(text).toHaveText('Copy this chat text.');
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  const handle = page.getByRole('separator', { name: 'Resize conversation panel' });
  for (const end of ['pointerup', 'pointercancel', 'blur'] as const) {
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(page.locator('body')).toHaveClass(/panel-resizing/);
    if (end === 'pointerup') await page.mouse.up();
    else if (end === 'pointercancel') await page.dispatchEvent('body', 'pointercancel', { pointerId: 1 });
    else await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.locator('body')).not.toHaveClass(/panel-resizing/);
    // Releasing outside the page must not leave either resizing or selection suppression active.
    await page.mouse.up();
    await text.click({ clickCount: 3 });
    await expect.poll(() => page.evaluate(() => getSelection()?.toString().trim())).toBe('Copy this chat text.');
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await page.keyboard.press('ControlOrMeta+c');
    await expect.poll(async () => (await page.evaluate(() => navigator.clipboard.readText())).trim()).toBe('Copy this chat text.');
  }
});

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: ordered reply footer copies Markdown and recovery precedes its user message`, async ({ page, request, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const { conversation, session } = await openSession(page, request, theme, null);
    const markdown = 'Finished the change.\n\n```ts\nconst value = 42;\n```';
    const replyId = crypto.randomUUID(), userId = crypto.randomUUID();
    const turn = finishTurn(updateActivity(createTurn('reply-actions', userId, session.primaryAgentId, session.createdAt), 1,
      { kind: 'assistant', key: 'final', text: markdown }), 'completed', { attempt: 1, messageId: replyId, key: 'final' });
    session.messages.push({ id: userId, role: 'user', authorId: `${session.id}:human`,
      addressedParticipantId: session.primaryAgentId, createdAt: session.createdAt, status: 'sent',
      text: 'Simplify the reply actions.', diagramAttachments: [], turn: { ...turn, history: 'saved', incomplete: true } },
    { id: replyId, role: 'assistant', authorId: session.primaryAgentId, createdAt: session.createdAt,
      status: 'complete', rawMarkdown: markdown, blocks: [{ kind: 'markdown', markdown: 'Finished the change.' }, { kind: 'code', source: 'const value = 42;', language: 'ts' }] });
    await page.route('**/api/sessions**', async route => {
      const response = await route.fetch();
      const data = await response.json();
      if (new URL(route.request().url()).pathname === `/api/sessions/${session.id}`) data.session = session;
      if (Array.isArray(data.sessions)) data.sessions = data.sessions.map((item: PublicSession) => item.id === session.id ? session : item);
      await route.fulfill({ response, json: data });
    });
    await page.route('**/api/agent/checkpoint?*', route => route.fulfill({ json: { checkpoint: {
      id: crypto.randomUUID(), messageId: userId, createdAt: session.createdAt,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(), state: 'ready', changedFiles: 2,
    } } }));
    await page.reload();
    const reply = conversation.locator('.chat-message.assistant.complete');
    const footer = reply.locator('.message-actions');
    const copy = footer.getByRole('button', { name: 'Copy reply', exact: true });
    const archive = conversation.locator(':scope > header').getByRole('button', { name: 'Archive session', exact: true });
    await expect(reply).toHaveCount(1);
    await expect(reply.locator('.message-meta time')).toHaveCount(0);
    await expect(footer.locator('time')).toHaveAttribute('datetime', session.createdAt);
    expect(await footer.locator('time, button').evaluateAll(elements => elements.map(element => element.tagName === 'TIME' ? 'timestamp' : element.getAttribute('aria-label'))))
      .toEqual(['timestamp', 'Copy reply']);
    const recovery = conversation.getByLabel('Turn recovery');
    await expect(recovery.getByRole('button', { name: 'Restore files', exact: true })).toBeEnabled();
    expect(await recovery.evaluate(element => {
      const message = element.closest('[data-message-id]')?.querySelector('.chat-message.user');
      return Boolean(message && (element.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING));
    })).toBe(true);
    await expect(archive).toHaveText('');
    await expect(archive).toBeEnabled();
    await archive.hover();
    await expect(page.getByRole('tooltip')).toContainText('Archive session');
    await copy.click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(markdown);
    await expect(footer.getByRole('status')).toHaveText('Copied');
    await page.evaluate(() => {
      const original = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = async text => {
        navigator.clipboard.writeText = original;
        throw new DOMException(`Clipboard denied (${text.length} characters)`, 'NotAllowedError');
      };
    });
    await copy.click();
    await expect(footer.getByRole('status')).toHaveText('Could not copy. Try again.');
    await expect(reply.locator('.assistant-blocks')).toContainText('const value = 42;');
    await copy.click();
    await expect(footer.getByRole('status')).toHaveText('Copied');
    await expect(conversation).not.toContainText('Some activity was not retained');
    await expect(conversation).not.toContainText('Ready for an instruction');
    await expect(conversation.locator('.inline-status')).toHaveCount(0);
    await expect(conversation.getByRole('img', { name: 'Activity history details', exact: true })).toHaveCount(0);
    await expect(conversation).not.toContainText('Some activity details were shortened');
    await copy.focus();
    await mkdir('test-results/compact-reply-actions-followup', { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(archive).toBeInViewport();
      expect(await conversation.locator('.conversation-scroll').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await expect(recovery).toBeInViewport();
      await page.screenshot({ animations: 'disabled', path: `test-results/compact-reply-actions-followup/${theme}-${width}.png` });
    }
    await page.unrouteAll({ behavior: 'wait' });
  });

  test(`${theme}: quiet message headers and compact tool results reveal full details`, async ({ page, request }) => {
    const { conversation, session } = await openSession(page, request, theme, null);
    const messageId = crypto.randomUUID();
    let turn = createTurn('quiet-tools', messageId, session.primaryAgentId, session.createdAt);
    const results: Array<[ToolStatus, string, string]> = [
      ['succeeded', 'Succeeded', '--live'], ['failed', 'Failed', '--stop'], ['denied', 'Denied', '--stop'],
      ['running', 'Running', '--wait'], ['cancelled', 'Cancelled', '--muted'], ['unknown', 'Outcome unknown', '--muted'],
    ];
    for (const [status] of results) turn = updateActivity(turn, 1, { kind: 'tool', key: status, tool: 'Shell',
      summary: `${status}: npm test ${'long-command-'.repeat(30)}`, status,
      input: 'Full arguments', output: 'Full tool output', diff: '+ changed line',
      ...(status === 'failed' ? { error: `${'Failure detail. '.repeat(30)}LAST ERROR LINE`, exitCode: 1, durationMs: 125, omittedBytes: 50 } : {}),
    });
    session.messages.push({ id: messageId, role: 'user', authorId: `${session.id}:human`,
      addressedParticipantId: session.primaryAgentId, createdAt: session.createdAt, status: 'sent',
      text: 'Make the tool results easier to scan.', diagramAttachments: [], mode: 'auto', level: 'native',
      turn: { ...turn, lifecycle: 'completed', history: 'saved' } },
    { id: crypto.randomUUID(), role: 'assistant', authorId: session.primaryAgentId, createdAt: session.createdAt,
      status: 'complete', mode: 'auto', level: 'native', rawMarkdown: 'The results are ready.',
      blocks: [{ kind: 'markdown', markdown: 'The results are ready.' }] });
    await page.route('**/api/sessions**', async route => {
      const response = await route.fetch();
      const data = await response.json();
      if (new URL(route.request().url()).pathname === `/api/sessions/${session.id}`) data.session = session;
      if (Array.isArray(data.sessions)) data.sessions = data.sessions.map((item: PublicSession) => item.id === session.id ? session : item);
      await route.fulfill({ response, json: data });
    });
    await page.reload();
    await expect(conversation.locator('.chat-message .mode-tag')).toHaveCount(0);
    await expect(conversation.locator('.mode-menu > button')).toHaveText('Agent');
    const tools = conversation.locator('.activity-tool');
    await expect(tools).toHaveCount(6);
    for (const [status, label, token] of results) {
      const row = tools.locator(`:scope.${status}`);
      const dot = row.getByRole(status === 'running' ? 'progressbar' : 'img', { name: label, exact: true });
      if (status !== 'running') await expect(dot).toHaveAttribute('title', label);
      await expect(row.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
      await expect(row.locator('.MuiAccordionDetails-root')).toBeHidden();
      if (status !== 'cancelled' && status !== 'running') {
        const color = await dot.evaluate((element, token) => {
          const sample = document.createElement('span'); sample.style.color = `var(${token})`; element.append(sample);
          const expected = getComputedStyle(sample).color; sample.remove();
          return { actual: getComputedStyle(element).backgroundColor, expected };
        }, token);
        expect(color.actual).toBe(color.expected);
      }
    }
    const failed = tools.locator(':scope.failed');
    const toggle = failed.getByRole('button');
    await toggle.focus(); await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    for (const text of ['Full arguments', 'Full tool output', '+ changed line', 'LAST ERROR LINE', 'Exit 1', '125 ms', '50 bytes omitted']) {
      await expect(failed.getByText(text, { exact: false }).last()).toBeVisible();
    }
    await page.keyboard.press('Space');
    await expect(failed.locator('.tool-error')).toBeHidden();
    await tools.first().getByRole('button').click();
    await expect(tools.first().getByText('Full tool output')).toBeVisible();
    await tools.first().getByRole('button').click();
    await mkdir('test-results/quiet-message-activity', { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await conversation.locator('.conversation-scroll').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await page.screenshot({ animations: 'disabled', path: `test-results/quiet-message-activity/${theme}-${width}-collapsed.png` });
      await toggle.click();
      expect(await failed.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await page.screenshot({ animations: 'disabled', path: `test-results/quiet-message-activity/${theme}-${width}-expanded.png` });
      await toggle.click();
    }
    await page.reload();
    await expect(failed.getByRole('img', { name: 'Failed', exact: true })).toBeVisible();
    await expect(failed.locator('.tool-error')).toBeHidden();
    await expect(conversation).toContainText('The results are ready.');
    await page.unrouteAll({ behavior: 'wait' });
  });

  test(`${theme}: idle conversation controls and normal text contrast`, async ({ page, request }) => {
    const { conversation } = await openSession(page, request, theme, null);
    const controls = await conversation.locator('button:visible, select:visible, textarea:visible').count();
    const contrast = await textContrast(conversation.locator('header strong, .conversation-welcome h1, .conversation-welcome p, .conversation-starter-copy, .conversation-starter small, .composer-menu > button'));
    await mkdir('test-results/chronological-chat', { recursive: true });
    await writeFile(`test-results/chronological-chat/${theme}-idle${process.env.CODEAI_METRICS_BASELINE ? '-baseline' : ''}.json`, JSON.stringify({ controls, contrast }, null, 2));
    for (const item of contrast) expect(item.ratio, item.text).toBeGreaterThanOrEqual(4.5);
    // Empty conversations add three starter actions to the existing nine-control budget.
    expect(controls).toBeLessThanOrEqual(12);
  });

  test(`${theme}: ordered durable tools, fixed approvals, review, drafts and scrolling`, async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { conversation, session } = await openSession(page, request, theme);
    const field = conversation.getByRole('textbox', { name: 'Instruction', exact: true });
    await expect(field).toHaveValue('');
    await field.fill('My next draft');
    const approvals = conversation.getByRole('region', { name: 'Pending approvals' });
    await expect(approvals).toContainText('1 of 2');
    await expect(conversation.locator('.activity-tool').getByRole('progressbar', { name: 'Running', exact: true })).toHaveCount(2);
    const contrast = await textContrast(conversation.locator('.message-meta, .tool-summary, .tool-summary small, .activity-approval, .assistant-blocks p'));
    for (const item of contrast) expect(item.ratio, item.text).toBeGreaterThanOrEqual(4.5);
    await mkdir('test-results/chronological-chat', { recursive: true });
    await writeFile(`test-results/chronological-chat/${theme}-activity-contrast.json`, JSON.stringify(contrast, null, 2));
    await expect(field).toBeFocused();
    const rows = conversation.locator('[data-activity-id]');
    const ids = await rows.evaluateAll(elements => elements.map(element => element.getAttribute('data-activity-id')));
    expect(new Set(ids).size).toBe(ids.length);
    const parallel = conversation.locator('.activity-tool').filter({ hasText: /first command|second command/ });
    expect(await parallel.allTextContents()).toEqual([expect.stringContaining('first command'), expect.stringContaining('second command')]);
    for (const width of [1440, 1000, 360]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 800 });
      await inViewport(approvals.getByRole('button', { name: 'Allow once', exact: true }), page);
      await inViewport(approvals.getByRole('button', { name: 'Deny', exact: true }), page);
      await inViewport(conversation.getByRole('button', { name: 'Cancel', exact: true }), page);
      await inViewport(field, page);
      expect(await conversation.locator('.conversation-scroll').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await page.screenshot({ animations: 'disabled', path: `test-results/chronological-chat/${theme}-${width}-approval.png` });
    }
    await page.setViewportSize({ width: 1000, height: 800 });
    // Exercise the documented minimum conversation content width within a docked workspace.
    await conversation.evaluate(element => { (element as HTMLElement).style.width = '320px'; });
    await inViewport(approvals.getByRole('button', { name: 'Allow once', exact: true }), page);
    await page.screenshot({ animations: 'disabled', path: `test-results/chronological-chat/${theme}-320-approval.png` });
    await conversation.evaluate(element => { (element as HTMLElement).style.width = ''; });
    await approvals.getByRole('button', { name: 'Review', exact: true }).click();
    const review = page.getByRole('dialog', { name: /Review/ });
    await expect(review).toContainText('LAST REVIEW LINE');
    await review.locator('.MuiDialogContent-root').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await inViewport(review.getByRole('button', { name: 'Allow once', exact: true }), page);
    await page.screenshot({ animations: 'disabled', path: `test-results/chronological-chat/${theme}-review.png` });
    await review.getByRole('button', { name: 'Close', exact: true }).click();
    const scroll = conversation.locator('.conversation-scroll');
    await scroll.evaluate(element => { element.scrollTop = 0; });
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(0);
    await approvals.getByRole('button', { name: 'Deny', exact: true }).click();
    await expect(approvals).toContainText('1 of 1');
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBe(0);
    await expect(conversation.getByRole('button', { name: /Jump to latest/ })).toBeVisible();
    await approvals.getByRole('button', { name: 'Allow once', exact: true }).click();
    await expect(approvals).toHaveCount(0);
    await expect(conversation).toContainText('Updated conversation.');
    await expect(conversation.locator('.activity-tool').getByRole('progressbar')).toHaveCount(0);
    await expect(conversation.locator('.activity-approval')).toContainText(['Denied', 'Allowed']);
    const errors = conversation.locator('.tool-error');
    await expect(errors).toContainText(['The action was denied.', 'Allowed action failed with exit 1.']);
    await expect(errors.first()).toBeHidden();
    // This provider reports both denied actions and failed commands as failed tool results.
    for (const tool of await conversation.locator('.activity-tool').filter({ has: page.locator('.tool-error') }).all()) {
      await tool.getByRole('button').click();
      await expect(tool.locator('.tool-error')).toBeVisible();
      await tool.getByRole('button').click();
    }
    await expect(field).toHaveValue('My next draft');
    await conversation.getByRole('button', { name: /Jump to latest/ }).click();
    await expect(conversation.locator('.diagram-card')).toHaveCount(1);
    const before = await rows.evaluateAll(elements => elements.map(element => element.getAttribute('data-activity-id')));
    await page.reload();
    await expect(conversation).toContainText('Updated conversation.');
    expect(await rows.evaluateAll(elements => elements.map(element => element.getAttribute('data-activity-id')))).toEqual(before);
    const saved = (await (await request.get(`/api/sessions/${session.id}`)).json()).session as PublicSession;
    expect(saved.version).toBe(13);
    expect(saved.messages[0]).toMatchObject({ turn: { lifecycle: 'completed', history: 'saved' } });
    await page.screenshot({ animations: 'disabled', path: `test-results/chronological-chat/${theme}-completed.png` });
  });
}

test('unknown complete review blocks only desktop Allow, external decisions reconcile, and stale inline reviews do not open the next turn', async ({ page, request }) => {
  const { conversation, session } = await openSession(page, request, 'light', '[chronological-ui] unavailable review');
  const approvals = conversation.getByRole('region', { name: 'Pending approvals' });
  await expect(approvals).toContainText('1 of 2');
  await expect(approvals.getByRole('button', { name: 'Allow once', exact: true })).toBeDisabled();
  await expect(approvals.getByRole('button', { name: 'Deny', exact: true })).toBeEnabled();
  await expect(conversation.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  await conversation.locator('.activity-approval').first().getByRole('button', { name: 'Review', exact: true }).click();
  const review = page.getByRole('dialog', { name: /Review/ });
  await expect(review).not.toContainText('OMITTED-FIXTURE-SECRET');
  await expect(review.getByRole('button', { name: 'Allow once', exact: true })).toBeDisabled();
  await review.getByRole('button', { name: 'Close', exact: true }).click();
  const runs = await (await request.get(`/api/agent/runs?sessionId=${session.id}`)).json();
  const run = runs.active.find((item: { sessionId: string }) => item.sessionId === session.id);
  // Arena/Inbox/VR use this unchanged broker route, which has no desktop completeness gate.
  expect((await request.post('/api/agent/permission', { data: { runId: run.runId, requestId: run.pendingPermissions[0].requestId, decision: 'allow' } })).ok()).toBe(true);
  await expect(approvals).toContainText('1 of 1');
  await approvals.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(approvals).toHaveCount(0);
  await expect(conversation).toContainText('Updated conversation.');
  const field = conversation.getByRole('textbox', { name: 'Instruction', exact: true });
  await field.fill('[chronological-ui] A new turn');
  await conversation.getByRole('button', { name: 'Send', exact: true }).click();
  await field.focus();
  await expect(approvals).toContainText('1 of 2');
  await expect(review).toHaveCount(0);
  await expect(field).toBeFocused();
  await approvals.getByRole('button', { name: 'Next approval', exact: true }).click();
  await expect(approvals).toContainText('2 of 2');
  await expect(approvals).toContainText('false');
  await approvals.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(approvals).toContainText('1 of 1');
  await approvals.getByRole('button', { name: 'Deny', exact: true }).click();
});

test('a later approval in the same run waits for an explicit Review without stealing composer focus', async ({ page, request }) => {
  const { conversation } = await openSession(page, request, 'light', '[chronological-ui] sequential review');
  const approvals = conversation.getByRole('region', { name: 'Pending approvals' });
  await expect(approvals).toContainText('1 of 2');
  await approvals.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(approvals).toContainText('1 of 1');
  const field = conversation.getByRole('textbox', { name: 'Instruction', exact: true });
  await field.focus();
  const reviewButton = approvals.getByRole('button', { name: 'Review', exact: true });
  for (let i = 0; i < 12 && !await reviewButton.evaluate(element => element === document.activeElement); i++) await page.keyboard.press('Shift+Tab');
  await expect(reviewButton).toBeFocused();
  await page.keyboard.press('Enter');
  const review = page.getByRole('dialog', { name: /Review/ });
  const deny = review.getByRole('button', { name: 'Deny', exact: true });
  for (let i = 0; i < 8 && !await deny.evaluate(element => element === document.activeElement); i++) await page.keyboard.press('Tab');
  await expect(deny).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(approvals).toHaveCount(0);
  await field.fill('Next draft keeps focus');
  await expect(approvals).toContainText('true');
  await expect(review).toHaveCount(0);
  await expect(field).toBeFocused();
  await approvals.getByRole('button', { name: 'Deny', exact: true }).click();
});
