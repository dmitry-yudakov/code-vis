import { expect, test } from '@playwright/test';
import type { CheckoutsResponse, DurableProject } from '../src/shared/types';
import { LIFECYCLE_REQUEST_TIMEOUT_MS, RECONNECT_LIMIT_MS } from '../src/features/lifecycle/lifecycleFlow';

for (const theme of ['light', 'dark']) for (const width of [960, 360]) {
  test(`restart preparation and failed-build suspension remain clear in ${theme} at ${width}px`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 640 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
    const { project } = await (await request.post('/api/projects', { data: {
      name: `Restart suspension ${theme} ${width} ${Date.now()}`, checkoutIds: [checkouts.find(item => item.relativePath === 'alpha')!.id],
    } })).json();
    const { session } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json();
    let phase: 'idle' | 'suspending' | 'paused' = 'idle';
    const operationId = 'b0571d1a-b249-4cbd-8f5e-630390f2d320';
    await page.route('**/api/codeai-lifecycle**', route => {
      if (route.request().method() === 'POST') phase = 'suspending';
      const snapshot = { available: true, releaseId: 'old-release', phase,
        ...(phase === 'idle' ? {} : { operationId, startedAt: new Date().toISOString() }),
        ...(phase === 'paused' ? { detail: 'The build failed. Sessions remain suspended; fix the build and retry or restart CodeAI from the terminal.' } : {}),
      };
      return route.fulfill({ status: route.request().method() === 'POST' ? 202 : 200,
        json: route.request().method() === 'POST' ? { snapshot } : snapshot });
    });
    await page.goto(`/?session=${session.id}`);
    await page.locator('.more-menu > button').click();
    await page.getByRole('button', { name: 'Build & restart CodeAI' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Active work pauses and continues after restart');
    await dialog.getByRole('button', { name: 'Build and restart', exact: true }).click();
    await expect(dialog).toContainText('Waiting for active responses and commands to pause');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`suspending-${theme}-${width}.png`), animations: 'disabled' });
    phase = 'paused';
    await expect(dialog.getByRole('alert')).toContainText('Sessions remain suspended');
    await expect(dialog.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`paused-${theme}-${width}.png`), animations: 'disabled' });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toBeHidden();
  });
}

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

