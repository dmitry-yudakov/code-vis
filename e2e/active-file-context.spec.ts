import { expect, test, fulfillArenaSnapshot, type APIRequestContext, type Page } from './arena-stream';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentMessageRequest, ArenaSnapshot, CheckoutsResponse, DurableSession, PublicSession } from '../src/shared/types';
import { durableSessionSchema } from '../src/shared/sessionSchema';

async function fixture(page: Page, request: APIRequestContext, projectOnly = false) {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const ids = ['alpha', 'beta'].map(name => checkouts.find(item => item.name === name)!.id);
  const { project } = await (await request.post('/api/projects', { data: { name: `File context ${Date.now()}`, checkoutIds: ids } })).json();
  if (projectOnly) {
    await page.goto(`/?project=${project.id}`);
    await expect(page.getByRole('list', { name: 'Repository files', exact: true })).toBeVisible();
  }
  else {
    const { session } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json();
    await page.goto(`/?session=${session.id}`);
    await expect(page.getByRole('textbox', { name: 'Instruction', exact: true })).toBeVisible();
  }
  return { ids, project };
}
async function openFile(page: Page, path: string) {
  await page.keyboard.press('Control+p');
  const picker = page.getByRole('dialog', { name: 'Open file', exact: true });
  await picker.getByRole('combobox', { name: 'File name or path', exact: true }).fill(path);
  await picker.getByRole('option').filter({ hasText: path }).click();
  await expect(page.locator('.file-view-content:not([hidden])').getByLabel(/File source|Markdown preview/)).toBeVisible();
}
async function showChat(page: Page) {
  const compact = await page.locator('.app-shell').evaluate(node => node.classList.contains('dock-capacity-0'));
  const button = (compact ? page.getByRole('navigation', { name: 'Views', exact: true }) : page.locator('.app-header'))
    .getByRole('button', { name: compact ? 'Chat' : 'Conversation', exact: true });
  if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
}
const chip = (page: Page) => page.locator('.instruction-composer [aria-label="File context"]');
async function send(page: Page, request: APIRequestContext, text: string, expected: string) {
  const input = page.getByRole('textbox', { name: 'Instruction', exact: true });
  await input.fill(text);
  const posted = page.waitForRequest(req => req.url().endsWith('/api/agent/message') && req.method() === 'POST');
  await input.press('Enter');
  const body = (await posted).postDataJSON() as AgentMessageRequest;
  await expect.poll(async () => {
    const { session } = await (await request.get(`/api/sessions/${body.sessionId}`)).json() as { session: PublicSession };
    const last = session.messages.at(-1);
    return last?.role === 'assistant' ? last.rawMarkdown : '';
  }).toBe(expected);
  await expect(input).toHaveValue('');
  await expect(page.locator('.instruction-composer').getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  return body;
}

for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
  test(`${theme} ${width}: project file carries into chat with removable metadata-only context`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    const { ids } = await fixture(page, request, true);
    await expect(page.getByRole('list', { name: 'Repository files', exact: true })).toBeVisible();
    await openFile(page, 'package.json');
    await page.locator('.app-header').getByRole('button', { name: 'New session', exact: true }).click();
    await page.getByRole('button', { name: 'Start session', exact: true }).click();
    await expect(page).toHaveURL(/session=/);
    await showChat(page);
    await expect(chip(page)).toContainText('alpha · package.json');
    await page.getByRole('textbox', { name: 'Instruction', exact: true }).fill('Explain the open file [active-file-context]');
    await page.screenshot({ path: testInfo.outputPath('active-file-context.png'), animations: 'disabled' });
    const box = (await chip(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    const pageWidth = await page.locator('body').evaluate(node => node.scrollWidth);
    const body = await send(page, request, 'Explain the open file [active-file-context]', 'Active file received: package.json (file). Reference only: true.');
    expect(body.activeFile).toEqual({ checkoutId: ids[0], path: 'package.json', view: 'file' });
    expect(body.text).toBe('Explain the open file [active-file-context]');
    expect(body).not.toHaveProperty('fileAttachments');
    await chip(page).getByRole('button', { name: 'Remove active file from context', exact: true }).click();
    expect(await page.locator('body').evaluate(node => node.scrollWidth)).toBe(pageWidth);
    await expect(chip(page).getByRole('button', { name: 'Add active file to context', exact: true })).toBeVisible();
    const removed = await send(page, request, 'Ask without a file [active-file-context]', 'No active file received.');
    expect(removed).not.toHaveProperty('activeFile');
    await chip(page).getByRole('button', { name: 'Add active file to context', exact: true }).click();
    await expect(chip(page)).toContainText('package.json');
    const { session } = await (await request.get(`/api/sessions/${body.sessionId}`)).json() as { session: PublicSession };
    expect(session.version).toBe(16);
    expect(session.messages.find(message => message.id === body.messageId)).toMatchObject({ text: body.text, activeFile: body.activeFile });
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Instruction', exact: true })).toBeVisible();
    await expect(chip(page)).toHaveCount(0); // File tabs and their choices remain device-memory state.
  });
}

test('Markdown/source, tab removal, diff context and the next tab preserve per-file choices', async ({ page, request }) => {
  await fixture(page, request);
  await openFile(page, 'package.json');
  await showChat(page);
  await chip(page).getByRole('button', { name: 'Remove active file from context' }).click();
  await openFile(page, 'docs/file-links.md');
  await showChat(page);
  await expect(chip(page)).toContainText('docs/file-links.md');
  const filePane = page.getByRole('region', { name: 'File view', exact: true });
  await filePane.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(chip(page)).toContainText('docs/file-links.md');
  await page.getByRole('tab', { name: 'package.json', exact: true }).click();
  await expect(chip(page).getByRole('button', { name: 'Add active file to context' })).toBeVisible();
  await page.getByRole('tab', { name: 'file-links.md', exact: true }).click();
  await filePane.getByRole('button', { name: 'Close docs/file-links.md', exact: true }).click();
  await expect(chip(page).getByRole('button', { name: 'Add active file to context' })).toBeVisible();
  await page.route('**/api/repository/status?*', route => route.fulfill({ json: { tree: { isRepository: true, branch: 'main',
    files: [{ path: 'package.json', status: 'modified', staged: false, unstaged: true }] } } }));
  await page.route('**/api/repository/diff?*', route => route.fulfill({ json: { diff: { path: 'package.json', unstaged: '@@ -1 +1 @@\n-old\n+new' } } }));
  await page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name: /^Repository(?:,|$)/ }).click();
  await page.locator('.repository-file').filter({ hasText: 'package.json' }).click();
  await expect(chip(page)).toContainText('package.json · Diff');
  await page.getByRole('region', { name: 'File view', exact: true }).getByRole('button', { name: 'Hide file view' }).click();
  await expect(chip(page)).toContainText('package.json · Diff');
  expect((await send(page, request, 'Explain this diff [active-file-context]', 'Active file received: package.json (diff). Reference only: true.')).activeFile?.view).toBe('diff');
});

