import { sessionTab } from './session-tabs';
import { selectWorkspaceView } from './workspace-navigation';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AssistantMessage, CheckoutsResponse, DurableSession, PublicSession, UserMessage } from '../src/shared/types';
import { createTurn, finishTurn, updateActivity } from '../src/shared/turnActivity';
import { durableSessionSchema } from '../src/shared/sessionSchema';

async function openConversation(page: Page, request: APIRequestContext, count = 1, docker = false) {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const ids = ['alpha', 'beta'].map(name => checkouts.find(item => item.name === name)!.id);
  const { project } = await (await request.post('/api/projects', { data: {
    name: `Local links ${Date.now()}`, checkoutIds: ids.slice(0, count),
  } })).json();
  const { session } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json() as { session: PublicSession };
  const text = '> Read [workspace story](docs/file-links.md#details) next.\n\n'
    + '[Package file](package.json:2) [Source anchor](package.json#metadata) [Line range](src/long.ts#L120-L123) '
    + `[Absolute file](${path.resolve('test/fixtures/projects/alpha/package.json')}:2) `
    + `[File URL](file://${path.resolve('test/fixtures/projects/alpha/package.json')}#L2) `
    + '[Document](docs/file-links.md#details) [Missing](missing.txt) [Docker file](/workspace/package.json:2) '
    + '[Outside](/etc/passwd) [Unsafe](javascript:alert%281%29) '
    + '[External](https://example.com/reference) '
    + `[Other repository](${path.resolve('test/fixtures/projects/beta/pyproject.toml')})`;
  const user: UserMessage = { id: crypto.randomUUID(), role: 'user', authorId: `${session.id}:human`,
    addressedParticipantId: session.primaryAgentId, createdAt: session.createdAt, status: 'sent', text: 'Show files', diagramAttachments: [] };
  user.turn = finishTurn(updateActivity(createTurn(crypto.randomUUID(), user.id, session.primaryAgentId, session.createdAt), 1,
    { kind: 'assistant', key: 'commentary', text: '[Activity file](package.json:2)', complete: true }), 'cancelled');
  user.turn.history = 'saved';
  const reply: AssistantMessage = { id: crypto.randomUUID(), role: 'assistant', authorId: session.primaryAgentId,
    createdAt: session.createdAt, status: 'complete', rawMarkdown: text, blocks: [{ kind: 'markdown', markdown: text }] };
  const filename = path.resolve(process.env.CODEAI_E2E_DATA_DIR ?? 'test-results/server-data', 'session-store-v2/sessions', `${session.id}.json`);
  const stored = JSON.parse(await readFile(filename, 'utf8')) as DurableSession;
  stored.version = 13;
  if (docker) stored.execution = 'docker';
  stored.messages = [user, reply];
  await writeFile(filename, JSON.stringify(durableSessionSchema.parse(stored)));
  await page.goto(`/?session=${session.id}`);
  await expect(page.getByRole('button', { name: 'Package file', exact: true })).toBeVisible();
  return { ids, session };
}

const activeFile = (page: Page) => page.locator('.file-view-content:not([hidden])');
const pane = (page: Page) => page.getByRole('region', { name: 'File view', exact: true });
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open files', exact: true });

test('a handoff selection includes file link text and the exact target can be copied separately', async ({ page, request, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openConversation(page, request);
  const reply = page.locator('.chat-message.assistant');
  const handoff = reply.locator('blockquote p');
  const link = handoff.getByRole('button', { name: 'workspace story', exact: true });
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());

  const box = (await link.boundingBox())!;
  const paragraph = (await handoff.boundingBox())!;
  const textY = box.y + box.height / 2;
  await page.mouse.move(paragraph.x + 1, textY);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 40, textY, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.press('ControlOrMeta+c');
  await expect.poll(async () => (await clipboard()).trim()).toBe('Read workspace story next.');
  await expect(pane(page)).not.toBeVisible();

  await reply.getByRole('button', { name: 'Copy reply', exact: true }).click();
  await expect.poll(clipboard).toContain('> Read [workspace story](docs/file-links.md#details) next.');

  const copyLink = page.getByRole('menuitem', { name: 'Copy link target' });
  await link.click({ button: 'right' });
  await expect(copyLink).toBeFocused();
  await page.evaluate(() => {
    const writeText = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = async () => {
      navigator.clipboard.writeText = writeText;
      throw new DOMException('Clipboard denied', 'NotAllowedError');
    };
  });
  await copyLink.click();
  await expect(page.getByRole('status').filter({ hasText: 'Could not copy. Try again.' })).toBeVisible();
  await copyLink.press('Enter');
  await expect.poll(clipboard).toBe('docs/file-links.md#details');
  await expect(copyLink).toHaveCount(0);
  await expect(link).toBeFocused();

  await link.press('Shift+F10');
  await expect(copyLink).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(link).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(activeFile(page).getByRole('heading', { name: 'Details', exact: true })).toBeInViewport();
});

