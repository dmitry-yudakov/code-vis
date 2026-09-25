import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const WORKSPACE_NAME = `E2E workspace ${Date.now()}`;

test.afterEach(async ({ request }) => {
  const discovery = await request.get('/api/agent/runs');
  const active = (await discovery.json() as { active?: Array<{ runId: string }> }).active || [];
  await Promise.all(active.map((run) => request.post('/api/agent/cancel', { data: { runId: run.runId } })));
  await expect.poll(async () => {
    const response = await request.get('/api/agent/runs');
    return ((await response.json() as { active?: unknown[] }).active || []).length;
  }, { timeout: 10_000 }).toBe(0);
});

async function startSession(page: Page) {
  const openViews = page.getByRole('tab');
  const before = await openViews.count();
  const dismissNotice = page.getByRole('button', { name: 'Dismiss notice' });
  await page.locator('.new-session-menu summary').click();
  const start = page.getByRole('button', { name: 'Start session' });
  let clicked = false;
  for (let attempt = 0; attempt < 10 && !clicked; attempt += 1) {
    if (await dismissNotice.isVisible()) await dismissNotice.click();
    try {
      await start.click({ timeout: 500 });
      clicked = true;
    } catch {
      await page.waitForTimeout(100);
    }
  }
  expect(clicked).toBe(true);
  await expect(openViews).toHaveCount(before + 1);
  // The conversation is already open, so its composer can be typed into before the new session
  // replaces the old one. The menu closes once creation has been applied.
  await expect(page.locator('.new-session-menu[open]')).toHaveCount(0);
}

/** The header's Conversation layout icon; while it is closed its name adds approvals or unread. */
function conversationToggle(page: Page) {
  return page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: /^Conversation/ });
}

async function ensureConversationOpen(page: Page) {
  if (!await page.getByRole('complementary', { name: 'Conversation' }).count()) await conversationToggle(page).click();
}

async function openConversation(page: Page) {
  await expect(conversationToggle(page)).toHaveAttribute('aria-pressed', 'false');
  await conversationToggle(page).click();
  await expect(page.getByRole('complementary', { name: 'Conversation' })).toBeVisible();
}

async function closeConversation(page: Page) {
  await expect(conversationToggle(page)).toHaveAttribute('aria-pressed', 'true');
  await conversationToggle(page).click();
  await expect(page.getByRole('complementary', { name: 'Conversation' })).toHaveCount(0);
}

async function createWorkspace(page: Page) {
  await createNamedProject(page, WORKSPACE_NAME);
}

async function createNamedProject(page: Page, name: string) {
  await page.locator('.project-search-trigger').click();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill(name);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.locator('.project-search-trigger')).toContainText(name);
}

/** The composer's mode picker shows the mode; its accessible name adds the mode's hint. */
function modePicker(scope: Page | Locator) {
  return scope.getByLabel(/^Mode: /);
}

async function chooseMode(scope: Page | Locator, name: 'Ask' | 'Plan' | 'Agent') {
  await modePicker(scope).click();
  await scope.getByRole('radiogroup', { name: 'Agent mode' }).getByRole('radio', { name, exact: true }).click();
  await expect(modePicker(scope)).toHaveText(name);
}

/** The activity bar: the session's side-panel views, the Arena and Inbox links, and More. */
function activityBar(page: Page) {
  return page.getByRole('navigation', { name: 'Views' });
}

function activityView(page: Page, name: 'Changes' | 'History' | 'Reports') {
  return activityBar(page).getByRole('button', { name: new RegExp(`^${name}`) });
}

/** Theme and export live in More, the activity bar's gear, which stays open until toggled again. */
async function fromMoreMenu(page: Page, name: string) {
  const menu = page.locator('.more-menu');
  await menu.locator('summary').click();
  await menu.getByRole('button', { name, exact: true }).click();
  await menu.locator('summary').click();
}

/** The side panel starts closed unless the session has no repository yet. */
async function openRepositoryPanel(page: Page) {
  const changes = activityView(page, 'Changes');
  if (await changes.getAttribute('aria-pressed') !== 'true') await changes.click();
}

async function attachRepository(page: Page, name: string) {
  await openRepositoryPanel(page);
  const manager = page.getByRole('region', { name: 'Session repositories' });
  // A single repository collapses the manager; attaching another starts by opening it.
  if (!await manager.locator('details').evaluate((details: HTMLDetailsElement) => details.open)) await manager.locator('summary').click();
  await manager.getByRole('combobox', { name: 'Repository to add' }).selectOption({ label: name });
  await manager.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(manager.locator('.repository-binding').filter({ hasText: name })).toHaveCount(1);
}

async function ensureRepository(page: Page) {
  await openRepositoryPanel(page);
  const manager = page.getByRole('region', { name: 'Session repositories' });
  if (!await manager.locator('.repository-binding').count()) await attachRepository(page, 'alpha');
}

async function persistedSpatialLayout(page: Page) {
  return page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('code-ai:device:v1:workspace') || '{}') as {
      scopes?: Record<string, { views?: Record<string, {
        surface?: string;
        activeDiagramId?: string;
        spatial?: unknown;
      }> }>;
    };
    const view = Object.values(stored.scopes || {}).flatMap((scope) => Object.values(scope.views || {}))
      .find((candidate) => candidate.surface === 'spatial');
    return view ? { activeDiagramId: view.activeDiagramId, surface: view.surface, spatial: view.spatial } : null;
  });
}

test('creates, annotates, revises, restores, and exports a canvas session', async ({ page }) => {
  const externalFontRequests: string[] = [];
  page.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com') externalFontRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /No project/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe('loaded');
  const fontVariables = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return ['--font-geist', '--font-geist-mono', '--font-archivo']
      .map((name) => styles.getPropertyValue(name).trim());
  });
  expect(fontVariables.every(Boolean)).toBe(true);
  expect(externalFontRequests).toEqual([]);
  await createWorkspace(page);
  await startSession(page);
  await attachRepository(page, 'packages/deep-app');
  await attachRepository(page, 'alpha');
  await attachRepository(page, 'beta');
  const repositoryManager = page.getByRole('region', { name: 'Session repositories' });
  await expect(repositoryManager.locator('.repository-binding')).toHaveCount(3);
  await repositoryManager.getByRole('button', { name: 'Move beta up' }).dblclick();
  await expect(repositoryManager.locator('.repository-binding strong')).toHaveText([
    'beta', 'packages/deep-app', 'alpha',
  ]);

  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await expect(conversation).toBeVisible();

  const composer = page.getByPlaceholder(/Ask anything about this project/);
  await composer.fill('Draw a simple architecture');
  await page.getByRole('button', { name: 'Send' }).click();
  // Transient tool activity is visible while the run is in flight and gone afterwards.
  const timeline = page.locator('.tool-timeline');
  await expect(timeline).toBeVisible();
  await expect(timeline).toContainText('Reading README.md');
  await expect(timeline).toContainText('Searching architecture in src');
  await expect(page.locator('.run-ribbon')).toHaveClass(/working/);
  await expect(page.locator('.run-ribbon-tick')).not.toHaveCount(0);
  await expect(page.locator('.diagram-canvas-shell')).toBeVisible();
  await expect(timeline).toHaveCount(0);
  await expect(page.locator('.run-ribbon')).toHaveClass(/idle/);
  await expect(page.locator('.run-ribbon-tick')).toHaveCount(0);
  await expect(page.locator('.mermaid-layer svg')).toBeVisible();
  await expect(page.locator('.canvas-titleblock strong')).toHaveText('Diagram 1');
  // An unannotated canvas states its identity and nothing else — a "0 marks" count is noise.
  await expect(page.locator('.canvas-titleblock')).not.toContainText('mark');
  await expect(page.locator('.app-header')).toHaveCSS('height', '48px');

  // At desktop width both panels are real columns, and Fit targets the unobstructed canvas rect.
  await expect(page.locator('.app-shell')).toHaveClass(/dock-capacity-2/);
  const repository = page.getByRole('complementary', { name: 'Repository' });
  const [repositoryBox, canvasBox, conversationBox] = await Promise.all([
    repository.boundingBox(),
    page.locator('.canvas-workspace').boundingBox(),
    conversation.boundingBox(),
  ]);
  expect(repositoryBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  expect(conversationBox).not.toBeNull();
  expect(repositoryBox!.x + repositoryBox!.width).toBeLessThanOrEqual(canvasBox!.x + 1);
  expect(canvasBox!.x + canvasBox!.width).toBeLessThanOrEqual(conversationBox!.x + 1);
  await page.getByRole('button', { name: 'Fit' }).click();
  const fitted = await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('.canvas-stage')!;
    const diagram = document.querySelector<HTMLElement>('.mermaid-layer')!;
    const stageBox = stage.getBoundingClientRect();
    const diagramBox = diagram.getBoundingClientRect();
    const styles = getComputedStyle(stage);
    const inset = (name: string) => Number.parseFloat(styles.getPropertyValue(name)) || 0;
    const visible = {
      left: stageBox.left + inset('--canvas-inset-left'),
      right: stageBox.right - inset('--canvas-inset-right'),
      top: stageBox.top + inset('--canvas-inset-top'),
      bottom: stageBox.bottom - inset('--canvas-inset-bottom'),
    };
    return {
      inside: diagramBox.left >= visible.left && diagramBox.right <= visible.right
        && diagramBox.top >= visible.top && diagramBox.bottom <= visible.bottom,
      centerDeltaX: Math.abs((diagramBox.left + diagramBox.right) / 2 - (visible.left + visible.right) / 2),
      centerDeltaY: Math.abs((diagramBox.top + diagramBox.bottom) / 2 - (visible.top + visible.bottom) / 2),
    };
  });
  expect(fitted.inside).toBe(true);
  expect(fitted.centerDeltaX).toBeLessThan(2);
  expect(fitted.centerDeltaY).toBeLessThan(2);

  const repositorySeparator = page.getByRole('separator', { name: 'Resize repository panel' });
  const repositoryWidth = Number(await repositorySeparator.getAttribute('aria-valuenow'));
  await repositorySeparator.press('ArrowRight');
  await expect(repositorySeparator).toHaveAttribute('aria-valuenow', String(repositoryWidth + 8));
  await expect.poll(() => page.evaluate(() => localStorage.getItem('code-ai:panel-widths'))).toContain(`"repositoryWidth":${repositoryWidth + 8}`);

  // The canvas keeps every pixel for the diagram; the composer lives in the drawer.
  await closeConversation(page);
  await expect(page.locator('.instruction-composer')).toHaveCount(0);

  await page.getByRole('button', { name: 'Pen (P)' }).click();
  const ink = page.locator('svg.ink-layer');
  const box = await ink.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width * .3, box!.y + box!.height * .35);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * .55, box!.y + box!.height * .55, { steps: 8 });
  await page.mouse.up();
  await openConversation(page);
  await expect(page.locator('.attachment-chip')).toContainText('1 mark');
  await closeConversation(page);

  await page.getByRole('button', { name: 'Focus' }).click();
  await expect(page.locator('.canvas-workspace')).toHaveClass(/focus-mode/);
  await expect(repository).toBeHidden();
  await page.getByRole('button', { name: 'Exit focus' }).click();
  await openConversation(page);
  const revisionComposer = page.getByPlaceholder(/Ask about or revise/);
  await revisionComposer.fill('Revise it with a context step');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('button', { name: /Previous version/ })).toBeVisible();
  await expect(conversation.locator('.attachment-chip')).toContainText('Active diagram included');
  // Artifact ordinals are response-local; the titleblock deliberately renders the stored field
  // rather than inventing a separate global revision number.
  await expect(page.locator('.canvas-titleblock strong')).toHaveText('Diagram 1');
  await expect(page.locator('.canvas-titleblock')).toContainText('derived from Diagram 1');
  await page.getByPlaceholder(/Ask about or revise/).fill('Show two alternatives');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.canvas-titleblock strong')).toHaveText('Diagram 1');
  await expect(page.locator('.notice-banner')).toContainText('2 diagram results');
  await expect(page.locator('.diagram-card')).toHaveCount(4);
  await expect(page.locator('.diagram-card-svg svg')).toHaveCount(4);
  await closeConversation(page);

  await activityView(page, 'History').click();
  await expect(activityView(page, 'History')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.navigator-item')).toHaveCount(4);
  // Every entry carries a picture of its canvas; the diagrams in view have rendered theirs.
  await expect(page.locator('.navigator-item .canvas-thumbnail')).toHaveCount(4);
  await expect(page.locator('.canvas-thumbnail [data-mermaid-theme] svg').first()).toBeVisible();
  // A second press on the shown view closes the side panel.
  await activityView(page, 'History').click();
  await expect(page.getByRole('complementary', { name: 'Canvas history' })).toBeHidden();
  await expect(activityView(page, 'History')).toHaveAttribute('aria-pressed', 'false');

  await page.reload();
  await expect(page.locator('.diagram-canvas-shell')).toBeVisible();
  // Focused canvas is persisted device state, so reload keeps the revision we were viewing.
  await expect(page.locator('.canvas-titleblock strong')).toHaveText('Diagram 1');
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('code-ai:web2:v1:')))).toEqual([]);

  // A separate browser context hydrates the same committed host session after selecting its project.
  const secondContext = await page.context().browser()!.newContext();
  const secondPage = await secondContext.newPage();
  await secondPage.goto('/');
  if (!(await secondPage.locator('.project-search-trigger').textContent())?.includes(WORKSPACE_NAME)) {
    await secondPage.locator('.project-search-trigger').click();
    await secondPage.getByRole('option', { name: new RegExp(WORKSPACE_NAME) }).click();
  }
  await expect(secondPage.locator('.canvas-titleblock strong')).toHaveText('Diagram 2');
  await secondContext.close();

  const downloadPromise = page.waitForEvent('download');
  await fromMoreMenu(page, 'Export session');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^codeai-.*\.json$/);

  await page.screenshot({ path: 'test-results/codeai-canvas.png', fullPage: true });
});