test('preflight rejection preserves the reference and draft', async ({ page, request }) => {
  await fixture(page, request);
  await openFile(page, 'package.json');
  await showChat(page);
  let captured: AgentMessageRequest | undefined;
  await page.route('**/api/agent/message', route => {
    captured = route.request().postDataJSON();
    return route.fulfill({ status: 400, json: { error: 'Simulated preflight failure' } });
  });
  const input = page.getByRole('textbox', { name: 'Instruction', exact: true });
  await input.fill('Recover this reference [active-file-context]');
  await input.press('Enter');
  await expect(page.getByRole('region', { name: 'Notifications' })).toContainText('Simulated preflight failure');
  await expect(input).toHaveValue('Recover this reference [active-file-context]');
  await expect(chip(page)).toContainText('package.json');
  await page.unroute('**/api/agent/message');
  const sent = await send(page, request, 'Recover this reference [active-file-context]', 'Active file received: package.json (file). Reference only: true.');
  expect(sent.activeFile).toEqual(captured?.activeFile);
});

test('explicit Retry after reload restores the original file reference', async ({ page, request }) => {
  const { ids } = await fixture(page, request);
  const sessionId = new URL(page.url()).searchParams.get('session')!;
  const filename = path.resolve('test-results/server-data/session-store-v2/sessions', `${sessionId}.json`);
  const stored = JSON.parse(await readFile(filename, 'utf8')) as DurableSession;
  const activeFile = { checkoutId: ids[0], path: 'package.json', view: 'file' as const };
  stored.version = 16;
  stored.messages = [{ id: crypto.randomUUID(), role: 'user', authorId: stored.participants.find(item => item.kind === 'human')!.id,
    addressedParticipantId: stored.primaryAgentId, text: 'Recover this reference [active-file-context]', createdAt: stored.createdAt,
    status: 'failed', delivery: 'not-sent', diagramAttachments: [], activeFile }];
  await writeFile(filename, JSON.stringify(durableSessionSchema.parse(stored)));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await openFile(page, 'docs/file-links.md');
  await showChat(page);
  await expect(chip(page)).toContainText('docs/file-links.md');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(chip(page)).toContainText('package.json');
  expect((await send(page, request, 'Recover this reference [active-file-context]', 'Active file received: package.json (file). Reference only: true.')).activeFile).toEqual(activeFile);
});

test('project seeding gives each conversation a fresh viewer and returning re-reads the file', async ({ page, request }) => {
  let reads = 0;
  await page.route('**/api/repository/file?*', route => route.fulfill({ json: { file: { path: 'docs/file-links.md', text: `# Version ${++reads}` } } }));
  await fixture(page, request, true);
  await openFile(page, 'docs/file-links.md');
  const active = page.locator('.file-view-content:not([hidden])');
  await expect(active.getByRole('heading', { name: 'Version 1', exact: true })).toBeVisible();
  await active.getByRole('button', { name: 'Source', exact: true }).click();
  const create = async () => {
    const priorUrl = page.url();
    await page.locator('.app-header').getByRole('button', { name: 'New session', exact: true }).click();
    await page.getByRole('button', { name: 'Start session', exact: true }).click();
    await expect.poll(() => page.url()).not.toBe(priorUrl);
    await expect(page).toHaveURL(/session=/);
    const toggle = page.locator('.app-header').getByRole('button', { name: 'File view', exact: true });
    if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
    return new URL(page.url()).searchParams.get('session')!;
  };
  const first = await create();
  await expect(active.getByRole('heading', { name: 'Version 2', exact: true })).toBeVisible();
  await active.getByRole('button', { name: 'Source', exact: true }).click();
  const second = await create();
  expect(second).not.toBe(first);
  await expect(active.getByRole('heading', { name: 'Version 3', exact: true })).toBeVisible();
  await page.getByRole('tablist', { name: 'Open session views', exact: true }).locator(`a[href*="session=${first}"]`).click();
  await expect(active.getByRole('heading', { name: 'Version 4', exact: true })).toBeVisible();
  await showChat(page);
  await expect(chip(page)).toContainText('docs/file-links.md');
});