async function showChat(page: Page) {
  const compact = await page.locator('.app-shell').evaluate(node => node.classList.contains('dock-capacity-0'));
  const button = (compact ? page.getByRole('navigation', { name: 'Views', exact: true }) : page.locator('.app-header'))
    .getByRole('button', { name: compact ? 'Chat' : 'Conversation', exact: true });
  if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
}
async function closeFile(page: Page) {
  await tabs(page).locator('[aria-selected="true"]').getByRole('button').click();
  await showChat(page);
}

for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
  test(`${theme} ${width}: tabbed source, Markdown, maximize and file browsing preserve the workspace`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    let imageRequests = 0;
    page.on('request', req => { if (req.url().includes('local-file-image')) imageRequests++; });
    await page.route('**/api/repository/file?*', route => {
      if (new URL(route.request().url()).searchParams.get('path') !== 'src/long.ts') return route.fallback();
      return route.fulfill({ json: { file: { path: 'src/long.ts', text: Array.from({ length: 250 }, (_, index) => `const line${index + 1} = ${index === 150 ? `"${'x'.repeat(600)}"` : index + 1};`).join('\n') } } });
    });
    await openConversation(page, request);
    const input = page.getByRole('textbox', { name: 'Instruction', exact: true });
    await input.fill('Retain this draft');
    const initialUrl = page.url();
    for (const name of ['Package file', 'Absolute file', 'File URL', 'Activity file']) {
      await showChat(page);
      await page.getByRole('button', { name, exact: true }).click();
      await expect(activeFile(page).getByLabel('File source')).toContainText('alpha');
      if (width === 1440) expect((await pane(page).boundingBox())!.width).toBeGreaterThanOrEqual((width - 48) * .5);
      await expect(activeFile(page).locator('[data-file-line="2"]')).toBeInViewport();
      await expect(tabs(page).getByRole('tab')).toHaveCount(1);
    }
    await expect(activeFile(page).locator('.hljs-string').filter({ hasText: 'alpha' })).toHaveText('"alpha-fixture"');
    await showChat(page);
    await page.getByRole('button', { name: 'Line range', exact: true }).click();
    const source = activeFile(page);
    await expect(source.locator('[data-file-line="120"]')).toContainText('line123');
    const keyword = source.locator('[data-file-line="120"] .hljs-keyword').first();
    await expect(keyword).toHaveText('const');
    await expect(keyword).toHaveCSS('color', theme === 'dark' ? 'rgb(210, 168, 255)' : 'rgb(123, 44, 191)');
    await expect(source.locator('[data-file-line="120"]')).toBeInViewport();
    expect(await source.locator('.diff-inspector-scroll').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await source.getByRole('button', { name: 'Wrap text', exact: true }).click();
    expect(await source.locator('.diff-inspector-scroll').evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
    await source.locator('.diff-inspector-scroll').evaluate(node => { node.scrollTop = 500; });
    await tabs(page).getByRole('tab', { name: 'package.json', exact: true }).click();
    await tabs(page).getByRole('tab', { name: 'long.ts', exact: true }).click();
    await expect(source.getByRole('button', { name: 'Wrap text' })).toHaveAttribute('aria-pressed', 'false');
    expect(await source.locator('.diff-inspector-scroll').evaluate(node => node.scrollTop)).toBe(500);
    await page.screenshot({ path: testInfo.outputPath('file-source.png') });
    await showChat(page);
    await page.getByRole('button', { name: 'Document', exact: true }).click();
    const document = activeFile(page);
    await expect(document.getByRole('heading', { name: 'Details', exact: true })).toBeInViewport();
    await expect(document.locator('img, script')).toHaveCount(0);
    expect(imageRequests).toBe(0);
    expect(await page.evaluate(() => 'localFileScriptRan' in window)).toBe(false);
    await document.getByRole('button', { name: 'Source', exact: true }).click();
    await expect(document.getByLabel('File source')).toContainText('# File links');
    await document.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('file-markdown.png') });
    const before = await page.locator('.app-shell').getAttribute('style');
    await pane(page).getByRole('button', { name: 'Maximize File view', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Views', exact: true })).toBeVisible();
    const box = (await pane(page).boundingBox())!;
    expect(box.width).toBeGreaterThan(width - 60);
    await page.screenshot({ path: testInfo.outputPath('maximized-file.png') });
    await page.keyboard.press('Escape');
    await expect(pane(page).getByRole('button', { name: 'Maximize File view', exact: true })).toBeFocused();
    expect(await page.locator('.app-shell').getAttribute('style')).toBe(before);
    await document.getByRole('button', { name: 'Package source', exact: true }).click();
    await expect(activeFile(page).locator('[data-file-line="2"]')).toBeVisible();
    await expect(tabs(page).getByRole('tab')).toHaveCount(3);
    await pane(page).getByRole('button', { name: 'Hide file view', exact: true }).click();
    await showChat(page);
    await expect(input).toHaveValue('Retain this draft');
    expect(page.url()).toBe(initialUrl);
    await expect(page.getByRole('link', { name: 'External', exact: true })).toHaveAttribute('target', '_blank');
    await expect(page.getByRole('link', { name: 'Unsafe', exact: true })).toHaveCount(0);
    await selectWorkspaceView(page, 'Files');
    const files = page.getByRole('list', { name: 'Repository files', exact: true });
    const docs = files.getByRole('button', { name: 'docs', exact: true });
    await docs.click();
    await files.getByRole('button', { name: 'nested', exact: true }).click();
    await expect(files.getByRole('button', { name: 'details.md', exact: true })).toBeVisible();
    await files.getByRole('button', { name: 'file-links.md', exact: true }).click();
    await expect(activeFile(page).getByRole('heading', { name: 'File links', exact: true })).toBeVisible();
    await expect(tabs(page).getByRole('tab')).toHaveCount(3);
    if (width === 390) await selectWorkspaceView(page, 'Files');
    await docs.click();
    await expect(files.getByRole('button', { name: 'details.md', exact: true })).toHaveCount(0);
    await expect(files.getByRole('button', { name: 'package.json', exact: true })).toBeVisible();
    await docs.focus();
    await page.keyboard.press('Space');
    await expect(files.getByRole('button', { name: 'details.md', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('repository-files.png') });
  });
}

test('source highlighting preserves multiline tokens and exact text through a refresh', async ({ page, request }) => {
  let text = '/*\r\n' + '\r\n'.repeat(118) + '\tinside the comment\r\n' + '\r\n'.repeat(3)
    + '*/\r\nconst text = "<img src=example>";\r\n';
  await page.route('**/api/repository/file?*', route => {
    const path = new URL(route.request().url()).searchParams.get('path');
    if (path === 'src/long.ts') return route.fulfill({ json: { file: { path, text } } });
    if (path === 'missing.txt') return route.fulfill({ json: { file: { path, text: '<b>Plain text</b>\n' } } });
    return route.fallback();
  });
  await openConversation(page, request);
  await page.getByRole('button', { name: 'Line range', exact: true }).click();
  const source = activeFile(page).getByLabel('File source');
  await expect(source.locator('mark .hljs-comment')).toContainText('inside the comment');
  await expect(source.locator('.hljs-string')).toHaveText('"<img src=example>"');
  await expect(source.locator('img')).toHaveCount(0);
  expect(await source.textContent()).toBe(text);

  const large = 'const updated = 2;\n'.repeat(8000);
  const dense = `const dense = [\n${'1,\n'.repeat(12000)}];\n`;
  const nested = 'const nested = ' + '`value ${\n'.repeat(128) + '0' + '}`'.repeat(128) + ';\n';
  for (const next of [large, dense, nested]) {
    text = next;
    await activeFile(page).getByRole('button', { name: 'Refresh file', exact: true }).click();
    await expect.poll(() => source.textContent()).toBe(text);
    await expect(source.locator('mark')).toBeVisible();
    await expect(source.locator('.hljs-keyword')).toHaveCount(0);
  }

  await showChat(page);
  await page.getByRole('button', { name: 'Missing', exact: true }).click();
  await expect(source).toHaveText('<b>Plain text</b>');
  await expect(source.locator('b, [class^="hljs-"]')).toHaveCount(0);
});

test('missing file recovery and outside paths retain tabs; late reads cannot replace a new selection', async ({ page, request }) => {
  await openConversation(page, request);
  await page.getByRole('button', { name: 'Outside', exact: true }).click();
  await expect(activeFile(page).getByRole('alert')).toContainText('outside');
  await closeFile(page);
  let recovered = false;
  await page.route('**/api/repository/file?*', route => {
    if (new URL(route.request().url()).searchParams.get('path') !== 'missing.txt') return route.fallback();
    return route.fulfill(recovered ? { json: { file: { path: 'missing.txt', text: 'Recovered content' } } }
      : { status: 404, json: { error: 'That file no longer exists.' } });
  });
  await page.getByRole('button', { name: 'Missing', exact: true }).click();
  await expect(activeFile(page).getByRole('alert')).toContainText('no longer exists');
  recovered = true;
  await activeFile(page).getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(activeFile(page).getByLabel('File source')).toContainText('Recovered content');
  await closeFile(page);
  let release!: () => void;
  await page.route('**/api/repository/file?*', async route => {
    if (new URL(route.request().url()).searchParams.get('path') !== 'missing.txt') return route.fallback();
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: { file: { path: 'missing.txt', text: 'Late stale content' } } }).catch(() => {});
  });
  await page.getByRole('button', { name: 'Missing', exact: true }).click();
  await expect(activeFile(page).getByRole('status')).toContainText('Reading file');
  await closeFile(page);
  await page.getByRole('button', { name: 'Package file', exact: true }).click();
  await expect(activeFile(page).getByLabel('File source')).toContainText('alpha');
  release();
  await expect(activeFile(page).getByLabel('File source')).not.toContainText('Late stale content');
});

