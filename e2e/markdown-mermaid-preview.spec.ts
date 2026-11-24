import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { selectWorkspaceView } from './workspace-navigation';
import type { CheckoutsResponse } from '../src/shared/types';

const documentPath = 'docs/file-links.md';
const markdown = '# Diagram document\n\nBefore the diagrams. Inline `mermaid` stays code.\n\n'
  + '```ts\nconst current = true;\n```\n\n'
  + '```mermaid\nflowchart LR\n  A[Read file] --> B[Preview diagram]\n```\n\n'
  + '~~~mermaid\nsequenceDiagram\n  Reader->>Preview: Render the document\n~~~\n\n'
  + '```mermaid\nflowchart LR\n  A[\n```\n\n'
  + '```mermaid\nflowchart LR\n  A[Unsafe] --> B[Link]\n  click A "https://example.com/mermaid-must-not-load"\n```\n\n'
  + 'After the diagrams.\n\n[External link](https://example.com/reference)\n\n'
  + '![Remote](https://example.com/mermaid-must-not-load.png)\n\n'
  + '<script>window.mermaidPreviewScriptRan = true</script>\n\n'
  + '| Configuration | Authentication | Reconciliation | Administration | Documentation |\n'
  + '| --- | --- | --- | --- | --- |\n'
  + '| Enabled | Required | Complete | Available | Published |\n';

const activeFile = (page: Page) => page.locator('.file-view-content:not([hidden])');
const preview = (page: Page) => activeFile(page).getByRole('article', { name: 'Markdown preview', exact: true });

async function openDocument(page: Page, request: APIRequestContext, text: () => string = () => markdown) {
  await page.route('**/api/repository/file?*', route => route.fulfill({ json: { file: { path: documentPath, text: text() } } }));
  await page.route('**/api/repository/status?*', route => route.fulfill({ json: { tree: {
    isRepository: true, branch: 'main', files: [{ path: documentPath, status: 'modified', staged: false, unstaged: true }],
  } } }));
  await page.route('**/api/repository/diff?*', route => route.fulfill({ json: { diff: {
    path: documentPath, unstaged: '@@ -1 +1 @@\n-old\n+new', preview: { markdown: text() },
  } } }));
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const { project } = await (await request.post('/api/projects', { data: {
    name: `Mermaid preview ${Date.now()}`, checkoutIds: [checkouts.find(item => item.name === 'alpha')!.id],
  } })).json();
  const { session } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json();
  await page.goto(`/?session=${session.id}`);
  await selectWorkspaceView(page, 'Files', { ensureOpen: true });
  const files = page.getByRole('list', { name: 'Repository files', exact: true });
  await files.getByRole('button', { name: 'docs', exact: true }).click();
  await files.getByRole('button', { name: 'file-links.md', exact: true }).click();
  await expect(preview(page).getByRole('heading', { name: 'Diagram document' })).toBeVisible();
}

for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
  test(`${theme} ${width}: Mermaid renders in file and Changes previews with local failures`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    const unwantedRequests: string[] = [];
    page.on('request', req => { if (req.url().includes('mermaid-must-not-load')) unwantedRequests.push(req.url()); });
    await openDocument(page, request);
    for (const view of ['file', 'changes']) {
      const article = preview(page);
      const diagrams = article.getByRole('img', { name: 'Mermaid diagram', exact: true });
      await expect(diagrams).toHaveCount(2);
      await expect(diagrams.first()).toContainText('Read file');
      await expect(diagrams.last()).toContainText('Render the document');
      for (const diagram of await diagrams.all()) {
        await expect(diagram).toHaveAttribute('data-mermaid-theme', theme);
        await expect(diagram.locator('svg')).toBeVisible();
        expect(await diagram.evaluate(node => node.getBoundingClientRect().width >= node.querySelector('svg')!.getBoundingClientRect().width)).toBe(true);
      }
      await expect(article.getByRole('status')).toHaveCount(2);
      await expect(article).toContainText('Mermaid links and callbacks are not allowed');
      await expect(article.locator('pre code.language-mermaid')).toHaveCount(2);
      await expect(article.locator('pre code.language-mermaid').first()).toContainText('A[');
      await expect(article.locator('pre code.language-ts')).toHaveText('const current = true;\n');
      await expect(article.locator('p > code')).toHaveText('mermaid');
      await expect(article).toContainText('After the diagrams.');
      await expect(article.getByRole('link', { name: 'External link' })).toHaveAttribute('target', '_blank');
      const table = article.getByRole('region', { name: 'Markdown table' });
      await expect(table.getByRole('columnheader', { name: 'Documentation' })).toBeAttached();
      if (width === 390) expect(await table.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
      await expect(article.locator('img, script')).toHaveCount(0);
      expect(unwantedRequests).toEqual([]);
      expect(await page.evaluate(() => 'mermaidPreviewScriptRan' in window)).toBe(false);
      const svgIds = await page.locator('.markdown-mermaid svg[id]').evaluateAll(nodes => nodes.map(node => node.id));
      expect(new Set(svgIds).size).toBe(svgIds.length);
      expect(await activeFile(page).locator('.diff-inspector-scroll').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${view}-mermaid.png`) });
      if (view === 'file') {
        await activeFile(page).getByRole('button', { name: 'Source', exact: true }).click();
        await expect(activeFile(page).getByLabel('File source')).toHaveText(markdown);
        await activeFile(page).getByRole('button', { name: 'Preview', exact: true }).click();
        await expect(preview(page).getByRole('img', { name: 'Mermaid diagram', exact: true })).toHaveCount(2);
        await selectWorkspaceView(page, /^Repository/);
        await page.locator('.repository-file').filter({ hasText: 'file-links.md' }).click();
        await activeFile(page).getByRole('button', { name: 'Preview', exact: true }).click();
      }
    }
    await activeFile(page).getByRole('button', { name: 'Diff', exact: true }).click();
    await expect(activeFile(page).getByLabel('Unified diff')).toContainText('+new');
  });
}

test('corrected diagrams recover and follow system appearance without crypto.randomUUID', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    localStorage.setItem('code-ai:theme', 'system');
    Object.defineProperty(crypto, 'randomUUID', { value: undefined });
  });
  let text = markdown;
  await openDocument(page, request, () => text);
  await expect(preview(page).getByRole('status')).toHaveCount(2);
  text = '# Diagram document\n\n```mermaid\nflowchart LR\n  A[Corrected] --> B[Recovered]\n```\n';
  await activeFile(page).getByRole('button', { name: 'Refresh file', exact: true }).click();
  const diagram = preview(page).getByRole('img', { name: 'Mermaid diagram', exact: true });
  await expect(diagram).toHaveCount(1);
  await expect(diagram).toContainText('Recovered');
  await expect(preview(page).getByRole('status')).toHaveCount(0);
  await expect(diagram).toHaveAttribute('data-mermaid-theme', 'light');
  const node = diagram.locator('.node rect').first();
  const lightFill = await node.evaluate(element => getComputedStyle(element).fill);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(diagram).toHaveAttribute('data-mermaid-theme', 'dark');
  await expect(diagram).toContainText('Corrected');
  await expect.poll(() => node.evaluate(element => getComputedStyle(element).fill)).not.toBe(lightFill);
});
