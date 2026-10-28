import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AssistantMessage, CheckoutsResponse, DurableSession, PublicSession, UserMessage } from '../src/shared/types';
import { createTurn, finishTurn, updateActivity } from '../src/shared/turnActivity';
import { durableSessionSchema } from '../src/shared/sessionSchema';

async function openConversation(page: Page, request: APIRequestContext, theme: 'light' | 'dark') {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const { project } = await (await request.post('/api/projects', { data: {
    name: `Message navigation ${Date.now()}`, checkoutIds: [checkouts.find(item => item.relativePath === 'alpha')!.id],
  } })).json();
  const { session } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json() as { session: PublicSession };
  const longText = Array.from({ length: 18 }, (_, index) => `Paragraph ${index + 1}: enough response text to make navigation across a long conversation useful.`).join('\n\n');
  const user = (text: string): UserMessage => ({ id: crypto.randomUUID(), role: 'user', authorId: `${session.id}:human`,
    addressedParticipantId: session.primaryAgentId, createdAt: session.createdAt, status: 'sent', text, diagramAttachments: [] });
  const reply = (text: string): AssistantMessage => ({ id: crypto.randomUUID(), role: 'assistant', authorId: session.primaryAgentId,
    createdAt: session.createdAt, status: 'complete', rawMarkdown: text, blocks: [{ kind: 'markdown', markdown: text }] });
  const users = [user('First prompt'), user('Interrupted prompt'), user('Legacy prompt'), user('Unanswered prompt')];
  const first = reply(`Canonical response\n\n${longText}`);
  users[0].turn = finishTurn(updateActivity(createTurn(crypto.randomUUID(), users[0].id, session.primaryAgentId, session.createdAt), 1,
    { kind: 'assistant', key: 'final', text: first.rawMarkdown }), 'completed', { attempt: 1, messageId: first.id, key: 'final' });
  users[0].turn.history = 'saved';
  let stopped = updateActivity(createTurn(crypto.randomUUID(), users[1].id, session.primaryAgentId, session.createdAt), 1,
    { kind: 'assistant', key: 'comment', text: 'Intermediate commentary', complete: true });
  stopped = updateActivity(stopped, 1, { kind: 'tool', key: 'tool', tool: 'Read', summary: 'file.ts', status: 'succeeded' });
  users[1].turn = finishTurn(updateActivity(stopped, 1, { kind: 'assistant', key: 'stopped', text: `Stopped response\n\n${longText}` }), 'cancelled');
  users[1].turn.history = 'saved';
  const intermediate = reply('Legacy intermediate commentary'), last = reply(`Legacy response\n\n${longText}`);
  const filename = path.resolve('test-results/server-data/session-store-v2/sessions', `${session.id}.json`);
  const stored = JSON.parse(await readFile(filename, 'utf8')) as DurableSession;
  stored.version = 13;
  stored.messages = [users[0], first, users[1], users[2], intermediate, last, users[3]];
  await writeFile(filename, JSON.stringify(durableSessionSchema.parse(stored)));
  const { session: other } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json() as { session: PublicSession };
  await page.addInitScript(theme => localStorage.setItem('code-ai:theme', theme), theme);
  await page.goto('/');
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(project.name) }).click();
  await page.getByRole('combobox', { name: 'All sessions', exact: true }).selectOption(session.id);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  const target = (id: string) => conversation.locator(`[data-navigation-id="${id}"]`);
  const responses = [target(`message:${first.id}`), target(`activity:${users[1].turn!.runId}:${users[1].turn!.entries.at(-1)!.id}`), target(`message:${last.id}`)];
  return { conversation, session, other, users: users.map(user => target(`message:${user.id}`)), responses, intermediate: target(`message:${intermediate.id}`) };
}

async function atStart(target: Locator) {
  await expect(target).toBeFocused();
  await expect.poll(() => target.evaluate(element => {
    const scroll = element.closest('.conversation-scroll')!;
    const offset = element.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
    // A short final message can reach the bottom before its start reaches the top.
    return Math.abs(offset - 8) <= 1 || scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= 1;
  })).toBe(true);
}

