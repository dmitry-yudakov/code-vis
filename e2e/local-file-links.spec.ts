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
  const text = '[Package file](package.json:2) [Line range](src/long.ts#L120-L123) '
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
  const filename = path.resolve('test-results/server-data/session-store-v2/sessions', `${session.id}.json`);
  const stored = JSON.parse(await readFile(filename, 'utf8')) as DurableSession;
  stored.version = 13;
  if (docker) stored.execution = 'docker';
  stored.messages = [user, reply];
  await writeFile(filename, JSON.stringify(durableSessionSchema.parse(stored)));
  await page.goto(`/?session=${session.id}`);
  await expect(page.getByRole('button', { name: 'Package file', exact: true })).toBeVisible();
  return { ids, session };
}

for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
  test(`${theme} ${width}: chat and activity links open files at lines; Markdown and file browsing stay in the workspace`, async ({ page, request }, testInfo) => {
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
      const link = page.getByRole('button', { name, exact: true });
      await link.click();
      const viewer = page.getByRole('dialog', { name: 'Repository file: package.json', exact: true });
      await expect(viewer.getByLabel('File source')).toContainText('alpha');
      await expect(viewer.locator('[data-file-line="2"]')).toBeInViewport();
      await page.keyboard.press('Escape');
      await expect(viewer).toBeHidden();
      await expect(link).toBeFocused();
    }
    await page.getByRole('button', { name: 'Line range', exact: true }).click();
    const source = page.getByRole('dialog', { name: 'Repository file: src/long.ts', exact: true });
    await expect(source.locator('[data-file-line="120"]')).toContainText('line123');
    await expect(source.locator('[data-file-line="120"]')).toBeInViewport();
    expect(await source.locator('.diff-inspector-scroll').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await source.getByRole('button', { name: 'Wrap text', exact: true }).click();
    await expect(source.getByRole('button', { name: 'Wrap text', exact: true })).toHaveAttribute('aria-pressed', 'false');
    expect(await source.locator('.diff-inspector-scroll').evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('file-source.png') });
    await source.getByRole('button', { name: 'Close file', exact: true }).click();
    await page.getByRole('button', { name: 'Document', exact: true }).click();
    const document = page.getByRole('dialog', { name: 'Repository file: docs/file-links.md', exact: true });
    await expect(document.getByRole('heading', { name: 'Details', exact: true })).toBeInViewport();
    await expect(document.locator('img, script')).toHaveCount(0);
    expect(imageRequests).toBe(0);
    expect(await page.evaluate(() => 'localFileScriptRan' in window)).toBe(false);
    await document.getByRole('button', { name: 'Source', exact: true }).click();
    await expect(document.getByLabel('File source')).toContainText('# File links');
    await document.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('file-markdown.png') });
    await document.getByRole('button', { name: 'Package source', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Repository file: package.json', exact: true }).locator('[data-file-line="2"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Document', exact: true })).toBeFocused();
    await expect(input).toHaveValue('Retain this draft');
    expect(page.url()).toBe(initialUrl);
    await expect(page.getByRole('link', { name: 'External', exact: true })).toHaveAttribute('target', '_blank');
    await expect(page.getByRole('link', { name: 'Unsafe', exact: true })).toHaveCount(0);
    const toggle = page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name: 'Files', exact: true });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('complementary', { name: 'Files', exact: true }).getByRole('tab')).toHaveCount(0);
    const files = page.getByRole('list', { name: 'Repository files', exact: true });
    const docs = files.getByRole('button', { name: 'docs', exact: true });
    await expect(docs).toHaveAttribute('aria-expanded', 'false');
    await docs.click();
    await expect(docs).toHaveAttribute('aria-expanded', 'true');
    await expect(files.getByRole('button', { name: 'package.json', exact: true })).toBeVisible();
    await files.getByRole('button', { name: 'nested', exact: true }).click();
    await expect(files.getByRole('button', { name: 'details.md', exact: true })).toBeVisible();
    await files.getByRole('button', { name: 'file-links.md', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'File links', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await docs.click();
    await expect(files.getByRole('button', { name: 'details.md', exact: true })).toHaveCount(0);
    await expect(docs).toHaveAttribute('aria-expanded', 'false');
    await expect(files.getByRole('button', { name: 'package.json', exact: true })).toBeVisible();
    await docs.focus();
    await page.keyboard.press('Space');
    await expect(files.getByRole('button', { name: 'details.md', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('repository-files.png') });
  });
}

test('missing file recovery and outside paths retain the conversation; late reads cannot replace a new selection', async ({ page, request }) => {
  await openConversation(page, request);
  await page.getByRole('button', { name: 'Outside', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('outside');
  await expect(page.getByLabel('File source')).toHaveCount(0);
  await page.keyboard.press('Escape');
  let recovered = false;
  await page.route('**/api/repository/file?*', async route => {
    if (new URL(route.request().url()).searchParams.get('path') !== 'missing.txt') return route.fallback();
    if (!recovered) return route.fulfill({ status: 404, json: { error: 'That file no longer exists.' } });
    return route.fulfill({ json: { file: { path: 'missing.txt', text: 'Recovered content' } } });
  });
  await page.getByRole('button', { name: 'Missing', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('no longer exists');
  recovered = true;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByLabel('File source')).toContainText('Recovered content');
  await page.keyboard.press('Escape');
  let release!: () => void;
  await page.route('**/api/repository/file?*', async route => {
    if (new URL(route.request().url()).searchParams.get('path') !== 'missing.txt') return route.fallback();
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: { file: { path: 'missing.txt', text: 'Late stale content' } } }).catch(() => {});
  });
  await page.getByRole('button', { name: 'Missing', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Reading file');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Package file', exact: true }).click();
  await expect(page.getByLabel('File source')).toContainText('alpha');
  release();
  await expect(page.getByLabel('File source')).not.toContainText('Late stale content');
});

test('relative chat links use the primary repository; absolute links can open a second attached repository', async ({ page, request }) => {
  const { ids } = await openConversation(page, request, 2);
  const toggle = page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name: /^Repository/ });
  if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
  await page.getByRole('combobox', { name: 'Current repository', exact: true }).selectOption(ids[1]);
  await page.getByRole('button', { name: 'Package file', exact: true }).click();
  await expect(page.getByLabel('File source')).toContainText('alpha');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Other repository', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Repository file: pyproject.toml', exact: true }).getByLabel('File source')).toContainText('beta');
});

test('leaving and returning to a conversation closes its old file viewer', async ({ page, request }) => {
  const { session } = await openConversation(page, request);
  const { session: other } = await (await request.post('/api/sessions', { data: { projectId: session.projectId, provider: 'claude' } })).json();
  await page.getByRole('button', { name: 'Package file', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(id => window.history.pushState(null, '', `/?session=${id}`), other.id);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Package file', exact: true })).toHaveCount(0);
  await page.evaluate(id => window.history.pushState(null, '', `/?session=${id}`), session.id);
  await expect(page.getByRole('button', { name: 'Package file', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Docker workspace links resolve in the bound host checkout', async ({ page, request }) => {
  await openConversation(page, request, 1, true);
  await page.getByRole('button', { name: 'Docker file', exact: true }).click();
  const viewer = page.getByRole('dialog', { name: 'Repository file: package.json', exact: true });
  await expect(viewer.getByLabel('File source')).toContainText('alpha');
  await expect(viewer.locator('[data-file-line="2"]')).toBeVisible();
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
