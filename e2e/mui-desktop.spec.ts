import { expect, test, type Locator, type Page } from '@playwright/test';
import { openMachineSettings } from './machine-settings';

async function expectScreenshot(target: Locator, name: string, options: { mask?: Locator[] } = {}) {
  await expect(target).toBeVisible();
  await expect(target).toHaveScreenshot(name, { animations: 'disabled', ...options });
}

async function settingsFixture(page: Page, saving?: Promise<void>) {
  await page.route('**/api/instructions', async (route) => {
    if (route.request().method() === 'PATCH') await saving;
    await route.fulfill({ json: { shared: false, providers: {
      claude: { enabled: true, displayPath: '~/.claude/CLAUDE.md', text: 'Keep changes focused.', imports: false, docker: { entries: [], skipped: [] } },
      codex: { enabled: true, displayPath: '~/.codex/AGENTS.md', text: 'Verify the changed behavior.', imports: false, localAlways: true, docker: { entries: [], skipped: [] } },
    } } });
  });
}

const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (/hydration|did not match|server rendered/i.test(message.text())) errors.push(message.text()); });
});
test.afterEach(async ({ page, request }) => {
  expect(browserErrors.get(page)).toEqual([]);
  const runs = await (await request.get('/api/agent/runs')).json();
  for (const run of runs.active ?? []) await request.post('/api/agent/cancel', { data: { runId: run.runId } });
});