test('keeps a repository-free loose session usable and durable', async ({ page }) => {
  await page.goto('/');
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: /No project.*Loose sessions/ }).click();
  await startSession(page);
  const manager = page.getByRole('region', { name: 'Session repositories' });
  await expect(manager).toContainText('Attach a repository to enable agent turns');
  await closeConversation(page);
  await page.getByRole('button', { name: /Start a sketch/ }).click();
  await expect(page.locator('.sketch-sheet')).toBeVisible();
  const fallbackNotice = page.getByRole('button', { name: 'Dismiss notice' });
  if (await fallbackNotice.isVisible()) await fallbackNotice.click();

  await openConversation(page);
  await page.getByRole('complementary', { name: 'Conversation' }).locator('textarea').fill('Try without a repository');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.notice-banner')).toContainText('Attach a repository and make it primary');
  await expect(page.locator('.chat-message.user')).toHaveCount(0);

  await page.reload();
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: /No project.*Loose sessions/ }).click();
  await expect(page.locator('.sketch-sheet')).toBeVisible();
});

test('loads the bounded spatial room on demand and restores its device-only layout', async ({ page }) => {
  const name = `E2E spatial ${Date.now()}`;
  const scripts: string[] = [];
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(request.url());
    if (request.url().startsWith('http') && new URL(request.url()).hostname !== '127.0.0.1') externalRequests.push(request.url());
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await createNamedProject(page, name);
  await startSession(page);
  await ensureRepository(page);

  const composer = page.getByPlaceholder(/Ask anything about this project/);
  await composer.fill('Spatial fixture');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.diagram-card')).toHaveCount(8);
  await expect(page.locator('.run-ribbon')).toHaveClass(/idle/);
  await closeConversation(page);

  for (let ordinal = 1; ordinal <= 5; ordinal += 1) {
    await page.getByRole('button', { name: 'New sketch' }).click();
    await expect(page.locator('.canvas-titleblock strong')).toHaveText(`Sketch ${ordinal}`);
  }
  await activityView(page, 'History').click();
  const badDiagram = page.locator('.navigator-item').filter({ hasText: 'Diagram 4' });
  // A diagram Mermaid cannot render keeps its kind mark instead of an empty frame.
  await expect(badDiagram.locator('.canvas-thumbnail-mark')).toBeVisible();
  await badDiagram.locator('.navigator-select').click();
  await expect(page.locator('.canvas-titleblock strong')).toHaveText('Diagram 4');
  const fixtureNotice = page.getByRole('button', { name: 'Dismiss notice' });
  if (await fixtureNotice.isVisible()) await fixtureNotice.click();

  const scriptsBeforeEntry = [...scripts];
  expect(await page.evaluate(() => window.__CODEAI_SPATIAL_INSTRUMENTATION__)).toBeUndefined();
  await page.getByRole('button', { name: 'Spatial', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Spatial canvas projection' })).toBeVisible();
  const panelList = page.getByRole('listbox', { name: 'Panels in chronological room order' });
  await expect(panelList).toBeVisible();
  await expect(panelList.getByRole('option')).toHaveCount(12);
  await expect(page.locator('.spatial-omitted')).toContainText('1 older target is omitted');
  await expect(panelList.getByRole('option', { name: /Diagram 4/ })).toContainText('Preview error');
  expect(await page.evaluate(() => window.__CODEAI_SPATIAL_INSTRUMENTATION__?.moduleEvaluations)).toBe(1);
  expect(scripts.slice(scriptsBeforeEntry.length).some((url) => url.includes('/_next/static/chunks/'))).toBe(true);
  expect(externalRequests).toEqual([]);

  const readyOption = panelList.getByRole('option', { name: /Sketch 5/ });
  await readyOption.click();
  await expect(readyOption).toHaveAttribute('aria-selected', 'true');
  await panelList.focus();
  await panelList.press('ArrowUp');
  await expect(readyOption).toHaveAttribute('aria-selected', 'false');
  await panelList.press('Enter');
  await readyOption.click();
  await page.getByRole('button', { name: 'Focus selected' }).click();
  for (const cameraControl of [
    'Orbit left', 'Orbit right', 'Orbit up', 'Orbit down', 'Pan left', 'Pan right',
    'Pan up', 'Pan down', 'Dolly in', 'Dolly out',
  ]) await page.getByRole('button', { name: cameraControl, exact: true }).click();
  await page.getByRole('checkbox', { name: 'Arrange selected panel' }).check();
  for (const panelControl of [
    'Left', 'Right', 'Up', 'Down', 'Forward', 'Back', 'Rotate left', 'Rotate right',
  ]) await page.getByRole('button', { name: panelControl, exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('code-ai:device:v1:workspace'))).toContain('"surface":"spatial"');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('code-ai:device:v1:workspace'))).toContain('"placements"');

  await expect.poll(() => page.evaluate(() => window.__CODEAI_SPATIAL_INSTRUMENTATION__?.objectUrls)).toBe(0);
  await expect.poll(async () => {
    const before = await page.evaluate(() => window.__CODEAI_SPATIAL_INSTRUMENTATION__!.frames);
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => window.__CODEAI_SPATIAL_INSTRUMENTATION__!.frames);
    return after - before;
  }).toBe(0);
  const live = await page.evaluate(() => ({ ...window.__CODEAI_SPATIAL_INSTRUMENTATION__! }));
  expect(live.textures).toBeGreaterThan(0);
  expect(live.logicalTexturePixels).toBeLessThanOrEqual(16_000_000);

  const layoutBeforeTheme = await page.evaluate(() => localStorage.getItem('code-ai:device:v1:workspace'));
  const failureId = await readyOption.getAttribute('data-canvas-id');
  await page.evaluate((id) => { window.__CODEAI_SPATIAL_TEST__ = { failTextureId: id || undefined }; }, failureId);
  await fromMoreMenu(page, 'Dark');
  await expect(readyOption).toContainText('Preview error');
  await expect.poll(() => page.evaluate(() => window.__CODEAI_SPATIAL_INSTRUMENTATION__?.objectUrls)).toBe(0);
  const layoutAfterTheme = await page.evaluate(() => localStorage.getItem('code-ai:device:v1:workspace'));
  expect(layoutAfterTheme).toBe(layoutBeforeTheme);
  await page.evaluate(() => { window.__CODEAI_SPATIAL_TEST__ = {}; });

  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Repository' })).toBeHidden();
  await page.getByRole('button', { name: 'Exit focus' }).click();
  await page.getByRole('button', { name: 'Open in Flat' }).click();
  await expect(page.locator('.sketch-sheet')).toBeVisible();
  await page.getByRole('button', { name: 'Spatial', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Spatial canvas projection' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('region', { name: 'Spatial canvas projection' })).toBeVisible();
  await expect(page.getByRole('option', { name: /Sketch 5/ })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => page.evaluate(() => window.__CODEAI_SPATIAL_INSTRUMENTATION__?.textures || 0)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Reset room' }).click();
  await expect.poll(() => page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('code-ai:device:v1:workspace') || '{}') as {
      scopes?: Record<string, { views?: Record<string, { surface?: string; spatial?: { camera?: unknown; placements?: Record<string, unknown> } }> }>;
    };
    const spatialView = Object.values(stored.scopes || {}).flatMap((scope) => Object.values(scope.views || {}))
      .find((view) => view.surface === 'spatial');
    return spatialView?.spatial;
  })).toEqual({ placements: {} });
  await page.locator('.spatial-viewport canvas').dispatchEvent('webglcontextlost');
  await expect(page.locator('.spatial-fallback')).toContainText('WebGL context was lost');
  await page.getByRole('button', { name: 'Return to Flat' }).click();
  await expect(page.locator('.sketch-sheet')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__CODEAI_SPATIAL_INSTRUMENTATION__?.textures || 0)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__CODEAI_SPATIAL_INSTRUMENTATION__?.materials || 0)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__CODEAI_SPATIAL_INSTRUMENTATION__?.geometries || 0)).toBe(0);

  await page.evaluate(() => { window.__CODEAI_SPATIAL_TEST__ = { forceUnsupported: true }; });
  await page.getByRole('button', { name: 'Spatial', exact: true }).click();
  await expect(page.locator('.spatial-fallback')).toContainText('does not provide a usable WebGL context');
  await page.getByRole('button', { name: 'Return to Flat' }).click();
  await expect(page.locator('.sketch-sheet')).toBeVisible();

  const secondContext = await page.context().browser()!.newContext();
  const secondPage = await secondContext.newPage();
  await secondPage.goto('/');
  await secondPage.locator('.project-search-trigger').click();
  await secondPage.getByRole('option', { name: new RegExp(name) }).click();
  await expect(secondPage.getByRole('button', { name: 'Flat', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await secondPage.evaluate(() => window.__CODEAI_SPATIAL_INSTRUMENTATION__)).toBeUndefined();
  let abortedSpatialChunk = false;
  await secondPage.route('**/_next/static/chunks/**', async (route) => {
    abortedSpatialChunk = true;
    await route.abort();
  });
  await secondPage.getByRole('button', { name: 'Spatial', exact: true }).click();
  await expect(secondPage.locator('.spatial-fallback')).toContainText('Spatial is unavailable');
  expect(abortedSpatialChunk).toBe(true);
  await secondPage.unroute('**/_next/static/chunks/**');
  await secondPage.getByRole('button', { name: 'Return to Flat' }).click();
  await expect(secondPage.locator('.sketch-sheet')).toBeVisible();
  await secondContext.close();
});

