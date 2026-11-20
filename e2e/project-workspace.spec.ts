import { expect, test, fulfillArenaSnapshot, type APIRequestContext } from './arena-stream';
import type { ArenaSnapshot, CheckoutsResponse, DurableProject, PublicSession } from '../src/shared/types';

async function projectFixture(request: APIRequestContext, repositories = 2) {
  const catalog = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const checkouts = ['alpha', 'beta'].map(name => catalog.checkouts.find(item => item.relativePath === name)!);
  const { project } = await (await request.post('/api/projects', { data: {
    name: `Project workspace ${Date.now()}`, checkoutIds: checkouts.slice(0, repositories).map(item => item.id),
  } })).json() as { project: DurableProject };
  return { project, checkouts };
}

for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
  test(`${theme} ${width}: open an empty project, browse files and changes, then create a session`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    const { project, checkouts } = await projectFixture(request);
    await page.route('**/api/repository/status?*', route => route.fulfill({ json: { tree: {
      isRepository: true, branch: 'main', files: [{ path: 'package.json', status: 'modified', staged: false, unstaged: true }],
    } } }));
    await page.route('**/api/repository/diff?*', route => route.fulfill({ json: { diff: {
      path: 'package.json', unstaged: '@@ -1 +1 @@\n-old project\n+new project',
    } } }));
    await page.goto('/arena');
    if (width > 740) await page.getByRole('button', { name: 'Tiles', exact: true }).click();
    const group = page.getByRole('region', { name: project.name, exact: true });
    const open = group.getByRole('link', { name: `Open project ${project.name}`, exact: true });
    await expect(group.locator('.arena-card')).toHaveCount(0);
    const groupBox = (await group.boundingBox())!, actions = (await group.locator('.arena-project-actions').boundingBox())!;
    expect(groupBox.x + groupBox.width - actions.x - actions.width).toBeLessThan(24);
    const [heading, repositories] = await Promise.all([
      group.getByRole('heading', { name: project.name, exact: true }),
      group.locator('.arena-project-repositories'),
    ].map(item => item.boundingBox()));
    // Metadata on the same row must share its vertical center with the logo/title.
    if (repositories!.y < heading!.y + heading!.height) {
      expect(Math.abs(repositories!.y + repositories!.height / 2 - heading!.y - heading!.height / 2)).toBeLessThan(2);
    }
    await group.screenshot({ path: testInfo.outputPath('project-header.png') });
    // The logo edits its image in place; only the title navigates to the project.
    const logo = group.getByRole('button', { name: `Project logo for ${project.name}`, exact: true });
    await expect(logo).toHaveCount(1);
    await expect(group.getByRole('button', { name: `Project actions for ${project.name}`, exact: true })).toBeVisible();
    await expect(group.getByRole('button', { name: `New session in ${project.name}`, exact: true })).toBeVisible();
    await logo.click();
    const logoDialog = page.getByRole('dialog', { name: 'Project logo', exact: true });
    await expect(logoDialog).toBeVisible();
    await expect(page).toHaveURL('/arena');
    await page.keyboard.press('Escape');
    await expect(logo).toBeFocused();
    await open.click();
    await expect(page).toHaveURL(`/?project=${project.id}`);
    const views = page.getByRole('navigation', { name: 'Views', exact: true });
    const files = page.getByRole('complementary', { name: 'Files', exact: true });
    await expect(files).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Repository', exact: true })).toHaveValue(checkouts[0].id);
    await files.getByRole('button', { name: 'package.json', exact: true }).click();
    const filePane = page.getByRole('region', { name: 'File view', exact: true });
    await expect(filePane.getByLabel('File source', { exact: true })).toContainText('alpha');
    await expect(page.locator('.welcome-screen')).toBeHidden();
    await expect.poll(async () => { const box = (await filePane.boundingBox())!; return Math.round(box.x + box.width); }).toBe(width > 740 ? width - 4 : width);
    await page.screenshot({ path: testInfo.outputPath('project-file.png') });
    await filePane.getByRole('button', { name: 'Hide file view', exact: true }).click();
    await views.getByRole('button', { name: /^Repository(?:,|$)/ }).click();
    const repository = page.getByRole('complementary', { name: 'Repository', exact: true });
    await repository.locator('.repository-file').filter({ hasText: 'package.json' }).click();
    await expect(filePane.getByLabel('Unified diff').last()).toContainText('+new project');
    await page.screenshot({ path: testInfo.outputPath('project-changes.png') });
    await filePane.getByRole('button', { name: 'Hide file view', exact: true }).click();
    await views.getByRole('button', { name: 'Files', exact: true }).click();
    await page.getByRole('combobox', { name: 'Repository', exact: true }).selectOption(checkouts[1].id);
    await files.getByRole('button', { name: 'pyproject.toml', exact: true }).click();
    await expect(filePane.locator('.file-view-content:not([hidden])').getByLabel('File source', { exact: true })).toContainText('beta');
    expect((await (await request.get(`/api/sessions?projectId=${project.id}`)).json()).sessions).toHaveLength(0);
    await page.reload();
    await expect(page).toHaveURL(`/?project=${project.id}`);
    await expect(files).toBeVisible();
    await page.locator('.app-header').getByRole('button', { name: 'New session', exact: true }).click();
    await page.getByRole('button', { name: 'Start session', exact: true }).click();
    await expect(page).toHaveURL(/session=/);
    const { sessions } = await (await request.get(`/api/sessions?projectId=${project.id}`)).json() as { sessions: PublicSession[] };
    expect(sessions).toHaveLength(1);
    expect(sessions[0].repositories.map(item => item.checkoutId)).toEqual(checkouts.map(item => item.id));
    // Reopening the project keeps its workspace separate from an existing conversation.
    await page.goto('/arena');
    await group.getByRole('link', { name: `Open project ${project.name}`, exact: true }).click();
    await expect(page).toHaveURL(`/?project=${project.id}`);
    await expect(files).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'All sessions', exact: true })).toHaveValue('');
    expect(await page.locator('body').evaluate(node => node.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('opening a project file leaves it at least half the workspace beside a wide Files panel', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('code-ai:panel-widths', JSON.stringify({ repositoryWidth: 900, filesWidth: 320 })));
  const { project } = await projectFixture(request, 1);
  await page.goto(`/?project=${project.id}`);
  const files = page.getByRole('complementary', { name: 'Files', exact: true });
  await expect(files).toHaveCSS('width', '900px');
  await files.getByRole('button', { name: 'package.json', exact: true }).click();
  const filePane = page.getByRole('region', { name: 'File view', exact: true });
  await expect(filePane.getByLabel('File source')).toContainText('alpha');
  expect((await filePane.boundingBox())!.width).toBeGreaterThanOrEqual((1440 - 48) * .5);
  expect(await page.locator('.app-shell').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test('a repository-free project opens and can create its first session', async ({ page, request }) => {
  const { project } = await projectFixture(request, 0);
  await page.goto('/arena');
  const open = page.getByRole('link', { name: `Open project ${project.name}`, exact: true });
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`/?project=${project.id}`);
  await expect(page.getByRole('complementary', { name: 'Files', exact: true })).toContainText('No repository attached');
  await page.locator('.welcome-screen').getByRole('button', { name: 'New session', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'New session', exact: true });
  await setup.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(setup.getByLabel('Project', { exact: true })).toHaveValue(project.id);
  await setup.getByRole('button', { name: 'Create and open', exact: true }).click();
  await expect(page).toHaveURL(/session=/);
});

for (const theme of ['light', 'dark']) for (const width of [1440, 390]) for (const entry of ['Files', 'Repository']) {
  test(`${theme} ${width}: a project can attach its first repository from ${entry}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    const { project, checkouts } = await projectFixture(request, 0);
    await page.route('**/api/repository/status?*', route => route.fulfill({ json: { tree: {
      isRepository: true, branch: 'project-attachment', files: [{ path: 'package.json', status: 'modified', staged: false, unstaged: true }],
    } } }));
    await page.goto('/arena');
    await page.getByRole('link', { name: `Open project ${project.name}`, exact: true }).click();
    if (entry === 'Repository') await page.getByRole('navigation', { name: 'Views', exact: true })
      .getByRole('button', { name: 'Repository', exact: true }).click();
    const manager = page.getByRole('region', { name: 'Project repositories', exact: true });
    await expect(manager).toBeVisible();
    await manager.getByRole('combobox', { name: 'Repository to add', exact: true }).selectOption(checkouts[0].id);
    await expect(manager.getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('attach-project-repository.png') });
    await manager.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(manager).toBeHidden();
    const saved = await (await request.get(`/api/projects/${project.id}`)).json() as { project: DurableProject };
    expect(saved.project.repositories).toMatchObject([{ checkoutId: checkouts[0].id, role: 'primary' }]);
    const views = page.getByRole('navigation', { name: 'Views', exact: true });
    if (entry === 'Repository') {
      await expect(page.getByRole('complementary', { name: 'Repository', exact: true })).toContainText('project-attachment');
      await views.getByRole('button', { name: 'Files', exact: true }).click();
    }
    await page.getByRole('complementary', { name: 'Files', exact: true }).getByRole('button', { name: 'package.json', exact: true }).click();
    await expect(page.getByRole('region', { name: 'File view', exact: true }).getByLabel('File source', { exact: true })).toContainText('alpha');
    await page.screenshot({ path: testInfo.outputPath('attached-project-file.png') });
    expect((await (await request.get(`/api/sessions?projectId=${project.id}`)).json()).sessions).toHaveLength(0);
    await page.reload();
    await expect(page.getByRole('complementary', { name: 'Files', exact: true }).locator('.repository-name')).toHaveText('alpha');
    await page.locator('.app-header').getByRole('button', { name: 'New session', exact: true }).click();
    await page.getByRole('button', { name: 'Start session', exact: true }).click();
    await expect(page).toHaveURL(/session=/);
    const { sessions } = await (await request.get(`/api/sessions?projectId=${project.id}`)).json() as { sessions: PublicSession[] };
    expect(sessions).toHaveLength(1);
    expect(sessions[0].repositories).toEqual(saved.project.repositories);
  });
}

test('project repository saves retain failed choices, block duplicates and retry', async ({ page, request }) => {
  const { project, checkouts } = await projectFixture(request, 0);
  let attempts = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/projects/${project.id}`, async route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    attempts++;
    if (attempts > 1) return route.continue();
    await held;
    return route.fulfill({ status: 503, json: { error: 'Repository attachment unavailable' } });
  });
  await page.goto(`/?project=${project.id}`);
  const manager = page.getByRole('region', { name: 'Project repositories', exact: true });
  const choice = manager.getByRole('combobox', { name: 'Repository to add', exact: true });
  const add = manager.getByRole('button', { name: 'Add', exact: true });
  await choice.selectOption(checkouts[0].id);
  await add.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(add).toBeDisabled();
  await expect(choice).toBeDisabled();
  expect(attempts).toBe(1);
  release();
  await expect(manager.getByRole('alert')).toContainText('Repository attachment unavailable');
  await expect(choice).toHaveValue(checkouts[0].id);
  expect((await (await request.get(`/api/projects/${project.id}`)).json()).project.repositories).toEqual([]);
  await add.click();
  await expect(manager).toBeHidden();
  expect(attempts).toBe(2);
  await expect(page.getByRole('complementary', { name: 'Files', exact: true }).getByRole('button', { name: 'package.json', exact: true })).toBeVisible();
});

