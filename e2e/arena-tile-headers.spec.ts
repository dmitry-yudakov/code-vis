import { expect, test, fulfillArenaSnapshot, type APIRequestContext, type Page } from './arena-stream';
import type { ArenaSnapshot, CheckoutsResponse, DurableProject, PublicSession } from '../src/shared/types';

async function headerFixture(request: APIRequestContext, count = 2) {
  const catalog = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const source = catalog.checkouts.find(item => item.relativePath === 'alpha')!;
  const { project } = await (await request.post('/api/projects', { data: { name: `Header project ${Date.now()}`, checkoutIds: [source.id] } })).json() as { project: DurableProject };
  const sessions: PublicSession[] = [];
  for (let i = 0; i < count; i++) sessions.push((await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json()).session);
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const owner = snapshot.machines.find(entry => entry.machine.kind === 'local')!;
  owner.projects = [project]; owner.archivedSessions = [];
  owner.sessions = sessions.map(session => owner.sessions.find(item => item.id === session.id)!);
  owner.checkouts.find(item => item.id === source.id)!.name = 'fm/bookinggood-next';
  owner.sessions.forEach((session, i) => {
    session.title = i ? 'Recent SEO Issues and Documentation' : 'Review and implement the new designs with a deliberately long title';
    session.updatedAt = new Date(Date.now() - i * 86_400_000).toISOString();
    session.agents[0].contextUsage = { usedTokens: 40_000, contextWindow: 200_000 };
    session.lastActivity = { messageId: crypto.randomUUID(), createdAt: session.updatedAt, status: 'complete' };
    session.lastMessage = { role: 'assistant', author: 'Claude', text: 'The latest saved response remains available for review.', truncated: false };
  });
  const activity = 'Shell: git status --short and inspect the current repository changes';
  owner.runs = { active: [{ runId: crypto.randomUUID(), sessionId: sessions[0].id, participantId: sessions[0].primaryAgentId,
    state: 'running', enqueuedAt: Date.now(), startedAt: Date.now(), status: activity, pendingPermissionCount: 0, pendingPermissions: [] }], recent: [] };
  return { project, snapshot, owner, sessions, activity, source };
}

const cardFor = (page: Page, id: string) => page.locator('.arena-card').filter({ has: page.locator(`.arena-card-open[href*="${id}"]`) });

