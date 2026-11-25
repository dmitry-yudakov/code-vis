import { expect, test, fulfillArenaSnapshot } from './arena-stream';
import type { ArenaSnapshot, CheckoutsResponse, DurableProject, PublicSession } from '../src/shared/types';

for (const theme of ['light', 'dark']) for (const width of [1440, 390, 360]) {
  test(`Arena uses its navbar and leaves room for projects: ${theme} ${width}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme => {
      localStorage.setItem('code-ai:theme', theme);
      localStorage.setItem('code-ai:device:arena-layout', 'tiles');
    }, theme);
    const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
    const checkout = checkouts.find(item => item.name === 'alpha')!;
    const { project: created } = await (await request.post('/api/projects', {
      data: { name: 'Compact Arena project', checkoutIds: [checkout.id] },
    })).json() as { project: DurableProject };
    const logoSave = await request.patch(`/api/projects/${created.id}`, {
      data: { expectedRevision: created.revision, expectedLogo: null, logo: { repositoryId: created.repositories[0].id, path: 'logo.svg' } },
    });
    expect(logoSave.ok()).toBe(true);
    const { project } = await logoSave.json() as { project: DurableProject };
    const { session } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json() as { session: PublicSession };
    const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
    const owner = snapshot.machines.find(machine => machine.machine.kind === 'local')!;
    snapshot.machines = [owner];
    owner.projects = [project];
    owner.checkouts.find(item => item.id === checkout.id)!.worktreeCreation = { available: true, branch: 'feature/project-picker' };
    owner.sessions = owner.sessions.filter(item => item.id === session.id);
    owner.archivedSessions = [{ ...owner.sessions[0], id: crypto.randomUUID(), archivedAt: new Date().toISOString() }];
    owner.runs = { active: [], recent: [] };
    await page.addInitScript(({ machineId, level }) => {
      localStorage.setItem(`code-ai:device:v1:security-notice:${machineId}`, level);
    }, { machineId: owner.machine.id, level: owner.securityLevel || 'guarded' });
    await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
    await page.goto('/arena');
    const navbar = page.locator('.app-header');
    const arena = page.getByRole('main', { name: 'Arena', exact: true });
    await expect(navbar.getByRole('heading', { name: 'Arena', exact: true })).toBeVisible();
    for (const name of ['Refresh', 'New project', 'New session']) {
      await expect(navbar.getByRole('button', { name, exact: true })).toBeVisible();
      await expect(arena.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    await expect(arena.getByRole('tab', { name: 'Active (1)', exact: true })).toBeVisible();
    await expect(arena.getByRole('tab', { name: 'Archived', exact: true })).toBeVisible();
    const controls = (await arena.locator('.arena-view-controls').boundingBox())!;
    const header = (await navbar.boundingBox())!;
    const panel = arena.getByRole('region', { name: project.name, exact: true });
    await expect(panel).toBeVisible();
    expect(controls.y - (header.y + header.height)).toBeLessThanOrEqual(20);
    expect((await panel.boundingBox())!.y).toBeLessThan(150);
    expect(await navbar.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await arena.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('compact-arena.png'), animations: 'disabled' });
    await page.keyboard.press('Control+k');
    const projects = page.getByRole('listbox', { name: 'Projects', exact: true });
    await expect(page.getByRole('combobox', { name: 'Search projects', exact: true })).toBeFocused();
    const option = projects.getByRole('option', { selected: true });
    await expect(option.getByText(project.name, { exact: true })).toBeVisible();
    const logo = option.locator('img.project-logo');
    await expect(logo).toBeVisible();
    await expect.poll(() => logo.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const folder = option.getByText('alpha', { exact: true });
    const branch = option.getByText('feature/project-picker', { exact: true });
    if (width === 360) await expect(folder).toBeHidden();
    else await expect(folder).toBeVisible();
    if (width === 1440) await expect(branch).toBeVisible();
    else await expect(branch).toBeHidden();
    expect(await projects.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('arena-project-picker.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    for (const section of ['Inbox', 'Archived']) {
      await arena.getByRole('tab', { name: section, exact: true }).click();
      const newProject = navbar.getByRole('button', { name: 'New project', exact: true });
      await newProject.click();
      const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
      await expect(dialog.getByRole('textbox', { name: 'Project name', exact: true })).toBeFocused();
      await page.keyboard.press('Control+k');
      await expect(projects).toBeHidden();
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(newProject).toBeFocused();
      await navbar.getByRole('button', { name: 'New session', exact: true }).click();
      const setup = page.getByRole('dialog', { name: 'New session', exact: true });
      await expect(setup).toBeVisible();
      await setup.getByRole('button', { name: 'Close setup', exact: true }).click();
    }
  });
}

test('Arena Projects opens the selected executor workspace', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const local = snapshot.machines.find(entry => entry.machine.kind === 'local')!;
  const { project } = await (await request.post('/api/projects', { data: { name: 'Executor project fixture' } })).json();
  const remoteId = crypto.randomUUID();
  const repositories = [
    { id: crypto.randomUUID(), hostId: remoteId, checkoutId: 'remote-reference', role: 'reference' },
    { id: crypto.randomUUID(), hostId: remoteId, checkoutId: 'remote-primary', role: 'primary' },
  ] satisfies DurableProject['repositories'];
  const remoteProject: DurableProject = { ...project, id: crypto.randomUUID(), name: 'Executor project', repositories,
    logo: { repositoryId: repositories[1].id, path: 'logo.svg' } };
  const remote = { ...local, machine: { ...local.machine, id: remoteId, kind: 'remote' as const, label: 'Online executor' },
    projects: [remoteProject], sessions: [], archivedSessions: [], checkouts: [
      { id: 'remote-reference', name: 'reference', relativePath: 'reference', branch: 'main' },
      { id: 'remote-primary', name: 'remote/checkout', relativePath: 'remote/checkout', branch: 'remote-branch' },
    ] };
  snapshot.machines.push(remote, { ...remote, machine: { ...remote.machine, id: crypto.randomUUID(), state: 'offline' as const, label: 'Offline executor' } });
  await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
  await page.route(`**/api/machines/${remoteId}/projects`, route => route.fulfill({ json: { projects: [remoteProject] } }));
  await page.route(`**/api/machines/${remoteId}/projects/${remoteProject.id}/logo?*`, route =>
    route.fulfill({ path: 'test/fixtures/projects/alpha/logo.svg', contentType: 'image/svg+xml' }));
  await page.route(`**/api/machines/${remoteId}/sessions?*`, route => route.fulfill({ json: { sessions: [] } }));
  await page.goto('/arena');
  await expect(page.getByRole('region', { name: 'Online executor', exact: true })).toBeVisible();
  await page.keyboard.press('Control+k');
  const projects = page.getByRole('listbox', { name: 'Projects', exact: true });
  await expect(projects.getByRole('option', { name: /Offline executor/ })).toHaveCount(0);
  const search = page.getByRole('combobox', { name: 'Search projects', exact: true });
  await expect(search).toBeFocused();
  await page.keyboard.type('exctrprj');
  const option = projects.getByRole('option', { selected: true });
  await expect(option).toHaveAccessibleName(/Executor project Online executor remote\/checkout remote-branch/);
  const logo = option.locator('img.project-logo');
  await expect(logo).toHaveAttribute('src', new RegExp(`^/api/machines/${remoteId}/projects/${remoteProject.id}/logo\\?`));
  await expect.poll(() => logo.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`/?project=${remoteProject.id}&machine=${remoteId}`);
  await expect(page.getByRole('button', { name: `Project: ${remoteProject.name}`, exact: true })).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(search).toBeFocused();
  await expect(projects.getByRole('option', { selected: true })).toHaveAccessibleName('Executor project remote/checkout remote-branch');
});