test('revealing a file widens an old preference while subsequent tabs preserve manual resizing', async ({ page, request }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.addInitScript(() => localStorage.setItem('code-ai:panel-widths', JSON.stringify({ filesWidth: 320 })));
  await openConversation(page, request);
  const navigation = page.getByRole('navigation', { name: 'Views', exact: true });
  await navigation.getByRole('button', { name: 'Files', exact: true }).click();
  await page.getByRole('button', { name: 'Package file', exact: true }).click();
  await expect(pane(page).getByLabel('File source')).toContainText('alpha');
  expect((await pane(page).boundingBox())!.width).toBeGreaterThanOrEqual((1920 - 48) * .35);
  const divider = page.getByRole('separator', { name: 'Resize file view', exact: true });
  await divider.focus();
  await page.keyboard.press('Home');
  await expect(pane(page)).toHaveCSS('width', '320px');
  await page.getByRole('button', { name: 'Document', exact: true }).click();
  await expect(activeFile(page).getByRole('heading', { name: 'Details', exact: true })).toBeVisible();
  await expect(pane(page)).toHaveCSS('width', '320px');
  await pane(page).getByRole('button', { name: 'Hide file view', exact: true }).click();
  await page.getByRole('button', { name: 'Package file', exact: true }).click();
  expect((await pane(page).boundingBox())!.width).toBeGreaterThanOrEqual((1920 - 48) * .35);
});