test('project repository conflicts refresh concurrent changes and retry with the new revision', async ({ page, request }) => {
  const { project, checkouts } = await projectFixture(request, 0);
  let concurrent: DurableProject | undefined;
  const revisions: number[] = [];
  await page.route(`**/api/projects/${project.id}`, async route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    revisions.push(route.request().postDataJSON().expectedRevision);
    if (revisions.length === 1) {
      const response = await request.patch(`/api/projects/${project.id}`, { data: { expectedRevision: project.revision, name: 'Concurrent project rename' } });
      concurrent = (await response.json()).project;
    }
    return route.continue();
  });
  await page.goto(`/?project=${project.id}`);
  const manager = page.getByRole('region', { name: 'Project repositories', exact: true });
  const choice = manager.getByRole('combobox', { name: 'Repository to add', exact: true });
  await choice.selectOption(checkouts[0].id);
  await manager.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(manager.getByRole('alert')).toContainText('Project changed');
  await expect(choice).toHaveValue(checkouts[0].id);
  await manager.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(manager).toBeHidden();
  expect(revisions).toEqual([project.revision, concurrent!.revision]);
  const saved = (await (await request.get(`/api/projects/${project.id}`)).json()).project as DurableProject;
  expect(saved.name).toBe('Concurrent project rename');
  expect(saved.repositories[0]).toMatchObject({ checkoutId: checkouts[0].id, role: 'primary' });
});

