import { sessionTab } from './session-tabs';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { CheckoutsResponse } from '../src/shared/types';

const longLine = '+A long review paragraph with meaningful prose. '.repeat(15);
const markdown = '# Complete document\n\nUnchanged introduction.\n\n- First item\n- Second item\n\n'
  + '| Column | Value |\n| --- | --- |\n| Result | Complete |\n\n```ts\nconst current = true;\n```\n\n'
  + '[Repository link](../README.md) [External link](https://example.com/review)\n\n'
  + '![Remote evidence](https://example.com/should-not-load.png)\n\n'
  + '<script>window.reviewScriptRan = true</script>\n\n'
  + Array.from({ length: 80 }, (_, index) => `Paragraph ${index + 1}.\n\n`).join('');

async function openReview(page: Page, request: APIRequestContext) {
  await page.route('**/api/repository/status?*', route => route.fulfill({ json: { tree: {
    isRepository: true, branch: 'main', files: [
      { path: 'docs/review.md', status: 'modified', staged: true, unstaged: true },
      { path: 'docs/another.md', status: 'untracked', staged: false, unstaged: false },
      { path: 'source.ts', status: 'modified', staged: false, unstaged: true },
    ],
  } } }));
  await page.route('**/api/repository/diff?*', route => {
    const path = new URL(route.request().url()).searchParams.get('path');
    return route.fulfill({ json: { diff: { path,
      ...(path?.endsWith('.md') ? { staged: '@@ -1 +1 @@\n-old title\n+staged title', preview: { markdown } } : {}),
      unstaged: '@@ -1 +1 @@\n-old line\n' + longLine + '\n' + 'x'.repeat(800) + '\n'
        + Array.from({ length: 120 }, (_, index) => `+Changed line ${index + 1}`).join('\n'),
    } } });
  });
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const { project } = await (await request.post('/api/projects', { data: {
    name: `File review ${Date.now()}`, checkoutIds: [checkouts.find(item => item.name === 'alpha')!.id],
  } })).json();
  const { session } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json();
  await page.goto('/');
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(project.name) }).click();
  await sessionTab(page, session.id).click();
  const input = page.getByRole('textbox', { name: 'Instruction', exact: true });
  await input.fill('Keep this review draft');
  await page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name: /^Repository/ }).click();
  await page.locator('.repository-file').filter({ hasText: 'review.md' }).click();
  await expect(page.getByLabel('Unified diff').last()).toContainText('Changed line 120');
  return input;
}

const filePane = (page: Page) => page.getByRole('region', { name: 'File view', exact: true });
const activeReview = (page: Page) => page.locator('.file-view-content:not([hidden])');
const fileTabs = (page: Page) => page.getByRole('tablist', { name: 'Open files', exact: true });