test('the first document in a restored empty pane gets the wider default and keeps wider preferences', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openConversation(page, request);
  await page.getByRole('button', { name: 'Package file', exact: true }).click();
  const divider = page.getByRole('separator', { name: 'Resize file view', exact: true });
  await divider.focus();
  await page.keyboard.press('Home');
  await expect(pane(page)).toHaveCSS('width', '320px');
  await page.reload();
  await expect(pane(page).getByText('No open files', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Package file', exact: true }).click();
  await expect(pane(page).getByLabel('File source')).toContainText('alpha');
  expect((await pane(page).boundingBox())!.width).toBeGreaterThanOrEqual((1440 - 48) * .5);
  await divider.focus();
  await page.keyboard.press('End');
  const wide = (await pane(page).boundingBox())!.width;
  await page.reload();
  await expect(pane(page).getByText('No open files', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Package file', exact: true }).click();
  await expect(pane(page).getByLabel('File source')).toContainText('alpha');
  expect((await pane(page).boundingBox())!.width).toBe(wide);
});

test('relative links use the primary repository; absolute links can open a second repository', async ({ page, request }) => {
  const { ids } = await openConversation(page, request, 2);
  await page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name: /^Repository/ }).click();
  await page.getByRole('combobox', { name: 'Current repository', exact: true }).selectOption(ids[1]);
  await page.getByRole('button', { name: 'Package file', exact: true }).click();
  await expect(activeFile(page).getByLabel('File source')).toContainText('alpha');
  await page.getByRole('button', { name: 'Other repository', exact: true }).click();
  await expect(activeFile(page).getByLabel('File source')).toContainText('beta');
  await expect(tabs(page).getByRole('tab')).toHaveCount(2);
});

test('leaving a conversation cancels stale reads and returning restores its tabs with fresh content', async ({ page, request }) => {
  const { session } = await openConversation(page, request);
  const { session: other } = await (await request.post('/api/sessions', { data: { projectId: session.projectId, provider: 'claude' } })).json();
  let release!: () => void;
  let delayed = true;
  await page.route('**/api/repository/file?*', async route => {
    if (!delayed) return route.fallback();
    delayed = false;
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: { file: { path: 'package.json', text: 'Wrong session content' } } }).catch(() => {});
  });
  await page.getByRole('button', { name: 'Package file', exact: true }).click();
  await expect(activeFile(page).getByRole('status')).toContainText('Reading file');
  await page.evaluate(id => window.history.pushState(null, '', `/?session=${id}`), other.id);
  await expect(page.getByRole('button', { name: 'Package file', exact: true })).toHaveCount(0);
  release();
  await page.evaluate(id => window.history.pushState(null, '', `/?session=${id}`), session.id);
  await expect(page.getByRole('button', { name: 'Package file', exact: true })).toBeVisible();
  await expect(activeFile(page).getByLabel('File source')).toContainText('alpha');
  await expect(tabs(page).getByRole('tab')).toHaveCount(1);
  await expect(page.getByText('Wrong session content')).toHaveCount(0);
});