test('MUI dialogs retain backdrop protection, textarea focus and nested model selection', async ({ page }) => {
  await page.route('**/api/health', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const choices = { models: [{ id: 'pilot-model', label: 'Pilot model', efforts: ['low', 'high'] }], efforts: ['low', 'high'] };
    Object.assign(body.providers.claude, choices);
    Object.assign(body.executions.local.providers.claude, choices);
    await route.fulfill({ response, json: body });
  });
  await page.goto('/arena');
  const settings = await openMachineSettings(page);
  await expect(settings).toHaveClass(/MuiDialog-paper/);
  await page.mouse.click(2, 2);
  await expect(settings).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'New session', exact: true });
  const message = setup.getByRole('textbox', { name: 'First message (optional)' });
  await expect(message).toBeFocused();
  await message.fill('Retained MUI draft');
  await setup.getByRole('button', { name: /Model and effort/ }).click();
  const models = page.getByRole('radiogroup', { name: 'Model', exact: true });
  await models.getByRole('radio', { name: 'Pilot model', exact: true }).click();
  await page.getByRole('radiogroup', { name: 'Effort' }).getByRole('radio', { name: 'High', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(models).toBeHidden();
  await expect(setup).toBeVisible();
  await expect(setup.getByRole('button', { name: /Model and effort/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(setup).toBeHidden();
  await expect(page.getByRole('button', { name: 'New session', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await expect(message).toHaveValue('Retained MUI draft');
  await expect(setup.getByRole('button', { name: /Model and effort/ })).toContainText('Pilot model · High');
});

test('the existing appearance key governs MUI, portals and system changes', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('code-ai:theme', 'system'));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/arena');
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
  const settings = await openMachineSettings(page);
  const samePaper = () => settings.evaluate((element) => {
    const themeColor = getComputedStyle(document.documentElement).getPropertyValue('--raised').trim();
    const probe = document.createElement('span');
    probe.style.color = themeColor;
    document.body.append(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return { actual: getComputedStyle(element).backgroundColor, expected };
  });
  const dark = await samePaper();
  expect(dark.actual).toBe(dark.expected);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
  const colors = await samePaper();
  expect(colors.actual).toBe(colors.expected);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light');
});

for (const storage of ['available', 'unavailable']) test(`dark CSS is correct before hydration with ${storage} storage`, async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript((state) => {
    if (state === 'unavailable') Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage unavailable'); } });
    else localStorage.setItem('code-ai:theme', 'dark');
  }, storage);
  await page.route('**/_next/static/**/*.js', (route) => route.abort());
  await page.goto('/arena');
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'dark');
  expect(await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    return css.getPropertyValue('--raised').trim() === css.getPropertyValue('--mui-palette-background-paper').trim();
  })).toBe(true);
  await expect(page.locator('body style[data-emotion]')).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  for (const [width, height] of [[1440, 900], [1000, 800], [360, 800]]) {
    test(`pilot visual baseline ${theme} ${width}`, async ({ page }) => {
      await settingsFixture(page);
      await page.setViewportSize({ width, height });
      await page.addInitScript((appearance) => {
        localStorage.clear();
        localStorage.setItem('code-ai:theme', appearance);
      }, theme);
      await page.route('**/api/arena**', async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        for (const entry of body.machines) {
          entry.machine.label = 'Home machine';
          entry.projects = [];
          entry.checkouts = [];
          entry.sessions = [];
        }
        await route.fulfill({ response, json: body });
      });
      await page.goto('/arena');
      const settings = await openMachineSettings(page);
      await expect(settings.getByRole('checkbox', { name: 'Use global instructions for Claude' })).toBeVisible();
      await expectScreenshot(settings, `settings-${theme}-${width}.png`);
      await settings.getByRole('button', { name: 'Close settings' }).click();
      await page.getByRole('button', { name: 'New session', exact: true }).click();
      const setup = page.getByRole('dialog', { name: 'New session', exact: true });
      await expect(setup.getByRole('textbox')).toBeFocused();
      await expectScreenshot(setup, `setup-${theme}-${width}.png`);
      expect(await setup.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    });
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 1000, 360]) test(`conversation visual baseline ${theme} ${width}`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 800 });
    await page.addInitScript((appearance) => { localStorage.clear(); localStorage.setItem('code-ai:theme', appearance); }, theme);
    const { checkouts } = await (await request.get('/api/checkouts')).json();
    const { project } = await (await request.post('/api/projects', { data: { name: 'MUI visual fixture', checkoutIds: [checkouts.find((item: { name: string }) => item.name === 'alpha').id] } })).json();
    await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } });
    await page.goto('/');
    const conversation = page.getByRole('complementary', { name: 'Conversation' });
    await expect(conversation.getByRole('textbox', { name: 'Instruction' })).toBeFocused();
    await expectScreenshot(conversation.locator('.drawer-composer'), `composer-${theme}-${width}.png`);
    await conversation.getByRole('button', { name: /^Mode:/ }).click();
    await expectScreenshot(page.locator('.desktop-picker-paper:visible'), `modes-${theme}-${width}.png`);
    await page.getByRole('radio', { name: 'Agent', exact: true }).click();
    await conversation.getByRole('textbox', { name: 'Instruction' }).fill('Make a bounded change.');
    await conversation.getByRole('button', { name: 'Send', exact: true }).click();
    const approval = conversation.getByRole('article', { name: 'Approval required: Edit' });
    await expect(approval.getByRole('button', { name: 'Allow', exact: true })).toBeVisible();
    await expectScreenshot(approval, `approval-${theme}-${width}.png`);
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 1000, 360]) test(`shell visual baseline ${theme} ${width}`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 800 });
    await page.clock.setFixedTime(new Date('2026-10-13T12:00:00Z'));
    await page.addInitScript((appearance) => { localStorage.clear(); localStorage.setItem('code-ai:theme', appearance); }, theme);
    const { checkouts } = await (await request.get('/api/checkouts')).json();
    const { project } = await (await request.post('/api/projects', { data: { name: 'A long project name for the desktop visual fixture', checkoutIds: [checkouts.find((item: { name: string }) => item.name === 'alpha').id] } })).json();
    await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } });
    await page.route('**/api/sessions**', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      for (const session of body.sessions ?? (body.session ? [body.session] : [])) {
        if (session.projectId === project.id) session.title = 'Review the parser and its long session title';
      }
      await route.fulfill({ response, json: body });
    });
    await page.route('**/api/arena**', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.machines = body.machines.filter((entry: { machine: { kind: string } }) => entry.machine.kind === 'local');
      for (const entry of body.machines) {
        entry.machine.label = 'Home machine';
        entry.projects = entry.projects.filter((item: { id: string }) => item.id === project.id);
        entry.sessions = entry.sessions.filter((item: { projectId: string }) => item.projectId === project.id);
        for (const session of entry.sessions) { session.updatedAt = '2026-10-13T11:59:00Z'; session.title = 'Review the parser and its long session title'; }
      }
      await route.fulfill({ response, json: body });
    });
    await page.goto('/');
    await expect(page.getByRole('tab', { selected: true })).toBeVisible();
    await expectScreenshot(page.locator('.app-header'), `titlebar-${theme}-${width}.png`);
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Theme' })).toBeVisible();
    await expectScreenshot(page.locator('.desktop-picker-paper:visible'), `more-${theme}-${width}.png`);
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: 'Arena', exact: true }).click();
    const arena = page.getByRole('main', { name: 'Arena' });
    await expect(arena.getByRole('button', { name: 'Open Review the parser and its long session title', exact: true })).toBeVisible();
    expect(await arena.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expectScreenshot(arena, `arena-${theme}-${width}.png`);
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 1000, 360]) test(`panels visual baseline ${theme} ${width}`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 800 });
    await page.addInitScript((appearance) => { localStorage.clear(); localStorage.setItem('code-ai:theme', appearance); }, theme);
    const { checkouts } = await (await request.get('/api/checkouts')).json();
    const { project } = await (await request.post('/api/projects', { data: { name: 'MUI panels fixture', checkoutIds: [checkouts.find((item: { name: string }) => item.name === 'alpha').id] } })).json();
    await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } });
    await page.route('**/api/repository/status?*', (route) => route.fulfill({ json: { tree: {
      isRepository: true, branch: 'feature/a-long-branch-name-for-review', files: [
        { path: 'src/features/a-long-directory/working-tree.ts', status: 'modified', staged: false, unstaged: true },
        { path: 'src/new-file.ts', status: 'untracked', staged: false, unstaged: true },
      ],
    } } }));
    await page.goto('/');
    if (width === 360) await page.getByRole('button', { name: /^Conversation/ }).click();
    await page.getByRole('button', { name: /Changes/ }).click();
    const repository = page.getByRole('complementary', { name: 'Repository', exact: true });
    await expect(repository.locator('.repository-file')).toHaveCount(2);
    if (width === 1440) {
      await page.getByRole('separator', { name: 'Resize repository panel' }).press('Home');
      await page.getByRole('separator', { name: 'Resize conversation panel' }).press('Home');
      await expect(repository).toHaveCSS('width', '268px');
      await expect(page.getByRole('complementary', { name: 'Conversation' })).toHaveCSS('width', '320px');
    }
    expect(await repository.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expectScreenshot(repository, `repository-${theme}-${width}.png`);
    await page.getByRole('button', { name: /Changes/ }).click();
    if (await page.getByRole('button', { name: /^Conversation/ }).getAttribute('aria-pressed') === 'true') await page.getByRole('button', { name: /^Conversation/ }).click();
    await page.route('**/api/sessions/*/sketches', (route) => route.fulfill({ status: 500, json: { error: 'The sketch could not be saved. Try again.' } }), { times: 1 });
    await page.getByRole('button', { name: /Start a sketch/ }).click();
    const toast = page.locator('.toast');
    await expect(toast).toHaveClass(/MuiAlert-root/);
    await expectScreenshot(toast, `toast-${theme}-${width}.png`);
    await toast.getByRole('button', { name: 'Dismiss notification' }).click();
    await expect(toast).toHaveCount(0);
    await page.getByRole('button', { name: /Start a sketch/ }).click();
    await expect(page.locator('.sketch-sheet')).toBeVisible();
    await page.getByRole('button', { name: 'Pen (P)' }).click();
    await expectScreenshot(page.getByRole('toolbar', { name: 'Diagram drawing tools' }), `drawing-${theme}-${width}.png`);
    await expectScreenshot(page.locator('.canvas-controls'), `canvas-controls-${theme}-${width}.png`);
    await page.getByRole('button', { name: 'History', exact: true }).click();
    // The timestamp's width also positions its title, so stabilize it before masking the text.
    await page.locator('.navigator-select small').evaluateAll((timestamps) => {
      for (const timestamp of timestamps) timestamp.textContent = 'Oct 13, 12:00 PM';
    });
    await expectScreenshot(page.getByRole('complementary', { name: 'Canvas history' }), `history-${theme}-${width}.png`, { mask: [page.locator('.navigator-select small')] });
  });
}