for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
  test(`${theme} ${width}: diff wrapping, Markdown and pane maximize retain tabs and layout`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    const imageRequests: string[] = [];
    page.on('request', req => { if (req.url().includes('should-not-load')) imageRequests.push(req.url()); });
    const input = await openReview(page, request);
    if (width === 1440) expect((await filePane(page).boundingBox())!.width).toBeGreaterThanOrEqual((width - 48) * .35);
    const inspector = activeReview(page);
    const wrap = inspector.getByRole('button', { name: 'Wrap text', exact: true });
    const patch = inspector.getByLabel('Unified diff').last();
    await expect(wrap).toHaveAttribute('aria-pressed', 'true');
    expect(await patch.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await wrap.click();
    expect(await patch.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
    await patch.evaluate(node => { node.scrollLeft = 500; });
    expect(await patch.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
    await wrap.click();
    expect(await patch.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('wrapped-diff.png') });
    await inspector.getByRole('button', { name: 'Preview', exact: true }).click();
    const preview = inspector.getByRole('article', { name: 'Markdown preview', exact: true });
    await expect(preview.getByRole('heading', { name: 'Complete document' })).toBeVisible();
    await expect(preview).toContainText('Unchanged introduction.');
    await expect(preview.getByRole('table')).toBeVisible();
    await expect(preview.locator('pre')).toContainText('const current = true;');
    await expect(preview.getByRole('link', { name: 'External link' })).toHaveAttribute('target', '_blank');
    await expect(preview.getByRole('link', { name: 'Repository link' })).toHaveCount(0);
    await expect(preview.locator('img, script')).toHaveCount(0);
    expect(imageRequests).toEqual([]);
    expect(await page.evaluate(() => 'reviewScriptRan' in window)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('markdown-preview.png') });
    await inspector.locator('.diff-inspector-scroll').evaluate(node => { node.scrollTop = 400; });
    const before = await page.locator('.app-shell').getAttribute('style');
    await filePane(page).getByRole('button', { name: 'Maximize File view', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Views', exact: true })).toBeVisible();
    await expect(preview).toBeVisible();
    expect((await filePane(page).boundingBox())!.width).toBeGreaterThan(width - 60);
    await expect.poll(() => inspector.locator('.diff-inspector-scroll').evaluate(node => node.scrollTop)).toBe(400);
    await page.screenshot({ path: testInfo.outputPath('maximized-preview.png') });
    await page.keyboard.press('Escape');
    await expect(filePane(page).getByRole('button', { name: 'Maximize File view', exact: true })).toBeFocused();
    expect(await page.locator('.app-shell').getAttribute('style')).toBe(before);
    expect(await inspector.locator('.diff-inspector-scroll').evaluate(node => node.scrollTop)).toBe(400);
    await filePane(page).getByRole('button', { name: 'Maximize File view', exact: true }).click();
    await inspector.getByRole('button', { name: 'Diff', exact: true }).click();
    await expect(inspector.getByRole('button', { name: 'Wrap text' })).toHaveAttribute('aria-pressed', 'true');
    await filePane(page).getByRole('button', { name: 'Restore layout', exact: true }).click();
    await inspector.getByRole('button', { name: 'Close file changes', exact: true }).click();
    await expect(filePane(page).getByText('No open files', { exact: true })).toBeVisible();
    if (width === 390) await page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(input).toHaveValue('Keep this review draft');
  });
}

test('file pane resizes with pointer and keyboard; phone navigation and tabs stay reachable', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReview(page, request);
  const divider = page.getByRole('separator', { name: 'Resize file view', exact: true });
  const start = (await filePane(page).boundingBox())!.width;
  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + 180, { steps: 5 });
  await page.mouse.up();
  expect((await filePane(page).boundingBox())!.width).toBeCloseTo(start + 60, 0);
  await divider.focus();
  await page.keyboard.press('Shift+ArrowLeft');
  expect((await filePane(page).boundingBox())!.width).toBeCloseTo(start + 36, 0);
  await page.keyboard.press('Home');
  expect((await filePane(page).boundingBox())!.width).toBe(320);
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(divider).toBeHidden();
  await expect(filePane(page).getByRole('button', { name: 'Maximize File view' })).toBeInViewport();
  expect(await filePane(page).evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test('diff tabs retain independent view/scroll, deduplicate and close with keyboard neighbour focus', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReview(page, request);
  await activeReview(page).getByRole('button', { name: 'Preview', exact: true }).click();
  await activeReview(page).locator('.diff-inspector-scroll').evaluate(node => { node.scrollTop = 1000; });
  await page.locator('.repository-file').filter({ hasText: 'another.md' }).click();
  await activeReview(page).getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(activeReview(page).getByRole('heading', { name: 'Complete document' })).toBeInViewport();
  expect(await activeReview(page).locator('.diff-inspector-scroll').evaluate(node => node.scrollTop)).toBe(0);
  await page.locator('.repository-file').filter({ hasText: 'review.md' }).click();
  await expect(fileTabs(page).getByRole('tab')).toHaveCount(2);
  await expect(activeReview(page).getByRole('button', { name: 'Preview', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await activeReview(page).locator('.diff-inspector-scroll').evaluate(node => node.scrollTop)).toBe(1000);
  await fileTabs(page).getByRole('tab', { name: 'review.md · Diff', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(fileTabs(page).getByRole('tab', { name: 'another.md · Diff', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Delete');
  await expect(fileTabs(page).getByRole('tab')).toHaveCount(1);
  await expect(fileTabs(page).getByRole('tab', { name: 'review.md · Diff', exact: true })).toBeFocused();
});

test('maximized file view isolates hidden canvas shortcuts and restores the arrangement', async ({ page, request }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await openReview(page, request);
  await page.locator('.app-header').getByRole('button', { name: 'Canvas', exact: true }).click();
  await page.getByRole('button', { name: 'Start a sketch', exact: true }).click();
  const rectangle = page.getByRole('button', { name: 'Rectangle (R)', exact: true });
  await rectangle.click();
  const box = (await page.locator('svg.ink-layer').boundingBox())!;
  await page.mouse.move(box.x + box.width * .3, box.y + box.height * .3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .6, box.y + box.height * .6, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('[data-mark-id]')).toHaveCount(1);
  await filePane(page).getByRole('button', { name: 'Maximize File view', exact: true }).click();
  await expect(page.locator('.canvas-workspace')).toBeHidden();
  await page.keyboard.press('p');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-mark-id]')).toHaveCount(1);
});

test('preview failure retains the diff; refresh recovers and vanished changes can retry', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReview(page, request);
  let available = false;
  let vanished = false;
  await page.route('**/api/repository/diff?*', route => new URL(route.request().url()).searchParams.get('path') !== 'docs/review.md' ? route.fallback() : route.fulfill(vanished
    ? { status: 404, json: { error: 'This file is no longer changed.' } }
    : { json: { diff: { path: 'docs/review.md', unstaged: '@@ -1 +1 @@\n-old\n+new',
      preview: available ? { markdown: '# Recovered document' } : { error: 'Markdown preview is limited to 512 KiB per file.' },
    } } }));
  await page.getByRole('button', { name: 'Refresh Git status', exact: true }).click();
  await activeReview(page).getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(activeReview(page).getByText('Preview unavailable', { exact: true })).toBeVisible();
  await activeReview(page).getByRole('button', { name: 'Diff', exact: true }).click();
  await expect(activeReview(page).getByLabel('Unified diff')).toContainText('+new');
  await activeReview(page).getByRole('button', { name: 'Preview', exact: true }).click();
  available = true;
  await activeReview(page).getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(activeReview(page).getByRole('heading', { name: 'Recovered document', exact: true })).toBeVisible();
  vanished = true;
  await activeReview(page).getByRole('button', { name: 'Refresh file changes', exact: true }).click();
  await expect(activeReview(page).getByText('This file is no longer changed.', { exact: true })).toBeVisible();
  vanished = false;
  await activeReview(page).getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(activeReview(page).getByRole('heading', { name: 'Recovered document', exact: true })).toBeVisible();
});