for (const width of [1440, 390]) {
  test(`${width}: a full-screen conversation document returns after visiting another project`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    const { session } = await openConversation(page, request);
    await page.getByRole('textbox', { name: 'Instruction', exact: true }).fill('Keep my conversation draft');
    await page.getByRole('button', { name: 'Document', exact: true }).click();
    await expect(activeFile(page).getByRole('heading', { name: 'Details', exact: true })).toBeVisible();
    await pane(page).getByRole('button', { name: 'Maximize File view', exact: true }).click();
    const { project: other } = await (await request.post('/api/projects', { data: {
      name: `Other file workspace ${Date.now()}`, checkoutIds: session.repositories.map(item => item.checkoutId),
    } })).json();
    await page.getByRole('link', { name: 'Arena', exact: true }).click();
    await page.getByRole('link', { name: `Open project ${other.name}`, exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Files', exact: true })).toBeVisible();
    await expect(pane(page)).toBeHidden();
    await page.getByRole('link', { name: 'Arena', exact: true }).click();
    await page.locator(`a[href="/?session=${session.id}"]`).click();
    await expect(activeFile(page).getByRole('heading', { name: 'Details', exact: true })).toBeInViewport();
    await expect(pane(page).getByRole('button', { name: 'Restore layout', exact: true })).toBeVisible();
    // The project's session-free view must not borrow the conversation's tabs or maximize state.
    await page.getByRole('link', { name: 'Arena', exact: true }).click();
    await page.locator(`a[href="/?project=${session.projectId}"]`).click();
    await expect(page.getByRole('complementary', { name: 'Files', exact: true })).toBeVisible();
    await expect(pane(page)).toBeHidden();
    if (width === 390) {
      await page.getByRole('button', { name: 'Session', exact: true }).click();
      await page.getByRole('option', { name: session.title, exact: true }).click();
    } else await sessionTab(page, session.id).click();
    await expect(activeFile(page).getByRole('heading', { name: 'Details', exact: true })).toBeInViewport();
    await expect(pane(page).getByRole('button', { name: 'Restore layout', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await showChat(page);
    await expect(page.getByRole('textbox', { name: 'Instruction', exact: true })).toHaveValue('Keep my conversation draft');
  });
}

test('returning to an unavailable document retains its tab and full-screen retry', async ({ page, request }) => {
  const { session } = await openConversation(page, request);
  await page.getByRole('button', { name: 'Document', exact: true }).click();
  await expect(activeFile(page).getByRole('heading', { name: 'Details', exact: true })).toBeVisible();
  await pane(page).getByRole('button', { name: 'Maximize File view', exact: true }).click();
  await page.getByRole('link', { name: 'Arena', exact: true }).click();
  let unavailable = true;
  await page.route('**/api/repository/file?*', route => unavailable
    ? route.fulfill({ status: 404, json: { error: 'Document was removed while away.' } }) : route.fallback());
  await page.locator(`a[href="/?session=${session.id}"]`).click();
  await expect(activeFile(page).getByRole('alert')).toContainText('Document was removed while away.');
  await expect(tabs(page).getByRole('tab', { name: 'file-links.md', exact: true })).toHaveCount(1);
  await expect(pane(page).getByRole('button', { name: 'Restore layout', exact: true })).toBeVisible();
  unavailable = false;
  await activeFile(page).getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(activeFile(page).getByRole('heading', { name: 'Details', exact: true })).toBeInViewport();
});

test('Docker workspace links resolve in the bound host checkout', async ({ page, request }) => {
  await openConversation(page, request, 1, true);
  await page.getByRole('button', { name: 'Docker file', exact: true }).click();
  await expect(activeFile(page).getByLabel('File source')).toContainText('alpha');
  await expect(activeFile(page).locator('[data-file-line="2"]')).toBeVisible();
});

test('folder failures expose retry without affecting Changes and History', async ({ page, request }) => {
  await openConversation(page, request);
  let recovered = false;
  await page.route('**/api/repository/files?*', route => recovered ? route.fallback()
    : route.fulfill({ status: 400, json: { error: 'Could not read this folder.' } }));
  const navigation = page.getByRole('navigation', { name: 'Views', exact: true });
  await navigation.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Files', exact: true }).getByRole('alert')).toContainText('Could not read this folder.');
  recovered = true;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Repository files', exact: true }).getByRole('button', { name: 'package.json', exact: true })).toBeVisible();
  await navigation.getByRole('button', { name: /^Repository/ }).click();
  await expect(page.getByRole('tab', { name: /^Changes/ })).toHaveAttribute('aria-selected', 'true');
});

test('Files expands lazily, retains sibling folders and survives refresh and view changes', async ({ page, request }) => {
  const reads: string[] = [];
  let gitReads = 0;
  await page.route('**/api/repository/files?*', route => {
    reads.push(new URL(route.request().url()).searchParams.get('path') || '');
    return route.fallback();
  });
  await page.route('**/api/repository/status?*', route => { gitReads++; return route.fallback(); });
  await openConversation(page, request);
  expect(reads).toEqual([]);
  const navigation = page.getByRole('navigation', { name: 'Views', exact: true });
  await navigation.getByRole('button', { name: 'Files', exact: true }).click();
  const files = page.getByRole('list', { name: 'Repository files', exact: true });
  await expect(files.getByRole('button', { name: 'docs', exact: true })).toBeVisible();
  expect(reads).toEqual(['']);
  await files.getByRole('button', { name: 'docs', exact: true }).click();
  await files.getByRole('button', { name: 'nested', exact: true }).click();
  await expect(files.getByRole('button', { name: 'details.md', exact: true })).toBeVisible();
  expect(reads).toEqual(['', 'docs', 'docs/nested']);
  await files.getByRole('button', { name: 'notes', exact: true }).click();
  await expect(files.getByRole('button', { name: 'todo.md', exact: true })).toBeVisible();
  await expect(files.getByRole('button', { name: 'details.md', exact: true })).toBeVisible();
  const before = gitReads;
  await page.getByRole('button', { name: 'Refresh files', exact: true }).click();
  await expect.poll(() => reads.filter(item => item === 'docs/nested').length).toBe(2);
  expect(gitReads).toBe(before);
  await expect(files.getByRole('button', { name: 'docs', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await navigation.getByRole('button', { name: /^Repository/ }).click();
  await expect(page.getByRole('tab', { name: 'Files', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /^Changes/ })).toBeVisible();
  await navigation.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(files.getByRole('button', { name: 'details.md', exact: true })).toBeVisible();
  await expect(files.getByRole('button', { name: 'todo.md', exact: true })).toBeVisible();
  await page.reload();
  await expect(navigation.getByRole('button', { name: 'Files', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('complementary', { name: 'Files', exact: true })).toBeVisible();
});

test('a collapsed folder ignores late children and retries failures without hiding sibling files', async ({ page, request }) => {
  await openConversation(page, request);
  let release!: () => void;
  let first = true;
  await page.route('**/api/repository/files?*', async route => {
    if (new URL(route.request().url()).searchParams.get('path') !== 'docs' || !first) return route.fallback();
    first = false;
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: { directory: { path: 'docs', entries: [{ name: 'stale.txt', kind: 'file' }] } } }).catch(() => {});
  });
  await page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name: 'Files', exact: true }).click();
  const files = page.getByRole('list', { name: 'Repository files', exact: true });
  const docs = files.getByRole('button', { name: 'docs', exact: true });
  await docs.click();
  await expect(files.getByRole('status')).toContainText('Reading folder');
  await docs.click();
  release();
  await expect(docs).toHaveAttribute('aria-expanded', 'false');
  await expect(files.getByRole('button', { name: 'stale.txt', exact: true })).toHaveCount(0);
  let failed = true;
  await page.route('**/api/repository/files?*', route => new URL(route.request().url()).searchParams.get('path') === 'docs' && failed
    ? route.fulfill({ status: 400, json: { error: 'Folder unavailable.' } }) : route.fallback());
  await docs.click();
  await expect(files.getByRole('alert')).toContainText('Folder unavailable.');
  await expect(files.getByRole('button', { name: 'package.json', exact: true })).toBeVisible();
  failed = false;
  await files.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(files.getByRole('button', { name: 'file-links.md', exact: true })).toBeVisible();
});

test('Files switches checkout scopes without stale rows and Repository retains its selected diff', async ({ page, request }) => {
  await page.route('**/api/repository/status?*', route => route.fulfill({ json: { tree: {
    isRepository: true, branch: 'main', files: [{ path: 'changed.ts', status: 'modified', staged: false, unstaged: true }],
  } } }));
  await page.route('**/api/repository/diff?*', route => route.fulfill({ json: { diff: { path: 'changed.ts', unstaged: '+Retain this diff' } } }));
  const { ids } = await openConversation(page, request, 2);
  const navigation = page.getByRole('navigation', { name: 'Views', exact: true });
  const repository = navigation.getByRole('button', { name: /^Repository/ });
  if (await repository.getAttribute('aria-pressed') !== 'true') await repository.click();
  await page.locator('.repository-file').click();
  await expect(page.getByLabel('Unified diff')).toContainText('Retain this diff');
  await navigation.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.locator('.repository-sidebar')).not.toHaveClass(/has-inspector/);
  const files = page.getByRole('list', { name: 'Repository files', exact: true });
  await files.getByRole('button', { name: 'docs', exact: true }).click();
  await expect(files.getByRole('button', { name: 'file-links.md', exact: true })).toBeVisible();
  await repository.click();
  await expect(page.getByLabel('Unified diff')).toContainText('Retain this diff');
  await navigation.getByRole('button', { name: 'Files', exact: true }).click();
  await page.getByRole('combobox', { name: 'Current repository', exact: true }).selectOption(ids[1]);
  await expect(files.getByRole('button', { name: 'pyproject.toml', exact: true })).toBeVisible();
  await expect(files.getByRole('button', { name: 'file-links.md', exact: true })).toHaveCount(0);
});

test('all four panes, mixed source/diff tabs, independent toggles and responsive return', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.route('**/api/repository/status?*', route => route.fulfill({ json: { tree: {
    isRepository: true, branch: 'main', files: [{ path: 'package.json', status: 'modified', staged: false, unstaged: true }],
  } } }));
  await page.route('**/api/repository/diff?*', route => route.fulfill({ json: { diff: { path: 'package.json', unstaged: '+package changes' } } }));
  await openConversation(page, request);
  const navigation = page.getByRole('navigation', { name: 'Views', exact: true });
  await page.getByRole('button', { name: 'Package file', exact: true }).click();
  await navigation.getByRole('button', { name: /^Repository/ }).click();
  await page.locator('.repository-file').click();
  await expect(activeFile(page).getByLabel('Unified diff')).toContainText('package changes');
  await expect(tabs(page).getByRole('tab')).toHaveCount(2);
  await page.locator('.app-header').getByRole('button', { name: 'Canvas', exact: true }).click();
  const regions = ['.activity-bar', '.repository-region', '.file-view-region', '.canvas-workspace', '.conversation-region'];
  const boxes = [];
  for (const selector of regions) {
    const region = page.locator(selector);
    await expect(region).toBeVisible();
    boxes.push((await region.boundingBox())!);
  }
  for (let index = 1; index < boxes.length; index++) expect(boxes[index].x).toBeGreaterThanOrEqual(boxes[index - 1].x + boxes[index - 1].width);
  await page.screenshot({ path: testInfo.outputPath('all-workspace-panes.png') });
  const before = await page.locator('.app-shell').getAttribute('style');
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(pane(page)).toBeVisible();
  expect(await page.locator('.app-shell').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect(page.locator('.app-shell')).toHaveAttribute('style', before!);
  await tabs(page).getByRole('tab', { name: 'package.json', exact: true }).click();
  await expect(activeFile(page).getByLabel('File source')).toContainText('alpha');
  await navigation.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Repository files', exact: true })).toBeVisible();
  await pane(page).getByRole('button', { name: 'Hide file view', exact: true }).click();
  await expect(page.locator('.file-view-region')).toBeHidden();
  await expect(page.locator('.repository-region')).toBeVisible();
  await page.locator('.app-header').getByRole('button', { name: 'File view', exact: true }).click();
  await expect(activeFile(page).getByLabel('File source')).toContainText('alpha');
  await expect(tabs(page).getByRole('tab')).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 900 });
  await navigation.getByRole('button', { name: 'Canvas', exact: true }).click();
  await expect(page.locator('.canvas-workspace')).toBeVisible();
  await navigation.getByRole('button', { name: 'File view', exact: true }).click();
  await expect(pane(page)).toBeVisible();
  await expect(tabs(page).getByRole('tab')).toHaveCount(2);
});

test('a slow line-targeted read waits for the phone pane to return; document links retain maximize', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openConversation(page, request);
  let release!: () => void;
  await page.route('**/api/repository/file?*', async route => {
    if (new URL(route.request().url()).searchParams.get('path') !== 'src/long.ts') return route.fallback();
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: { file: { path: 'src/long.ts', text: Array.from({ length: 300 }, (_, index) => `line ${index + 1}`).join('\n') } } });
  });
  await page.getByRole('button', { name: 'Line range', exact: true }).click();
  await expect(activeFile(page).getByRole('status')).toContainText('Reading file');
  await showChat(page);
  release();
  await expect(page.locator('.repository-file-source')).toContainText('line 300');
  await page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name: 'File view', exact: true }).click();
  await expect(activeFile(page).locator('[data-file-line="120"]')).toBeInViewport();
  await showChat(page);
  await page.getByRole('button', { name: 'Document', exact: true }).click();
  await expect(activeFile(page).getByRole('button', { name: 'Package source', exact: true })).toBeVisible();
  await pane(page).getByRole('button', { name: 'Maximize File view', exact: true }).click();
  await activeFile(page).getByRole('button', { name: 'Package source', exact: true }).click();
  await expect(activeFile(page).getByLabel('File source')).toContainText('alpha');
  await expect(pane(page).getByRole('button', { name: 'Restore layout', exact: true })).toBeVisible();
});