test('screenshots detect a deliberately changed control', async ({ page }) => {
  test.skip(test.info().project.ignoreSnapshots, 'Enable screenshot comparisons with CODEAI_E2E_VISUAL=1');
  test.skip(['all', 'changed'].includes(test.info().config.updateSnapshots), 'Run mismatch checks against reviewed baselines');
  await settingsFixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/api/arena**', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const entry of body.machines) { entry.machine.label = 'Home machine'; entry.projects = []; entry.checkouts = []; entry.sessions = []; }
    await route.fulfill({ response, json: body });
  });
  await page.addInitScript(() => localStorage.setItem('code-ai:theme', 'light'));
  await page.goto('/arena');
  const settings = await openMachineSettings(page);
  await expectScreenshot(settings, 'settings-light-1440.png');
  await settings.getByRole('button', { name: 'Close settings' }).evaluate((element) => { element.style.backgroundColor = 'red'; });
  let detected = false;
  try { await expect(settings).toHaveScreenshot('settings-light-1440.png', { animations: 'disabled', timeout: 1000 }); }
  catch { detected = true; }
  expect(detected, 'The stored screenshot must reject a visible control change').toBe(true);
});

test('keyboard opening keeps exactly one composer picker visible', async ({ page, request }) => {
  const { checkouts } = await (await request.get('/api/checkouts')).json();
  const { project } = await (await request.post('/api/projects', { data: { name: 'Keyboard picker fixture', checkoutIds: [checkouts.find((item: { name: string }) => item.name === 'alpha').id] } })).json();
  await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } });
  await page.goto('/');
  const composer = page.locator('.instruction-composer');
  const attach = composer.getByRole('button', { name: 'Attach', exact: true });
  const mode = composer.getByRole('button', { name: /^Mode:/ });
  const model = composer.getByRole('button', { name: /Model and effort/ });
  for (const [next, previous] of [[attach, undefined], [mode, attach], [model, mode]] as const) {
    await next.focus();
    await next.press('ArrowDown');
    await expect(next).toHaveAttribute('aria-expanded', 'true');
    if (previous) await expect(previous).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.desktop-picker-paper:visible')).toHaveCount(1);
  }
  await page.keyboard.press('Escape');
  await expect(model).toBeFocused();
  await expect(page.locator('.desktop-picker-paper:visible')).toHaveCount(0);
  await attach.click();
  await page.mouse.move(70, 150);
  await page.mouse.down();
  try { await expect(attach).toHaveAttribute('aria-expanded', 'false'); }
  finally { await page.mouse.up(); }
});