test('enters and cleans up the immersive workspace through an injectable XR adapter', async ({ page }) => {
  await page.addInitScript(() => {
    type TestWindow = Window & {
      __CODEAI_XR_PROBE_COUNT__?: number;
      __CODEAI_END_XR__?: () => void;
    };
    const scope = window as TestWindow;
    const createSession = () => {
      const listeners = {
        end: new Set<() => void>(),
        visibilitychange: new Set<() => void>(),
        inputsourceschange: new Set<() => void>(),
      };
      let ended = false;
      const session = {
        visibilityState: 'visible' as const,
        async end() {
          if (ended) return;
          ended = true;
          for (const listener of listeners.end) listener();
        },
        addEventListener(type: keyof typeof listeners, listener: () => void) { listeners[type].add(listener); },
        removeEventListener(type: keyof typeof listeners, listener: () => void) { listeners[type].delete(listener); },
      };
      scope.__CODEAI_END_XR__ = () => { for (const listener of listeners.end) listener(); };
      return session;
    };
    scope.__CODEAI_XR_PROBE_COUNT__ = 0;
    window.__CODEAI_XR_TEST__ = {
      adapter: {
        async isSessionSupported() {
          scope.__CODEAI_XR_PROBE_COUNT__ = (scope.__CODEAI_XR_PROBE_COUNT__ || 0) + 1;
          return true;
        },
        async enterVR() { return createSession(); },
      },
    };
  });

  const response = await page.goto('/');
  expect(response?.headers()['permissions-policy']).toBe('xr-spatial-tracking=(self)');
  await createNamedProject(page, `E2E immersive ${Date.now()}`);
  await startSession(page);
  await ensureRepository(page);

  const prompts = ['Spatial fixture', ...Array.from({ length: 6 }, (_, index) => `XR history ${index + 1}`)];
  for (const prompt of prompts) {
    await ensureConversationOpen(page);
    await page.getByRole('complementary', { name: 'Conversation' }).locator('textarea').fill(prompt);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('.run-ribbon')).toHaveClass(/idle/, { timeout: 12_000 });
  }
  await closeConversation(page);
  await expect(page.locator('.canvas-titleblock strong')).toHaveText('Diagram 1');

  await expect(page.getByRole('button', { name: 'Enter VR', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Enter VR', exact: true }).click();
  const controls = page.getByRole('group', { name: 'Immersive workspace controls' });
  await expect(controls).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__?.sessionActive)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__?.logicalTexturePixels || 0)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__!.logicalTexturePixels)).toBeLessThanOrEqual(5_592_405);

  const activeBeforeNavigation = await page.locator('.canvas-titleblock strong').textContent();
  await controls.getByRole('button', { name: 'Previous canvas' }).click();
  await expect(page.locator('.canvas-titleblock strong')).not.toHaveText(activeBeforeNavigation!);
  await controls.getByRole('button', { name: 'Next canvas' }).click();
  await expect(page.locator('.canvas-titleblock strong')).toHaveText(activeBeforeNavigation!);
  await controls.getByRole('button', { name: 'Larger', exact: true }).click();
  await controls.getByRole('button', { name: 'Reset view' }).click();
  await controls.getByRole('button', { name: 'Smaller', exact: true }).click();
  await expect(controls.getByRole('button', { name: 'Older' })).toBeEnabled();
  await controls.getByRole('button', { name: 'Older' }).click();
  await expect(controls.getByRole('button', { name: 'Newer' })).toBeEnabled();

  await controls.locator('[data-immersive-action="panel:conversation:focus"]').click();
  const immersiveLayoutBeforeStream = await page.evaluate(() => localStorage.getItem('code-ai:device:v1:immersive-layout'));
  await openConversation(page);
  const immersiveComposer = page.getByRole('complementary', { name: 'Conversation' }).locator('textarea');
  await immersiveComposer.fill('Live immersive update');
  await page.getByRole('complementary', { name: 'Conversation' }).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.run-ribbon')).toHaveClass(/idle/, { timeout: 12_000 });
  await expect(controls).toContainText('New activity');
  expect(await page.evaluate(() => localStorage.getItem('code-ai:device:v1:immersive-layout'))).toBe(immersiveLayoutBeforeStream);
  await controls.locator('[data-immersive-action="conversation:latest"]').click();
  await expect(controls).not.toContainText('New activity');
  await closeConversation(page);

  const layoutBeforeExit = await persistedSpatialLayout(page);
  await page.evaluate(() => (window as Window & { __CODEAI_END_XR__?: () => void }).__CODEAI_END_XR__?.());
  await expect(page.getByRole('button', { name: 'Enter VR', exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__?.sessionActive)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__?.liveResources || 0)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__?.logicalTexturePixels || 0)).toBe(0);
  expect(await persistedSpatialLayout(page)).toEqual(layoutBeforeExit);
  await expect.poll(async () => {
    const before = await page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__!.frames);
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__!.frames);
    return after - before;
  }).toBe(0);

  await page.getByRole('button', { name: 'Enter VR', exact: true }).click();
  await expect(controls).toBeVisible();
  await controls.getByRole('button', { name: 'Exit VR' }).click();
  await expect(page.getByRole('button', { name: 'Enter VR', exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__?.sessionActive)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__?.liveResources || 0)).toBe(0);
  expect(await persistedSpatialLayout(page)).toEqual(layoutBeforeExit);
});

test('keeps multiple session views and their device layout usable during background work', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.new-session-menu summary')).toBeVisible();
  const initiallyOpen = page.locator('.workspace-tab-close');
  while (await initiallyOpen.count()) await initiallyOpen.first().click();
  await startSession(page);
  const firstConversation = page.getByRole('complementary', { name: 'Conversation' });
  await firstConversation.locator('textarea').fill('first view draft');

  await startSession(page);
  await expect(page.getByRole('tab')).toHaveCount(2);
  expect(await page.locator('[role="tablist"] > *').evaluateAll((children) => (
    children.map((child) => child.getAttribute('role'))
  ))).toEqual(['tab', 'tab']);
  await ensureRepository(page);
  const secondConversation = page.getByRole('complementary', { name: 'Conversation' });
  await secondConversation.locator('textarea').fill('Wait for reload cancellation.');
  await secondConversation.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.workspace-tab').nth(1)).toHaveClass(/working/);
  await expect(page.locator('.tool-timeline')).toContainText('Reading README.md');

  await page.getByRole('tab').nth(0).click();
  const backgroundConversation = page.getByRole('complementary', { name: 'Conversation' });
  await expect(backgroundConversation.locator('textarea')).toHaveValue('first view draft');
  await backgroundConversation.locator('textarea').fill('first view draft, edited while another turn runs');
  await expect(backgroundConversation.getByRole('button', { name: 'Send' })).toBeEnabled();
  await closeConversation(page);
  await page.getByRole('button', { name: /Start a sketch/ }).click();
  await expect(page.locator('.sketch-sheet')).toBeVisible();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const firstViewZoom = await page.locator('.canvas-controls > span').first().textContent();
  expect(firstViewZoom).toMatch(/%$/);

  // Recovery is host-wide: the running second view reattaches even though the first view owns
  // device focus at reload, and that focus plus its camera remain intact.
  await page.reload();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.getByRole('tab').nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.workspace-tab').nth(1)).toHaveClass(/working/);
  await expect(page.locator('.canvas-controls > span').first()).toHaveText(firstViewZoom!);

  await page.getByRole('tab').nth(1).click();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.notice-banner')).toContainText('cancelled');
  await page.getByRole('complementary', { name: 'Conversation' }).locator('textarea').fill('second view draft');

  await page.reload();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('complementary', { name: 'Conversation' }).locator('textarea')).toHaveValue('second view draft');
  await page.getByRole('tab').nth(0).click();
  await expect(page.getByRole('complementary', { name: 'Conversation' })).toHaveCount(0);
  await openConversation(page);
  await expect(page.getByRole('complementary', { name: 'Conversation' }).locator('textarea')).toHaveValue('first view draft, edited while another turn runs');
  await expect(page.locator('.canvas-controls > span').first()).toHaveText(firstViewZoom!);
  await page.getByRole('tab').nth(0).press('Delete');
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(page.getByRole('tab')).toBeFocused();
});

