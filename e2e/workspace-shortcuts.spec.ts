import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { CheckoutsResponse, PublicSession } from '../src/shared/types';

async function openWorkspace(page: Page, request: APIRequestContext, session = true, count = 1) {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const ids = ['alpha', 'beta'].slice(0, count).map(name => checkouts.find(item => item.name === name)!.id);
  const { project } = await (await request.post('/api/projects', { data: { name: `Shortcuts ${Date.now()}`, checkoutIds: ids } })).json();
  if (session) {
    const { session: created } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json() as { session: PublicSession };
    await page.goto(`/?session=${created.id}`);
    await expect(page.getByRole('textbox', { name: 'Instruction', exact: true })).toBeVisible();
  } else {
    await page.goto(`/?project=${project.id}`);
    await expect(page.getByRole('list', { name: 'Repository files', exact: true })).toBeVisible();
  }
  return ids;
}

const picker = (page: Page) => page.getByRole('dialog', { name: 'Open file', exact: true });
const search = (page: Page) => picker(page).getByRole('combobox', { name: 'File name or path', exact: true });
const source = (page: Page) => page.locator('.file-view-content:not([hidden])').getByLabel('File source');

for (const modifier of ['Control', 'Meta']) {
  test(`${modifier}+J opens Arena from the composer and Back restores the draft`, async ({ page, request }) => {
    await openWorkspace(page, request);
    const input = page.getByRole('textbox', { name: 'Instruction', exact: true });
    await input.fill('Keep my Arena jump draft');
    const sessionUrl = page.url();
    await input.press(`${modifier}+j`);
    await expect(page).toHaveURL(/\/arena$/);
    await expect(page.getByRole('heading', { name: 'Arena', exact: true })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(sessionUrl);
    await expect(input).toHaveValue('Keep my Arena jump draft');
    await expect(page.getByRole('link', { name: 'Arena', exact: true })).toHaveAttribute('aria-keyshortcuts', 'Control+J Meta+J');
  });

  test(`${modifier}+K opens Projects from a session and from Arena`, async ({ page, request }) => {
    const { project } = await (await request.post('/api/projects', { data: { name: `Shortcut destination ${modifier}` } })).json();
    await openWorkspace(page, request);
    const input = page.getByRole('textbox', { name: 'Instruction', exact: true });
    const projects = page.getByRole('listbox', { name: 'Projects', exact: true });
    const destination = projects.getByRole('option', { name: new RegExp(project.name) });
    await input.fill('Keep my project jump draft');
    const sessionUrl = page.url();
    await expect(page.getByRole('button', { name: /^Project: Shortcuts/ })).toHaveAttribute('aria-keyshortcuts', 'Control+K Meta+K');
    await input.press(`${modifier}+k`);
    const currentProject = projects.getByRole('option', { selected: true });
    await expect(currentProject).toBeFocused({ timeout: 5000 });
    await page.keyboard.press('ArrowDown');
    await expect(projects.locator(':focus')).toHaveRole('option');
    await expect(currentProject).not.toBeFocused();
    await page.keyboard.press(`${modifier}+k`);
    await expect(projects).toBeVisible();
    await destination.click();
    await expect(page).toHaveURL(`/?project=${project.id}`);
    await page.goBack();
    await expect(page).toHaveURL(sessionUrl);
    await expect(input).toHaveValue('Keep my project jump draft');

    await page.getByRole('link', { name: 'Arena', exact: true }).click();
    const arenaPicker = page.getByRole('button', { name: 'Projects', exact: true });
    await expect(arenaPicker).toHaveAttribute('aria-keyshortcuts', 'Control+K Meta+K');
    await page.keyboard.press(`${modifier}+k`);
    await expect(destination).toBeVisible();
    await expect(projects.locator(':focus')).toHaveRole('option');
    await page.keyboard.press('Escape');
    await expect(projects).toBeHidden();
    await expect(arenaPicker).toBeFocused();
    await page.keyboard.press(`${modifier}+k`);
    await destination.press('Enter');
    await expect(page).toHaveURL(`/?project=${project.id}`);
  });
}

test('navigation shortcuts respect modified keys, composition and open pickers', async ({ page, request }) => {
  await openWorkspace(page, request);
  const input = page.getByRole('textbox', { name: 'Instruction', exact: true });
  const sessionUrl = page.url();
  for (const key of ['j', 'k']) {
    for (const extra of [{ isComposing: true }, { altKey: true }, { shiftKey: true }, { metaKey: true }]) {
      expect(await input.evaluate((node, args) => node.dispatchEvent(new KeyboardEvent('keydown', {
        ctrlKey: true, ...args, bubbles: true, cancelable: true,
      })), { key, ...extra })).toBe(true);
    }
  }
  await input.press('Control+p');
  await expect(search(page)).toBeFocused();
  await search(page).press('Meta+j');
  await search(page).press('Control+k');
  await expect(search(page)).toBeFocused();
  await expect(page.getByRole('listbox', { name: 'Projects', exact: true })).toBeHidden();
  await expect(page).toHaveURL(sessionUrl);
  await openWorkspace(page, request, false);
  const link = page.getByRole('link', { name: 'Arena', exact: true });
  await expect(link).not.toHaveAttribute('aria-keyshortcuts', /./);
  expect(await link.evaluate(node => node.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'j', ctrlKey: true, bubbles: true, cancelable: true,
  })))).toBe(true);
});

