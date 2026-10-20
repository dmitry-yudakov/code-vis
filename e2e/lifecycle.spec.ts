import { expect, test } from '@playwright/test';
import type { CheckoutsResponse, DurableProject } from '../src/shared/types';

// The end-to-end server is plain `next start`, which no start:managed parent spawned (Story 64).
test('an unmanaged server offers no Build & restart, even in CodeAI’s own project, and refuses the request', async ({ page, request, baseURL }) => {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const installation = checkouts.find((item) => item.relativePath === 'installation')!;
  const name = `Own project ${Date.now()}`;
  const project = (await (await request.post('/api/projects', { data: { name, checkoutIds: [installation.id] } })).json()).project as DurableProject;
  await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } });

  expect(await (await request.get(`/api/codeai-lifecycle?projectId=${project.id}`)).json())
    .toEqual({ available: false, reason: 'not-managed' });
  const refused = await request.post('/api/codeai-lifecycle', {
    headers: { Origin: new URL(baseURL!).origin },
    data: { action: 'build-and-restart', projectId: project.id },
  });
  expect(refused.status()).toBe(409);
  expect((await refused.json()).error).toContain('npm run start:managed');
  expect((await (await request.get('/api/health')).json()).release).toEqual({ managed: false });

  await page.goto('/');
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await expect(page.locator('.project-search-trigger')).toContainText(name);
  await page.locator('.more-menu > button').click();
  await expect(page.locator('.desktop-picker-paper:visible').getByRole('button', { name: 'Export session' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Build & restart CodeAI' })).toHaveCount(0);
  await expect(page.locator('.lifecycle-pill')).toHaveCount(0);
});

test('a managed server’s control confirms, follows the build and restart, and reloads into the same project', async ({ page, request }, testInfo) => {
  const stamp = Date.now();
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const create = async (name: string, relativePath: string) => {
    const checkout = checkouts.find((item) => item.relativePath === relativePath)!;
    const project = (await (await request.post('/api/projects', { data: { name, checkoutIds: [checkout.id] } })).json()).project as DurableProject;
    await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } });
    return project;
  };
  const self = await create(`Managed self ${stamp}`, 'installation');
  // Newer, so an ordinary page load would open it instead.
  await create(`Opened first ${stamp}`, 'alpha');

  // This server is unmanaged; the route stands in for a managed one through a whole operation.
  const operationId = '5b0c9a1e-3f4d-4e2a-9b1c-2d3e4f5a6b7c';
  const snapshots = {
    idle: { available: true, phase: 'idle', releaseId: 'release-a' },
    building: { available: true, phase: 'building', releaseId: 'release-a', operationId, startedAt: new Date().toISOString() },
    restarting: { available: true, phase: 'restarting', releaseId: 'release-a', operationId, startedAt: new Date().toISOString(), candidateReleaseId: 'release-b' },
    done: {
      available: true, phase: 'idle', releaseId: 'release-b',
      lastOperation: { operationId, outcome: 'succeeded', finishedAt: new Date().toISOString() },
    },
    failed: {
      available: true, phase: 'idle', releaseId: 'release-a',
      lastOperation: { operationId, outcome: 'build-failed', finishedAt: new Date().toISOString(), detail: 'The build failed with exit code 1.' },
    },
  };
  let phase: keyof typeof snapshots | 'gone' = 'idle';
  let rejectNext = false;
  const posted: unknown[] = [];
  await page.route('**/api/codeai-lifecycle**', async (route) => {
    if (route.request().method() === 'POST') {
      posted.push(route.request().postDataJSON());
      if (rejectNext) {
        rejectNext = false;
        return route.fulfill({ status: 409, json: { error: 'Agent turns are queued or running.' } });
      }
      phase = 'building';
      return route.fulfill({ status: 202, json: { snapshot: snapshots.building } });
    }
    if (new URL(route.request().url()).searchParams.get('projectId') !== self.id) {
      return route.fulfill({ json: { available: false, reason: 'not-self-project' } });
    }
    if (phase === 'gone') return route.abort('connectionrefused');
    return route.fulfill({ json: snapshots[phase] });
  });

  await page.goto('/');
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(self.name) }).click();
  await expect(page.locator('.project-search-trigger')).toContainText(self.name);
  const menu = page.locator('.more-menu');
  const dialog = page.getByRole('dialog', { name: 'Build and restart CodeAI?' });
  for (const theme of ['Light', 'Dark']) {
    for (const viewport of [{ width: 960, height: 548 }, { width: 360, height: 640 }]) {
      await page.setViewportSize(viewport);
      await menu.locator(':scope > button').click();
      await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: theme, exact: true }).click();
      await page.getByRole('button', { name: 'Build & restart CodeAI' }).click();
      await expect(page.locator('.desktop-picker-paper:visible')).toHaveCount(0);
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAccessibleDescription(/from installation\?.*uncommitted changes included.*runs it on this machine.*VR session ends/);
      await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
      for (const element of [dialog, dialog.locator('#lifecycle-confirmation-description'),
        dialog.getByRole('button', { name: 'Cancel' }), dialog.getByRole('button', { name: 'Build and restart', exact: true })]) {
        await expect(element).toBeInViewport({ ratio: 1 });
      }
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`restart-${theme.toLowerCase()}-${viewport.width}.png`), animations: 'disabled' });
      if (viewport.width === 960) await dialog.getByRole('button', { name: 'Cancel' }).click();
      else await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(menu.locator(':scope > button')).toBeFocused();
      expect(posted).toEqual([]);
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  rejectNext = true;
  await menu.locator(':scope > button').click();
  await page.getByRole('button', { name: 'Build & restart CodeAI' }).click();
  await dialog.getByRole('button', { name: 'Build and restart', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.toast').filter({ hasText: 'Agent turns are queued or running.' })).toHaveAttribute('data-tone', 'error');
  await expect(page.locator('.lifecycle-pill')).toHaveCount(0);
  const buildRequest = { action: 'build-and-restart', projectId: self.id };
  expect(posted).toEqual([buildRequest]);
  await menu.locator(':scope > button').click();
  await page.getByRole('button', { name: 'Build & restart CodeAI' }).click();
  await dialog.getByRole('button', { name: 'Build and restart', exact: true }).click();
  await expect(page.locator('.lifecycle-pill')).toContainText('Building CodeAI');
  phase = 'failed';
  const failure = page.locator('.toast').filter({ hasText: 'The build failed with exit code 1.' });
  await expect(failure).toHaveAttribute('data-tone', 'error');
  await expect(failure).toContainText('The current release is still running.');
  await expect(page.locator('.lifecycle-pill')).toHaveCount(0);
  phase = 'idle';
  await menu.locator(':scope > button').click();
  await expect(page.locator('.desktop-picker-paper:visible').getByRole('status')).toContainText('Serving release release-a.');
  await page.locator('.desktop-picker-paper:visible').getByRole('button', { name: 'Build & restart CodeAI' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('from installation?');
  await expect(dialog).toContainText('runs it on this machine');
  expect(posted).toEqual([buildRequest, buildRequest]);
  await dialog.getByRole('button', { name: 'Build and restart', exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(page.locator('.lifecycle-pill')).toContainText('Building CodeAI');
  expect(posted).toEqual([buildRequest, buildRequest, buildRequest]);
  // New turns wait for the restart, and the draft stays.
  const composer = page.getByPlaceholder(/Ask anything about this project/);
  await composer.fill('Kept for after the restart');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.toast').filter({ hasText: 'building a new release of itself' })).toHaveAttribute('data-tone', 'warning');
  await expect(composer).toHaveValue('Kept for after the restart');

  phase = 'restarting';
  await expect(page.locator('.lifecycle-pill')).toContainText('Restarting CodeAI', { timeout: 10_000 });
  phase = 'gone';
  await page.evaluate(() => { (window as Window & { beforeRestart?: boolean }).beforeRestart = true; });
  await page.waitForTimeout(2_500);
  expect(await page.evaluate(() => (window as Window & { beforeRestart?: boolean }).beforeRestart)).toBe(true);
  phase = 'done';
  await expect.poll(() => page.evaluate(() => (window as Window & { beforeRestart?: boolean }).beforeRestart ?? false), { timeout: 15_000 }).toBe(false);

  // The reloaded page returns to the project it was showing and says what happened.
  await expect(page.locator('.project-search-trigger')).toContainText(self.name);
  await expect(page.getByPlaceholder(/Ask anything about this project/)).toHaveValue('Kept for after the restart');
  await menu.locator(':scope > button').click();
  await expect(page.locator('.desktop-picker-paper:visible').getByRole('status')).toContainText('Serving release release-b.');
  await expect(page.locator('.desktop-picker-paper:visible').getByRole('status')).toContainText('the new release is running');
  await expect(page.locator('.lifecycle-pill')).toHaveCount(0);
  expect(posted).toHaveLength(3);
});
