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

async function selectProject(page: Page, name: string) {
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await expect(page.locator('.project-search-trigger')).toContainText(name);
}

test('lists CodeAI reports only in its own project', async ({ page, request }) => {
  const stamp = Date.now();
  const self = await projectWith(request, `Self ${stamp}`, INSTALLATION);
  const elsewhere = await projectWith(request, `Elsewhere ${stamp}`, 'alpha');
  await page.goto('/');
  const image = await screenshot(page);
  await postReport(request, {
    note: `Seen elsewhere ${stamp}`, screenshot: image,
    context: { machineId: self.hostId, projectId: elsewhere.project.id, sessionId: elsewhere.session.id },
  });
  await postReport(request, { note: `No session ${stamp}`, screenshot: image });

  await selectProject(page, self.project.name);
  await page.locator('.repository-toggle').click();
  const sidePanel = page.locator('.repository-sidebar');
  await sidePanel.getByRole('button', { name: 'Reports', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'CodeAI reports' })).toBeVisible();
  const elsewhereRow = sidePanel.locator('.report-item').filter({ hasText: `Seen elsewhere ${stamp}` });
  await expect(elsewhereRow).toContainText(`Captured in ${elsewhere.project.name}`);
  await expect(elsewhereRow.locator('img')).toHaveJSProperty('complete', true);
  expect(await elsewhereRow.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(64);
  const row = sidePanel.locator('.report-item').filter({ hasText: `No session ${stamp}` });
  await expect(row).toContainText('Captured with no session selected');

  // Selecting a report opens its details and the full screenshot.
  await row.locator('.report-select').click();
  await expect(sidePanel.locator('.report-detail img')).toBeVisible();
  await expect(sidePanel.locator('.report-detail')).toContainText(`No session ${stamp}`);
  await sidePanel.getByRole('button', { name: '← All reports' }).click();

  // Any other project has no Reports tab.
  await selectProject(page, elsewhere.project.name);
  await page.locator('.repository-toggle').click();
  await expect(sidePanel.getByRole('button', { name: 'History', exact: true })).toBeVisible();
  await expect(sidePanel.getByRole('button', { name: 'Reports', exact: true })).toHaveCount(0);
});
