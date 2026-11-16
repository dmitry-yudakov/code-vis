import { expect, test, fulfillArenaSnapshot, pushArenaSnapshot } from './arena-stream';
import type { APIRequestContext, Locator } from '@playwright/test';
import type { ArenaSnapshot, CheckoutsResponse, DurableProject } from '../src/shared/types';

async function createProject(request: APIRequestContext, name: string, withRepository = true) {
  const catalog = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const checkout = catalog.checkouts.find(item => item.relativePath === 'alpha')!;
  const response = await request.post('/api/projects', { data: { name, checkoutIds: withRepository ? [checkout.id] : [] } });
  expect(response.ok()).toBe(true);
  return (await response.json()).project as DurableProject;
}
async function loaded(image: Locator) {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
}

for (const [appearance, width] of [['light', 1440], ['dark', 1440], ['light', 390], ['dark', 390]] as const) {
  test(`choose, retain and remove a logo in Arena and an open session: ${appearance} ${width}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme => localStorage.setItem('code-ai:theme', theme), appearance);
    const project = await createProject(request, `Logo ${appearance} ${width} ${Date.now()}`);
    await page.goto('/arena');
    const group = page.getByRole('region', { name: project.name, exact: true });
    const open = group.getByRole('button', { name: `Project logo for ${project.name}`, exact: true });
    const heading = group.getByRole('heading', { name: project.name, exact: true });
    await expect(open).toHaveCount(1);
    await expect(group.getByRole('link', { name: `Open project ${project.name}`, exact: true })).toBeVisible();
    expect((await open.boundingBox())!.x).toBeLessThan((await heading.boundingBox())!.x);
    await open.click();
    const dialog = page.getByRole('dialog', { name: 'Project logo', exact: true });
    await expect(dialog.getByRole('textbox', { name: 'Image path', exact: true })).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    const files = dialog.getByRole('list', { name: 'Logo files', exact: true });
    await files.getByRole('button', { name: 'logo.svg', exact: true }).click();
    await loaded(dialog.getByRole('img', { name: 'Logo preview', exact: true }));
    await page.screenshot({ path: testInfo.outputPath('logo-dialog.png'), animations: 'disabled' });
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await loaded(group.locator('img.project-logo'));
    await expect(open).toBeFocused();
    if (width === 1440) {
      await page.getByRole('button', { name: 'Tiles', exact: true }).click();
      await loaded(group.locator('img.project-logo'));
    }
    await page.reload();
    await loaded(group.locator('img.project-logo'));
    await group.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('arena-logo.png'), animations: 'disabled' });
    const sessionResponse = await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } });
    const { session } = await sessionResponse.json();
    await page.goto(`/?session=${session.id}`);
    const picker = page.locator('.project-search-trigger');
    const headerLogo = page.locator('.project-picker-with-logo').getByRole('button', { name: `Project logo for ${project.name}`, exact: true });
    await loaded(headerLogo.locator('img.project-logo'));
    await expect(picker).toContainText(project.name);
    await page.screenshot({ path: testInfo.outputPath('session-logo.png'), animations: 'disabled' });
    await headerLogo.click();
    await expect(dialog.getByRole('textbox', { name: 'Image path', exact: true })).toHaveValue('logo.svg');
    await dialog.getByRole('button', { name: 'Remove logo', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(headerLogo.locator('img.project-logo')).toHaveCount(0);
    await expect(headerLogo).toBeFocused();
    await page.reload();
    await expect(picker).toContainText(project.name);
    await expect(headerLogo.locator('img.project-logo')).toHaveCount(0);
    expect((await (await request.get(`/api/projects/${project.id}`)).json()).project.logo).toBeUndefined();
    expect(await page.locator('body').evaluate(node => node.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test('browse folders, preview before saving, cancel, and change the image from its own position', async ({ page, request }) => {
  const project = await createProject(request, `Logo browser ${Date.now()}`);
  await page.goto('/arena');
  const group = page.getByRole('region', { name: project.name, exact: true });
  const logo = group.getByRole('button', { name: `Project logo for ${project.name}`, exact: true });
  const dialog = page.getByRole('dialog', { name: 'Project logo', exact: true });
  const files = dialog.getByRole('list', { name: 'Logo files', exact: true });
  await logo.click();
  await expect(dialog.getByRole('button', { name: 'Parent folder', exact: true })).toBeDisabled();
  await expect(files.getByRole('button', { name: 'package.json', exact: true })).toHaveCount(0);
  await files.getByRole('button', { name: 'docs', exact: true }).click();
  await files.getByRole('button', { name: 'logo.svg', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Image path', exact: true })).toHaveValue('docs/logo.svg');
  await loaded(dialog.getByRole('img', { name: 'Logo preview', exact: true }));
  expect((await (await request.get(`/api/projects/${project.id}`)).json()).project.logo).toBeUndefined();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(logo).toBeFocused();
  await expect(logo.locator('img')).toHaveCount(0);
  await logo.press('Enter');
  await files.getByRole('button', { name: 'docs', exact: true }).click();
  await files.getByRole('button', { name: 'logo.svg', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await loaded(logo.locator('img.project-logo'));
  await logo.click();
  await expect(dialog.getByRole('textbox', { name: 'Image path', exact: true })).toHaveValue('docs/logo.svg');
  await dialog.getByRole('button', { name: 'Parent folder', exact: true }).click();
  await files.getByRole('button', { name: 'logo.svg', exact: true }).click();
  await loaded(dialog.getByRole('img', { name: 'Logo preview', exact: true }));
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect((await (await request.get(`/api/projects/${project.id}`)).json()).project.logo.path).toBe('logo.svg');
});

test('folder and preview errors can retry, and abandoned folder reads do not replace the current list', async ({ page, request }) => {
  const project = await createProject(request, `Logo picker recovery ${Date.now()}`);
  let firstFolder = true;
  let releaseFolder: () => void = () => {};
  const folderGate = new Promise<void>(resolve => { releaseFolder = resolve; });
  await page.route('**/api/repository/files?*', async route => {
    if (firstFolder) {
      firstFolder = false;
      return route.fulfill({ status: 503, json: { error: 'Folder temporarily unavailable' } });
    }
    if (new URL(route.request().url()).searchParams.get('path') === 'docs') {
      await folderGate;
      return route.fulfill({ json: { directory: { path: 'docs', entries: [{ name: 'stale.svg', kind: 'file' }] } } }).catch(() => {});
    }
    return route.continue();
  });
  let firstPreview = true;
  await page.route(`**/projects/${project.id}/logo?*`, route => {
    if (!firstPreview) return route.continue();
    firstPreview = false;
    return route.fulfill({ status: 503 });
  });
  await page.goto('/arena');
  await page.getByRole('button', { name: `Project logo for ${project.name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Project logo', exact: true });
  const files = dialog.getByRole('list', { name: 'Logo files', exact: true });
  await expect(files.getByRole('alert')).toContainText('temporarily unavailable');
  await files.getByRole('button', { name: 'Retry', exact: true }).click();
  await files.getByRole('button', { name: 'docs', exact: true }).click();
  await expect(files).toContainText('Reading folder');
  await dialog.getByRole('button', { name: 'Parent folder', exact: true }).click();
  await files.getByRole('button', { name: 'logo.svg', exact: true }).click();
  releaseFolder();
  await expect(files.getByRole('button', { name: 'stale.svg', exact: true })).toHaveCount(0);
  await expect(dialog).toContainText('Preview unavailable');
  await dialog.getByRole('button', { name: 'Retry preview', exact: true }).click();
  await loaded(dialog.getByRole('img', { name: 'Logo preview', exact: true }));
  await expect(dialog.getByRole('textbox', { name: 'Image path', exact: true })).toHaveValue('logo.svg');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test('logo errors retain the draft; stale revisions refresh for retry, missing images keep the name usable', async ({ page, request }) => {
  const project = await createProject(request, `Logo retry ${Date.now()}`);
  await page.goto('/arena');
  const group = page.getByRole('region', { name: project.name, exact: true });
  await group.getByRole('button', { name: `Project logo for ${project.name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Project logo', exact: true });
  const input = dialog.getByRole('textbox', { name: 'Image path', exact: true });
  await input.fill('missing.svg');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('no longer exists');
  await expect(input).toHaveValue('missing.svg');
  expect((await (await request.patch(`/api/projects/${project.id}`, { data: { expectedRevision: 0, name: `${project.name} renamed` } })).json()).project.revision).toBe(1);
  await input.fill('logo.svg');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText(/changed|revision/i);
  await expect(input).toHaveValue('logo.svg');
  await input.press('Enter');
  await expect(dialog).not.toBeVisible();
  const renamed = page.getByRole('region', { name: `${project.name} renamed`, exact: true });
  await loaded(renamed.locator('img.project-logo'));
  await page.route(`**/projects/${project.id}/logo?*`, route => route.fulfill({ status: 404, json: { error: 'Missing image' } }));
  await page.reload();
  await expect(renamed).toBeVisible();
  await expect(renamed.locator('img.project-logo')).toHaveCount(0);
  await renamed.getByRole('button', { name: `Project logo for ${project.name} renamed`, exact: true }).click();
  await dialog.getByRole('button', { name: 'Remove logo', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.unroute(`**/projects/${project.id}/logo?*`);
  await renamed.getByRole('button', { name: `Project logo for ${project.name} renamed`, exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Image path', exact: true }).fill('logo.svg');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await loaded(renamed.locator('img.project-logo'));
});

test('a repository-free project can cancel logo setup', async ({ page, request }) => {
  const project = await createProject(request, `No repo logo ${Date.now()}`, false);
  await page.goto('/arena');
  await page.getByRole('button', { name: `Project logo for ${project.name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Project logo', exact: true });
  await expect(dialog).toContainText('Add a repository');
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('repository changes during logo setup retain the path and allow retry on the remaining repository', async ({ page, request }) => {
  const project = await createProject(request, `Logo repository conflict ${Date.now()}`);
  await page.goto('/arena');
  await page.getByRole('button', { name: `Project logo for ${project.name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Project logo', exact: true });
  await dialog.getByRole('textbox', { name: 'Image path', exact: true }).fill('logo.svg');
  const replacement = { ...project.repositories[0], id: crypto.randomUUID() };
  expect((await request.patch(`/api/projects/${project.id}`, { data: { expectedRevision: 0, repositories: [replacement] } })).ok()).toBe(true);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('changed');
  await expect(dialog.getByRole('textbox', { name: 'Image path', exact: true })).toHaveValue('logo.svg');
  await expect(dialog.getByLabel('Repository', { exact: true })).toHaveValue(replacement.id);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await loaded(page.getByRole('region', { name: project.name, exact: true }).locator('img.project-logo'));
});

test('logo selection uses the project machine and repository, and disables offline edits', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const local = snapshot.machines.find(entry => entry.machine.kind === 'local')!;
  const remoteId = crypto.randomUUID();
  const project: DurableProject = { version: 1, revision: 0, id: crypto.randomUUID(), name: 'Remote logo project',
    repositories: [0, 1].map(index => ({ id: crypto.randomUUID(), hostId: remoteId, checkoutId: `remote-${index}`, role: index ? 'reference' : 'primary' })),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const remote = { ...structuredClone(local), machine: { ...local.machine, id: remoteId, kind: 'remote' as const, label: 'Logo executor' },
    projects: [project], sessions: [], archivedSessions: [], checkouts: [0, 1].map(index => ({ ...local.checkouts[0], id: `remote-${index}`, name: `Remote repository ${index}` })) };
  snapshot.machines.push(remote);
  await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
  let patches = 0;
  await page.route(`**/api/machines/${remoteId}/projects/${project.id}`, async route => {
    expect(route.request().method()).toBe('PATCH');
    expect(route.request().postDataJSON()).toEqual({ expectedRevision: 0, expectedLogo: null, logo: { repositoryId: project.repositories[1].id, path: 'brand.svg' } });
    patches++;
    project.logo = route.request().postDataJSON().logo;
    project.revision++;
    await route.fulfill({ json: { project } });
  });
  await page.route(`**/api/machines/${remoteId}/projects/${project.id}/logo?*`, route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32"/></svg>' }));
  const browsed: string[] = [];
  await page.route(`**/api/machines/${remoteId}/repository/files?*`, route => {
    browsed.push(new URL(route.request().url()).searchParams.get('checkoutId')!);
    return route.fulfill({ json: { directory: { path: '', entries: [{ name: 'brand.svg', kind: 'file' }] } } });
  });
  await page.goto('/arena');
  const group = page.getByRole('region', { name: project.name, exact: true });
  const button = group.getByRole('button', { name: `Project logo for ${project.name}`, exact: true });
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'Project logo', exact: true });
  await dialog.getByLabel('Repository', { exact: true }).selectOption(project.repositories[1].id);
  await dialog.getByRole('list', { name: 'Logo files', exact: true }).getByRole('button', { name: 'brand.svg', exact: true }).click();
  await loaded(dialog.getByRole('img', { name: 'Logo preview', exact: true }));
  expect(browsed).toContain('remote-1');
  remote.machine.state = 'offline';
  await pushArenaSnapshot(page);
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  remote.machine.state = 'online';
  await pushArenaSnapshot(page);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(patches).toBe(1);
  await loaded(group.locator('img.project-logo'));
  remote.machine.state = 'offline';
  await pushArenaSnapshot(page);
  await expect(button).toBeDisabled();
});