for (const theme of ['light', 'dark'] as const) test(`loading controls, long models and image preview ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.addInitScript((appearance) => { localStorage.clear(); localStorage.setItem('code-ai:theme', appearance); }, theme);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await settingsFixture(page, held);
  await page.route('**/api/health', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const choices = { models: [{ id: 'visual-model', label: 'A long model name with an uninterrupted identifier abcdefghijklmnopqrstuvwxyz0123456789', efforts: ['low', 'high'] }], efforts: ['low', 'high'] };
    Object.assign(body.providers.claude, choices);
    Object.assign(body.executions.local.providers.claude, choices);
    await route.fulfill({ response, json: body });
  });
  await page.goto('/arena');
  const settings = await openMachineSettings(page);
  await settings.getByRole('checkbox', { name: 'Use global instructions for Claude' }).click();
  await expect(settings.getByRole('checkbox', { name: 'Use global instructions for Claude' })).toBeDisabled();
  await expectScreenshot(settings, `loading-${theme}-360.png`);
  release();
  await expect(settings.getByRole('checkbox', { name: 'Use global instructions for Claude' })).toBeEnabled();
  await settings.getByRole('button', { name: 'Close settings' }).click();
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'New session', exact: true });
  await setup.getByRole('button', { name: /Model and effort/ }).click();
  const picker = page.locator('.desktop-picker-paper:visible');
  await expect(picker.getByRole('radio', { name: /A long model name/ })).toBeVisible();
  expect(await picker.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expectScreenshot(picker, `long-models-${theme}-360.png`);
  await picker.getByRole('radio', { name: /A long model name/ }).click();
  await page.keyboard.press('Escape');
  await setup.getByRole('textbox').evaluate(async (element) => {
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 200;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#3366cc'; context.fillRect(0, 0, 320, 200);
    context.fillStyle = 'white'; context.font = '24px sans-serif'; context.fillText('Review this screenshot', 20, 80);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
    const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'screenshot.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await expect(setup.locator('.attachment-chip.image')).toBeVisible();
  await setup.getByRole('button', { name: 'Preview image 1' }).click();
  await setup.locator('.session-setup-preview img').scrollIntoViewIfNeeded();
  await expect(setup.locator('.session-setup-preview img')).toBeInViewport();
  await expectScreenshot(setup, `preview-${theme}-360.png`);
  await page.keyboard.press('Escape');
  await expect(setup.locator('.session-setup-preview')).toHaveCount(0);
  await expect(setup).toBeVisible();
});