test('a managed server confirms and blocks the UI through build, failure, restart and reload from an ordinary chat', async ({ page, request }, testInfo) => {
  const stamp = Date.now();
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const create = async (name: string, relativePath: string) => {
    const checkout = checkouts.find((item) => item.relativePath === relativePath)!;
    const project = (await (await request.post('/api/projects', { data: { name, checkoutIds: [checkout.id] } })).json()).project as DurableProject;
    await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } });
    return project;
  };
  const self = await create(`Ordinary chat ${stamp}`, 'alpha');
  // Newer, so an ordinary page load would open it instead.
  await create(`Opened first ${stamp}`, 'installation');

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
      await expect(dialog).toHaveAccessibleDescription(/from the installed CodeAI checkout\?.*uncommitted changes included.*runs it on this machine.*VR session ends/);
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
  await page.getByPlaceholder(/Ask anything about this project/).fill('Kept for after the restart');
  rejectNext = true;
  await menu.locator(':scope > button').click();
  await page.getByRole('button', { name: 'Build & restart CodeAI' }).click();
  await dialog.getByRole('button', { name: 'Build and restart', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Agent turns are queued or running.');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.lifecycle-pill')).toHaveCount(0);
  const buildRequest = { action: 'build-and-restart' };
  expect(posted).toEqual([buildRequest]);
  await menu.locator(':scope > button').click();
  await page.getByRole('button', { name: 'Build & restart CodeAI' }).click();
  await dialog.getByRole('button', { name: 'Build and restart', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Building CodeAI');
  phase = 'failed';
  const failure = page.getByRole('dialog').getByRole('alert');
  await expect(failure).toContainText('The build failed with exit code 1.');
  await expect(failure).toContainText('The current release is still running.');
  await expect(page.locator('.lifecycle-pill')).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('from the installed CodeAI checkout?');
  await expect(dialog).toContainText('runs it on this machine');
  expect(posted).toEqual([buildRequest, buildRequest]);
  await dialog.getByRole('button', { name: 'Build and restart', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Building CodeAI');
  expect(posted).toEqual([buildRequest, buildRequest, buildRequest]);
  // The active modal blocks background actions, Escape, and backdrop dismissal.
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
  await expect(page.getByRole('dialog')).toContainText('Building CodeAI');
  await expect(page.getByRole('dialog').getByRole('button')).toHaveCount(0);
  const blocked = await menu.locator(':scope > button').click({ timeout: 500 }).then(() => false, () => true);
  expect(blocked).toBe(true);
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('.MuiDialog-root')))).toBe(true);

  phase = 'restarting';
  await expect(page.getByRole('dialog')).toContainText('Restarting CodeAI', { timeout: 10_000 });
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

for (const theme of ['light', 'dark']) {
  for (const width of [1280, 360]) {
    test(`restart is available from Arena without a selected project and keeps submission and progress in the modal, ${theme}, ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 640 });
      await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
      await page.route('**/api/projects', route => route.fulfill({ json: { projects: [] } }));
      const building = {
        available: true, phase: 'building', releaseId: 'release-a',
        operationId: '5b0c9a1e-3f4d-4e2a-9b1c-2d3e4f5a6b7c', startedAt: new Date().toISOString(),
      };
      let releaseRequest!: () => void;
      const requestGate = new Promise<void>(resolve => { releaseRequest = resolve; });
      const posted: unknown[] = [];
      await page.route('**/api/codeai-lifecycle**', async route => {
        expect(new URL(route.request().url()).pathname).toBe('/api/codeai-lifecycle');
        expect(new URL(route.request().url()).search).toBe('');
        if (route.request().method() === 'POST') {
          posted.push(route.request().postDataJSON());
          await requestGate;
          return route.fulfill({ status: 202, json: { snapshot: building } });
        }
        return route.fulfill({ json: posted.length ? building : { available: true, phase: 'idle', releaseId: 'release-a' } });
      });
      await page.goto('/arena');
      await expect(page.getByRole('main', { name: 'Arena', exact: true })).toBeVisible();
      await page.locator('.more-menu > button').click();
      await page.getByRole('button', { name: 'Build & restart CodeAI' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Build and restart', exact: true }).click();
      await expect(dialog).toContainText('Starting build');
      await page.keyboard.press('Escape');
      await page.mouse.click(5, 5);
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button')).toHaveCount(0);
      expect(posted).toEqual([{ action: 'build-and-restart' }]);
      releaseRequest();
      await expect(dialog).toContainText('Building CodeAI');
      await expect(dialog.getByRole('progressbar')).toBeVisible();
      await expect(dialog).toBeInViewport({ ratio: 1 });
      await expect(dialog.locator('#lifecycle-confirmation-description')).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: testInfo.outputPath(`restart-progress-${theme}-${width}.png`), animations: 'disabled' });
      // A page opened mid-build adopts the same blocking progress without another request.
      await page.reload();
      await expect(dialog).toContainText('Building CodeAI');
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      expect(posted).toHaveLength(1);
    });
  }
}

test('progress discovered while More is open blocks its controls too', async ({ page }) => {
  let building = false;
  await page.route('**/api/codeai-lifecycle**', route => route.fulfill({ json: building ? {
    available: true, phase: 'building', releaseId: 'release-a',
    operationId: '5b0c9a1e-3f4d-4e2a-9b1c-2d3e4f5a6b7c', startedAt: new Date().toISOString(),
  } : { available: true, phase: 'idle', releaseId: 'release-a' } }));
  await page.goto('/arena');
  await expect(page.getByRole('main', { name: 'Arena', exact: true })).toBeVisible();
  building = true;
  await page.locator('.more-menu > button').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Building CodeAI');
  const settings = page.getByRole('button', { name: 'Machine settings', exact: true });
  const blocked = await settings.click({ timeout: 500 }).then(() => false, () => true);
  expect(blocked).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
});

test('an uncertain submission reconciles progress and stalled reconnect requests eventually allow recovery', async ({ page }) => {
  const building = {
    available: true, phase: 'building', releaseId: 'release-a',
    operationId: '5b0c9a1e-3f4d-4e2a-9b1c-2d3e4f5a6b7c', startedAt: new Date().toISOString(),
  };
  let posted = 0;
  let stallReads = false;
  let stalledReads = 0;
  let releaseRequests!: () => void;
  const gate = new Promise<void>(resolve => { releaseRequests = resolve; });
  await page.route('**/api/codeai-lifecycle**', async route => {
    if (route.request().method() === 'POST' || stallReads) {
      if (route.request().method() === 'POST') posted += 1;
      else stalledReads += 1;
      await gate;
      await route.abort().catch(() => undefined);
      return;
    }
    return route.fulfill({ json: posted ? building : { available: true, phase: 'idle', releaseId: 'release-a' } });
  });
  try {
    await page.goto('/arena');
    await expect(page.getByRole('main', { name: 'Arena', exact: true })).toBeVisible();
    await page.clock.install();
    await page.locator('.more-menu > button').click();
    await page.getByRole('button', { name: 'Build & restart CodeAI' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Build and restart', exact: true }).click();
    await expect(dialog).toContainText('Starting build');
    await page.clock.fastForward(LIFECYCLE_REQUEST_TIMEOUT_MS + 1);
    await expect(dialog).toContainText('Building CodeAI');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    expect(posted).toBe(1);
    stallReads = true;
    await page.clock.fastForward(2_001);
    await expect.poll(() => stalledReads).toBe(1);
    await page.clock.fastForward(LIFECYCLE_REQUEST_TIMEOUT_MS + 1);
    await expect(dialog).toContainText('Restarting CodeAI');
    const now = await page.evaluate(() => Date.now());
    await page.clock.setSystemTime(now + RECONNECT_LIMIT_MS + 1);
    await page.clock.fastForward(1_001);
    await expect.poll(() => stalledReads).toBe(2);
    await page.clock.fastForward(LIFECYCLE_REQUEST_TIMEOUT_MS + 1);
    await expect(dialog.getByRole('alert')).toContainText('did not come back within five minutes');
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
    stallReads = false;
    await dialog.getByRole('button', { name: 'Check again', exact: true }).click();
    await expect(dialog).toContainText('Building CodeAI');
    expect(posted).toBe(1);
  } finally {
    releaseRequests();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