test('a local secondary repository keeps its own file identity through Send', async ({ page, request }) => {
  const { ids } = await fixture(page, request);
  await openFile(page, 'pyproject.toml');
  await showChat(page);
  await expect(chip(page)).toContainText('beta · pyproject.toml');
  const body = await send(page, request, 'Explain this file [active-file-context]', 'Active file received: pyproject.toml (file). Reference only: true.');
  expect(body.activeFile).toEqual({ checkoutId: ids[1], path: 'pyproject.toml', view: 'file' });
});

test('attached-machine context uses its gateway and returning restores the local file', async ({ page, request }) => {
  const { ids, project } = await fixture(page, request);
  await openFile(page, 'package.json');
  await showChat(page);
  const localUrl = page.url();
  const localId = new URL(localUrl).searchParams.get('session')!;
  const { session } = await (await request.get(`/api/sessions/${localId}`)).json() as { session: PublicSession };
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const local = snapshot.machines.find(item => item.machine.kind === 'local')!;
  const remoteId = crypto.randomUUID();
  const remoteProject = { ...project, id: crypto.randomUUID(), name: 'Executor file context',
    repositories: project.repositories.map((binding: PublicSession['repositories'][number]) => ({ ...binding, hostId: remoteId })) };
  const remoteSession = { ...session, id: crypto.randomUUID(), projectId: remoteProject.id, repositories: remoteProject.repositories };
  const summary = local.sessions.find(item => item.id === localId)!;
  snapshot.machines.push({ ...structuredClone(local), machine: { ...local.machine, id: remoteId, kind: 'remote', label: 'File executor' },
    projects: [remoteProject], sessions: [{ ...summary, id: remoteSession.id, projectId: remoteProject.id }], archivedSessions: [] });
  await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
  let posted: AgentMessageRequest | undefined;
  await page.route(`**/api/machines/${remoteId}/**`, route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/projects')) return route.fulfill({ json: { projects: [remoteProject] } });
    if (pathname.endsWith('/checkouts')) return route.fulfill({ json: { checkouts: local.checkouts, recentCheckoutIds: ids } });
    if (pathname.endsWith('/sessions')) return route.fulfill({ json: { sessions: [remoteSession] } });
    if (pathname.includes('/sessions/')) return route.fulfill({ json: { session: remoteSession } });
    if (pathname.endsWith('/agent/runs')) return route.fulfill({ json: { active: [], recent: [] } });
    if (pathname.endsWith('/file-search')) return route.fulfill({ json: { files: {
      paths: new URL(route.request().url()).searchParams.get('checkoutId') === ids[0] ? ['remote.txt'] : [],
    } } });
    if (pathname.endsWith('/file')) return route.fulfill({ json: { file: { path: 'remote.txt', text: 'Executor contents' } } });
    if (pathname.endsWith('/agent/message')) {
      posted = route.request().postDataJSON();
      return route.fulfill({ status: 400, json: { error: 'Executor test rejection' } });
    }
    return route.fulfill({ json: { tree: { isRepository: false, files: [] } } });
  });
  await page.evaluate(() => (window as typeof window & { pushArenaSnapshot?: () => Promise<void> }).pushArenaSnapshot?.());
  await page.evaluate(url => history.pushState(null, '', url), `/?session=${remoteSession.id}&machine=${remoteId}`);
  await expect(page.getByRole('button', { name: 'Project: Executor file context', exact: true })).toBeVisible();
  await expect(chip(page)).toHaveCount(0);
  await openFile(page, 'remote.txt');
  await showChat(page);
  await expect(chip(page)).toContainText('remote.txt');
  await page.getByRole('textbox', { name: 'Instruction', exact: true }).fill('Use the executor reference');
  await page.getByRole('textbox', { name: 'Instruction', exact: true }).press('Enter');
  await expect.poll(() => posted?.activeFile).toEqual({ checkoutId: ids[0], path: 'remote.txt', view: 'file' });
  expect(posted?.sessionId).toBe(remoteSession.id);
  await expect(page.getByRole('region', { name: 'Notifications' })).toContainText('Executor test rejection');
  await page.evaluate(url => history.pushState(null, '', url), localUrl);
  await expect(chip(page)).toContainText('package.json');
  await expect(chip(page)).not.toContainText('remote.txt');
});