test('source anchors remain source; hidden-canvas toasts use a numeric offset', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openConversation(page, request);
  await page.getByRole('button', { name: 'Source anchor', exact: true }).click();
  await expect(activeFile(page).getByLabel('File source')).toContainText('alpha');
  await expect(activeFile(page).getByRole('article', { name: 'Markdown preview' })).toHaveCount(0);
  await page.route('**/api/agent/message', route => route.fulfill({ status: 503, json: { error: 'File pane toast placement check' } }));
  await page.getByRole('textbox', { name: 'Instruction', exact: true }).fill('Show recovery feedback');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const toast = page.getByRole('region', { name: 'Notifications', exact: true });
  await expect(toast).toContainText('Delivery is unconfirmed.');
  await expect(toast).toHaveCSS('right', '16px');
});

test('reopening an absolute chat file from the tree preserves its reading position without another read', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let fileReads = 0;
  await page.route('**/api/repository/file?*', route => {
    if (!new URL(route.request().url()).searchParams.get('path')?.endsWith('package.json')) return route.fallback();
    fileReads++;
    return route.fulfill({ json: { file: { path: 'package.json', text: Array.from({ length: 250 }, (_, index) => `line ${index + 1}`).join('\n') } } });
  });
  await openConversation(page, request);
  await page.getByRole('button', { name: 'Absolute file', exact: true }).click();
  await expect(activeFile(page).getByLabel('File source')).toContainText('line 250');
  await activeFile(page).locator('.diff-inspector-scroll').evaluate(node => { node.scrollTop = 500; });
  await page.getByRole('button', { name: 'Document', exact: true }).click();
  await expect(activeFile(page).getByRole('heading', { name: 'File links', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name: 'Files', exact: true }).click();
  await page.getByRole('list', { name: 'Repository files', exact: true }).getByRole('button', { name: 'package.json', exact: true }).click();
  await expect(activeFile(page).getByLabel('File source')).toContainText('line 250');
  expect(await activeFile(page).locator('.diff-inspector-scroll').evaluate(node => node.scrollTop)).toBe(500);
  expect(fileReads).toBe(1);
  await expect(tabs(page).getByRole('tab')).toHaveCount(2);
});
