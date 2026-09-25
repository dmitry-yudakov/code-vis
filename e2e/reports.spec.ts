import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { CheckoutsResponse, DurableProject, PublicSession } from '../src/shared/types';

/** The fixture checkout the end-to-end server names as its installation (playwright.config.ts). */
const INSTALLATION = 'installation';

async function projectWith(request: APIRequestContext, name: string, relativePath: string) {
  const { checkouts, hostId } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const checkout = checkouts.find((item) => item.relativePath === relativePath)!;
  const project = (await (await request.post('/api/projects', { data: { name, checkoutIds: [checkout.id] } })).json()).project as DurableProject;
  const session = (await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json()).session as PublicSession;
  return { project, session, hostId };
}

/** A real JPEG, drawn by the browser, so previews decode as they do from the headset. */
async function screenshot(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 48;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#3366cc'; context.fillRect(0, 0, 64, 48);
    return canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
  });
}

async function postReport(request: APIRequestContext, fields: Record<string, unknown>) {
  const response = await request.post('/api/immersive/report', { data: {
    version: 1, kind: 'capture', at: new Date().toISOString(), browser: 'E2E headset',
    errors: [], diagnostics: { version: 1, browser: 'E2E headset', events: [] }, ...fields,
  } });
  expect(response.ok()).toBe(true);
  return (await response.json() as { name: string }).name;
}

test.afterEach(async ({ request }) => {
  const active = ((await (await request.get('/api/agent/runs')).json()) as { active?: Array<{ runId: string }> }).active || [];
  await Promise.all(active.map((run) => request.post('/api/agent/cancel', { data: { runId: run.runId } })));
});

async function selectProject(page: Page, name: string) {
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await expect(page.locator('.project-search-trigger')).toContainText(name);
}

test('lists CodeAI reports only in its own project, and attaches one to an explained message', async ({ page, request }) => {
  const stamp = Date.now();
  const self = await projectWith(request, `Self ${stamp}`, INSTALLATION);
  const elsewhere = await projectWith(request, `Elsewhere ${stamp}`, 'alpha');
  await page.goto('/');
  const image = await screenshot(page);
  await postReport(request, {
    note: `Seen elsewhere ${stamp}`, screenshot: image,
    context: { machineId: self.hostId, projectId: elsewhere.project.id, sessionId: elsewhere.session.id },
  });
  const unplaced = await postReport(request, { note: `No session ${stamp}`, screenshot: image });

  // The composer's attach menu reaches the Reports view in CodeAI's own project.
  await selectProject(page, self.project.name);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  const attach = conversation.getByLabel('Attach', { exact: true });
  await attach.click();
  await conversation.getByRole('menu', { name: 'Attach to the next instruction' }).getByRole('menuitem', { name: 'Headset report…' }).click();
  const sidePanel = page.locator('.repository-sidebar');
  await expect(page.getByRole('complementary', { name: 'CodeAI reports' })).toBeVisible();
  await expect(sidePanel.getByRole('button', { name: 'Reports', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const elsewhereRow = sidePanel.locator('.report-item').filter({ hasText: `Seen elsewhere ${stamp}` });
  await expect(elsewhereRow).toContainText(`Captured in ${elsewhere.project.name}`);
  await expect(elsewhereRow.locator('img')).toHaveJSProperty('complete', true);
  expect(await elsewhereRow.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(64);
  const row = sidePanel.locator('.report-item').filter({ hasText: `No session ${stamp}` });
  await expect(row).toContainText('Captured with no session selected');

  await row.locator('.report-select').click();
  await expect(sidePanel.locator('.report-detail img')).toBeVisible();
  await sidePanel.getByRole('button', { name: 'Attach next' }).click();
  await expect(page.locator('.attachment-chip.report')).toContainText('CodeAI report · Capture');

  const composer = page.locator('.instruction-composer textarea');
  await composer.fill('The panel at the right is clipped.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.chat-message.assistant').last()).toContainText('Report files: report-1.jpg, report-1.json, report-attachments.json.');
  await expect(page.locator('.chat-message.user .message-attachments.report')).toHaveText('1 CodeAI report attached · screenshot');
  await expect(page.locator('.attachment-chip.report')).toHaveCount(0);
  const userMessages = async () => ((await (await request.get(`/api/sessions/${self.session.id}`)).json()).session as PublicSession)
    .messages.filter((message) => message.role === 'user');
  const stored = (await (await request.get(`/api/sessions/${self.session.id}`)).json()).session as PublicSession;
  expect(stored.version).toBe(5);
  expect(stored.messages[0]).toMatchObject({
    role: 'user', text: 'The panel at the right is clipped.',
    reportAttachments: [{ reportId: unplaced, kind: 'capture', screenshotIncluded: true, errorCount: 0 }],
  });

  // A failed send keeps the draft and the attachment; a report alone is a complete instruction.
  await sidePanel.getByRole('button', { name: '← All reports' }).click();
  await elsewhereRow.getByRole('button', { name: 'Attach next' }).click();
  await composer.fill('Draft kept');
  let outages = 1;
  await page.route('**/api/agent/message', (route) => outages-- > 0
    ? route.fulfill({ status: 503, json: { error: 'Simulated outage.' } }) : route.fallback());
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Simulated outage.' })).toBeVisible();
  await expect(composer).toHaveValue('Draft kept');
  await expect(page.locator('.attachment-chip.report')).toHaveCount(1);
  await composer.fill('');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(async () => (await userMessages()).length).toBe(2);
  expect((await userMessages())[1]).toMatchObject({
    text: 'Investigate the attached CodeAI report.', reportAttachments: [{ kind: 'capture', screenshotIncluded: true }],
  });
  await expect(page.locator('.attachment-chip.report')).toHaveCount(0);

  // Retry brings back a message's reports along with its text.
  await elsewhereRow.getByRole('button', { name: 'Attach next' }).click();
  await composer.fill('Wait for reload cancellation.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const cancelled = page.locator('.chat-message.user.cancelled');
  await expect(cancelled).toHaveCount(1);
  await expect(cancelled.locator('.message-attachments.report')).toHaveText('1 CodeAI report attached · screenshot');
  await page.getByRole('button', { name: 'Remove report attachment' }).click();
  await composer.fill('');
  await cancelled.getByRole('button', { name: 'Retry' }).click();
  await expect(composer).toHaveValue('Wait for reload cancellation.');
  await expect(page.locator('.attachment-chip.report')).toHaveCount(1);

  // Any other project has no Reports tab, and the attach menu offers no report.
  await selectProject(page, elsewhere.project.name);
  await page.locator('.repository-toggle').click();
  await expect(sidePanel.getByRole('button', { name: 'History', exact: true })).toBeVisible();
  await expect(sidePanel.getByRole('button', { name: 'Reports', exact: true })).toHaveCount(0);
  await attach.click();
  const attachMenu = conversation.getByRole('menu', { name: 'Attach to the next instruction' });
  await expect(attachMenu.getByRole('menuitem', { name: 'New sketch' })).toBeVisible();
  await expect(attachMenu.getByRole('menuitem', { name: 'Headset report…' })).toHaveCount(0);
});