for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
  test(`${theme} ${width}: fuzzy file opening and Shift+Esc preserve drafts and tab state`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    await openWorkspace(page, request);
    const input = page.getByRole('textbox', { name: 'Instruction', exact: true });
    await input.fill('Keep my draft');
    const url = page.url();
    await input.press('Control+p');
    await expect(search(page)).toBeFocused();
    await search(page).fill('flnk');
    await expect(picker(page).getByRole('option')).toHaveCount(1);
    await expect(picker(page).getByRole('option')).toContainText('docs/file-links.md');
    await page.screenshot({ path: testInfo.outputPath('file-picker.png'), animations: 'disabled' });
    await page.keyboard.press('Enter');
    await expect(picker(page)).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'file-links.md', exact: true })).toBeFocused();
    const fileView = page.getByRole('region', { name: 'File view', exact: true });
    await fileView.getByRole('button', { name: 'Source', exact: true }).click();
    await expect(source(page)).toContainText('# File links');
    const before = await page.locator('.app-shell').getAttribute('style');
    await page.keyboard.press('Shift+Escape');
    await expect(page.locator('.app-shell')).toHaveClass(/maximized-files/);
    await page.keyboard.press('Shift+Escape');
    await expect(page.locator('.app-shell')).not.toHaveClass(/pane-maximized/);
    expect(await page.locator('.app-shell').getAttribute('style')).toBe(before);
    // Capture shortcuts even inside file tabs, which stop ordinary keyboard bubbling.
    await page.getByRole('tab', { name: 'file-links.md', exact: true }).focus();
    await page.keyboard.press('Meta+p');
    await search(page).fill('pckjs');
    await expect(picker(page).getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(source(page)).toContainText('alpha');
    await expect(page.getByRole('tablist', { name: 'Open files' }).getByRole('tab')).toHaveCount(2);
    // One Escape closes the picker; it must leave a maximized file view alone.
    await page.keyboard.press('Shift+Escape');
    await expect(page.locator('.app-shell')).toHaveClass(/maximized-files/);
    await page.keyboard.press('Control+p');
    await expect(search(page)).toBeFocused();
    await page.keyboard.press('Control+p');
    await expect(picker(page)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(picker(page)).toHaveCount(0);
    await expect(page.locator('.app-shell')).toHaveClass(/maximized-files/);
    await page.keyboard.press('Shift+Escape');
    await fileView.getByRole('button', { name: 'Hide file view', exact: true }).click();
    if (width === 390) await page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(input).toHaveValue('Keep my draft');
    expect(page.url()).toBe(url);
    await input.focus();
    await page.keyboard.press('Shift+Escape');
    await expect(page.locator('.app-shell')).toHaveClass(/maximized-conversation/);
    await page.keyboard.press('Shift+Escape');
    await expect(page.locator('.app-shell')).not.toHaveClass(/pane-maximized/);
  });
}

test('pointer activity selects Canvas even while the composer retains DOM focus; hidden panes are excluded', async ({ page, request }) => {
  await openWorkspace(page, request);
  await page.locator('.app-header').getByRole('button', { name: 'Canvas', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Instruction', exact: true });
  await input.focus();
  await page.locator('.canvas-workspace .empty-canvas-content h1').click();
  await page.keyboard.press('Shift+Escape');
  await expect(page.locator('.app-shell')).toHaveClass(/maximized-canvas/);
  await page.keyboard.press('Shift+Escape');
  await expect(page.locator('.app-shell')).not.toHaveClass(/pane-maximized/);
  await page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name: /^Files/ }).click();
  await page.getByRole('list', { name: 'Repository files', exact: true }).getByRole('button', { name: 'docs', exact: true }).focus();
  await page.keyboard.press('Shift+Escape');
  await expect(page.locator('.app-shell')).toHaveClass(/maximized-side/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.app-shell')).not.toHaveClass(/pane-maximized/);
});

test('project workspaces search all bound repositories and reopen existing tabs', async ({ page, request }) => {
  await openWorkspace(page, request, false, 2);
  await page.keyboard.press('Shift+Escape');
  await expect(page.locator('.app-shell')).toHaveClass(/maximized-side/);
  await page.keyboard.press('Shift+Escape');
  await page.keyboard.press('Control+p');
  await search(page).fill('pypj');
  await expect(picker(page).getByRole('option')).toContainText('beta');
  await page.keyboard.press('Enter');
  await expect(source(page)).toContainText('beta');
  await page.keyboard.press('Control+p');
  await search(page).fill('pypj');
  await expect(picker(page).getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tablist', { name: 'Open files' }).getByRole('tab')).toHaveCount(1);
  await page.keyboard.press('Control+p');
  await search(page).fill('docsmd');
  await expect(picker(page).getByRole('option')).toHaveCount(2);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'details.md', exact: true })).toBeFocused();
});

