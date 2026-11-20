import { expect, test, fulfillArenaSnapshot, pushArenaSnapshot, type APIRequestContext, type Page } from './arena-stream';
import type { ArenaSnapshot, CheckoutsResponse, DurableProject, PublicSession } from '../src/shared/types';

async function createProject(request: APIRequestContext, repository = false) {
  const catalog = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const checkout = catalog.checkouts.find(item => item.relativePath === 'alpha')!;
  const { project } = await (await request.post('/api/projects', { data: {
    name: `Manage project ${crypto.randomUUID()}`, checkoutIds: repository ? [checkout.id] : [],
  } })).json() as { project: DurableProject };
  return project;
}

async function openAction(page: Page, name: string, action: 'Rename' | 'Delete') {
  await page.getByRole('region', { name, exact: true }).getByRole('button', { name: `Project actions for ${name}`, exact: true }).click();
  await page.getByRole('menuitem', { name: `${action} project`, exact: true }).click();
  return page.getByRole('dialog', { name: `${action} project`, exact: true });
}

for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
  test(`Arena exposes project rename and delete: ${theme} ${width}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    const project = await createProject(request);
    await page.goto('/arena');
    if (width > 740) await page.getByRole('button', { name: 'Tiles', exact: true }).click();
    const trigger = page.getByRole('button', { name: `Project actions for ${project.name}`, exact: true });
    await trigger.click();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    let dialog = await openAction(page, project.name, 'Rename');
    const input = dialog.getByRole('textbox', { name: 'Project name', exact: true });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(project.name);
    await expect(input).toHaveAttribute('maxlength', '200');
    const save = dialog.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeDisabled();
    await input.fill('  ');
    await expect(save).toBeDisabled();
    await input.fill(` ${project.name} `);
    await expect(save).toBeDisabled();
    const renamed = `Renamed ${'Project'.repeat(23)} ${theme} ${width}`;
    await input.fill(renamed);
    await page.screenshot({ path: testInfo.outputPath('rename-project.png'), animations: 'disabled' });
    await input.press('Enter');
    await expect(dialog).not.toBeVisible();
    const group = page.getByRole('region', { name: renamed, exact: true });
    await expect(group).toBeVisible();
    await expect(group.getByRole('button', { name: `Project actions for ${renamed}`, exact: true })).toBeFocused();
    await group.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('project-actions.png'), animations: 'disabled' });
    expect(await page.locator('body').evaluate(node => node.scrollWidth <= window.innerWidth)).toBe(true);
    await page.reload();
    await expect(group).toBeVisible();
    expect((await (await request.get(`/api/projects/${project.id}`)).json()).project.name).toBe(renamed);
    dialog = await openAction(page, renamed, 'Delete');
    await expect(dialog).toContainText('Repository files and conversations are kept');
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath('delete-project.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(group.getByRole('button', { name: `Project actions for ${renamed}`, exact: true })).toBeFocused();
    dialog = await openAction(page, renamed, 'Delete');
    await dialog.getByRole('button', { name: 'Delete project', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(group).toHaveCount(0);
    await page.reload();
    await expect(group).toHaveCount(0);
    expect((await request.get(`/api/projects/${project.id}`)).status()).toBe(404);
  });
}

test('deleting a duplicate preserves the other project, active and archived sessions, and repository files', async ({ page, request }) => {
  const original = await createProject(request, true);
  const duplicate = await createProject(request, true);
  const sessions: PublicSession[] = [];
  for (const project of [original, duplicate, duplicate]) {
    sessions.push((await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json()).session);
  }
  expect((await request.post(`/api/sessions/${sessions[2].id}/archive`, { data: { expectedRevision: sessions[2].revision } })).ok()).toBe(true);
  await page.goto('/arena');
  const dialog = await openAction(page, duplicate.name, 'Delete');
  await dialog.getByRole('button', { name: 'Delete project', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('region', { name: duplicate.name, exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: original.name, exact: true })).toBeVisible();
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const archived = snapshot.machines.flatMap(machine => machine.archivedSessions).find(item => item.id === sessions[2].id)!;
  expect(archived.projectId).toBeUndefined();
  expect((await request.post(`/api/sessions/${archived.id}/restore`, { data: { expectedRevision: archived.revision } })).ok()).toBe(true);
  for (const session of sessions.slice(1)) {
    const saved = (await (await request.get(`/api/sessions/${session.id}`)).json()).session as PublicSession;
    expect(saved.projectId).toBeUndefined();
    expect(saved.repositories).toEqual(session.repositories);
    expect(saved.participants).toEqual(session.participants);
    expect(saved.messages).toEqual(session.messages);
  }
  expect((await (await request.get(`/api/sessions/${sessions[0].id}`)).json()).session.projectId).toBe(original.id);
  expect((await (await request.get(`/api/projects/${original.id}`)).json()).project).toEqual(original);
  // Reading through the retained project's real Files view proves the checkout remains usable.
  await page.goto(`/?project=${original.id}`);
  await page.getByRole('complementary', { name: 'Files', exact: true }).getByRole('button', { name: 'package.json', exact: true }).click();
  await expect(page.getByRole('region', { name: 'File view', exact: true }).getByLabel('File source', { exact: true })).toContainText('alpha');
});

test('workspace picker uses the same dialogs and keeps the focused conversation and draft after deletion', async ({ page, request }) => {
  const project = await createProject(request, true);
  const { session } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json() as { session: PublicSession };
  await page.goto(`/?session=${session.id}`);
  const composer = page.getByRole('textbox', { name: 'Instruction', exact: true });
  await composer.fill('Keep this unsent project draft');
  const picker = page.locator('.project-search-trigger');
  await picker.click();
  await page.getByRole('button', { name: `Rename ${project.name}`, exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Rename project', exact: true });
  await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill('Cancelled rename');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(picker).toBeFocused();
  await picker.click();
  await page.getByRole('button', { name: `Rename ${project.name}`, exact: true }).click();
  const renamed = `${project.name} in workspace`;
  await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill(renamed);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(picker).toContainText(renamed);
  await picker.click();
  await page.getByRole('button', { name: `Delete ${renamed}`, exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Delete project', exact: true });
  await dialog.getByRole('button', { name: 'Delete project', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(picker).toContainText('No project');
  await expect(page).toHaveURL(`/?session=${session.id}`);
  await expect(composer).toHaveValue('Keep this unsent project draft');
  await page.reload();
  await expect(picker).toContainText('No project');
  await expect(composer).toHaveValue('Keep this unsent project draft');
});

test('deleting the open empty project returns to No project', async ({ page, request }) => {
  const project = await createProject(request);
  await page.goto(`/?project=${project.id}`);
  await page.locator('.project-search-trigger').click();
  await page.getByRole('button', { name: `Delete ${project.name}`, exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete project', exact: true }).getByRole('button', { name: 'Delete project', exact: true }).click();
  await expect(page).toHaveURL('/?project=none');
  await expect(page.locator('.project-search-trigger')).toContainText('No project');
  await expect(page.getByRole('region', { name: 'Workspace unavailable', exact: true })).toHaveCount(0);
});

for (const action of ['Rename', 'Delete'] as const) {
  test(`${action} retains errors and guards pending requests until retry succeeds`, async ({ page, request }) => {
    const project = await createProject(request);
    await page.goto('/arena');
    const dialog = await openAction(page, project.name, action);
    const name = `${project.name} retry`;
    if (action === 'Rename') await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill(name);
    let attempts = 0;
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**/api/projects/${project.id}`, async route => {
      if (route.request().method() === 'GET') return route.continue();
      attempts++;
      if (attempts === 1) { await gate; return route.fulfill({ status: 503, json: { error: 'Try again after fixture failure.' } }); }
      return route.continue();
    });
    await dialog.getByRole('button', { name: action === 'Rename' ? 'Save' : 'Delete project', exact: true }).click();
    await expect(dialog.getByRole('button', { name: action === 'Rename' ? 'Saving…' : 'Deleting…', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    expect(attempts).toBe(1);
    release();
    await expect(dialog.getByRole('alert')).toContainText('fixture failure');
    if (action === 'Rename') await expect(dialog.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue(name);
    await dialog.getByRole('button', { name: action === 'Rename' ? 'Save' : 'Delete project', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(attempts).toBe(2);
    await expect(page.getByRole('region', { name: action === 'Rename' ? name : project.name, exact: true })).toHaveCount(action === 'Rename' ? 1 : 0);
  });
}

for (const action of ['Rename', 'Delete'] as const) {
  test(`${action} refreshes a conflicting revision for explicit retry`, async ({ page, request }) => {
    const project = await createProject(request);
    await page.goto('/arena');
    const dialog = await openAction(page, project.name, action);
    const draft = `${project.name} draft`;
    if (action === 'Rename') await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill(draft);
    const otherName = `${project.name} another client`;
    expect((await request.patch(`/api/projects/${project.id}`, { data: { expectedRevision: project.revision, name: otherName } })).ok()).toBe(true);
    const confirm = dialog.getByRole('button', { name: action === 'Rename' ? 'Save' : 'Delete project', exact: true });
    await confirm.click();
    await expect(dialog.getByRole('alert')).toContainText('Project changed');
    if (action === 'Rename') await expect(dialog.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue(draft);
    else await expect(dialog).toContainText(otherName);
    await confirm.click();
    await expect(dialog).not.toBeVisible();
    const saved = await request.get(`/api/projects/${project.id}`);
    if (action === 'Rename') expect((await saved.json()).project.name).toBe(draft);
    else expect(saved.status()).toBe(404);
  });
}

test('a lost delete response retries safely without changing a newer destination', async ({ page, request }) => {
  const project = await createProject(request);
  const other = await createProject(request);
  await page.goto(`/?project=${project.id}`);
  await page.locator('.project-search-trigger').click();
  await page.getByRole('button', { name: `Delete ${project.name}`, exact: true }).click();
  let attempts = 0;
  await page.route(`**/api/projects/${project.id}`, async route => {
    if (route.request().method() !== 'DELETE') return route.continue();
    if (++attempts === 1) { await route.fetch(); return route.abort('failed'); }
    // Simulate navigating in the shell while the retry is in flight.
    await page.evaluate(id => window.history.pushState(null, '', `/?project=${id}`), other.id);
    return route.continue();
  });
  const dialog = page.getByRole('dialog', { name: 'Delete project', exact: true });
  await dialog.getByRole('button', { name: 'Delete project', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete project', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(`/?project=${other.id}`);
  await expect(page.locator('.project-search-trigger')).toContainText(other.name);
  expect(attempts).toBe(2);
});

test('project management uses the owning executor and responds to offline transitions', async ({ page, request }) => {
  const project = await createProject(request);
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const local = snapshot.machines.find(entry => entry.machine.kind === 'local')!;
  const remoteId = crypto.randomUUID();
  const remote = { ...structuredClone(local), machine: { ...local.machine, id: remoteId, kind: 'remote' as const, label: 'Project executor' },
    projects: [project], sessions: [], archivedSessions: [] };
  local.projects = []; local.sessions = []; local.archivedSessions = [];
  snapshot.machines.push(remote);
  await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
  const methods: string[] = [];
  let deletions = 0;
  await page.route(`**/api/machines/${remoteId}/projects/${project.id}`, async route => {
    methods.push(route.request().method());
    expect(route.request().postDataJSON().expectedRevision).toBe(remote.projects[0].revision);
    if (route.request().method() === 'PATCH') {
      remote.projects[0] = { ...project, revision: 1, name: route.request().postDataJSON().name };
      return route.fulfill({ json: { project: remote.projects[0] } });
    }
    if (++deletions === 1) return route.fulfill({ status: 404, json: { error: 'That machine is not attached.' } });
    remote.projects = [];
    return route.fulfill({ json: { detachedSessionCount: 0 } });
  });
  await page.goto('/arena');
  const dialog = await openAction(page, project.name, 'Rename');
  await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill('Remote renamed project');
  remote.machine.state = 'offline';
  await pushArenaSnapshot(page);
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('alert')).toContainText('offline');
  remote.machine.state = 'online';
  await pushArenaSnapshot(page);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  remote.machine.state = 'offline';
  await pushArenaSnapshot(page);
  await expect(page.getByRole('button', { name: 'Project actions for Remote renamed project', exact: true })).toBeDisabled();
  remote.machine.state = 'online';
  await pushArenaSnapshot(page);
  const deletion = await openAction(page, 'Remote renamed project', 'Delete');
  await deletion.getByRole('button', { name: 'Delete project', exact: true }).click();
  await expect(deletion.getByRole('alert')).toContainText('That machine is not attached.');
  expect(remote.projects).toHaveLength(1);
  await deletion.getByRole('button', { name: 'Delete project', exact: true }).click();
  await expect(deletion).not.toBeVisible();
  await expect(page.getByRole('region', { name: 'Remote renamed project', exact: true })).toHaveCount(0);
  expect(methods).toEqual(['PATCH', 'DELETE', 'DELETE']);
  // The home machine's project with the same id was not changed.
  expect((await (await request.get(`/api/projects/${project.id}`)).json()).project).toEqual(project);
});

for (const newerDraft of ['', 'Keep a newer unsent draft']) {
  test(`deletion waits for pending delivery and retains the remaining draft: ${newerDraft || 'empty'}`, async ({ page, request }) => {
    const project = await createProject(request, true);
    const { session } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json() as { session: PublicSession };
    await page.goto(`/?session=${session.id}`);
    const input = page.getByRole('textbox', { name: 'Instruction', exact: true });
    await input.fill('/autoclose off');
    await input.press('Enter');
    await expect(input).toBeEmpty();
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let posts = 0;
    await page.route('**/api/agent/message', async route => { posts++; await gate; return route.continue(); });
    await input.fill('Read the repository without changing files');
    await input.press('Enter');
    await expect.poll(() => posts).toBe(1);
    const picker = page.locator('.project-search-trigger');
    await picker.click();
    await page.getByRole('button', { name: `Delete ${project.name}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete project', exact: true });
    await expect(dialog.getByRole('button', { name: 'Delete project', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('alert')).toContainText('Wait for active conversations');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    if (newerDraft) await input.fill(newerDraft);
    release();
    await expect(input).toHaveValue(newerDraft);
    await expect(page.getByRole('complementary', { name: 'Conversation', exact: true }).getByRole('button', { name: 'Send', exact: true })).toBeVisible();
    await picker.click();
    await page.getByRole('button', { name: `Delete ${project.name}`, exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Delete project', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Delete project', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(picker).toContainText('No project');
    await expect(input).toHaveValue(newerDraft);
    const saved = (await (await request.get(`/api/sessions/${session.id}`)).json()).session as PublicSession;
    expect(saved.projectId).toBeUndefined();
    expect(saved.messages.some(message => message.role === 'user' && message.text === 'Read the repository without changing files')).toBe(true);
  });
}
