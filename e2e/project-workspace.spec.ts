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
    await expect(group).toContainText('0 sessions');
    const groupBox = (await group.boundingBox())!, actions = (await group.locator('.arena-project-actions').boundingBox())!;
    expect(groupBox.x + groupBox.width - actions.x - actions.width).toBeLessThan(24);
    const [heading, count, repositories] = await Promise.all([
      group.getByRole('heading', { name: project.name, exact: true }), group.getByText('0 sessions', { exact: true }),
      group.locator('.arena-project-repositories'),
    ].map(item => item.boundingBox()));
    // Metadata on the same row must share its vertical center with the logo/title.
    for (const item of [count!, repositories!]) if (item.y < heading!.y + heading!.height) {
      expect(Math.abs(item.y + item.height / 2 - heading!.y - heading!.height / 2)).toBeLessThan(2);
    }
    await group.screenshot({ path: testInfo.outputPath('project-header.png') });
    // The logo edits its image in place; only the title navigates to the project.
    const logo = group.getByRole('button', { name: `Project logo for ${project.name}`, exact: true });
    await expect(logo).toHaveCount(1);
    await expect(group.locator('.arena-project-actions').getByRole('button')).toHaveCount(1);
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
