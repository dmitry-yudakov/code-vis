import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { durableSessionSchema } from '../src/shared/sessionSchema';
import { createTurn, finishTurn, updateActivity } from '../src/shared/turnActivity';
import type { CheckoutsResponse, PublicSession } from '../src/shared/types';

const summary = [
  '| Feature | What’s implemented | Evidence |',
  '| --- | --- | --- |',
  '| **Memberships** | ' + 'Staff can configure enrollment rules, manage participants, and reconcile payments with the finance team. '.repeat(3)
    + '| [Documentation](https://example.com/docs) · [Screenshots](https://example.com/screenshots) |',
].join('\n');

const wideTable = [
  '| Configuration | Authentication | Reconciliation | Administration | Documentation |',
  '| --- | --- | --- | ---: | --- |',
  '| Enabled | Required | Complete | 12 | Available |',
].join('\n');

async function openConversation(page: Page, request: APIRequestContext) {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const { project } = await (await request.post('/api/projects', { data: {
    name: `Markdown table layout ${Date.now()}`, checkoutIds: [checkouts.find(checkout => checkout.name === 'alpha')!.id],
  } })).json();
  const { session } = await (await request.post('/api/sessions', { data: {
    projectId: project.id, provider: 'claude',
  } })).json() as { session: PublicSession };
  const filename = path.resolve(process.env.CODEAI_E2E_DATA_DIR ?? 'test-results/server-data', 'session-store-v2/sessions', `${session.id}.json`);
  const stored = durableSessionSchema.parse(JSON.parse(await readFile(filename, 'utf8')));
  stored.version = 13;
  const userId = crypto.randomUUID();
  const turn = finishTurn(updateActivity(createTurn(crypto.randomUUID(), userId, session.primaryAgentId, session.createdAt), 1,
    { kind: 'assistant', key: 'commentary', text: summary, complete: true }), 'completed');
  const reply = `${summary}\n\n${wideTable}`;
  stored.messages = [
    { id: userId, role: 'user', authorId: `${session.id}:human`, addressedParticipantId: session.primaryAgentId,
      createdAt: session.createdAt, status: 'sent', text: 'Summarize the changes.', diagramAttachments: [], turn: { ...turn, history: 'saved' } },
    { id: crypto.randomUUID(), role: 'assistant', authorId: session.primaryAgentId, createdAt: session.createdAt,
      status: 'complete', rawMarkdown: reply, blocks: [{ kind: 'markdown', markdown: reply }] },
  ];
  await writeFile(filename, JSON.stringify(durableSessionSchema.parse(stored)));
  await page.goto(`/?session=${session.id}`);
}

for (const theme of ['light', 'dark']) {
  test(`${theme}: Markdown tables keep words whole and scroll within the chat pane`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width: 730, height: 900 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    await openConversation(page, request);

    const chat = page.locator('.conversation-scroll');
    const tables = chat.getByRole('table');
    await expect(tables).toHaveCount(3);
    for (const table of await tables.filter({ has: page.getByRole('columnheader', { name: 'Feature' }) }).all()) {
      for (const word of [table.getByText('Memberships', { exact: true }), table.getByRole('link', { name: 'Documentation' })]) {
        expect(await word.evaluate(node => {
          const range = document.createRange();
          range.selectNodeContents(node);
          return range.getClientRects().length;
        })).toBe(1);
      }
    }

    const configurationHeader = page.getByRole('columnheader', { name: 'Configuration' });
    const wide = tables.filter({ has: configurationHeader });
    await expect(wide.getByRole('cell', { name: '12' })).toHaveCSS('text-align', 'right');
    const scroll = chat.getByRole('region', { name: 'Markdown table' }).filter({ has: configurationHeader });
    await expect.poll(() => scroll.evaluate(node => node.scrollWidth - node.clientWidth)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('readable-columns.png') });

    await page.setViewportSize({ width: 390, height: 900 });
    await expect.poll(() => scroll.evaluate(node => node.scrollWidth - node.clientWidth)).toBeGreaterThan(0);
    await expect.poll(() => chat.evaluate(node => node.scrollWidth - node.clientWidth)).toBe(0);
    await scroll.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => scroll.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
    await wide.getByRole('columnheader', { name: 'Documentation' }).scrollIntoViewIfNeeded();
    await expect(wide.getByRole('columnheader', { name: 'Documentation' })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('mobile-scroll.png') });
  });
}
