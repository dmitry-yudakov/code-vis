import { expect, test, fulfillArenaSnapshot, type APIRequestContext, type Page } from './arena-stream';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentProvider, ArenaSnapshot, CheckoutsResponse, DurableProject, PublicSession } from '../src/shared/types';

async function openSession(page: Page, request: APIRequestContext, provider: AgentProvider = 'claude') {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const { project } = await (await request.post('/api/projects', { data: {
    name: `Context usage ${Date.now()}`, checkoutIds: [checkouts.find(item => item.name === 'alpha')!.id],
  } })).json() as { project: DurableProject };
  const { session } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider } })).json() as { session: PublicSession };
  await page.goto('/');
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(project.name) }).click();
  await expect(page.getByRole('combobox', { name: 'All sessions', exact: true })).toHaveValue(session.id);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await expect(conversation).toBeVisible();
  return { session, conversation };
}

test('offline Arena context remains inspectable without restoring session navigation', async ({ page, request }) => {
  const { session } = await openSession(page, request);
  const snapshot = (await (await request.get('/api/arena')).json()) as ArenaSnapshot;
  const owner = snapshot.machines.find(machine => machine.sessions.some(item => item.id === session.id))!;
  owner.machine.state = 'offline';
  const summary = owner.sessions.find(item => item.id === session.id)!;
  summary.title = 'Offline context session';
  summary.agents[0].contextUsage = { usedTokens: 40_000, contextWindow: 200_000 };
  await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
  await page.goto('/arena');
  const card = page.getByRole('main', { name: 'Arena' }).locator('.arena-card').filter({ hasText: summary.title });
  const row = card.locator('.arena-card-open');
  await expect(row).toBeDisabled();
  await expect(row).not.toHaveAttribute('href');
  const meter = row.getByRole('meter', { name: /@Claude context:/ });
  await meter.hover();
  await expect(page.getByRole('tooltip')).toContainText('20% used');
  await meter.click({ button: 'middle', force: true });
  await expect(page).toHaveURL(/\/arena$/);
  expect(page.context().pages()).toHaveLength(1);
});

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1280, 390]) {
    test(`${theme} ${width}px: context follows live Claude work, reloads and selected participants`, async ({ page, request }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(theme => localStorage.setItem('code-ai:theme', theme), theme);
      const { session, conversation } = await openSession(page, request);
      const unknown = conversation.getByRole('img', { name: '@Claude context: not reported yet', exact: true });
      await expect(unknown).toBeVisible();
      await unknown.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(page.getByRole('tooltip')).toContainText('Available after the provider reports usage.');
      await conversation.getByRole('textbox', { name: 'Instruction', exact: true }).fill('[context-usage] Report current context.');
      await conversation.getByRole('button', { name: 'Send', exact: true }).click();
      const meter = conversation.getByRole('meter', { name: /@Claude context:/ });
      await expect(meter).toHaveAttribute('aria-valuenow', '20');
      await expect(meter).toHaveText('');
      expect((await meter.locator('.MuiCircularProgress-root').first().boundingBox())!.width).toBe(14);
      await expect(conversation.getByRole('button', { name: 'Session agents', exact: true })).toBeEnabled();
      const saved = (await (await request.get(`/api/sessions/${session.id}`)).json()).session as PublicSession;
      expect(saved.participants.find(p => p.id === session.primaryAgentId)).toMatchObject({ contextUsage: { usedTokens: 40_000, contextWindow: 200_000 } });
      await page.reload();
      await expect(meter).toHaveAttribute('aria-valuenow', '20');
      await meter.focus();
      await expect(page.getByRole('tooltip')).toContainText('40,000 of 200,000 tokens');
      await expect(page.getByRole('tooltip')).toContainText('20% used');

      // The next turn can reuse capacity for this exact reporting model while it works.
      await conversation.getByRole('textbox', { name: 'Instruction', exact: true }).fill('[context-usage] Check again.');
      await conversation.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(meter).toHaveAttribute('aria-valuenow', '75');
      await expect(meter).toHaveAttribute('aria-valuenow', '20');
      await expect(conversation.getByRole('button', { name: 'Session agents', exact: true })).toBeEnabled();

      const response = await request.post(`/api/sessions/${session.id}/participants`, { data: { provider: 'claude', role: 'reviewer', requestId: crypto.randomUUID() } });
      expect(response.status()).toBe(201);
      await page.reload();
      await expect(meter).toHaveAttribute('aria-valuenow', '20');
      await conversation.getByRole('button', { name: 'Session agents', exact: true }).click();
      await page.getByRole('button', { name: '@Claude Reviewer · Reviewer', exact: true }).click();
      await expect(conversation.getByRole('img', { name: '@Claude Reviewer context: not reported yet', exact: true })).toBeVisible();
      await conversation.getByRole('button', { name: 'Session agents', exact: true }).click();
      await page.getByRole('button', { name: '@Claude · Coder · Main', exact: true }).click();
      await expect(meter).toHaveAttribute('aria-valuenow', '20');

      const bounds = await conversation.locator('.participant-controls').evaluate(element => {
        const parent = element.getBoundingClientRect();
        return [...element.children].map(child => {
          const rect = child.getBoundingClientRect();
          return { left: rect.left - parent.left, right: rect.right - parent.right };
        });
      });
      for (const bound of bounds) { expect(bound.left).toBeGreaterThanOrEqual(-1); expect(bound.right).toBeLessThanOrEqual(1); }
      await page.screenshot({ path: `test-results/context-usage-${theme}-${width}.png` });

      await page.goto('/arena');
      const arena = page.getByRole('main', { name: 'Arena' });
      const link = arena.locator(`.arena-card-open[href*="${session.id}"]`);
      const arenaMeter = link.getByRole('meter', { name: /@Claude context:/ });
      await expect(arenaMeter).toHaveAttribute('aria-valuenow', '20');
      await expect(arenaMeter).toHaveText('');
      await expect(link.getByRole('img', { name: '@Claude Reviewer context: not reported yet', exact: true })).toBeVisible();
      await expect(link.locator('[tabindex]')).toHaveCount(0);
      await arenaMeter.hover();
      await expect(page.getByRole('tooltip')).toContainText('20% used, 40,000 of 200,000 tokens');
      await expect(page).toHaveURL(/\/arena$/);
      const provider = arenaMeter.locator('..');
      await expect(provider).toHaveText('Claude');
      const [providerBounds, meterBounds] = await Promise.all([provider.boundingBox(), arenaMeter.boundingBox()]);
      expect(meterBounds!.x + meterBounds!.width).toBeLessThanOrEqual(providerBounds!.x + providerBounds!.width + 1);
      expect(await arena.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: `test-results/arena-context-${theme}-${width}.png` });
      await arena.getByRole('heading', { name: 'Arena', exact: true }).hover();
      await link.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(link).toBeFocused();
      const rowTooltip = page.getByRole('tooltip').filter({ hasText: 'Claude Reviewer context: not reported yet' });
      await expect(rowTooltip).toContainText('20% used');
      // Context remains informative without taking over the row's navigation action.
      await link.click();
      await expect(page.getByRole('combobox', { name: 'All sessions', exact: true })).toHaveValue(session.id);
    });
  }

  test(`${theme}: saved Codex reports render the percentage for their own session`, async ({ page, request }) => {
    await page.addInitScript(theme => localStorage.setItem('code-ai:theme', theme), theme);
    const { session, conversation } = await openSession(page, request, 'codex');
    const filename = path.resolve('test-results/server-data/session-store-v2/sessions', `${session.id}.json`);
    const raw = JSON.parse(await readFile(filename, 'utf8'));
    raw.version = 14;
    raw.participants.find((p: { id: string }) => p.id === session.primaryAgentId).contextUsage = { usedTokens: 160_000, contextWindow: 200_000 };
    await writeFile(filename, JSON.stringify(raw));
    await page.reload();
    const meter = conversation.getByRole('meter', { name: /@Codex context:/ });
    await expect(meter).toHaveAttribute('aria-valuenow', '80');
    await meter.focus();
    await expect(page.getByRole('tooltip')).toContainText('160,000 of 200,000 tokens');
    await expect(meter).toHaveText('');
    await page.goto('/arena');
    const arena = page.getByRole('main', { name: 'Arena' });
    const link = arena.locator(`.arena-card-open[href*="${session.id}"]`);
    await expect(link.getByRole('meter', { name: /@Codex context:/ })).toHaveAttribute('aria-valuenow', '80');
    // Archived sessions use the same provider facts and retain a keyboard-focusable indicator.
    const current = (await (await request.get(`/api/sessions/${session.id}`)).json()).session as PublicSession;
    expect((await request.post(`/api/sessions/${session.id}/archive`, { data: { expectedRevision: current.revision } })).ok()).toBe(true);
    await page.goto('/arena/archived');
    const card = arena.locator('.arena-card.archived').filter({ hasText: session.title });
    const archivedMeter = card.getByRole('meter', { name: /@Codex context:/ });
    await expect(archivedMeter).toHaveAttribute('aria-valuenow', '80');
    await expect(archivedMeter).toHaveAttribute('tabindex', '0');
    await archivedMeter.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('tooltip')).toContainText('80% used');
  });
}