test('runs two turns, queues a third, and recovers background approval and promotion', async ({ page }) => {
  await page.goto('/');
  await createNamedProject(page, `Concurrent workspace ${Date.now()}`);

  await startSession(page);
  await attachRepository(page, 'beta');
  await page.getByRole('complementary', { name: 'Conversation' }).locator('textarea').fill('Concurrent slot one');
  await page.getByRole('button', { name: 'Send' }).click();

  await startSession(page);
  await attachRepository(page, 'packages/deep-app');
  await page.getByRole('button', { name: 'Make packages/deep-app primary' }).click();
  await chooseMode(page, 'Agent');
  await page.getByRole('complementary', { name: 'Conversation' }).locator('textarea').fill('Request an edit approval');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('article', { name: 'Approval required: Edit' })).toBeVisible();

  await startSession(page);
  await attachRepository(page, 'alpha');
  await page.getByRole('button', { name: 'Make alpha primary' }).click();
  // A new session starts in the last mode chosen, Agent here; this slot is a read-only turn.
  await chooseMode(page, 'Ask');
  await page.getByRole('complementary', { name: 'Conversation' }).locator('textarea').fill('Concurrent slot three');
  await page.getByRole('button', { name: 'Send' }).click();

  const tabs = page.locator('.workspace-tab');
  await expect(tabs).toHaveCount(3);
  await expect(tabs.nth(0)).toHaveClass(/working/);
  await expect(tabs.nth(1)).toHaveClass(/awaiting-approval/);
  await expect(tabs.nth(2)).toHaveClass(/queued/);
  await expect(tabs.nth(2)).toHaveAttribute('aria-label', /Queued · position 1/);
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();

  await page.reload();
  await expect(tabs).toHaveCount(3);
  await expect(tabs.nth(0)).toHaveClass(/working/);
  await expect(tabs.nth(1)).toHaveClass(/awaiting-approval/);
  await expect(tabs.nth(2)).toHaveClass(/queued/);

  await tabs.nth(1).click();
  await expect(page.getByRole('article', { name: 'Approval required: Edit' })).toBeVisible();
  await page.getByRole('button', { name: 'Allow' }).click();
  await expect(tabs.nth(2)).toHaveClass(/working/);
  await expect(tabs.nth(2)).not.toHaveClass(/queued/);

  // Clean up both delayed fixture processes; cancellation is explicit and scoped by focused run.
  if (await tabs.nth(0).evaluate((tab) => tab.classList.contains('working'))) {
    await tabs.nth(0).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  await tabs.nth(2).click();
  if (await page.getByRole('button', { name: 'Cancel', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  await expect(tabs.nth(2)).not.toHaveClass(/working/);
});

test('routes Arena views through browser history without remounting the shell', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.locator('.app-shell').evaluate((shell) => { shell.setAttribute('data-route-sentinel', 'preserved'); });

  await page.getByRole('link', { name: 'Arena', exact: true }).click();
  const arena = page.getByRole('main', { name: 'Arena' });
  await expect(page).toHaveURL(/\/arena$/);
  await expect(page).toHaveTitle('Arena — CodeAI');
  await expect(arena.getByRole('tab', { name: /Active/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-route-sentinel', 'preserved');

  await arena.getByRole('tab', { name: /Inbox/ }).click();
  await expect(page).toHaveURL(/\/arena\/inbox$/);
  await expect(page).toHaveTitle('Inbox — CodeAI');
  await arena.getByRole('tab', { name: /Archived/ }).click();
  await expect(page).toHaveURL(/\/arena\/archived$/);
  await expect(page).toHaveTitle('Archived sessions — CodeAI');

  await page.goBack();
  await expect(page).toHaveURL(/\/arena\/inbox$/);
  await expect(arena.getByRole('tab', { name: /Inbox/ })).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(page).toHaveURL(/\/arena$/);
  await expect(arena.getByRole('tab', { name: /Active/ })).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('main', { name: 'Arena' })).toHaveCount(0);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-route-sentinel', 'preserved');

  await page.goForward();
  await expect(page).toHaveURL(/\/arena$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/arena\/inbox$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/arena\/archived$/);

  await page.goto('/arena/archived');
  await expect(page.getByRole('main', { name: 'Arena' }).getByRole('tab', { name: /Archived/ }))
    .toHaveAttribute('aria-selected', 'true');
  await page.reload();
  await expect(page).toHaveURL(/\/arena\/archived$/);
  await expect(page).toHaveTitle('Archived sessions — CodeAI');
  await expect(page.getByRole('main', { name: 'Arena' }).getByRole('tab', { name: /Archived/ }))
    .toHaveAttribute('aria-selected', 'true');

  expect((await request.get('/arena/not-a-view')).status()).toBe(404);
});

test('orchestrates cross-project attention and starts configured work from the Arena', async ({ page, request }) => {
  const alphaProject = `Arena Alpha ${Date.now()}`;
  const betaProject = `Arena Beta ${Date.now()}`;
  await page.goto('/');

  await createNamedProject(page, alphaProject);
  await startSession(page);
  await attachRepository(page, 'alpha');

  await createNamedProject(page, betaProject);
  await startSession(page);
  await attachRepository(page, 'beta');

  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(alphaProject) }).click();
  const alphaConversation = page.getByRole('complementary', { name: 'Conversation' });
  await chooseMode(alphaConversation, 'Agent');
  await alphaConversation.locator('textarea').fill('Arena permission from Alpha');
  await alphaConversation.getByRole('button', { name: 'Send' }).click();
  await expect(alphaConversation.getByRole('article', { name: 'Approval required: Edit' })).toBeVisible();

  // Leave the blocked session. Project navigation stays available and its permission reaches the
  // host-wide Inbox without first reopening the owning project/session.
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(betaProject) }).click();
  await expect(page.locator('.project-search-trigger')).toContainText(betaProject);
  const inbox = activityBar(page).getByRole('link', { name: /^Inbox/ });
  await expect(inbox).toHaveAccessibleName(/^Inbox, \d+ unread$/);
  await expect(inbox.locator('.activity-badge')).toBeVisible();
  await inbox.click();
  await expect(page).toHaveURL(/\/arena\/inbox$/);
  const arena = page.getByRole('main', { name: 'Arena' });
  await expect(arena).toBeVisible();
  const permissionItem = arena.locator('.arena-inbox-item:has(.arena-attention-kind.permission)').filter({ hasText: 'Arena permission from Alpha' });
  await expect(permissionItem).toContainText(alphaProject);
  await expect(permissionItem).toContainText('Edit: README.md');
  await permissionItem.getByRole('button', { name: 'Allow' }).click();
  await expect(permissionItem).toHaveCount(0);

  const finishedItem = arena.locator('.arena-inbox-item').filter({ hasText: 'Arena permission from Alpha' }).filter({ hasText: 'Finished' });
  await expect(finishedItem).toBeVisible();
  await finishedItem.getByRole('button', { name: 'Mark read' }).click();
  await expect(finishedItem).toHaveClass(/read/);

  await arena.getByRole('tab', { name: /Active/ }).click();
  await expect(page).toHaveURL(/\/arena$/);
  const alphaGroup = arena.getByRole('region', { name: alphaProject });
  const alphaCard = alphaGroup.getByRole('button', { name: 'Open Arena permission from Alpha' });
  await expect(alphaCard).toContainText('Idle');
  await expect(alphaCard).toContainText('alpha');
  await expect(alphaCard).toContainText('Claude');

  // A failed refresh leaves the last good cards in place and offers a safe retry.
  let failArenaRefresh = true;
  await page.route('**/api/arena', async (route) => {
    if (failArenaRefresh) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Arena unavailable' }) });
    } else {
      await route.continue();
    }
  });
  await arena.getByRole('button', { name: 'Refresh' }).click();
  await expect(arena.getByText(/Showing the last good overview/)).toBeVisible();
  await expect(alphaCard).toBeVisible();
  failArenaRefresh = false;
  await arena.getByRole('button', { name: 'Try again' }).click();
  await expect(arena.getByText(/Showing the last good overview/)).toHaveCount(0);
  await page.unroute('**/api/arena');

  // Starting from the overview chooses project/provider/mode, opens the resulting view, and does
  // not itself start a provider run.
  await arena.getByRole('button', { name: 'New session' }).click();
  const create = arena.getByRole('region', { name: 'Create session' });
  await create.getByLabel('Project').selectOption({ label: betaProject });
  await create.getByLabel('Provider').selectOption('claude');
  await create.getByRole('radio', { name: 'Plan' }).click();
  await create.getByRole('button', { name: 'Create and open' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.project-search-trigger')).toContainText(betaProject);
  await expect(modePicker(page.getByRole('complementary', { name: 'Conversation' }))).toHaveText('Plan');
  await expect(page.locator('.chat-message')).toHaveCount(0);
  expect(((await (await request.get('/api/agent/runs')).json()) as { active: unknown[] }).active).toEqual([]);
});

test('archives and restores an idle session from the Arena', async ({ page, request }) => {
  const projectName = `Arena archive ${Date.now()}`;
  await page.goto('/');
  await createNamedProject(page, projectName);
  await startSession(page);
  const projects = (await (await request.get('/api/projects')).json()) as {
    projects: Array<{ id: string; name: string }>;
  };
  const projectId = projects.projects.find((project) => project.name === projectName)!.id;
  const catalog = (await (await request.get(`/api/sessions?projectId=${projectId}`)).json()) as {
    sessions: Array<{ id: string }>;
  };
  const archivedSessionId = catalog.sessions[0].id;

  const openTabs = page.getByRole('tab');
  await expect(openTabs).toHaveCount(1);
  await page.getByRole('link', { name: 'Arena', exact: true }).click();
  await expect(page).toHaveURL(/\/arena$/);
  const arena = page.getByRole('main', { name: 'Arena' });
  const active = arena.getByRole('tab', { name: /Active/ });
  await active.click();
  const project = arena.getByRole('region', { name: projectName });
  const card = project.locator('.arena-card');
  await expect(card).toHaveCount(1);

  await card.locator('.arena-card-menu summary').click();
  page.once('dialog', (dialog) => dialog.accept());
  await card.getByRole('button', { name: 'Archive session' }).click();
  await expect(project).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo archive' })).toBeVisible();
  expect(await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('code-ai:device:v1:workspace') || '{}') as {
      scopes?: Record<string, { openSessionIds?: string[] }>;
    };
    return Object.values(stored.scopes || {}).flatMap((scope) => scope.openSessionIds || []);
  })).not.toContain(archivedSessionId);

  const archived = arena.getByRole('tab', { name: /Archived/ });
  await archived.click();
  await expect(page).toHaveURL(/\/arena\/archived$/);
  const archivedProject = arena.getByRole('region', { name: projectName });
  const archivedCard = archivedProject.locator('.arena-card');
  await expect(archivedCard).toContainText('Archived');
  await expect(archivedCard).toContainText('Claude');
  await archivedCard.getByRole('button', { name: 'Restore' }).click();
  await expect(archivedProject).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo archive' })).toHaveCount(0);

  await active.click();
  await expect(page).toHaveURL(/\/arena$/);
  const restoredProject = arena.getByRole('region', { name: projectName });
  await expect(restoredProject.locator('.arena-card')).toHaveCount(1);
  await restoredProject.getByRole('button', { name: /Open Session/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.project-search-trigger')).toContainText(projectName);
  await expect(page.getByRole('tab')).toHaveCount(1);
});

test('archives the open session from the More menu', async ({ page, request }) => {
  const projectName = `Menu archive ${Date.now()}`;
  await page.goto('/');
  await createNamedProject(page, projectName);
  await startSession(page);
  await startSession(page);
  await expect(page.getByRole('tab')).toHaveCount(2);
  const projects = (await (await request.get('/api/projects')).json()) as { projects: Array<{ id: string; name: string }> };
  const projectId = projects.projects.find((project) => project.name === projectName)!.id;
  const sessionIds = async () => ((await (await request.get(`/api/sessions?projectId=${projectId}`)).json()) as {
    sessions: Array<{ id: string }>;
  }).sessions.map((session) => session.id);
  const focusedId = () => page.evaluate((projectId) => {
    const stored = JSON.parse(localStorage.getItem('code-ai:device:v1:workspace') || '{}') as {
      scopes?: Record<string, { focusedSessionId?: string }>;
    };
    return stored.scopes?.[`project:${projectId}`]?.focusedSessionId;
  }, projectId);
  await expect.poll(focusedId).toBeTruthy();
  const archivedId = (await focusedId())!;
  const archiveRequests: string[] = [];
  page.on('request', (sent) => { if (sent.method() === 'POST' && sent.url().endsWith('/archive')) archiveRequests.push(sent.url()); });

  const menu = page.locator('.more-menu');
  const archive = menu.getByRole('button', { name: 'Archive session', exact: true });
  await ensureRepository(page);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await conversation.locator('textarea').fill('Wait for reload cancellation.');
  await conversation.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.workspace-tab.active')).toHaveClass(/working/);
  await menu.locator('summary').click();
  await expect(archive).toBeDisabled();
  await menu.locator('summary').click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.notice-banner')).toContainText('cancelled');

  await menu.locator('summary').click();
  await expect(archive).toBeEnabled();
  page.once('dialog', (dialog) => dialog.dismiss());
  await archive.click();
  await page.waitForTimeout(100);
  expect(archiveRequests).toEqual([]);
  await expect(page.getByRole('tab')).toHaveCount(2);

  // While the archive is in flight, the reopened menu cannot send a second one.
  let releaseArchive!: () => void;
  const archiveHeld = new Promise<void>((resolve) => { releaseArchive = resolve; });
  await page.route('**/api/sessions/*/archive', async (route) => { await archiveHeld; await route.continue(); });
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('You can restore it later from Archived.');
    return dialog.accept();
  });
  await archive.click();
  await expect(menu).not.toHaveAttribute('open');
  await menu.locator('summary').click();
  await expect(archive).toBeDisabled();
  await menu.locator('summary').click();
  releaseArchive();
  await expect(page.getByRole('tab')).toHaveCount(1);
  expect(archiveRequests).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Undo archive' })).toBeVisible();
  expect(await sessionIds()).not.toContain(archivedId);
  expect(await sessionIds()).toHaveLength(1);

  await page.getByRole('button', { name: 'Undo archive' }).click();
  await expect.poll(sessionIds).toContain(archivedId);
});

test('separates replay from live recovery events and keeps terminal actions per session', async ({ page }) => {
  await page.goto('/');
  await createNamedProject(page, `Recovery outcomes ${Date.now()}`);

  await startSession(page);
  await attachRepository(page, 'beta');
  await page.getByRole('complementary', { name: 'Conversation' }).locator('textarea').fill('Concurrent slot recovery one');
  await page.getByRole('button', { name: 'Send' }).click();

  await startSession(page);
  await attachRepository(page, 'alpha');
  await page.getByRole('button', { name: 'Make alpha primary' }).click();
  await chooseMode(page, 'Plan');
  await page.getByRole('complementary', { name: 'Conversation' }).locator('textarea').fill('Concurrent slot recovery two');
  await page.getByRole('button', { name: 'Send' }).click();

  const firstTab = page.getByRole('tab', { name: /Concurrent slot recovery one/ });
  const secondTab = page.getByRole('tab', { name: /Concurrent slot recovery two/ });
  await expect(firstTab).toHaveClass(/working/);
  await expect(secondTab).toHaveClass(/working/);
  await firstTab.click();

  await page.route(/\/api\/agent\/stream\?runId=/, async (route) => {
    const runId = new URL(route.request().url()).searchParams.get('runId')!;
    const frames = [
      {
        type: 'permission-request', runId, requestId: `replayed-${runId}`, participantId: 'recovered-agent',
        tool: 'Edit', detail: 'replayed approval',
      },
      {
        type: 'error', runId, code: 'max-turns', message: `Synthetic limit ${runId.slice(0, 8)}`,
        retryable: true, delivery: 'possibly-sent',
      },
      { type: 'done', runId, durationMs: 1, cancelled: false },
    ];
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      headers: { 'X-CodeAI-Replay-Events': '2' },
      body: `${frames.map((frame) => JSON.stringify(frame)).join('\n')}\n`,
    });
  });

  await page.reload();
  await expect(page.locator('.notice-banner')).toContainText('Synthetic limit');
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  const firstFailure = await page.locator('.notice-banner > span').textContent();

  // The replayed permission does not count, while a terminal error buffered in the attachment gap
  // restores one attention marker without duplicating an unread already persisted on this device.
  await expect(secondTab.locator('.unread-badge')).toHaveText('1');
  await secondTab.click();
  await expect(page.locator('.notice-banner')).toContainText('Synthetic limit');
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  const secondFailure = await page.locator('.notice-banner > span').textContent();
  expect(secondFailure).not.toBe(firstFailure);

  const continuation = page.waitForRequest((request) => (
    request.url().endsWith('/api/agent/message')
      && (request.postDataJSON() as { text?: string }).text === 'Continue where you stopped.'
  ));
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  expect((await continuation).postDataJSON()).toMatchObject({ mode: 'plan' });

  await firstTab.click();
  await expect(page.locator('.notice-banner')).toContainText(firstFailure!);
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
});

