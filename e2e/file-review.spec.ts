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
  await page.getByRole('combobox', { name: 'All sessions', exact: true }).selectOption(session.id);
  const input = page.getByRole('textbox', { name: 'Instruction', exact: true });
  await input.fill('Keep this review draft');
  await page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name: /^Repository/ }).click();
  await page.locator('.repository-file').filter({ hasText: 'review.md' }).click();
  await expect(page.getByLabel('Unified diff').last()).toContainText('Changed line 120');
  return input;
}

for (const theme of ['light', 'dark']) {
  for (const width of [1440, 390]) {
    test(`${theme} ${width}: wrap, preview and full-screen file review preserve the layout`, async ({ page, request }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
      const imageRequests: string[] = [];
      page.on('request', req => { if (req.url().includes('should-not-load')) imageRequests.push(req.url()); });
      const input = await openReview(page, request);
      const inspector = page.getByRole('region', { name: 'Changes in docs/review.md', exact: true });
      const wrap = inspector.getByRole('button', { name: 'Wrap text', exact: true });
      const patch = inspector.getByLabel('Unified diff').last();
      await expect(wrap).toHaveAttribute('aria-pressed', 'true');
      expect(await patch.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      const before = await page.evaluate(() => localStorage.getItem('code-ai:device:v1:view-panel-layouts'));
      await wrap.click();
      await expect(wrap).toHaveAttribute('aria-pressed', 'false');
      expect(await patch.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
      await patch.evaluate(node => { node.scrollLeft = 500; });
      expect(await patch.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
      await wrap.click();
      expect(await patch.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('wrapped-diff.png') });

      await inspector.getByRole('button', { name: 'Preview', exact: true }).click();
      const preview = page.getByRole('article', { name: 'Markdown preview', exact: true });
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
      await inspector.getByRole('button', { name: 'Full screen file review', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'File review: docs/review.md', exact: true });
      await expect(dialog).toBeVisible();
      const box = (await dialog.boundingBox())!;
      expect(box.width).toBe(width);
      expect(box.height).toBe(900);
      await expect(dialog.getByRole('article', { name: 'Markdown preview' })).toBeVisible();
      const scroll = dialog.locator('.diff-inspector-scroll');
      expect(await scroll.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
      await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBe(400);
      await scroll.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await expect(dialog.getByRole('button', { name: 'Restore file review', exact: true })).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath('fullscreen-preview.png') });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(preview).toBeVisible();
      await expect(inspector.getByRole('button', { name: 'Full screen file review', exact: true })).toBeFocused();
      expect(await inspector.locator('.diff-inspector-scroll').evaluate(node => node.scrollTop)).toBeGreaterThan(100);
      expect(await page.evaluate(() => localStorage.getItem('code-ai:device:v1:view-panel-layouts'))).toEqual(before);
      await inspector.getByRole('button', { name: 'Full screen file review', exact: true }).click();
      await dialog.getByRole('button', { name: 'Diff', exact: true }).click();
      await expect(dialog.getByRole('button', { name: 'Wrap text' })).toHaveAttribute('aria-pressed', 'true');
      await dialog.getByRole('button', { name: 'Restore file review', exact: true }).click();
      await expect(inspector.getByLabel('Unified diff').last()).toBeVisible();
      await inspector.getByRole('button', { name: 'Close file changes', exact: true }).click();
      await expect(page.locator('.repository-file').first()).toBeVisible();
      if (width === 390) await page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name: 'Chat', exact: true }).click();
      await expect(input).toHaveValue('Keep this review draft');
    });
  }
}