test('retrying a project attachment preserves a concurrently attached repository', async ({ page, request }) => {
  const { project, checkouts } = await projectFixture(request, 0);
  const { hostId } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  let raced = false;
  await page.route(`**/api/projects/${project.id}`, async route => {
    if (route.request().method() === 'PATCH' && !raced) {
      raced = true;
      await request.patch(`/api/projects/${project.id}`, { data: { expectedRevision: project.revision,
        repositories: [{ id: crypto.randomUUID(), hostId, checkoutId: checkouts[1].id, role: 'primary' }] } });
    }
    return route.continue();
  });
  await page.goto(`/?project=${project.id}`);
  await page.getByRole('combobox', { name: 'Repository to add', exact: true }).selectOption(checkouts[0].id);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const files = page.getByRole('complementary', { name: 'Files', exact: true });
  await expect(files.getByRole('alert')).toContainText('Project changed');
  await page.getByRole('button', { name: 'Manage repositories', exact: true }).click();
  const manager = page.getByRole('region', { name: 'Project repositories', exact: true });
  await expect(manager.getByRole('combobox', { name: 'Repository to add', exact: true })).toHaveValue(checkouts[0].id);
  await manager.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(manager.locator('.repository-binding')).toHaveCount(2);
  await expect(files.getByRole('alert')).toHaveCount(0);
  const saved = (await (await request.get(`/api/projects/${project.id}`)).json()).project as DurableProject;
  expect(saved.repositories.map(binding => [binding.checkoutId, binding.role])).toEqual([
    [checkouts[1].id, 'primary'], [checkouts[0].id, 'reference'],
  ]);
});

