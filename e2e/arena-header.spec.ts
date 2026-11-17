import { expect, test, fulfillArenaSnapshot } from './arena-stream';
import type { ArenaSnapshot, PublicSession } from '../src/shared/types';

for (const theme of ['light', 'dark']) for (const width of [1440, 360]) {
  test(`Arena uses its navbar and leaves room for projects: ${theme} ${width}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme => {
      localStorage.setItem('code-ai:theme', theme);
      localStorage.setItem('code-ai:device:arena-layout', 'tiles');
    }, theme);
    const { project } = await (await request.post('/api/projects', { data: { name: 'Compact Arena project' } })).json();
    const { session } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json() as { session: PublicSession };
    const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
    const owner = snapshot.machines.find(machine => machine.machine.kind === 'local')!;
    snapshot.machines = [owner];
    owner.projects = [project];
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
    for (const section of ['Inbox', 'Archived']) {
      await arena.getByRole('tab', { name: section, exact: true }).click();
      const newProject = navbar.getByRole('button', { name: 'New project', exact: true });
      await newProject.click();
      const dialog = page.getByRole('dialog', { name: 'New project', exact: true });
      await expect(dialog.getByRole('textbox', { name: 'Project name', exact: true })).toBeFocused();
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