test.afterEach(async ({ request }) => {
  const runs = await (await request.get('/api/agent/runs')).json();
  for (const run of runs.active ?? []) await request.post('/api/agent/cancel', { data: { runId: run.runId } });
});

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: user and response arrows navigate, focus and restore across sessions`, async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const { conversation, session, other, users, responses, intermediate } = await openConversation(page, request, theme);
    const field = conversation.getByRole('textbox', { name: 'Instruction', exact: true });
    await field.fill('Keep this draft');
    await expect(conversation.getByRole('button', { name: 'Previous user message', exact: true })).toHaveCount(4);
    await expect(conversation.getByRole('button', { name: 'Previous response', exact: true })).toHaveCount(3);
    await expect(intermediate.getByRole('button', { name: /response/ })).toHaveCount(0);
    await expect(users[0].getByRole('button', { name: 'Previous user message', exact: true })).toBeDisabled();
    await expect(users[3].getByRole('button', { name: 'Next user message', exact: true })).toBeDisabled();
    await expect(responses[0].getByRole('button', { name: 'Previous response', exact: true })).toBeDisabled();
    await expect(responses[2].getByRole('button', { name: 'Next response', exact: true })).toBeDisabled();
    for (let index = 3; index > 0; index--) {
      await users[index].getByRole('button', { name: 'Previous user message', exact: true }).click();
      await atStart(users[index - 1]);
    }
    for (let index = 0; index < 3; index++) {
      await users[index].getByRole('button', { name: 'Next user message', exact: true }).click();
      await atStart(users[index + 1]);
    }
    for (let index = 2; index > 0; index--) {
      await responses[index].getByRole('button', { name: 'Previous response', exact: true }).click();
      await atStart(responses[index - 1]);
    }
    for (let index = 0; index < 2; index++) {
      const next = responses[index].getByRole('button', { name: 'Next response', exact: true });
      await next.focus();
      await page.keyboard.press('Enter');
      await atStart(responses[index + 1]);
    }
    await expect(field).toHaveValue('Keep this draft');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await users[2].getByRole('button', { name: 'Previous user message', exact: true }).click();
    await atStart(users[1]);
    const scroll = conversation.locator('.conversation-scroll');
    const position = await scroll.evaluate(element => element.scrollTop);
    const picker = page.getByRole('combobox', { name: 'All sessions', exact: true });
    await picker.selectOption(other.id);
    await expect(conversation.getByRole('button', { name: 'Previous user message', exact: true })).toHaveCount(0);
    await picker.selectOption(session.id);
    await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeCloseTo(position, 0);
    await expect(field).toHaveValue('Keep this draft');
    await mkdir('test-results/message-navigation', { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await users[2].getByRole('button', { name: 'Previous user message', exact: true }).click();
      await expect(users[1].getByRole('button', { name: 'Next user message', exact: true })).toBeInViewport();
      await page.screenshot({ animations: 'disabled', path: `test-results/message-navigation/${theme}-${width}-user.png` });
      await responses[1].getByRole('button', { name: 'Next response', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ animations: 'disabled', path: `test-results/message-navigation/${theme}-${width}-response.png` });
      expect(await scroll.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
  });
}

test('navigation during a live turn preserves reading position, drafts and Jump to latest', async ({ page, request }) => {
  const { conversation, users, responses } = await openConversation(page, request, 'light');
  await conversation.getByLabel(/^Mode: /).click();
  await page.getByRole('radio', { name: /^Agent/ }).click();
  const field = conversation.getByRole('textbox', { name: 'Instruction', exact: true });
  await field.fill('[chronological-ui] Navigate during this turn.');
  await conversation.getByRole('button', { name: 'Send', exact: true }).click();
  const approvals = conversation.getByRole('region', { name: 'Pending approvals' });
  await expect(approvals).toContainText('1 of 2');
  await expect(conversation.getByRole('button', { name: 'Previous response', exact: true })).toHaveCount(3);
  await expect(responses[2].getByRole('button', { name: 'Next response', exact: true })).toBeDisabled();
  await field.fill('Draft survives navigation');
  await users[2].getByRole('button', { name: 'Previous user message', exact: true }).click();
  await atStart(users[1]);
  const scroll = conversation.locator('.conversation-scroll');
  const position = await scroll.evaluate(element => element.scrollTop);
  await approvals.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(approvals).toContainText('1 of 1');
  await approvals.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(conversation).toContainText('Updated conversation.');
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeCloseTo(position, 0);
  await expect(field).toHaveValue('Draft survives navigation');
  await conversation.getByRole('button', { name: /Jump to latest/ }).click();
  await expect.poll(() => scroll.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(40);
  await expect(conversation.getByRole('button', { name: 'Previous response', exact: true })).toHaveCount(4);
});

test('a jump clamped at the bottom keeps following paused after switching sessions', async ({ page, request }) => {
  const { conversation, session, other, users } = await openConversation(page, request, 'light');
  await conversation.getByLabel(/^Mode: /).click();
  await page.getByRole('radio', { name: /^Agent/ }).click();
  const field = conversation.getByRole('textbox', { name: 'Instruction', exact: true });
  await field.fill('A short turn awaiting approval.');
  await conversation.getByRole('button', { name: 'Send', exact: true }).click();
  const approvals = conversation.getByRole('region', { name: 'Pending approvals' });
  await expect(approvals).toContainText('1 of 1');
  await users[3].getByRole('button', { name: 'Next user message', exact: true }).click();
  await atStart(conversation.locator('.chat-message.user').last());
  const scroll = conversation.locator('.conversation-scroll');
  expect(await scroll.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(40);
  const picker = page.getByRole('combobox', { name: 'All sessions', exact: true });
  await picker.selectOption(other.id);
  await expect(conversation.locator('.chat-message.user')).toHaveCount(0);
  await picker.selectOption(session.id);
  await expect(approvals).toContainText('1 of 1');
  await approvals.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(conversation).toContainText('Edit denied');
  await expect(conversation.getByRole('button', { name: /Jump to latest/ })).toBeVisible();
});