test('project management changes future session defaults and preserves existing sessions', async ({ page, request }) => {
  const { project, checkouts } = await projectFixture(request, 1);
  const existing = (await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json()).session as PublicSession;
  await page.goto(`/?project=${project.id}`);
  const manage = page.getByRole('button', { name: 'Manage repositories', exact: true });
  await manage.click();
  const manager = page.getByRole('region', { name: 'Project repositories', exact: true });
  await manager.getByRole('combobox', { name: 'Repository to add', exact: true }).selectOption(checkouts[1].id);
  await manager.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(manager.locator('.repository-binding')).toHaveCount(2);
  await expect(manager.getByRole('button', { name: 'Make beta primary', exact: true })).toBeEnabled();
  await manager.getByRole('button', { name: 'Make beta primary', exact: true }).click();
  await expect(manager.locator('.repository-binding').filter({ hasText: 'beta' })).toContainText('primary');
  await manager.getByRole('button', { name: 'Move beta up', exact: true }).click();
  await expect(manager.locator('.repository-binding strong')).toHaveText(['beta', 'alpha']);
  await manager.getByRole('button', { name: 'Remove alpha', exact: true }).click();
  await expect(manager.locator('.repository-binding')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('complementary', { name: 'Files', exact: true }).getByRole('button', { name: 'pyproject.toml', exact: true })).toBeVisible();
  expect((await (await request.get(`/api/sessions/${existing.id}`)).json()).session.repositories).toEqual(existing.repositories);
  await page.reload();
  await expect(page.getByRole('complementary', { name: 'Files', exact: true }).locator('.repository-name')).toHaveText('beta');
  await page.locator('.app-header').getByRole('button', { name: 'New session', exact: true }).click();
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await expect(page).toHaveURL(/session=/);
  const sessionId = new URL(page.url()).searchParams.get('session');
  const created = (await (await request.get(`/api/sessions/${sessionId}`)).json()).session as PublicSession;
  expect(created.repositories).toMatchObject([{ checkoutId: checkouts[1].id, role: 'primary' }]);
});

