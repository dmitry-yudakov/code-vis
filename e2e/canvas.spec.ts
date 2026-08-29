import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function startConversation(page: Page) {
  await page.locator('.new-thread-menu summary').click();
  await page.getByRole('button', { name: 'Start conversation' }).click();
}

test('creates, annotates, revises, restores, and exports a canvas conversation', async ({ page }) => {
  const externalFontRequests: string[] = [];
  page.on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (host === 'fonts.googleapis.com' || host === 'fonts.gstatic.com') externalFontRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Your repository/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe('loaded');
  const fontVariables = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return ['--font-geist', '--font-geist-mono', '--font-archivo']
      .map((name) => styles.getPropertyValue(name).trim());
  });
  expect(fontVariables.every(Boolean)).toBe(true);
  expect(externalFontRequests).toEqual([]);
  await page.getByRole('button', { name: /alpha/ }).click();
  await expect(page.locator('.project-search-meta')).toContainText('3 projects');
  await expect(page.locator('.project-search-meta')).toContainText('Depth 2');
  const projectSearch = page.getByRole('searchbox', { name: 'Search projects' });
  await projectSearch.fill('not-a-project');
  await expect(page.locator('.project-search-empty')).toContainText('No projects match');
  await projectSearch.fill('DEEP');
  const projectResults = page.getByRole('listbox', { name: 'Projects' });
  await expect(projectResults.getByRole('option')).toHaveCount(1);
  await projectResults.getByRole('option', { name: /packages\/deep-app/ }).click();
  await expect(page.locator('.project-search-trigger')).toContainText('packages/deep-app');
  await startConversation(page);

  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await expect(conversation).toBeVisible();
  const openConversation = page.getByRole('button', { name: 'Open conversation' });

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
  await expect(page.locator('.canvas-titleblock')).toContainText('0 marks');
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
  await page.getByRole('button', { name: 'Close conversation' }).click();
  await expect(page.locator('.instruction-composer')).toHaveCount(0);

  await page.getByRole('button', { name: 'Pen (P)' }).click();
  const ink = page.locator('svg.ink-layer');
  const box = await ink.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width * .3, box!.y + box!.height * .35);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * .55, box!.y + box!.height * .55, { steps: 8 });
  await page.mouse.up();
  await openConversation.click();
  await expect(page.locator('.attachment-chip')).toContainText('1 marks');
  await page.getByRole('button', { name: 'Close conversation' }).click();

  await page.getByRole('button', { name: 'Focus' }).click();
  await expect(page.locator('.canvas-workspace')).toHaveClass(/focus-mode/);
  await expect(repository).toBeHidden();
  await page.getByRole('button', { name: 'Exit focus' }).click();
  await openConversation.click();
  const revisionComposer = page.getByPlaceholder(/Ask about or revise/);
  await revisionComposer.fill('Revise it with a context step');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('button', { name: /Previous version/ })).toBeVisible();
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
  await page.getByRole('button', { name: 'Close conversation' }).click();

  await page.getByRole('button', { name: /History/ }).click();
  await expect(page.locator('.navigator-item')).toHaveCount(4);
  await page.getByRole('complementary', { name: 'Canvas history' }).locator('header button').click();

  await page.reload();
  await expect(page.locator('.diagram-canvas-shell')).toBeVisible();
  // Focused canvas is device state; after reload the newest durable canvas is selected.
  await expect(page.locator('.canvas-titleblock strong')).toHaveText('Diagram 2');
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('code-ai:web2:v1:')))).toEqual([]);

  await page.locator('.project-search-trigger').click();
  const recentProjects = page.getByRole('group', { name: 'Recent' });
  await expect(recentProjects).toBeVisible();
  await expect(recentProjects.getByRole('option').first()).toContainText('packages/deep-app');
  await expect(page.getByRole('listbox', { name: 'Projects' }).getByRole('option')).toHaveCount(3);
  await page.getByRole('searchbox', { name: 'Search projects' }).fill('alpha');
  await expect(page.getByRole('group', { name: 'Recent' })).toHaveCount(0);
  await expect(projectResults.getByRole('option')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Search projects' }).press('Escape');

  // A separate browser context hydrates the same committed host conversation after selecting its checkout.
  const secondContext = await page.context().browser()!.newContext();
  const secondPage = await secondContext.newPage();
  await secondPage.goto('/');
  await secondPage.locator('.project-search-trigger').click();
  await secondPage.getByRole('searchbox', { name: 'Search projects' }).fill('DEEP');
  await secondPage.getByRole('option', { name: /packages\/deep-app/ }).click();
  await expect(secondPage.locator('.canvas-titleblock strong')).toHaveText('Diagram 2');
  await secondContext.close();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^codeai-.*\.json$/);

  await page.screenshot({ path: 'test-results/codeai-canvas.png', fullPage: true });
});

