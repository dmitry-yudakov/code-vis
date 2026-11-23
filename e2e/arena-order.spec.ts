import { expect, test, fulfillArenaSnapshot, pushArenaSnapshot, type Page } from './arena-stream';
import type { ArenaSnapshot, DurableProject, PublicSession } from '../src/shared/types';

const groupNames = (page: Page) => page.locator('.arena-group > header h3');
const sessionNames = (page: Page, project: string) => page.getByRole('region', { name: project, exact: true }).locator('.arena-card-open');

for (const arrangement of ['List', 'Tiles', 'Phone'] as const) {
  test(`Arena keeps initial project and session positions through live changes: ${arrangement}`, async ({ page, request }) => {
    await page.setViewportSize({ width: arrangement === 'Phone' ? 390 : 1440, height: 1000 });
    const projects: DurableProject[] = [];
    for (const name of ['Alpha', 'Beta', 'Empty']) {
      const response = await request.post('/api/projects', { data: { name } });
      expect(response.status()).toBe(201);
      projects.push((await response.json()).project);
    }
    const sessions: PublicSession[] = [];
    for (const project of [projects[0], projects[0], projects[1]]) {
      const response = await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } });
      expect(response.status()).toBe(201);
      sessions.push((await response.json()).session);
    }
    const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
    const owner = snapshot.machines.find(machine => machine.machine.kind === 'local')!;
    snapshot.machines = [owner];
    owner.projects = projects;
    owner.sessions = sessions.map(session => owner.sessions.find(item => item.id === session.id)!);
    owner.archivedSessions = [];
    owner.runs = { active: [], recent: [] };
    owner.sessions.forEach((session, index) => {
      session.title = ['Alpha older', 'Alpha newer', 'Beta latest'][index];
      session.updatedAt = new Date(Date.UTC(2026, 10, 1, index)).toISOString();
      session.lastActivity = { messageId: crypto.randomUUID(), createdAt: session.updatedAt, status: 'complete' };
    });
    let unavailable = false;
    await page.route('**/api/arena', route => fulfillArenaSnapshot(route, unavailable
      ? { status: 503, json: { error: 'Temporarily unavailable' } } : { json: snapshot }));
    await page.goto('/arena');
    if (arrangement !== 'Phone') await page.getByRole('button', { name: arrangement, exact: true }).click();
    await expect(groupNames(page)).toHaveText(['Beta', 'Alpha', 'Empty']);
    const alphaOrder = () => sessionNames(page, 'Alpha').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
    expect(await alphaOrder()).toEqual(['Open Alpha newer', 'Open Alpha older']);

    // An old session asking for approval used to jump both itself and its project to the front.
    owner.sessions[0].updatedAt = '2026-11-08T12:00:00.000Z';
    owner.runs.active = [{ runId: crypto.randomUUID(), sessionId: sessions[0].id, participantId: sessions[0].primaryAgentId,
      state: 'needs-you', enqueuedAt: Date.now(), pendingPermissionCount: 1,
      pendingPermissions: [{ requestId: crypto.randomUUID(), participantId: sessions[0].primaryAgentId, tool: 'Shell', detail: 'git status' }] }];
    await pushArenaSnapshot(page);
    await expect(sessionNames(page, 'Alpha').filter({ hasText: 'Alpha older' })).toContainText('Needs you');
    await expect(groupNames(page)).toHaveText(['Beta', 'Alpha', 'Empty']);
    expect(await alphaOrder()).toEqual(['Open Alpha newer', 'Open Alpha older']);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(groupNames(page)).toHaveText(['Beta', 'Alpha', 'Empty']);

    // Status, previews and drafts still update in place, including while Arena is unmounted.
    if (arrangement === 'Tiles') await page.getByRole('region', { name: 'Alpha', exact: true }).getByRole('textbox').first().fill('Draft stays here');
    await page.getByRole('tab', { name: /^Inbox/ }).click();
    await expect(page.getByRole('tabpanel', { name: 'Inbox', exact: true })).toBeVisible();
    owner.runs.active = [];
    owner.sessions[0].lastActivity!.status = 'failed';
    owner.sessions[0].lastMessage = { role: 'assistant', author: 'Claude', text: 'Updated response in place', truncated: false };
    await pushArenaSnapshot(page);
    await page.getByRole('tab', { name: /^Active/ }).click();
    await expect(sessionNames(page, 'Alpha').filter({ hasText: 'Alpha older' })).toContainText('Failed');
    await expect(groupNames(page)).toHaveText(['Beta', 'Alpha', 'Empty']);
    expect(await alphaOrder()).toEqual(['Open Alpha newer', 'Open Alpha older']);
    if (arrangement === 'Tiles') {
      await expect(page.getByRole('region', { name: 'Alpha', exact: true }).getByRole('textbox').first()).toHaveValue('Draft stays here');
      await expect(page.getByRole('region', { name: 'Alpha', exact: true })).toContainText('Updated response in place');
    }

    await sessionNames(page, 'Beta').click();
    await expect(page).toHaveURL(new RegExp(`session=${sessions[2].id}`));
    await expect(page.getByRole('main', { name: 'Arena', exact: true })).toHaveCount(0);
    owner.sessions[1].updatedAt = '2026-11-08T14:00:00.000Z';
    await pushArenaSnapshot(page);
    await page.getByRole('link', { name: 'Arena', exact: true }).click();
    await expect(groupNames(page)).toHaveText(['Beta', 'Alpha', 'Empty']);
    expect(await alphaOrder()).toEqual(['Open Alpha newer', 'Open Alpha older']);

    // A failed refresh and its recovery must keep the original positions too.
    unavailable = true;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.locator('.arena-refresh-error')).toBeVisible();
    unavailable = false;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.locator('.arena-refresh-error')).toHaveCount(0);
    await expect(groupNames(page)).toHaveText(['Beta', 'Alpha', 'Empty']);
    expect(await alphaOrder()).toEqual(['Open Alpha newer', 'Open Alpha older']);

    // A full page reload deliberately establishes a new initial order.
    await page.reload();
    await expect(groupNames(page)).toHaveText(['Alpha', 'Beta', 'Empty']);
    expect(await alphaOrder()).toEqual(['Open Alpha older', 'Open Alpha newer']);

    // New cards and projects append, including the first session in an existing empty project.
    const newProject = { ...projects[2], id: crypto.randomUUID(), name: 'New project' };
    owner.projects.push(newProject);
    const newSession = { ...owner.sessions[1], id: crypto.randomUUID(), title: 'Alpha added', updatedAt: '2026-11-08T15:00:00.000Z' };
    owner.sessions.push(newSession, { ...newSession, id: crypto.randomUUID(), title: 'Empty added', projectId: projects[2].id });
    await pushArenaSnapshot(page);
    await expect(groupNames(page)).toHaveText(['Alpha', 'Beta', 'Empty', 'New project']);
    await expect(sessionNames(page, 'Alpha')).toHaveCount(3);
    expect(await alphaOrder()).toEqual(['Open Alpha older', 'Open Alpha newer', 'Open Alpha added']);
    await expect(sessionNames(page, 'Empty')).toContainText('Empty added');

    // Removed sessions disappear, and returning sessions recover their previous position.
    const removed = owner.sessions.shift()!;
    await pushArenaSnapshot(page);
    await expect(sessionNames(page, 'Alpha')).toHaveCount(2);
    owner.sessions.push({ ...removed, title: 'Alpha restored' });
    await pushArenaSnapshot(page);
    await expect(sessionNames(page, 'Alpha')).toHaveCount(3);
    expect(await alphaOrder()).toEqual(['Open Alpha restored', 'Open Alpha newer', 'Open Alpha added']);
  });
}