test('preserves device views when the session catalog request fails', async ({ page }) => {
  await page.goto('/');
  await startSession(page);
  const draft = `preserve this draft ${Date.now()}`;
  await page.getByRole('complementary', { name: 'Conversation' }).locator('textarea').fill(draft);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('code-ai:device:v1:workspace'))).toContain(draft);
  const before = await page.evaluate(() => localStorage.getItem('code-ai:device:v1:workspace'));

  const catalogRequest = /\/api\/sessions\?(?:projectId=|loose=true)/;
  await page.route(catalogRequest, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Temporary catalog failure.' }),
    });
  });
  await page.reload();
  await expect(page.locator('.notice-banner')).toContainText('Temporary catalog failure');
  await expect(page.getByRole('button', { name: 'Continue in new session' })).toHaveCount(0);
  const after = await page.evaluate(() => localStorage.getItem('code-ai:device:v1:workspace'));
  expect(JSON.parse(after!)).toEqual(JSON.parse(before!));

  await page.unroute(catalogRequest);
  await page.reload();
  await expect(page.getByRole('complementary', { name: 'Conversation' }).locator('textarea')).toHaveValue(draft);
});

test('explains sessions hidden because a newer CodeAI wrote them, only while there are some', async ({ page, request }) => {
  const projectName = `Newer format ${Date.now()}`;
  const { project } = await (await request.post('/api/projects', { data: { name: projectName, checkoutIds: [] } })).json();
  expect((await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).status()).toBe(201);
  // The newest project opens first, so the Arena below has to switch projects to reach the session.
  await request.post('/api/projects', { data: { name: `${projectName} (opens first)`, checkoutIds: [] } });
  let newerFormatSessions = 2;
  await page.route('**/api/health', async (route) => {
    const upstream = await route.fetch();
    await route.fulfill({ response: upstream, json: { ...await upstream.json(), newerFormatSessions } });
  });
  const notice = page.getByRole('status').filter({ hasText: 'newer CodeAI' });
  await page.goto('/');
  await expect(notice).toHaveText(/^2 sessions were written by a newer CodeAI and are hidden here\./);
  await expect(page.locator('.project-search-trigger')).toContainText('(opens first)');
  // Opening another project's session from the Arena reloads this machine's catalog, not its health.
  await page.getByRole('link', { name: 'Arena', exact: true }).click();
  const arena = page.getByRole('main', { name: 'Arena' });
  await arena.getByRole('tab', { name: /Active/ }).click();
  await arena.getByRole('region', { name: projectName }).getByRole('button', { name: /^Open / }).click();
  await expect(page.locator('.project-search-trigger')).toContainText(projectName);
  await expect(notice).toHaveText(/^2 sessions were written by a newer CodeAI and are hidden here\./);
  await notice.getByRole('button', { name: 'Dismiss notice' }).click();
  await expect(notice).toHaveCount(0);

  newerFormatSessions = 1;
  await page.reload();
  await expect(notice).toHaveText(/^1 session was written by a newer CodeAI and is hidden here\./);

  newerFormatSessions = 0;
  const loaded = page.waitForResponse('**/api/health');
  await page.reload();
  await loaded;
  await expect(page.locator('.project-search-trigger')).toBeVisible();
  await expect(notice).toHaveCount(0);
});

test('sketches a blank canvas and sends the drawing as the instruction', async ({ page }) => {
  await page.goto('/');
  await startSession(page);
  await ensureRepository(page);
  await closeConversation(page);

  // A sketch is reachable before any diagram exists — that is the point of it.
  await page.getByRole('button', { name: /Start a sketch/ }).click();
  await expect(page.locator('.sketch-sheet')).toBeVisible();
  await expect(page.locator('.canvas-titleblock strong')).toHaveText('Sketch 1');

  await page.getByRole('button', { name: 'Pen (P)' }).click();
  const ink = page.locator('svg.ink-layer');
  const box = await ink.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width * .3, box!.y + box!.height * .3);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * .6, box!.y + box!.height * .5, { steps: 8 });
  await page.mouse.up();
  await openConversation(page);
  await expect(page.locator('.attachment-chip')).toContainText('Your sketch included · 1 mark');
  // The drawing is the instruction: sending needs no typed text.
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.chat-message.user')).toContainText('1 sketch attached');
  await expect(page.locator('.chat-message.assistant')).toBeVisible();

  await closeConversation(page);
  await page.reload();
  await expect(page.locator('.sketch-sheet')).toBeVisible();
  await activityView(page, 'History').click();
  await expect(page.locator('.navigator-item')).toContainText('Sketch 1');
});

test('discovers, reattaches, and cancels a turn that outlives a reload', async ({ page }) => {
  await page.goto('/');
  await startSession(page);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await conversation.locator('textarea').fill('Wait for reload cancellation.');
  await conversation.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.tool-timeline')).toContainText('Reading README.md');

  const discovery = page.waitForResponse((response) => response.url().endsWith('/api/agent/runs'));
  await page.reload();
  expect((await (await discovery).json()).active).toHaveLength(1);
  // The session's tab carries a reattached turn while the conversation is closed.
  await expect(page.getByRole('tab', { selected: true })).toHaveClass(/working/);
  await ensureConversationOpen(page);
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.notice-banner')).toContainText('cancelled');
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
});

test('recovers a host-wide run in its canonical project scope', async ({ page }) => {
  const ownerProject = `ZZZ run owner ${Date.now()}`;
  const landingProject = `AAA reload landing ${Date.now()}`;
  await page.goto('/');
  await createNamedProject(page, ownerProject);
  await createNamedProject(page, landingProject);
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(ownerProject) }).click();
  await startSession(page);
  await ensureRepository(page);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await conversation.locator('textarea').fill('Wait for reload cancellation.');
  await conversation.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.tool-timeline')).toContainText('Reading README.md');

  await page.reload();
  await expect(page.locator('.project-search-trigger')).toContainText(ownerProject);
  // The session's tab carries a reattached turn while the conversation is closed.
  await expect(page.getByRole('tab', { selected: true })).toHaveClass(/working/);
  await ensureConversationOpen(page);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.notice-banner')).toContainText('cancelled');
});

test('traces an Agent run without implying progress and shifts to wait for approval', async ({ page }) => {
  await page.goto('/');
  await startSession(page);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await chooseMode(conversation, 'Agent');

  await conversation.locator('textarea').fill('Make one approved edit.');
  await conversation.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.run-ribbon')).toHaveClass(/awaiting-approval/);
  await expect(page.locator('.run-ribbon')).not.toHaveAttribute('role', 'progressbar');
  await expect(conversation.getByLabel(/Approval required: Edit/)).toBeVisible();
  await expect(page.locator('.run-ribbon-line')).toHaveCSS('animation-name', 'ribbon-breathe');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.run-ribbon-line')).toHaveCSS('animation-name', 'none');

  await conversation.getByRole('button', { name: 'Deny' }).click();
  await expect(conversation.getByLabel(/Approval required: Edit/)).toHaveCount(0);
  await expect(conversation.locator('.chat-message.assistant')).toContainText('Edit denied');
  await expect(page.locator('.run-ribbon')).toHaveClass(/idle/);
});

test('adds a role participant and performs an explicit quick handoff', async ({ page }) => {
  await page.goto('/');
  await startSession(page);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  const composer = conversation.locator('textarea');

  await composer.fill('Summarize the current architecture in one paragraph.');
  await conversation.getByRole('button', { name: 'Send' }).click();
  await expect(conversation.locator('.chat-message.assistant')).toBeVisible();

  await conversation.locator('.add-agent-menu summary').click();
  const addAgentPanel = conversation.locator('.add-agent-menu > div');
  await expect(addAgentPanel).toBeVisible();
  const [drawerBox, addAgentPanelBox] = await Promise.all([
    conversation.boundingBox(),
    addAgentPanel.boundingBox(),
  ]);
  expect(drawerBox).not.toBeNull();
  expect(addAgentPanelBox).not.toBeNull();
  expect(addAgentPanelBox!.x).toBeGreaterThanOrEqual(drawerBox!.x);
  expect(addAgentPanelBox!.x + addAgentPanelBox!.width).toBeLessThanOrEqual(
    drawerBox!.x + drawerBox!.width,
  );
  await conversation.getByLabel('Role').selectOption('reviewer');
  await conversation.getByRole('button', { name: 'Add participant' }).click();
  await expect(addAgentPanel).toBeHidden();
  await expect(conversation.locator('.participant-chip')).toHaveCount(2);
  await expect(conversation.locator('.participant-chip.active')).toContainText('Claude Reviewer');

  // Select the main coder, then use the reviewer handoff chip. It prefills but does not send.
  await conversation.locator('.participant-chip').filter({ hasText: '@Claude' }).filter({ hasText: 'Main' }).click();
  await conversation.getByRole('button', { name: /@Claude Reviewer · Review this/ }).click();
  await expect(composer).toHaveValue(/Review the latest proposal or changes above/);
  await expect(conversation.locator('.participant-chip.active')).toContainText('Claude Reviewer');
  await expect(conversation.locator('.chat-message.user')).toHaveCount(1);

  await conversation.getByRole('button', { name: 'Send' }).click();
  await expect(conversation.locator('.chat-message.user')).toHaveCount(2);
  await expect(conversation.locator('.chat-message.user').last()).toContainText('→ @Claude Reviewer');
  await expect(conversation.locator('.chat-message.assistant').last()).toContainText('Claude Reviewer');

  // A completed retained reviewer run must not announce itself as live or rewrite the persisted
  // device-local selection when this browser reloads.
  await conversation.locator('.participant-chip').filter({ hasText: '@Claude' }).filter({ hasText: 'Main' }).click();
  const discovery = page.waitForResponse((response) => response.url().endsWith('/api/agent/runs'));
  await page.reload({ waitUntil: 'networkidle' });
  expect((await (await discovery).json()).active).toHaveLength(0);
  await expect(page.locator('.unread-badge, .layout-badge')).toHaveCount(0);
  await ensureConversationOpen(page);
  await expect(page.getByRole('complementary', { name: 'Conversation' }).locator('.participant-chip.active')).toContainText('Main');
  await expect(page.locator('.stream-preview')).toHaveCount(0);
  await expect(page.locator('.notice-banner')).toHaveCount(0);

  const reloadedConversation = page.getByRole('complementary', { name: 'Conversation' });
  await reloadedConversation.locator('.participant-chip').filter({ hasText: 'Reviewer' }).click();
  await reloadedConversation.getByRole('button', { name: 'Make @Claude Reviewer the main agent' }).click();
  await expect(reloadedConversation.locator('.participant-chip.active')).toContainText('Main');
});