test('sketches a blank canvas and sends the drawing as the instruction', async ({ page }) => {
  await page.goto('/');
  await startConversation(page);
  await page.getByRole('button', { name: 'Close conversation' }).click();

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
  await page.getByRole('button', { name: 'Open conversation' }).click();
  await expect(page.locator('.attachment-chip')).toContainText('Your sketch included · 1 marks');
  // The drawing is the instruction: sending needs no typed text.
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.chat-message.user')).toContainText('1 sketch attached');
  await expect(page.locator('.chat-message.assistant')).toBeVisible();

  await page.getByRole('button', { name: 'Close conversation' }).click();
  await page.reload();
  await expect(page.locator('.sketch-sheet')).toBeVisible();
  await page.getByRole('button', { name: /History/ }).click();
  await expect(page.locator('.navigator-item')).toContainText('Sketch 1');
});

test('discovers, reattaches, and cancels a turn that outlives a reload', async ({ page }) => {
  await page.goto('/');
  await startConversation(page);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await conversation.locator('textarea').fill('Wait for reload cancellation.');
  await conversation.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.tool-timeline')).toContainText('Reading README.md');

  const discovery = page.waitForResponse((response) => response.url().includes('/api/agent/runs?threadId='));
  await page.reload();
  expect((await (await discovery).json()).active).toHaveLength(1);
  await expect(page.getByRole('button', { name: /Open conversation/ })).toHaveAttribute('aria-label', /Agent working/);
  await page.getByRole('button', { name: /Open conversation/ }).click();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.notice-banner')).toContainText('cancelled');
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
});