test('a delayed attachment save preserves another project workspace selection', async ({ page, request }) => {
  const first = await projectFixture(request, 0), second = await projectFixture(request, 2);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/projects/${first.project.id}`, async route => {
    if (route.request().method() === 'PATCH') await held;
    return route.continue();
  });
  await page.goto(`/?project=${first.project.id}`);
  await page.getByRole('combobox', { name: 'Repository to add', exact: true }).selectOption(first.checkouts[0].id);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('link', { name: 'Arena', exact: true }).click();
  await page.getByRole('link', { name: `Open project ${second.project.name}`, exact: true }).click();
  const selection = page.getByRole('combobox', { name: 'Repository', exact: true });
  await selection.selectOption(second.checkouts[1].id);
  await expect(page.getByRole('button', { name: 'pyproject.toml', exact: true })).toBeVisible();
  const saved = page.waitForResponse(response => response.url().endsWith(`/api/projects/${first.project.id}`) && response.request().method() === 'PATCH');
  release();
  await saved;
  await expect.poll(async () => (await (await request.get(`/api/projects/${first.project.id}`)).json()).project.repositories.length).toBe(1);
  await page.getByRole('button', { name: 'pyproject.toml', exact: true }).click();
  await expect(page.getByLabel('File source', { exact: true })).toContainText('beta');
  await expect(selection).toHaveValue(second.checkouts[1].id);
  await expect(page).toHaveURL(`/?project=${second.project.id}`);
});

test('a repository-free attached project saves and browses on its executor', async ({ page, request }) => {
  const { project, checkouts } = await projectFixture(request, 0);
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const local = snapshot.machines.find(item => item.machine.kind === 'local')!;
  const remoteId = crypto.randomUUID();
  let remoteProject = { ...project, id: crypto.randomUUID(), name: 'Attach on executor' };
  const remote = { ...structuredClone(local), machine: { ...local.machine, id: remoteId, kind: 'remote' as const, label: 'Attachment executor' },
    projects: [remoteProject], sessions: [], archivedSessions: [] };
  snapshot.machines.push(remote);
  await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
  await page.route(`**/api/machines/${remoteId}/projects`, route => route.fulfill({ json: { projects: [remoteProject] } }));
  await page.route(`**/api/machines/${remoteId}/sessions?*`, route => route.fulfill({ json: { sessions: [] } }));
  const updates: unknown[] = [];
  await page.route(`**/api/machines/${remoteId}/projects/${remoteProject.id}`, route => {
    if (route.request().method() === 'PATCH') {
      const update = route.request().postDataJSON();
      updates.push(update);
      remoteProject = { ...remoteProject, repositories: update.repositories, revision: remoteProject.revision + 1 };
      remote.projects = [remoteProject];
    }
    return route.fulfill({ json: { project: remoteProject } });
  });
  await page.route(`**/api/machines/${remoteId}/repository/**`, route => {
    if (new URL(route.request().url()).pathname.endsWith('/files')) return route.fulfill({ json: { directory: { path: '', entries: [{ name: 'executor.txt', kind: 'file' }] } } });
    if (new URL(route.request().url()).pathname.endsWith('/file')) return route.fulfill({ json: { file: { path: 'executor.txt', text: 'Attached on executor', size: 20 } } });
    return route.fulfill({ json: { tree: { isRepository: true, branch: 'executor', files: [] } } });
  });
  await page.goto('/arena');
  await page.getByRole('link', { name: `Open project ${remoteProject.name}`, exact: true }).click();
  await page.getByRole('combobox', { name: 'Repository to add', exact: true }).selectOption(checkouts[0].id);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('complementary', { name: 'Files', exact: true }).getByRole('button', { name: 'executor.txt', exact: true }).click();
  await expect(page.getByLabel('File source', { exact: true })).toContainText('Attached on executor');
  expect(updates).toEqual([{ expectedRevision: 0, repositories: [{ id: expect.any(String), hostId: remoteId, checkoutId: checkouts[0].id, role: 'primary' }] }]);
  expect((await (await request.get(`/api/projects/${project.id}`)).json()).project.repositories).toEqual([]);
});

test('project file and status errors retain navigation and offer recovery', async ({ page, request }) => {
  const { project } = await projectFixture(request, 1);
  let statusFailed = true, fileFailed = true;
  await page.route('**/api/repository/status?*', route => statusFailed
    ? route.fulfill({ status: 503, json: { error: 'Project status unavailable' } }) : route.continue());
  await page.route('**/api/repository/file?*', route => fileFailed
    ? route.fulfill({ status: 503, json: { error: 'Project file unavailable' } }) : route.continue());
  await page.goto(`/?project=${project.id}`);
  await page.getByRole('complementary', { name: 'Files', exact: true }).getByRole('button', { name: 'package.json', exact: true }).click();
  const filePane = page.getByRole('region', { name: 'File view', exact: true });
  await expect(filePane.getByRole('alert')).toContainText('Project file unavailable');
  fileFailed = false;
  await filePane.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(filePane.getByLabel('File source', { exact: true })).toContainText('alpha');
  await page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name: 'Repository', exact: true }).click();
  const repository = page.getByRole('complementary', { name: 'Repository', exact: true });
  await expect(repository).toContainText('Project status unavailable');
  statusFailed = false;
  await repository.getByRole('button', { name: 'Refresh Git status', exact: true }).click();
  await expect(repository.getByText('Project status unavailable', { exact: true })).toHaveCount(0);
  await expect(filePane.getByLabel('File source', { exact: true })).toContainText('alpha');
});

