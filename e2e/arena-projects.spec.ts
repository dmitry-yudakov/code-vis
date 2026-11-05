import { expect, test } from '@playwright/test';
import type { ArenaSnapshot, CheckoutsResponse, DurableProject, PublicSession } from '../src/shared/types';

for (const [appearance, width] of [['light', 1440], ['dark', 1440], ['light', 390], ['dark', 390]] as const) {
  test(`create a project and its session directly from Arena: ${appearance} ${width}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme => localStorage.setItem('code-ai:theme', theme), appearance);
    const catalog = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
    const checkout = catalog.checkouts.find(item => item.relativePath === 'alpha')!;
    const name = `Arena project ${appearance} ${Date.now()}`;
    await page.goto('/arena');
    const arena = page.getByRole('main', { name: 'Arena', exact: true });
    const newProject = arena.getByRole('button', { name: 'New project', exact: true });
    await newProject.click();
    const projectDialog = page.getByRole('dialog', { name: 'New project', exact: true });
    await expect(projectDialog.getByRole('textbox', { name: 'Project name', exact: true })).toBeFocused();
    await expect(projectDialog.getByRole('button', { name: 'Create project', exact: true })).toBeDisabled();
    await projectDialog.getByRole('textbox', { name: 'Project name', exact: true }).fill(name);
    await projectDialog.getByLabel('Repository', { exact: true }).selectOption(checkout.id);
    await page.screenshot({ path: testInfo.outputPath('new-project.png'), animations: 'disabled' });
    await projectDialog.getByRole('button', { name: 'Create project', exact: true }).click();
    await expect(projectDialog).not.toBeVisible();
    await expect(page).toHaveURL(/\/arena$/);
    const group = arena.getByRole('region', { name, exact: true });
    await expect(group).toContainText('0 sessions');
    await expect(newProject).toBeFocused();
    await page.reload();
    await expect(group).toBeVisible();
    await group.getByRole('button', { name: `New session in ${name}`, exact: true }).click();
    const setup = page.getByRole('dialog', { name: 'New session', exact: true });
    const { projects } = await (await request.get('/api/projects')).json() as { projects: DurableProject[] };
    const created = projects.find(item => item.name === name)!;
    await expect(setup.getByLabel('Project', { exact: true })).toHaveValue(created.id);
    await expect(setup.getByLabel('Machine', { exact: true })).toHaveValue(catalog.hostId);
    await setup.getByLabel('Provider', { exact: true }).selectOption('claude');
    await setup.getByRole('button', { name: 'Create and open', exact: true }).click();
    await expect(setup).not.toBeVisible();
    await expect(page).toHaveURL(/\/\?(?:session|project)=/);
    await expect(page.locator('.project-search-trigger')).toContainText(name);
    const { sessions } = await (await request.get(`/api/sessions?projectId=${created.id}`)).json() as { sessions: PublicSession[] };
    expect(sessions).toHaveLength(1);
    expect(sessions[0].repositories.map(item => item.checkoutId)).toEqual([checkout.id]);
    if (width === 390) await page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name: /^More/ }).click();
    await page.getByRole('link', { name: 'Arena', exact: true }).click();
    await expect(group).toContainText('1 session');
    expect(await arena.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await group.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('arena-project.png'), animations: 'disabled' });
  });
}

test('project form supports cancel, retry, repository-free creation, and guards pending submission', async ({ page, request }) => {
  await page.goto('/arena');
  const newProject = page.getByRole('button', { name: 'New project', exact: true });
  await newProject.click();
  const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
  await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill('Cancelled project');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(newProject).toBeFocused();
  await newProject.click();
  await expect(dialog.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue('');
  const name = `Repository free ${Date.now()}`;
  await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill(`  ${name}  `);
  let posts = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/projects', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    posts++;
    if (posts === 1) {
      await gate;
      return route.fulfill({ status: 503, json: { error: 'Fixture temporarily unavailable. Try again.' } });
    }
    return route.continue();
  });
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Creating…', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  expect(posts).toBe(1);
  release();
  await expect(dialog.getByRole('alert')).toContainText('Fixture temporarily unavailable');
  await expect(dialog.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue(`  ${name}  `);
  await dialog.getByRole('textbox', { name: 'Project name', exact: true }).press('Enter');
  await expect(dialog).not.toBeVisible();
  const group = page.getByRole('region', { name, exact: true });
  await expect(group).toContainText('0 sessions');
  const { projects } = await (await request.get('/api/projects')).json() as { projects: DurableProject[] };
  expect(projects.filter(item => item.name === name)).toHaveLength(1);
  expect(projects.find(item => item.name === name)!.repositories).toEqual([]);
  await page.unrouteAll({ behavior: 'wait' });
});

test('project shortcuts preserve a pending setup draft instead of changing its target', async ({ page, request }) => {
  const projects: DurableProject[] = [];
  for (const suffix of ['A', 'B']) {
    const response = await request.post('/api/projects', { data: { name: `Pending ${suffix} ${Date.now()}` } });
    projects.push((await response.json()).project);
  }
  await page.goto('/arena');
  const group = (index: number) => page.getByRole('region', { name: projects[index].name, exact: true });
  const shortcut = (index: number) => group(index).getByRole('button', { name: `New session in ${projects[index].name}`, exact: true });
  await shortcut(0).click();
  const setup = page.getByRole('dialog', { name: 'New session', exact: true });
  await setup.getByRole('textbox').fill('Keep this task and target');
  await setup.getByRole('button', { name: 'Close setup', exact: true }).click();
  await shortcut(1).click();
  await expect(setup.getByRole('textbox')).toHaveValue('Keep this task and target');
  await expect(setup.getByLabel('Project', { exact: true })).toHaveValue(projects[0].id);
  await expect(setup).toContainText('A setup draft is already pending for another target');
  await setup.getByRole('button', { name: 'Clear setup', exact: true }).click();
  await shortcut(1).click();
  await expect(setup.getByLabel('Project', { exact: true })).toHaveValue(projects[1].id);
  await expect(setup.getByRole('textbox')).toHaveValue('');
});

test('project actions route to the selected machine, reset its repository, and disable offline targets', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const local = snapshot.machines.find(entry => entry.machine.kind === 'local')!;
  const remoteId = '99999999-9999-4999-8999-999999999999';
  const remote = { ...structuredClone(local), machine: { ...local.machine, id: remoteId, kind: 'remote' as const, label: 'Fixture executor' },
    projects: [] as DurableProject[], sessions: [], archivedSessions: [], checkouts: [{ ...local.checkouts[0], id: 'remote-checkout', name: 'Remote repository' }] };
  snapshot.machines.push(remote);
  await page.route('**/api/arena', route => route.fulfill({ json: snapshot }));
  let posted: { name: string; checkoutIds: string[] } | undefined;
  await page.route(`**/api/machines/${remoteId}/projects`, async route => {
    posted = route.request().postDataJSON();
    const now = new Date().toISOString();
    const project: DurableProject = { version: 1, revision: 0, id: crypto.randomUUID(), name: posted!.name, repositories: [], createdAt: now, updatedAt: now };
    remote.projects.push(project);
    await route.fulfill({ status: 201, json: { project } });
  });
  await page.goto('/arena');
  const arena = page.getByRole('main', { name: 'Arena', exact: true });
  await arena.getByRole('button', { name: 'New project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
  await dialog.getByLabel('Repository', { exact: true }).selectOption(local.checkouts[0].id);
  await dialog.getByLabel('Machine', { exact: true }).selectOption(remoteId);
  await expect(dialog.getByLabel('Repository', { exact: true })).toHaveValue('');
  await dialog.getByLabel('Repository', { exact: true }).selectOption('remote-checkout');
  // A long unbroken name must wrap without displacing its action on a phone.
  const name = 'Remote'.repeat(32);
  await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill(name);
  remote.machine.state = 'offline';
  await expect(dialog.getByRole('button', { name: 'Create project', exact: true })).toBeDisabled();
  remote.machine.state = 'online';
  await expect(dialog.getByRole('button', { name: 'Create project', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(posted).toEqual({ name, checkoutIds: ['remote-checkout'] });
  const group = arena.getByRole('region', { name, exact: true });
  const shortcut = group.getByRole('button', { name: `New session in ${name}`, exact: true });
  await shortcut.click();
  const setup = page.getByRole('dialog', { name: 'New session', exact: true });
  await expect(setup.getByLabel('Machine', { exact: true })).toHaveValue(remoteId);
  await expect(setup.getByLabel('Project', { exact: true })).toHaveValue(remote.projects[0].id);
  await setup.getByRole('button', { name: 'Clear setup', exact: true }).click();
  remote.machine.state = 'offline';
  await arena.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(shortcut).toBeDisabled();
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(shortcut).toBeVisible();
  expect(await arena.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  local.machine.state = 'offline';
  await arena.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(arena.getByRole('button', { name: 'New project', exact: true })).toBeDisabled();
  await expect(arena.getByRole('button', { name: 'New session', exact: true })).toBeDisabled();
  await page.unrouteAll({ behavior: 'wait' });
});

test('a shortcut preserves frozen creation identity and its recovery error', async ({ page, request }) => {
  const projects: DurableProject[] = [];
  for (const suffix of ['source', 'other']) {
    projects.push((await (await request.post('/api/projects', { data: { name: `Frozen ${suffix} ${Date.now()}` } })).json()).project);
  }
  await page.goto('/arena');
  const shortcut = (index: number) => page.getByRole('region', { name: projects[index].name, exact: true })
    .getByRole('button', { name: `New session in ${projects[index].name}`, exact: true });
  const attempts: Array<{ projectId: string; creationRequestId: string }> = [];
  await page.route('**/api/sessions', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    attempts.push(route.request().postDataJSON());
    await route.abort('failed');
  });
  await shortcut(0).click();
  const setup = page.getByRole('dialog', { name: 'New session', exact: true });
  await setup.getByLabel('Provider', { exact: true }).selectOption('claude');
  await setup.getByRole('button', { name: 'Create and open', exact: true }).click();
  await expect(setup.getByRole('alert')).toContainText('Creation status is unknown. Retry keeps this exact request.');
  await setup.getByRole('button', { name: 'Cancel', exact: true }).click();
  await shortcut(1).click();
  await expect(setup.getByRole('alert')).toContainText('Creation status is unknown. Retry keeps this exact request.');
  await expect(setup.getByRole('status').filter({ hasText: 'A setup draft is already pending' })).toContainText('Finish or recover that setup first.');
  await expect(setup.getByLabel('Project', { exact: true })).toHaveValue(projects[0].id);
  await expect(setup.getByRole('button', { name: 'Clear setup', exact: true })).toBeDisabled();
  await setup.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.poll(() => attempts.length).toBe(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await page.unrouteAll({ behavior: 'wait' });
});

for (const section of ['inbox', 'archived']) {
  test(`creating a project from ${section} reveals it in Active`, async ({ page }) => {
    await page.goto(`/arena/${section}`);
    await page.getByRole('button', { name: 'New project', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
    const name = `From ${section} ${Date.now()}`;
    await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill(name);
    await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page).toHaveURL(/\/arena$/);
    await expect(page.getByRole('region', { name, exact: true })).toContainText('0 sessions');
  });
}

test('the conversation project picker still creates and selects a project', async ({ page, request }) => {
  const source = (await (await request.post('/api/projects', { data: { name: `Picker source ${Date.now()}` } })).json()).project as DurableProject;
  await request.post('/api/sessions', { data: { projectId: source.id, provider: 'claude' } });
  await page.goto('/');
  const picker = page.locator('.project-search-trigger');
  await expect(picker).toContainText(source.name);
  await picker.click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  const name = `From picker ${Date.now()}`;
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(picker).toContainText(name);
  await expect(page).toHaveURL(/\/\?(?:session|project)=/);
});