test('traces an Agent run without implying progress and shifts to wait for approval', async ({ page }) => {
  await page.goto('/');
  await startConversation(page);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  const agentMode = conversation.getByRole('radio', { name: 'Agent' });
  await agentMode.click();
  await expect(agentMode).toHaveAttribute('aria-checked', 'true');

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
  await startConversation(page);
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

  // A completed retained reviewer run must not announce itself as live or rewrite device-local
  // selection when this browser reloads. The primary coder is the hydration default.
  await conversation.locator('.participant-chip').filter({ hasText: '@Claude' }).filter({ hasText: 'Main' }).click();
  const discovery = page.waitForResponse((response) => response.url().includes('/api/agent/runs?threadId='));
  await page.reload({ waitUntil: 'networkidle' });
  expect((await (await discovery).json()).active).toHaveLength(0);
  await expect(page.locator('.unread-badge')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open conversation' }).click();
  await expect(page.getByRole('complementary', { name: 'Conversation' }).locator('.participant-chip.active')).toContainText('Main');
  await expect(page.locator('.stream-preview')).toHaveCount(0);
  await expect(page.locator('.notice-banner')).toHaveCount(0);

  const reloadedConversation = page.getByRole('complementary', { name: 'Conversation' });
  await reloadedConversation.locator('.participant-chip').filter({ hasText: 'Reviewer' }).click();
  await reloadedConversation.getByRole('button', { name: 'Make @Claude Reviewer the main agent' }).click();
  await expect(reloadedConversation.locator('.participant-chip.active')).toContainText('Main');
});

test('docks only the panels that fit the live shell width', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 720 });
  await page.goto('/');
  await startConversation(page);

  const shell = page.locator('.app-shell');
  const repository = page.getByRole('complementary', { name: 'Repository' });
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await expect(shell).toHaveClass(/dock-capacity-1/);
  await expect(conversation).toBeVisible();
  await expect(repository).toBeHidden();

  // At one-panel capacity, the newly opened repository replaces the conversation column.
  await page.locator('.repository-toggle').click();
  await expect(repository).toBeVisible();
  await expect(conversation).toBeHidden();

  // Below the one-panel minimum both surfaces become overlays and can remain open together.
  await page.setViewportSize({ width: 600, height: 720 });
  await expect(shell).toHaveClass(/dock-capacity-0/);
  await page.getByRole('button', { name: 'Open conversation' }).click();
  await expect(repository).toBeVisible();
  await expect(conversation).toBeVisible();
  await expect(repository).toHaveCSS('position', 'absolute');
  await expect(page.locator('.repository-region')).toHaveCSS('position', 'fixed');
  await expect(page.locator('.conversation-region')).toHaveCSS('position', 'fixed');

  const conversationSeparator = page.getByRole('separator', { name: 'Resize conversation panel' });
  const conversationWidth = Number(await conversationSeparator.getAttribute('aria-valuenow'));
  await conversationSeparator.press('ArrowLeft');
  await expect(conversationSeparator).toHaveAttribute('aria-valuenow', String(conversationWidth + 8));

  // Widening restores both as columns while retaining at least 360px for the canvas.
  await page.setViewportSize({ width: 1000, height: 720 });
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
  await expect(page.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await startConversation(page);
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  const composer = conversation.locator('textarea');
  await composer.fill('Draw a simple architecture');
  await conversation.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.mermaid-layer[data-mermaid-theme="dark"] svg')).toBeVisible();
  await expect(conversation.locator('.diagram-card-svg[data-mermaid-theme="dark"] svg')).toBeVisible();
  await expect(page.locator('.tool-timeline')).toHaveCount(0);

  await conversation.getByRole('button', { name: 'Close conversation' }).click();
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

  await page.getByRole('button', { name: 'Open conversation' }).click();
  const darkSvg = await page.locator('.mermaid-layer svg').evaluate((element) => element.outerHTML);
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  expect(await root.evaluate((element) => getComputedStyle(element).colorScheme)).toBe('light');
  await expect(page.locator('.mermaid-layer[data-mermaid-theme="light"] svg')).toBeVisible();
  await expect(conversation.locator('.diagram-card-svg[data-mermaid-theme="light"] svg')).toBeVisible();
  const lightSvg = await page.locator('.mermaid-layer svg').evaluate((element) => element.outerHTML);
  expect(lightSvg).not.toBe(darkSvg);
  await expect(page.locator('.diagram-scene')).toHaveAttribute('style', transformBeforeThemeChange!);
  await expect(page.locator('[data-mark-id]')).toHaveCount(1);

  await page.getByRole('button', { name: 'System', exact: true }).click();
  await expect(root).not.toHaveAttribute('data-theme', /.+/);
  await expect(page.locator('.mermaid-layer[data-mermaid-theme="dark"] svg')).toBeVisible();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).not.toHaveAttribute('data-theme', /.+/);
  await expect(page.locator('.mermaid-layer[data-mermaid-theme="light"] svg')).toBeVisible();

  await page.getByRole('button', { name: 'Dark', exact: true }).click();
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
  await expect(page.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.mermaid-layer[data-mermaid-theme="dark"] svg')).toBeVisible();

  const blockedContext = await page.context().browser()!.newContext({ colorScheme: 'dark' });
  await blockedContext.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Storage blocked'); };
    Storage.prototype.setItem = () => { throw new DOMException('Storage blocked'); };
  });
  const blockedPage = await blockedContext.newPage();
  await blockedPage.goto('/');
  await expect(blockedPage.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  await expect(blockedPage.getByRole('button', { name: 'System', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await blockedPage.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(blockedPage.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  await expect(blockedPage.getByRole('button', { name: 'System', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await blockedContext.close();
});