test('file review divider resizes with pointer and keyboard and hides on narrow screens', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReview(page, request);
  const sidebar = page.locator('.repository-sidebar');
  const summary = sidebar.locator('.repository-summary-panel');
  const inspector = sidebar.locator('.diff-inspector');
  const divider = page.getByRole('separator', { name: 'Resize file review', exact: true });
  const start = (await summary.boundingBox())!.width;
  const dividerBox = (await divider.boundingBox())!;
  const reviewStart = (await inspector.boundingBox())!.width;
  await page.mouse.move(dividerBox.x + dividerBox.width / 2, dividerBox.y + 180);
  await page.mouse.down();
  await page.mouse.move(dividerBox.x + dividerBox.width / 2 - 60, dividerBox.y + 180, { steps: 5 });
  await page.mouse.up();
  expect((await summary.boundingBox())!.width).toBeCloseTo(start - 60, 0);
  expect((await inspector.boundingBox())!.width).toBeCloseTo(reviewStart + 60, 0);
  await divider.focus();
  await page.keyboard.press('Shift+ArrowRight');
  expect((await summary.boundingBox())!.width).toBeCloseTo(start - 36, 0);
  await page.keyboard.press('Home');
  expect((await summary.boundingBox())!.width).toBe(180);
  await page.keyboard.press('End');
  expect((await inspector.boundingBox())!.width).toBe(220);
  await sidebar.getByRole('button', { name: 'Maximize Repository', exact: true }).click();
  const maximizedStart = (await summary.boundingBox())!.width;
  await divider.focus();
  await page.keyboard.press('ArrowLeft');
  expect((await summary.boundingBox())!.width).toBeCloseTo(maximizedStart - 8, 0);
  await sidebar.getByRole('button', { name: 'Restore layout', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(divider).toBeHidden();
  await expect(sidebar.getByRole('button', { name: 'Close file changes' })).toBeInViewport();
  await expect(sidebar.getByRole('button', { name: 'Full screen file review' })).toBeInViewport();
  expect(await sidebar.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test('another Markdown file starts at the beginning of its own review', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReview(page, request);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.locator('.diff-inspector-scroll').evaluate(node => { node.scrollTop = 1000; });
  await expect.poll(() => page.locator('.diff-inspector-scroll').evaluate(node => node.scrollTop)).toBe(1000);
  await page.getByRole('button', { name: 'Close file changes', exact: true }).click();
  await page.locator('.repository-file').filter({ hasText: 'another.md' }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Complete document' })).toBeInViewport();
  expect(await page.locator('.diff-inspector-scroll').evaluate(node => node.scrollTop)).toBe(0);
  // Switching directly in the visible list also resets the per-file view.
  await page.locator('.repository-file').filter({ hasText: 'review.md' }).click();
  await expect(page.getByRole('button', { name: 'Diff', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  expect(await page.locator('.diff-inspector-scroll').evaluate(node => node.scrollTop)).toBe(0);
});

test('full-screen review contains shortcuts and preserves the maximized layout beneath it', async ({ page, request }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await openReview(page, request);
  await page.locator('.app-header').getByRole('button', { name: 'Canvas', exact: true }).click();
  await page.getByRole('button', { name: 'Start a sketch', exact: true }).click();
  const rectangle = page.getByRole('button', { name: 'Rectangle (R)', exact: true });
  await rectangle.click();
  const ink = page.locator('svg.ink-layer');
  const box = (await ink.boundingBox())!;
  await page.mouse.move(box.x + box.width * .3, box.y + box.height * .3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .6, box.y + box.height * .6, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('[data-mark-id]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Full screen file review', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'File review: docs/review.md', exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('p');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Escape');
  await expect(rectangle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-mark-id]')).toHaveCount(1);
  await page.locator('.repository-sidebar').getByRole('button', { name: 'Maximize Repository', exact: true }).click();
  const before = await page.evaluate(() => localStorage.getItem('code-ai:device:v1:view-panel-layouts'));
  await page.getByRole('button', { name: 'Full screen file review', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Restore layout', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('code-ai:device:v1:view-panel-layouts'))).toEqual(before);
});

test('preview failure retains Diff and refresh recovers the complete document', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReview(page, request);
  let available = false;
  await page.route('**/api/repository/diff?*', route => new URL(route.request().url()).searchParams.get('path') !== 'docs/review.md' ? route.fallback() : route.fulfill({ json: { diff: {
    path: 'docs/review.md', unstaged: '@@ -1 +1 @@\n-old\n+new',
    preview: available ? { markdown: '# Recovered document' } : { error: 'Markdown preview is limited to 512 KiB per file.' },
  } } }));
  await page.getByRole('button', { name: 'Refresh Git status', exact: true }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByText('Preview unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('Markdown preview is limited to 512 KiB per file.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Diff', exact: true }).click();
  await expect(page.getByLabel('Unified diff')).toContainText('+new');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  available = true;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Recovered document', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close file changes', exact: true }).click();
  await page.locator('.repository-file').filter({ hasText: 'source.ts' }).click();
  // A non-Markdown file never offers preview, even after previewing the previous selection.
  await expect(page.getByLabel('Unified diff')).toContainText('Changed line 120');
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toHaveCount(0);
});