test('sends each agent\'s own model and effort, keeps them across a reload, and fits a phone', async ({ page }) => {
  await page.goto('/');
  await startSession(page);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  const composer = conversation.locator('textarea');
  const menu = conversation.locator('.model-menu');
  const summary = menu.locator('summary');
  const models = menu.getByRole('radiogroup', { name: 'Model' });
  const efforts = menu.getByRole('radiogroup', { name: 'Effort' });
  const answers = conversation.locator('.chat-message.assistant');
  let turns = 0;
  const send = async (text?: string) => {
    const requested = page.waitForRequest((request) => request.url().endsWith('/api/agent/message'));
    if (text) await composer.fill(text);
    await conversation.getByRole('button', { name: 'Send' }).click();
    const body = (await requested).postDataJSON() as { participantId: string; model?: string; effort?: string };
    await expect(answers).toHaveCount(++turns);
    return body;
  };
  const choose = async (model: string, effort?: string) => {
    await summary.click();
    await models.getByRole('radio', { name: model, exact: true }).click();
    if (effort) await efforts.getByRole('radio', { name: effort, exact: true }).click();
    await summary.click();
  };

  // Default sends neither field, exactly as before.
  await expect(summary).toHaveText('Default');
  const plain = await send('Summarize the current architecture in one paragraph.');
  expect(plain).not.toHaveProperty('model');
  expect(plain).not.toHaveProperty('effort');

  // A model without efforts drops the effort group and resets the effort to Default.
  await choose('Opus', 'High');
  await expect(summary).toHaveText('Opus · High');
  await choose('Haiku');
  await expect(summary).toHaveText('Haiku');
  await summary.click();
  await expect(efforts).toHaveCount(0);
  await summary.click();

  await choose('Sonnet', 'Low');
  await expect(summary).toHaveText('Sonnet · Low');
  const chosen = await send('Explain the entry point briefly.');
  expect(chosen).toMatchObject({ participantId: plain.participantId, model: 'sonnet', effort: 'low' });

  // A second agent starts at this device's last choice for its provider and keeps its own choice.
  await conversation.locator('.add-agent-menu summary').click();
  await conversation.getByLabel('Role').selectOption('reviewer');
  await conversation.getByRole('button', { name: 'Add participant' }).click();
  await expect(conversation.locator('.participant-chip.active')).toContainText('Claude Reviewer');
  await expect(summary).toHaveText('Sonnet · Low');
  await choose('Opus', 'Extra high');
  await expect(summary).toHaveText('Opus · Extra high');

  const mainChip = conversation.locator('.participant-chip').filter({ hasText: '@Claude' }).filter({ hasText: 'Main' });
  await mainChip.click();
  await expect(summary).toHaveText('Sonnet · Low');
  // A handoff addresses the reviewer, so the turn carries the reviewer's choice.
  await conversation.getByRole('button', { name: /@Claude Reviewer · Review this/ }).click();
  await expect(summary).toHaveText('Opus · Extra high');
  const handoff = await send();
  expect(handoff.participantId).not.toBe(plain.participantId);
  expect(handoff).toMatchObject({ model: 'opus', effort: 'xhigh' });

  await page.reload({ waitUntil: 'networkidle' });
  await ensureConversationOpen(page);
  const reloaded = page.getByRole('complementary', { name: 'Conversation' });
  await expect(reloaded.locator('.model-menu summary')).toHaveText('Opus · Extra high');
  await reloaded.locator('.participant-chip').filter({ hasText: '@Claude' }).filter({ hasText: 'Main' }).click();
  await expect(reloaded.locator('.model-menu summary')).toHaveText('Sonnet · Low');

  // At phone width nothing in the composer row overlaps, and the open menu stays on screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await ensureConversationOpen(page);
  const row = page.getByRole('complementary', { name: 'Conversation' }).locator('.composer-actions');
  const boxes = (await Promise.all((await row.locator(':scope > *').all()).map((item) => item.boundingBox())))
    .filter((box): box is NonNullable<typeof box> => Boolean(box && box.width > 0));
  // Attach, the mode picker, the model menu, and Send.
  expect(boxes).toHaveLength(4);
  const rowBox = (await row.boundingBox())!;
  for (const [index, box] of boxes.entries()) {
    expect(box.x).toBeGreaterThanOrEqual(rowBox.x - 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 0.5);
    for (const other of boxes.slice(index + 1)) {
      const overlaps = box.x < other.x + other.width && other.x < box.x + box.width
        && box.y < other.y + other.height && other.y < box.y + box.height;
      expect(overlaps, `${JSON.stringify(box)} overlaps ${JSON.stringify(other)}`).toBe(false);
    }
  }
  const expectOnScreen = async (menu: Locator) => {
    await menu.locator('summary').click();
    const panel = (await menu.locator(':scope > div').boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(390);
    expect(panel.y).toBeGreaterThanOrEqual(0);
  };
  for (const menu of [row.locator('.attach-menu'), row.locator('.mode-menu'), conversation.locator('.execution-menu')]) {
    await expectOnScreen(menu);
    await page.keyboard.press('Escape');
  }
  await expectOnScreen(row.locator('.model-menu'));

  // Escape and a press outside close the menu, and so does a turn starting while it is open.
  const phoneMenu = row.locator('.model-menu');
  const phoneComposer = page.getByRole('complementary', { name: 'Conversation' }).locator('textarea');
  await page.keyboard.press('Escape');
  await expect(phoneMenu).not.toHaveAttribute('open');
  await row.locator('.model-menu summary').click();
  await phoneComposer.click();
  await expect(phoneMenu).not.toHaveAttribute('open');
  await row.locator('.model-menu summary').click();
  await phoneComposer.fill('One more turn.');
  await phoneComposer.press('Enter');
  await expect(phoneMenu).not.toHaveAttribute('open');
});

test('starts new sessions and agents at this device\'s last mode, model, and effort', async ({ page, request }) => {
  // A project of its own with a repository, so the only open views are the ones this test starts and
  // a turn can run. The newest project opens first.
  const projectName = `Remembered choices ${Date.now()}`;
  const { checkouts } = await (await request.get('/api/checkouts')).json() as { checkouts: { id: string }[] };
  const { project } = await (await request.post('/api/projects', { data: { name: projectName, checkoutIds: [checkouts[0].id] } }))
    .json() as { project: { id: string } };
  await page.goto('/');
  await expect(page.locator('.project-search-trigger')).toContainText(projectName);
  await startSession(page);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  const menu = conversation.locator('.model-menu');
  const summary = menu.locator('summary');
  const choose = async (model: string, effort?: string) => {
    await summary.click();
    await menu.getByRole('radiogroup', { name: 'Model' }).getByRole('radio', { name: model, exact: true }).click();
    if (effort) await menu.getByRole('radiogroup', { name: 'Effort' }).getByRole('radio', { name: effort, exact: true }).click();
    await summary.click();
  };
  const tabs = page.locator('.workspace-tab');
  const openTab = async (index: number) => {
    await tabs.nth(index).click();
    await ensureConversationOpen(page);
  };

  // Before any choice on this device a new session starts in Ask at Default, and keeps both as its own.
  await expect(modePicker(conversation)).toHaveText('Ask');
  await expect(summary).toHaveText('Default');
  await startSession(page);
  await chooseMode(conversation, 'Plan');
  await choose('Opus', 'High');
  await expect(summary).toHaveText('Opus · High');
  await openTab(0);
  await expect(modePicker(conversation)).toHaveText('Ask');
  await expect(summary).toHaveText('Default');
  await openTab(1);

  // A new session opens in the last mode, at the provider's last model and effort, and sends them.
  await startSession(page);
  await expect(modePicker(conversation)).toHaveText('Plan');
  await expect(summary).toHaveText('Opus · High');
  const requested = page.waitForRequest((request) => request.url().endsWith('/api/agent/message'));
  await conversation.locator('textarea').fill('Plan a small refactor.');
  await conversation.getByRole('button', { name: 'Send' }).click();
  expect((await requested).postDataJSON()).toMatchObject({ mode: 'plan', model: 'opus', effort: 'high' });
  await expect(conversation.locator('.chat-message.assistant')).toHaveCount(1);

  // A new agent starts there too. Every agent keeps the choice it started with, or its own, when
  // another agent's choice moves the device's last one.
  const chip = (role: string) => conversation.locator('.participant-chip').filter({ hasText: role });
  const addAgent = async (role: string) => {
    await conversation.locator('.add-agent-menu summary').click();
    await conversation.getByLabel('Role').selectOption(role);
    await conversation.getByRole('button', { name: 'Add participant' }).click();
    await expect(conversation.locator('.participant-chip.active')).toContainText(`Claude ${role[0].toUpperCase()}${role.slice(1)}`);
  };
  await addAgent('reviewer');
  await expect(summary).toHaveText('Opus · High');
  await choose('Default', 'Default');
  await expect(summary).toHaveText('Default');
  await chip('Main').click();
  await expect(summary).toHaveText('Opus · High');
  await addAgent('tester');
  await expect(summary).toHaveText('Default');
  await chip('Main').click();
  await choose('Sonnet', 'Low');
  await chip('Tester').click();
  await expect(summary).toHaveText('Default');
  await chip('Reviewer').click();
  await expect(summary).toHaveText('Default');

  // A session keeps its own mode when another session changes the device's last mode.
  await chooseMode(conversation, 'Agent');
  await openTab(1);
  await expect(modePicker(conversation)).toHaveText('Plan');

  // After a reload every choice is where it was, and the next session starts at the last ones.
  await page.reload({ waitUntil: 'networkidle' });
  await ensureConversationOpen(page);
  await expect(modePicker(conversation)).toHaveText('Plan');
  await expect(summary).toHaveText('Opus · High');
  await openTab(2);
  await expect(modePicker(conversation)).toHaveText('Agent');
  await chip('Main').click();
  await expect(summary).toHaveText('Sonnet · Low');
  await chip('Reviewer').click();
  await expect(summary).toHaveText('Default');
  await startSession(page);
  await expect(modePicker(conversation)).toHaveText('Agent');
  await expect(summary).toHaveText('Sonnet · Low');

  // The new session keeps the mode it started with when another session moves the last mode.
  await openTab(2);
  await chooseMode(conversation, 'Plan');
  await openTab(3);
  await expect(modePicker(conversation)).toHaveText('Agent');

  // A session started elsewhere, on another device for example, has no choices of its own on this
  // device and shows the last ones.
  const { session: elsewhere } = await (await request.post('/api/sessions', { data: { provider: 'claude', projectId: project.id } }))
    .json() as { session: { id: string } };
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('.project-search-trigger')).toContainText(projectName);
  await page.getByRole('combobox', { name: 'Session' }).selectOption(elsewhere.id);
  await ensureConversationOpen(page);
  await expect(modePicker(conversation)).toHaveText('Plan');
  await expect(summary).toHaveText('Sonnet · Low');

  // The Arena's form opens at the last mode, and what it creates with becomes the last choice.
  await page.getByRole('link', { name: 'Arena', exact: true }).click();
  const arena = page.getByRole('main', { name: 'Arena' });
  await arena.getByRole('button', { name: 'New session' }).click();
  const create = arena.getByRole('region', { name: 'Create session' });
  await expect(create.getByRole('radio', { name: 'Plan' })).toBeChecked();
  await create.getByRole('radio', { name: 'Agent' }).click();
  await create.getByRole('button', { name: 'Create and open' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(modePicker(conversation)).toHaveText('Agent');
  await startSession(page);
  await expect(modePicker(conversation)).toHaveText('Agent');
});

test('attaches from the composer, picks a mode from the keyboard, and names the execution under it', async ({ page, request, baseURL }) => {
  const disabled = await request.patch('/api/execution/docker', { headers: { Origin: baseURL! }, data: { enabled: false } });
  expect(disabled.ok()).toBe(true);
  const projectName = `E2E composer ${Date.now()}`;
  const { checkouts } = await (await request.get('/api/checkouts')).json() as { checkouts: { id: string; name: string }[] };
  await request.post('/api/projects', { data: { name: projectName, checkoutIds: [checkouts.find((checkout) => checkout.name === 'alpha')!.id] } });
  await page.goto('/');
  await expect(page.locator('.project-search-trigger')).toContainText(projectName);
  await startSession(page);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  const picker = modePicker(conversation);
  const hint = conversation.locator('.execution-hint');

  // The execution is named once, under the composer, followed by the mode's hint.
  await expect(conversation.locator(':scope > header')).not.toContainText(/Local|Docker|Continue in/);
  await expect(conversation.getByLabel(/^Execution: /)).toHaveText('Local');
  await expect(picker).toHaveText('Ask');
  await expect(hint).toHaveText('Read-only · git history');
  await conversation.getByLabel(/^Execution: /).click();
  const continuation = conversation.getByRole('menu', { name: 'Execution' }).getByRole('menuitem', { name: 'Continue in Docker…', exact: true });
  await expect(continuation).toBeDisabled();
  await expect(continuation).toHaveAccessibleDescription('Enable Docker in Arena to continue there.');
  await page.keyboard.press('Escape');

  await conversation.locator('textarea').fill('Show two alternatives');
  await conversation.getByRole('button', { name: 'Send' }).click();
  await expect(conversation.locator('.diagram-card')).toHaveCount(2);
  await expect(page.locator('.run-ribbon')).toHaveClass(/idle/);
  // Mermaid renders one at a time; once the cards have rendered, a thumbnail would have too.
  await expect(conversation.locator('.diagram-card-svg svg')).toHaveCount(2);

  // Closed, the attach menu renders no thumbnail; open, it renders the ones it shows.
  const attach = conversation.getByLabel('Attach', { exact: true });
  const attachMenu = conversation.getByRole('menu', { name: 'Attach to the next instruction' });
  const chips = conversation.locator('.attachment-chip');
  await expect(conversation.locator('.attach-menu .canvas-thumbnail [data-mermaid-theme]')).toHaveCount(0);
  await attach.click();
  const first = attachMenu.getByRole('menuitemcheckbox', { name: 'Diagram 1', exact: true });
  const second = attachMenu.getByRole('menuitemcheckbox', { name: 'Diagram 2', exact: true });
  await expect(attachMenu.getByRole('menuitemcheckbox')).toHaveCount(2);
  await expect(first).toHaveAttribute('aria-checked', 'true');
  await expect(first).toContainText('Included');
  await expect(first).toHaveAccessibleDescription('sequence · on the canvas');
  await expect(second).toHaveAttribute('aria-checked', 'false');
  await expect(second).toHaveAccessibleDescription(/^state · /);
  await expect(attachMenu.locator('.canvas-thumbnail [data-mermaid-theme] svg')).toHaveCount(2);
  await expect(attachMenu.getByRole('menuitem', { name: 'Headset report…' })).toHaveCount(0);

  // Choosing a canvas toggles the same chip History's Attach next does.
  await expect(chips).toHaveCount(1);
  await second.click();
  await expect(attachMenu).toBeHidden();
  await expect(chips).toHaveCount(2);
  await expect(chips.nth(1)).toContainText('Additional diagram included');
  await attach.click();
  await expect(second).toHaveAttribute('aria-checked', 'true');
  await second.click();
  await expect(chips).toHaveCount(1);

  await attach.click();
  await attachMenu.getByRole('menuitem', { name: 'All history…' }).click();
  await expect(page.getByRole('complementary', { name: 'Canvas history' })).toBeVisible();
  await expect(conversation).toBeVisible();
  await attach.click();
  await attachMenu.getByRole('menuitem', { name: 'New sketch' }).click();
  await expect(page.locator('.canvas-titleblock strong')).toHaveText('Sketch 1');
  await expect(chips).toHaveCount(1);
  await expect(chips).toContainText('Your sketch included');

  // One popover at a time: opening the picker from the keyboard closes the attach menu.
  const modes = conversation.getByRole('radiogroup', { name: 'Agent mode' });
  await attach.click();
  await picker.focus();
  await page.keyboard.press('Enter');
  await expect(modes).toBeVisible();
  await expect(attachMenu).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(modes).toBeHidden();

  // The picker opens, moves, chooses, and closes from the keyboard.
  await picker.focus();
  await page.keyboard.press('Enter');
  await expect(modes).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(modes.getByRole('radio', { name: 'Ask', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(modes.getByRole('radio', { name: 'Agent', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(modes).toBeHidden();
  await expect(picker).toBeFocused();
  await expect(picker).toHaveText('Agent');
  await expect(picker).toHaveAccessibleName('Mode: Agent. Edits files · asks first');
  await expect(picker).toHaveCSS('background-color', 'rgb(168, 98, 10)');
  await picker.hover();
  await expect(picker).toHaveCSS('background-color', 'rgb(168, 98, 10)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(picker).toHaveCSS('background-color', 'rgb(224, 162, 82)');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(hint).toHaveText('Edits files · asks first');
  await page.keyboard.press('Enter');
  await expect(modes).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modes).toBeHidden();
  await expect(picker).toBeFocused();

  // A chosen mode survives a reload (Story 70).
  await page.reload({ waitUntil: 'networkidle' });
  await ensureConversationOpen(page);
  await expect(picker).toHaveText('Agent');

  // A phone keeps the activity bar beside the open conversation overlay.
  await page.setViewportSize({ width: 390, height: 844 });
  await ensureConversationOpen(page);
  const phoneBar = (await activityBar(page).boundingBox())!;
  const phoneConversation = (await conversation.boundingBox())!;
  expect(phoneBar.x + phoneBar.width).toBeLessThanOrEqual(phoneConversation.x);
  await page.locator('.more-menu > summary').click();
  await expect(page.locator('.more-menu').getByRole('group', { name: 'Theme' })).toBeVisible();
  await page.locator('.more-menu > summary').click();
  await page.setViewportSize({ width: 1280, height: 720 });

  // On a phone the side panel is an overlay, so the composer's way to History closes the conversation.
  await activityView(page, 'History').click();
  await expect(page.getByRole('complementary', { name: 'Canvas history' })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await ensureConversationOpen(page);
  await attach.click();
  await attachMenu.getByRole('menuitem', { name: 'All history…' }).click();
  await expect(page.getByRole('complementary', { name: 'Canvas history' })).toBeVisible();
  await expect(conversation).toHaveCount(0);
});

test('picks side-panel views from the activity bar, leaves focus, and reaches the Arena', async ({ page, request }) => {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as { checkouts: Array<{ id: string; name: string }> };
  const name = `Activity bar ${Date.now()}`;
  await request.post('/api/projects', { data: { name, checkoutIds: [checkouts.find((checkout) => checkout.name === 'alpha')!.id] } });
  await page.route('**/api/repository/status?*', (route) => route.fulfill({ json: { tree: { isRepository: true, files: [
    { path: 'one.ts', status: 'modified', staged: false, unstaged: true },
    { path: 'two.ts', status: 'untracked', staged: false, unstaged: true },
  ] } } }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await startSession(page);

  // The header keeps identity and readiness; views, the Arena, and More moved to the bar.
  const header = page.locator('.app-header');
  await expect(header.getByRole('link')).toHaveCount(0);
  await expect(header.getByRole('button', { name: /^(Repository|Arena|Inbox)/ })).toHaveCount(0);
  await expect(header.locator('details:not(.new-session-menu, .device-menu)')).toHaveCount(0);
  const bar = activityBar(page);
  await expect(bar.locator(':scope > :is(button, a), .more-menu > summary')).toHaveCount(5);
  await expect(activityView(page, 'Changes')).toHaveAccessibleName('Changes, 2 files');
  await expect(activityView(page, 'Changes').locator('.activity-badge')).toHaveText('2');
  const [barBox, canvasBox] = await Promise.all([bar.boundingBox(), page.locator('.canvas-workspace').boundingBox()]);
  expect(barBox!.width).toBe(48);
  expect(barBox!.x + barBox!.width).toBeLessThanOrEqual(canvasBox!.x + 1);
  await expect(page.locator('.canvas-top-actions').getByRole('button', { name: /History/ })).toHaveCount(0);

  // Each view toggles itself, and another view switches the panel.
  const sidePanel = page.locator('.repository-sidebar');
  await activityView(page, 'Changes').click();
  await expect(page.getByRole('complementary', { name: 'Repository' })).toBeVisible();
  await expect(sidePanel.getByRole('heading', { name: 'Changes' })).toBeVisible();
  await expect(sidePanel.getByRole('button', { name: /Close|History|Reports/ })).toHaveCount(0);
  await activityView(page, 'History').click();
  await expect(page.getByRole('complementary', { name: 'Canvas history' })).toBeVisible();
  await expect(activityView(page, 'Changes')).toHaveAttribute('aria-pressed', 'false');
  await expect(activityView(page, 'History')).toHaveAttribute('aria-pressed', 'true');

  // Focus mode hides the panel; pressing its view shows it again instead of closing it unseen.
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Canvas history' })).toBeHidden();
  await expect(activityView(page, 'History')).toHaveAttribute('aria-pressed', 'false');
  await activityView(page, 'History').click();
  await expect(page.getByRole('complementary', { name: 'Canvas history' })).toBeVisible();
  await expect(page.locator('.canvas-workspace')).not.toHaveClass(/focus-mode/);
  await activityView(page, 'History').click();
  await expect(page.getByRole('complementary', { name: 'Canvas history' })).toBeHidden();

  // More opens beside the bar and stays on screen.
  const more = page.locator('.more-menu');
  await more.locator('summary').click();
  const menu = more.locator(':scope > div');
  await expect(menu.getByRole('group', { name: 'Theme' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Export session' })).toBeVisible();
  const menuBox = (await menu.boundingBox())!;
  expect(menuBox.x).toBeGreaterThanOrEqual(barBox!.x + barBox!.width);
  expect(menuBox.y).toBeGreaterThanOrEqual(0);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(900);
  await more.locator('summary').click();

  // The Arena and the Inbox are pages until they become side-panel views; the open one is marked.
  await bar.getByRole('link', { name: 'Arena', exact: true }).click();
  await expect(page.getByRole('main', { name: 'Arena' })).toBeVisible();
  await expect(bar.getByRole('link', { name: 'Arena', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(bar.getByRole('button', { name: /^(Changes|History)/ })).toHaveCount(0);
  await bar.getByRole('link', { name: /^Inbox/ }).click();
  await expect(page).toHaveURL(/\/arena\/inbox$/);
  await expect(bar.getByRole('link', { name: /^Inbox/ })).toHaveAttribute('aria-current', 'page');
  await expect(bar.getByRole('link', { name: 'Arena', exact: true })).not.toHaveAttribute('aria-current', /.+/);
});

test('hides the canvas for a wide conversation, and never hides it with the conversation', async ({ page, request }) => {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as { checkouts: Array<{ id: string; name: string }> };
  const name = `Canvas toggle ${Date.now()}`;
  await request.post('/api/projects', { data: { name, checkoutIds: [checkouts.find((checkout) => checkout.name === 'alpha')!.id] } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await startSession(page);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await conversation.locator('textarea').fill('Draw a simple architecture');
  await conversation.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('.mermaid-layer svg')).toBeVisible();
  await expect(page.locator('.run-ribbon')).toHaveClass(/idle/);

  const layout = page.getByRole('group', { name: 'Layout' });
  const canvasToggle = layout.getByRole('button', { name: 'Canvas', exact: true });
  await expect(layout.getByRole('button')).toHaveCount(2);
  await expect(canvasToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(conversationToggle(page)).toHaveAttribute('aria-pressed', 'true');
  // The Conversation icon is the conversation's one close control.
  await expect(conversation.getByRole('button', { name: /^Close/ })).toHaveCount(0);

  // A mark drawn before hiding the canvas returns with it; a drawing shortcut pressed while it is
  // hidden does nothing, because the hidden canvas is not mounted.
  await closeConversation(page);
  await page.getByRole('button', { name: 'Pen (P)' }).click();
  const ink = (await page.locator('svg.ink-layer').boundingBox())!;
  await page.mouse.move(ink.x + ink.width * .3, ink.y + ink.height * .3);
  await page.mouse.down();
  await page.mouse.move(ink.x + ink.width * .5, ink.y + ink.height * .5, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('[data-mark-id]')).toHaveCount(1);

  // Hiding the canvas opens the conversation, which reads in a centred column of up to 760px.
  await canvasToggle.click();
  await expect(canvasToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(conversation).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveClass(/canvas-hidden/);
  await expect(page.locator('.canvas-workspace')).toHaveCSS('display', 'none');
  await expect(page.getByRole('tabpanel')).toHaveCount(0);
  await expect(page.locator('.diagram-canvas-shell')).toHaveCount(0);
  await expect(conversation).toHaveCSS('border-left-width', '0px');
  await expect(page.getByRole('separator', { name: 'Resize conversation panel' })).toHaveCount(0);
  const [pane, composer] = await Promise.all([conversation.boundingBox(), conversation.locator('.instruction-composer').boundingBox()]);
  expect(pane!.x).toBe(48);
  expect(pane!.width).toBe(1440 - 48);
  expect(composer!.width).toBeLessThanOrEqual(760);
  expect(Math.abs(composer!.x + composer!.width / 2 - (pane!.x + pane!.width / 2))).toBeLessThan(2);
  await canvasToggle.press('r');
  await expect(conversation.locator('textarea')).toHaveValue('');

  // Closing the conversation brings the canvas back: the two are never hidden together.
  await closeConversation(page);
  await expect(canvasToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.mermaid-layer svg')).toBeVisible();
  await expect(page.locator('[data-mark-id]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Rectangle (R)' })).toHaveAttribute('aria-pressed', 'false');
  await openConversation(page);
  await expect(canvasToggle).toHaveAttribute('aria-pressed', 'true');

  // A hidden canvas is device layout that survives a reload; showing it again fits the new width.
  await canvasToggle.click();
  await page.reload();
  await expect(page.getByRole('complementary', { name: 'Conversation' })).toBeVisible();
  await expect(canvasToggle).toHaveAttribute('aria-pressed', 'false');
  await canvasToggle.click();
  await expect(page.locator('.mermaid-layer svg')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('.canvas-stage')!.getBoundingClientRect();
    const diagram = document.querySelector<HTMLElement>('.mermaid-layer')!.getBoundingClientRect();
    return diagram.left >= stage.left && diagram.right <= stage.right && diagram.width > stage.width / 3;
  })).toBe(true);

  // Returning at a different width, a fitted view fits the canvas it returns to.
  await canvasToggle.click();
  await activityView(page, 'Changes').click();
  await canvasToggle.click();
  await expect(page.getByRole('complementary', { name: 'Repository' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('.canvas-stage')!.getBoundingClientRect();
    const diagram = document.querySelector<HTMLElement>('.mermaid-layer')!.getBoundingClientRect();
    return diagram.left >= stage.left && diagram.right <= stage.right;
  })).toBe(true);
  await activityView(page, 'Changes').click();

  // Opening a diagram or starting a sketch from the conversation brings a hidden canvas back.
  await canvasToggle.click();
  await conversation.getByRole('button', { name: 'Open on canvas' }).first().click();
  await expect(canvasToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.mermaid-layer svg')).toBeVisible();
  await canvasToggle.click();
  await conversation.getByLabel('Attach', { exact: true }).click();
  await conversation.getByRole('menu', { name: 'Attach to the next instruction' }).getByRole('menuitem', { name: 'New sketch' }).click();
  await expect(canvasToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.canvas-titleblock strong')).toHaveText('Sketch 1');
  await conversation.getByRole('button', { name: 'Open on canvas' }).first().click();
  await expect(page.locator('.canvas-titleblock strong')).toHaveText('Diagram 1');

  // Focus mode gives way to a hidden canvas instead of blanking the shell.
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await canvasToggle.click();
  await expect(conversation).toBeVisible();
  await expect(canvasToggle).toHaveAttribute('aria-pressed', 'false');

  // Where one dock fits beside the canvas, both panels still fit beside a hidden one.
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(page.locator('.app-shell')).toHaveClass(/dock-capacity-1/);
  await activityView(page, 'Changes').click();
  await expect(page.getByRole('complementary', { name: 'Repository' })).toBeVisible();
  await expect(conversation).toBeVisible();
  await canvasToggle.click();
  await expect(page.getByRole('complementary', { name: 'Repository' })).toBeHidden();
  await expect(conversation).toBeVisible();
  await expect(page.locator('.mermaid-layer svg')).toBeVisible();

  // Below the one-dock band the panels overlay a canvas that always shows.
  await canvasToggle.click();
  await page.setViewportSize({ width: 600, height: 900 });
  await expect(page.locator('.app-shell')).toHaveClass(/dock-capacity-0/);
  await expect(canvasToggle).toHaveCount(0);
  await expect(page.locator('.mermaid-layer svg')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(canvasToggle).toHaveAttribute('aria-pressed', 'false');
  await canvasToggle.click();

  // A closed conversation carries its pending approval on its icon.
  await chooseMode(conversation, 'Agent');
  await conversation.locator('textarea').fill('Make one approved edit.');
  await conversation.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(conversation.getByLabel(/Approval required: Edit/)).toBeVisible();
  await expect(conversationToggle(page)).toHaveAccessibleName('Conversation');
  await closeConversation(page);
  await expect(conversationToggle(page)).toHaveAccessibleName('Conversation, 1 action waiting for your approval');
  await expect(conversationToggle(page).locator('.layout-badge')).toHaveText('1');
  await expect(conversationToggle(page).locator('.layout-badge')).toHaveCSS('background-color', 'rgb(168, 98, 10)');
  await openConversation(page);
  await conversation.getByRole('button', { name: 'Deny' }).click();
  await expect(page.locator('.run-ribbon')).toHaveClass(/idle/);
});

test('docks only the panels that fit the live shell width', async ({ page }) => {
  // The bands are the column minimums plus the 48px activity bar: one dock from 688, two from 1008.
  await page.setViewportSize({ width: 1008, height: 720 });
  await page.goto('/');
  await startSession(page);

  const shell = page.locator('.app-shell');
  const repository = page.getByRole('complementary', { name: 'Repository' });
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await expect(shell).toHaveClass(/dock-capacity-2/);
  await page.setViewportSize({ width: 1007, height: 720 });
  await expect(shell).toHaveClass(/dock-capacity-1/);
  await page.setViewportSize({ width: 688, height: 720 });
  await expect(shell).toHaveClass(/dock-capacity-1/);
  await expect(conversation).toBeVisible();
  await expect(repository).toBeHidden();

  // At one-panel capacity, the newly opened repository replaces the conversation column.
  await activityView(page, 'Changes').click();
  await expect(repository).toBeVisible();
  await expect(conversation).toBeHidden();

  // Below the one-panel minimum both surfaces become overlays and can remain open together.
  await page.setViewportSize({ width: 687, height: 720 });
  await expect(shell).toHaveClass(/dock-capacity-0/);
  await page.setViewportSize({ width: 600, height: 720 });
  await openConversation(page);
  await expect(repository).toBeVisible();
  await expect(conversation).toBeVisible();
  await expect(repository).toHaveCSS('position', 'absolute');
  await expect(page.locator('.repository-region')).toHaveCSS('position', 'fixed');
  await expect(page.locator('.conversation-region')).toHaveCSS('position', 'fixed');
  // The side panel overlay starts beside the activity bar, which stays usable over the canvas.
  const [barBox, overlayBox] = await Promise.all([activityBar(page).boundingBox(), repository.boundingBox()]);
  expect(barBox!.x + barBox!.width).toBeLessThanOrEqual(overlayBox!.x + 1);
  await expect(activityView(page, 'Changes')).toHaveAttribute('aria-pressed', 'true');
  // More opens over the side panel overlay rather than under it.
  const more = page.locator('.more-menu');
  await more.locator('summary').click();
  const menuBox = (await more.locator(':scope > div').boundingBox())!;
  expect(menuBox.x).toBeLessThan(overlayBox!.x + overlayBox!.width);
  expect(await page.evaluate(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('.more-menu')),
    [menuBox.x + menuBox.width / 2, menuBox.y + menuBox.height / 2])).toBe(true);
  await more.locator('summary').click();

  const conversationSeparator = page.getByRole('separator', { name: 'Resize conversation panel' });
  const conversationWidth = Number(await conversationSeparator.getAttribute('aria-valuenow'));
  await conversationSeparator.press('ArrowLeft');
  await expect(conversationSeparator).toHaveAttribute('aria-valuenow', String(conversationWidth + 8));

  // Widening restores both as columns while retaining at least 360px for the canvas.
  await page.setViewportSize({ width: 1100, height: 720 });
  await expect(shell).toHaveClass(/dock-capacity-2/);
  const [repositoryBox, canvasBox, conversationBox] = await Promise.all([
    repository.boundingBox(),
    page.locator('.canvas-workspace').boundingBox(),
    conversation.boundingBox(),
  ]);
  expect(repositoryBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  expect(conversationBox).not.toBeNull();
  expect(canvasBox!.width).toBeGreaterThanOrEqual(360);
  expect(repositoryBox!.x + repositoryBox!.width).toBeLessThanOrEqual(canvasBox!.x + 1);
  expect(canvasBox!.x + canvasBox!.width).toBeLessThanOrEqual(conversationBox!.x + 1);
});

test('switches themes, repaints Mermaid, and keeps attachment composites light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => localStorage.setItem('code-ai:theme', 'dark'));
  await page.goto('/');

  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Dark', exact: true, includeHidden: true })).toHaveAttribute('aria-pressed', 'true');

  await startSession(page);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  const composer = conversation.locator('textarea');
  await composer.fill('Draw a simple architecture');
  await conversation.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.mermaid-layer[data-mermaid-theme="dark"] svg')).toBeVisible();
  await expect(conversation.locator('.diagram-card-svg[data-mermaid-theme="dark"] svg')).toBeVisible();
  await expect(page.locator('.tool-timeline')).toHaveCount(0);

  await closeConversation(page);
  await page.getByRole('button', { name: 'Pen (P)' }).click();
  const ink = page.locator('svg.ink-layer');
  const box = await ink.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * 0.3, box!.y + box!.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5, { steps: 6 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Pointer (V)' }).click();
  await page.mouse.move(box!.x + box!.width * 0.55, box!.y + box!.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.65, box!.y + box!.height * 0.62);
  await page.mouse.up();
  const transformBeforeThemeChange = await page.locator('.diagram-scene').getAttribute('style');
  await expect(page.locator('[data-mark-id]')).toHaveCount(1);

  await openConversation(page);
  const darkSvg = await page.locator('.mermaid-layer svg').evaluate((element) => element.outerHTML);
  await fromMoreMenu(page, 'Light');
  await expect(root).toHaveAttribute('data-theme', 'light');
  expect(await root.evaluate((element) => getComputedStyle(element).colorScheme)).toBe('light');
  await expect(page.locator('.mermaid-layer[data-mermaid-theme="light"] svg')).toBeVisible();
  await expect(conversation.locator('.diagram-card-svg[data-mermaid-theme="light"] svg')).toBeVisible();
  const lightSvg = await page.locator('.mermaid-layer svg').evaluate((element) => element.outerHTML);
  expect(lightSvg).not.toBe(darkSvg);
  await expect(page.locator('.diagram-scene')).toHaveAttribute('style', transformBeforeThemeChange!);
  await expect(page.locator('[data-mark-id]')).toHaveCount(1);

  await fromMoreMenu(page, 'System');
  await expect(root).not.toHaveAttribute('data-theme', /.+/);
  await expect(page.locator('.mermaid-layer[data-mermaid-theme="dark"] svg')).toBeVisible();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).not.toHaveAttribute('data-theme', /.+/);
  await expect(page.locator('.mermaid-layer[data-mermaid-theme="light"] svg')).toBeVisible();

  await fromMoreMenu(page, 'Dark');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  expect(await root.evaluate((element) => getComputedStyle(element).colorScheme)).toBe('dark');
  const requestPromise = page.waitForRequest((request) => request.url().endsWith('/api/agent/message'));
  await composer.fill('Explain the attached diagram briefly');
  await conversation.getByRole('button', { name: 'Send' }).click();
  const request = await requestPromise;
  const payload = request.postDataJSON() as { diagramAttachments: Array<{ compositePngDataUrl?: string }> };
  const composite = payload.diagramAttachments[0]?.compositePngDataUrl;
  expect(composite).toMatch(/^data:image\/png;base64,/);
  const cornerPixel = await page.evaluate(async (dataUrl) => {
    const image = new Image();
    image.src = dataUrl!;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  }, composite);
  expect(cornerPixel[0] + cornerPixel[1] + cornerPixel[2]).toBeGreaterThan(700);
  expect(cornerPixel[3]).toBe(255);
  await expect(page.locator('.mermaid-layer[data-mermaid-theme="dark"] svg')).toBeVisible();
  await expect(page.locator('.tool-timeline')).toHaveCount(0);

  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Dark', exact: true, includeHidden: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.mermaid-layer[data-mermaid-theme="dark"] svg')).toBeVisible();

  const blockedContext = await page.context().browser()!.newContext({ colorScheme: 'dark' });
  await blockedContext.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Storage blocked'); };
    Storage.prototype.setItem = () => { throw new DOMException('Storage blocked'); };
  });
  const blockedPage = await blockedContext.newPage();
  await blockedPage.goto('/');
  await expect(blockedPage.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  await expect(blockedPage.getByRole('button', { name: 'System', exact: true, includeHidden: true })).toHaveAttribute('aria-pressed', 'true');
  await fromMoreMenu(blockedPage, 'Dark');
  await expect(blockedPage.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  await expect(blockedPage.getByRole('button', { name: 'System', exact: true, includeHidden: true })).toHaveAttribute('aria-pressed', 'true');
  await blockedContext.close();
});
