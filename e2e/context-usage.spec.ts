import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentProvider, CheckoutsResponse, DurableProject, PublicSession } from '../src/shared/types';

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
      await expect(conversation.getByRole('button', { name: 'Session agents', exact: true })).toBeEnabled();
      const saved = (await (await request.get(`/api/sessions/${session.id}`)).json()).session as PublicSession;
      expect(saved.participants.find(p => p.id === session.primaryAgentId)).toMatchObject({ contextUsage: { usedTokens: 40_000, contextWindow: 200_000 } });
      await page.reload();
      await expect(meter).toHaveAttribute('aria-valuenow', '20');
      await meter.focus();
      await expect(page.getByRole('tooltip')).toContainText('40,000 of 200,000 tokens');

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
  });
}