for (const theme of ['light', 'dark']) for (const width of [1440, 1000, 390]) {
  test(`project repositories and two-row tile headers: ${theme} ${width}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(theme => localStorage.setItem('code-ai:theme', theme), theme);
    const { project, snapshot, owner, sessions, activity } = await headerFixture(request);
    await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
    await page.goto('/arena');
    if (width > 740) await page.getByRole('button', { name: 'Tiles', exact: true }).click();
    const group = page.getByRole('region', { name: project.name, exact: true });
    await expect(group.locator(':scope > header .arena-project-repositories')).toHaveText('fm/bookinggood-next');
    await expect(group.getByText('fm/bookinggood-next', { exact: true })).toHaveCount(1);
    const first = cardFor(page, sessions[0].id), idle = cardFor(page, sessions[1].id);
    const blockedArchive = first.getByRole('button', { name: 'Archive session', exact: true });
    await expect(blockedArchive).toBeDisabled();
    await expect(idle.getByRole('button', { name: 'Archive session', exact: true })).toBeEnabled();
    const open = first.getByRole('link', { name: `Open ${owner.sessions[0].title}`, exact: true });
    await open.evaluate(node => node.addEventListener('click', () => { document.body.dataset.disabledArchiveForwarded = 'true'; }));
    let blockedArchives = 0;
    page.on('request', req => { if (req.url().endsWith(`/api/sessions/${sessions[0].id}/archive`) && req.method() === 'POST') blockedArchives++; });
    const disabledButton = (await blockedArchive.boundingBox())!;
    await page.mouse.click(disabledButton.x + disabledButton.width / 2, disabledButton.y + disabledButton.height / 2);
    expect(await page.locator('body').getAttribute('data-disabled-archive-forwarded')).toBeNull();
    expect(blockedArchives).toBe(0);
    await expect(page).toHaveURL(/\/arena$/);
    const meter = open.getByRole('meter', { name: /@Claude context:/ });
    await meter.hover();
    await expect(page.getByRole('tooltip')).toContainText('20% used, 40,000 of 200,000 tokens');
    if (width > 740) {
      const title = open.locator(':scope > strong');
      await expect(title).toHaveAttribute('title', owner.sessions[0].title);
      await expect(open.locator('.arena-card-activity')).toHaveCount(0);
      const state = open.locator('.arena-state'), agents = open.locator('.arena-card-agents'), time = open.locator('.arena-card-time');
      await expect(state).toHaveAttribute('title', activity);
      const boxes = await Promise.all([title, state, agents, meter, time, first.getByRole('button', { name: 'Archive session', exact: true })].map(item => item.boundingBox()));
      const [heading, ...metadata] = boxes;
      const archive = metadata.pop()!;
      expect(Math.abs(archive!.y - heading!.y)).toBeLessThan(10);
      for (const item of metadata) {
        expect(item!.y).toBeGreaterThanOrEqual(heading!.y + heading!.height);
        expect(Math.abs(item!.y + item!.height / 2 - metadata[0]!.y - metadata[0]!.height / 2)).toBeLessThan(2);
      }
      expect((await open.boundingBox())!.height).toBeLessThan(100);
      expect(await title.evaluate(node => getComputedStyle(node).whiteSpace)).toBe('nowrap');
      await page.getByRole('heading', { name: 'Arena', exact: true }).hover();
      await open.focus();
      await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
      await expect(open).toBeFocused();
      await expect(page.getByRole('tooltip').filter({ hasText: activity })).toContainText(activity);
      await expect(open.locator('[tabindex]')).toHaveCount(0);
    }
    await page.getByRole('heading', { name: 'Arena', exact: true }).hover();
    await page.getByRole('button', { name: 'Refresh', exact: true }).focus();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    expect(await page.getByRole('main', { name: 'Arena', exact: true }).evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await group.screenshot({ path: testInfo.outputPath('tile-headers.png'), animations: 'disabled' });
    const archived = page.waitForResponse(response => response.url().endsWith(`/api/sessions/${sessions[1].id}/archive`) && response.request().method() === 'POST');
    await idle.getByRole('button', { name: 'Archive session', exact: true }).click();
    expect((await archived).ok()).toBe(true);
    await open.focus(); await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`session=${sessions[0].id}`));
  });
}

test('different checkouts, loose sessions, worktrees and multiple agents retain their facts', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { project, snapshot, owner, sessions, source } = await headerFixture(request, 5);
  const alternate = owner.checkouts.find(item => item.relativePath === 'beta')!;
  owner.sessions[1].repositoryCheckoutIds = [alternate.id];
  owner.sessions[1].agents.push({ ...owner.sessions[1].agents[0], id: crypto.randomUUID(), provider: 'codex', displayName: 'Codex', role: 'reviewer' });
  owner.checkouts.push({ ...source, id: 'fixture-worktree', name: 'Worktree checkout', branch: 'feature/header-review' });
  owner.sessions[2].title = 'A managed worktree';
  owner.sessions[2].repositoryCheckoutIds = ['fixture-worktree'];
  owner.sessions[2].worktree = { id: crypto.randomUUID(), originCheckoutId: source.id, baseCommit: 'a'.repeat(40), branch: 'feature/header-review' };
  owner.sessions[2].execution = 'docker';
  owner.sessions[3].projectId = undefined; owner.sessions[3].title = 'A loose conversation';
  owner.sessions[4].projectId = crypto.randomUUID(); owner.sessions[4].repositoryCheckoutIds = ['missing']; owner.sessions[4].title = 'An unknown project';
  await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
  await page.goto('/arena');
  await page.getByRole('button', { name: 'Tiles', exact: true }).click();
  await expect(cardFor(page, sessions[1].id)).toContainText(alternate.name);
  await expect(cardFor(page, sessions[1].id).getByRole('meter')).toHaveCount(2);
  await expect(cardFor(page, sessions[2].id)).toContainText('Worktree · feature/header-review · Source: fm/bookinggood-next');
  await expect(cardFor(page, sessions[2].id)).toContainText('Docker');
  await expect(cardFor(page, sessions[3].id)).toContainText('fm/bookinggood-next');
  await expect(cardFor(page, sessions[4].id)).toContainText('Repository');
  const group = page.getByRole('region', { name: project.name, exact: true });
  await group.screenshot({ path: testInfo.outputPath('exceptional-targets.png'), animations: 'disabled' });
  // Even an unbroken project/repository name must fit the narrow list fallback.
  project.name = 'Project'.repeat(25); owner.checkouts.find(item => item.id === source.id)!.name = 'Repository'.repeat(30);
  await page.reload(); await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.getByRole('main', { name: 'Arena', exact: true })).toBeVisible();
  expect(await page.getByRole('main', { name: 'Arena', exact: true }).evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('long-names-phone.png'), animations: 'disabled' });
});