for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
  test(`${theme} ${width}: returning through Arena restores each project's files and maximize`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    const first = await projectFixture(request, 1), second = await projectFixture(request, 1);
    await page.goto(`/?project=${first.project.id}`);
    const files = page.getByRole('complementary', { name: 'Files', exact: true });
    await files.getByRole('button', { name: 'package.json', exact: true }).click();
    const filePane = page.getByRole('region', { name: 'File view', exact: true });
    await expect(filePane.getByLabel('File source', { exact: true })).toContainText('alpha');
    if (width === 390) await page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name: 'Files', exact: true }).click();
    await files.getByRole('button', { name: 'docs', exact: true }).click();
    await files.getByRole('button', { name: 'file-links.md', exact: true }).click();
    await expect(filePane.getByRole('heading', { name: 'File links', exact: true })).toBeVisible();
    await filePane.getByRole('button', { name: 'Maximize File view', exact: true }).click();
    if (width === 390) await page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('link', { name: 'Arena', exact: true }).click();
    await page.getByRole('link', { name: `Open project ${second.project.name}`, exact: true }).click();
    await expect(page).toHaveURL(`/?project=${second.project.id}`);
    await expect(files).toBeVisible();
    await expect(filePane).toBeHidden();
    await expect(page.locator('.app-shell')).not.toHaveClass(/pane-maximized/);
    await files.getByRole('button', { name: 'package.json', exact: true }).click();
    await expect(filePane.getByLabel('File source', { exact: true })).toContainText('alpha');
    await filePane.getByRole('button', { name: 'Maximize File view', exact: true }).click();
    if (width === 390) await page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('link', { name: 'Arena', exact: true }).click();
    await page.getByRole('link', { name: `Open project ${first.project.name}`, exact: true }).click();
    await expect(filePane.getByRole('heading', { name: 'File links', exact: true })).toBeVisible();
    await expect(filePane.getByRole('tab')).toHaveCount(2);
    await expect(filePane.getByRole('tab', { name: 'file-links.md', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(filePane.getByRole('button', { name: 'Restore layout', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('restored-project-document.png') });
    if (width === 390) await page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('link', { name: 'Arena', exact: true }).click();
    await page.getByRole('link', { name: `Open project ${second.project.name}`, exact: true }).click();
    await expect(filePane.getByLabel('File source', { exact: true })).toContainText('alpha');
    await expect(filePane.getByRole('tab')).toHaveCount(1);
    await expect(filePane.getByRole('button', { name: 'Restore layout', exact: true })).toBeVisible();
  });
}

test('an attached project routes files to its executor and offline projects cannot open', async ({ page, request }) => {
  const { project } = await projectFixture(request, 1);
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const local = snapshot.machines.find(item => item.machine.kind === 'local')!;
  const remoteId = crypto.randomUUID();
  const remoteProject = { ...project, id: crypto.randomUUID(), name: 'Attached project workspace',
    repositories: project.repositories.map(binding => ({ ...binding, hostId: remoteId })) };
  const remote = { ...structuredClone(local), machine: { ...local.machine, id: remoteId, kind: 'remote' as const, label: 'Project executor' },
    projects: [remoteProject], sessions: [], archivedSessions: [] };
  snapshot.machines.push(remote);
  await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
  await page.route(`**/api/machines/${remoteId}/projects`, route => route.fulfill({ json: { projects: [remoteProject] } }));
  await page.route(`**/api/machines/${remoteId}/sessions?*`, route => route.fulfill({ json: { sessions: [] } }));
  const remoteRequests: string[] = [];
  await page.route(`**/api/machines/${remoteId}/repository/**`, async route => {
    const url = new URL(route.request().url());
    remoteRequests.push(url.pathname);
    if (url.pathname.endsWith('/file-search')) return route.fulfill({ json: { files: { paths: ['remote.txt'] } } });
    if (url.pathname.endsWith('/files')) return route.fulfill({ json: { directory: { path: '', entries: [{ name: 'remote.txt', kind: 'file' }] } } });
    if (url.pathname.endsWith('/file')) return route.fulfill({ json: { file: { path: 'remote.txt', text: 'From the project executor', size: 25 } } });
    return route.fulfill({ json: { tree: { isRepository: true, branch: 'remote-project', files: [] } } });
  });
  await page.goto('/arena');
  const open = page.getByRole('link', { name: `Open project ${remoteProject.name}`, exact: true });
  await open.click();
  await expect(page).toHaveURL(`/?project=${remoteProject.id}&machine=${remoteId}`);
  await page.getByRole('complementary', { name: 'Files', exact: true }).getByRole('button', { name: 'remote.txt', exact: true }).click();
  await expect(page.getByLabel('File source', { exact: true })).toContainText('From the project executor');
  expect(remoteRequests.some(item => item.endsWith('/files'))).toBe(true);
  expect(remoteRequests.some(item => item.endsWith('/file'))).toBe(true);
  await page.keyboard.press('Control+p');
  const fileSearch = page.getByRole('dialog', { name: 'Open file', exact: true });
  await fileSearch.getByRole('combobox', { name: 'File name or path', exact: true }).fill('rmt');
  await expect(fileSearch.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('File source', { exact: true })).toContainText('From the project executor');
  expect(remoteRequests.some(item => item.endsWith('/file-search'))).toBe(true);
  await page.locator('.app-header').getByRole('button', { name: 'New session', exact: true }).click();
  await page.getByRole('button', { name: 'Queue session…', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'New session', exact: true });
  await expect(setup.getByLabel('Project', { exact: true })).toHaveValue(remoteProject.id);
  await setup.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(setup.getByLabel('Machine', { exact: true })).toHaveValue(remoteId);
  await setup.getByRole('button', { name: 'Close setup', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('complementary', { name: 'Files', exact: true })).toBeVisible();
  remote.machine.state = 'offline';
  await page.goto('/arena');
  await expect(open).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('button', { name: `New session in ${remoteProject.name}`, exact: true })).toBeDisabled();
});
