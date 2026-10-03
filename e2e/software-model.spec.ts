import { expect, test } from '@playwright/test';
import type { CheckoutsResponse, DurableProject, PublicSession } from '../src/shared/types';

for (const theme of ['dark', 'light']) {
  test(`captures copyable LLM suggestions and completes rejected output in ${theme}`, async ({ page, request }) => {
    await page.addInitScript((value) => localStorage.setItem('code-ai:theme', value), theme);
    const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
    const { project } = await (await request.post('/api/projects', { data: {
      name: `Model ${theme} ${Date.now()}`, checkoutIds: [checkouts.find((checkout) => checkout.name === 'alpha')!.id],
    } })).json() as { project: DurableProject };
    const { session } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json() as { session: PublicSession };
    await page.goto('/');
    await page.locator('.project-search-trigger').click();
    await page.getByRole('option', { name: new RegExp(project.name) }).click();
    await page.getByRole('combobox', { name: 'All sessions', exact: true }).selectOption(session.id);
    const conversation = page.getByRole('complementary', { name: 'Conversation' });
    await conversation.getByLabel(/^Mode: /).click();
    await conversation.getByRole('radio', { name: 'Ask', exact: true }).click();
    await conversation.locator('textarea').fill('/model\nSoftware-model fixture');
    await conversation.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(conversation.getByText('Normal answer complete.', { exact: true })).toBeVisible();
    await expect(conversation.locator('.block-warning').first()).toContainText('LLM');
    await expect(conversation.locator('.block-warning').first()).toContainText('temporary');
    await expect(conversation.locator('.code-block code').first()).toContainText('codeai.software-model.v1');
    await expect(conversation.locator('.diagram-card')).toHaveCount(1);
    await conversation.locator('textarea').fill('/model\nMalformed software-model fixture');
    await conversation.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(conversation.getByText('Ordinary answer still complete.', { exact: true })).toBeVisible();
    await expect(conversation.locator('.block-warning').last()).toContainText('Software model rejected');
    const { session: saved } = await (await request.get(`/api/sessions/${session.id}`)).json() as { session: PublicSession };
    expect(saved.messages.map((message) => message.status)).toEqual(['sent', 'complete', 'sent', 'complete']);
    await page.reload();
    await expect(conversation.locator('.block-warning').first()).toContainText('LLM');
    await expect(conversation.locator('.block-warning').last()).toContainText('Software model rejected');
  });
}