test('empty results, loading failure and retry retain the query and support cancellation', async ({ page, request }) => {
  await openWorkspace(page, request);
  let attempts = 0;
  await page.route('**/api/repository/file-search?*', async route => {
    if (++attempts === 1) return route.fulfill({ status: 409, json: { error: 'Repository busy. Try again.' } });
    return route.fallback();
  });
  const input = page.getByRole('textbox', { name: 'Instruction', exact: true });
  await input.press('Control+p');
  await expect(picker(page).getByRole('alert')).toContainText('Repository busy');
  await search(page).fill('pckjs');
  await picker(page).getByRole('button', { name: 'Try again' }).click();
  await expect(picker(page).getByRole('option')).toHaveCount(1);
  await expect(search(page)).toHaveValue('pckjs');
  await search(page).fill('no-such-file-xyz');
  await expect(picker(page)).toContainText('No matching files');
  await page.keyboard.press('Escape');
  await expect(input).toBeFocused();
});

test('workspace navigation closes the picker and ignores a late response', async ({ page, request }) => {
  await openWorkspace(page, request);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/repository/file-search?*', async route => {
    await pending;
    await route.fulfill({ json: { files: { paths: ['stale-file.txt'] } } });
  });
  await page.keyboard.press('Control+p');
  await expect(picker(page)).toContainText('Reading project files…');
  // Browser navigation is available even while a modal is open.
  await page.goto('/arena');
  release();
  await expect(picker(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Arena', exact: true })).toBeVisible();
});

test('an unavailable repository leaves results from other project repositories usable', async ({ page, request }) => {
  const ids = await openWorkspace(page, request, true, 2);
  await page.route('**/api/repository/file-search?*', route => new URL(route.request().url()).searchParams.get('checkoutId') === ids[1]
    ? route.fulfill({ status: 409, json: { error: 'Repository busy.' } }) : route.fallback());
  await page.keyboard.press('Control+p');
  await search(page).fill('pckjs');
  await expect(picker(page).getByRole('alert')).toContainText('beta: Repository busy.');
  await expect(picker(page).getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(source(page)).toContainText('alpha');
});

test('other dialogs and composition keep their keyboard handling', async ({ page, request }) => {
  await openWorkspace(page, request);
  const input = page.getByRole('textbox', { name: 'Instruction', exact: true });
  await input.evaluate(node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true })));
  await expect(picker(page)).toHaveCount(0);
  await input.press('Shift+Escape');
  await expect(page.locator('.app-shell')).toHaveClass(/maximized-conversation/);
  for (const modifiers of [{ shiftKey: true, isComposing: true }, { isComposing: true }, { shiftKey: true, repeat: true }]) {
    await input.evaluate((node, modifiers) => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', ...modifiers, bubbles: true, cancelable: true })), modifiers);
    await expect(page.locator('.app-shell')).toHaveClass(/maximized-conversation/);
  }
  await input.press('Shift+Escape');
  await expect(page.locator('.app-shell')).not.toHaveClass(/pane-maximized/);
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Create project session' })).toBeVisible();
  await page.keyboard.press('Shift+Escape');
  await expect(page.locator('.app-shell')).not.toHaveClass(/pane-maximized/);
  await expect(page.getByRole('button', { name: 'New session', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: /^Project logo for Shortcuts/ }).click();
  await expect(page.getByRole('dialog', { name: 'Project logo', exact: true })).toBeVisible();
  await page.keyboard.press('Control+p');
  await expect(page.getByRole('dialog', { name: 'Project logo', exact: true })).toBeVisible();
  await expect(picker(page)).toHaveCount(0);
  await page.keyboard.press('Shift+Escape');
  await expect(page.locator('.app-shell')).not.toHaveClass(/pane-maximized/);
});
