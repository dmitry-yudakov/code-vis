import { expect, test, fulfillArenaSnapshot, pushArenaSnapshot } from './arena-stream';
import type { ArenaMachineSnapshot, ArenaSnapshot, PublicSession } from '../src/shared/types';

test.use({ timezoneId: 'America/Los_Angeles', locale: 'en-US' });

for (const appearance of ['light', 'dark'] as const) for (const width of [1440, 390]) {
  test(`archives are recent-first by local day with older work available: ${appearance} ${width}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme => localStorage.setItem('code-ai:theme', theme), appearance);
    const created = await request.post('/api/sessions', { data: { provider: 'claude' } });
    expect(created.status()).toBe(201);
    const { session } = await created.json() as { session: PublicSession };
    const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
    const owner = snapshot.machines.find(machine => machine.machine.kind === 'local')!;
    const base = owner.sessions.find(item => item.id === session.id)!;
    const project = { id: crypto.randomUUID(), version: 1 as const, revision: 0, name: 'Archive project', repositories: [],
      createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' };
    owner.projects = [project];
    owner.sessions = [];
    owner.runs = { active: [], recent: [] };
    const archives = Array.from({ length: 45 }, (_, index) => ({
      ...base, id: crypto.randomUUID(), title: `Archive ${index.toString().padStart(2, '0')}`,
      projectId: index % 2 ? undefined : project.id,
      // The first two timestamps straddle local midnight on the same UTC date.
      archivedAt: index === 0 ? '2026-11-13T08:05:00Z' : index === 1 ? '2026-11-13T07:55:00Z'
        : new Date(Date.parse('2026-11-12T07:00:00Z') - index * 60_000).toISOString(),
      updatedAt: index === 44 ? '2026-12-01T00:00:00Z' : base.updatedAt,
      lastActivity: { ...base.lastActivity, messageId: crypto.randomUUID(), createdAt: base.updatedAt,
        status: index === 44 ? 'failed' as const : 'complete' as const },
      ...(index === 0 ? { agentArchiveCheck: { id: crypto.randomUUID(), messageId: crypto.randomUUID(), status: 'archived' as const },
        lastMessage: { role: 'assistant' as const, author: 'Claude', text: 'Work is complete.', truncated: false } } : {}),
    }));
    owner.archivedSessions = archives.filter((_, index) => index % 2 === 1);
    const remote: ArenaMachineSnapshot = { ...owner, machine: { ...owner.machine, id: crypto.randomUUID(), label: 'Archive laptop', kind: 'remote', state: 'offline' },
      archivedSessions: archives.filter((_, index) => index % 2 === 0) };
    snapshot.machines = [owner, remote];
    let unavailable = false;
    await page.route('**/api/arena', route => fulfillArenaSnapshot(route, unavailable
      ? { status: 503, json: { error: 'Temporarily unavailable' } } : { json: snapshot }));
    await page.goto('/arena/archived');
    const arena = page.getByRole('main', { name: 'Arena', exact: true });
    const cards = arena.locator('.arena-card.archived');
    const titles = cards.locator('.arena-card-content > strong');
    const headings = arena.locator('.arena-group > header h3');
    await expect(cards).toHaveCount(40);
    await expect(titles).toHaveText(archives.slice(0, 40).map(item => item.title));
    await expect(headings).toHaveText(['November 13, 2026', 'November 12, 2026', 'November 11, 2026']);
    await expect(cards.first()).toContainText('Archive project');
    await expect(cards.first()).toContainText('Archive laptop');
    await expect(cards.first()).toContainText('Work is complete.');
    await expect(cards.first().getByRole('button', { name: 'Restore', exact: true })).toBeDisabled();
    await expect(cards.nth(1)).toContainText('No project');
    await expect(cards.nth(1)).toContainText('Claude');
    await expect(cards.nth(1)).toContainText('No repository');
    await expect(cards.nth(1).getByRole('button', { name: 'Restore', exact: true })).toBeEnabled();
    expect(await arena.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await cards.first().evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('archive.png'), animations: 'disabled' });

    await arena.getByRole('button', { name: 'Show older sessions', exact: true }).click();
    await expect(titles).toHaveText(archives.map(item => item.title));
    await expect(arena.getByRole('button', { name: 'Show older sessions', exact: true })).toHaveCount(0);
    remote.machine.state = 'online';
    const added = { ...archives[0], id: crypto.randomUUID(), title: 'Just archived', archivedAt: '2026-11-13T09:00:00Z' };
    remote.archivedSessions.push(added);
    await pushArenaSnapshot(page);
    await expect(titles).toHaveText(['Just archived', ...archives.map(item => item.title)]);
    await expect(cards.first()).toContainText('Archived by agent');
    await expect(cards.first().getByRole('button', { name: 'Restore', exact: true })).toBeEnabled();

    unavailable = true;
    await arena.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(arena.locator('.arena-refresh-error')).toBeVisible();
    await expect(cards).toHaveCount(46);
    unavailable = false;
    await arena.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(arena.locator('.arena-refresh-error')).toHaveCount(0);
    await expect(titles).toHaveText(['Just archived', ...archives.map(item => item.title)]);
  });
}

test('restores a real archived session from its date group', async ({ page, request }) => {
  const created = await request.post('/api/sessions', { data: { provider: 'claude' } });
  expect(created.status()).toBe(201);
  const { session } = await created.json() as { session: PublicSession };
  const archived = await request.post(`/api/sessions/${session.id}/archive`, { data: { expectedRevision: session.revision } });
  expect(archived.status()).toBe(200);
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const summary = snapshot.machines.flatMap(machine => machine.archivedSessions).find(item => item.id === session.id)!;
  await page.goto('/arena/archived');
  const arena = page.getByRole('main', { name: 'Arena', exact: true });
  const card = arena.locator('.arena-card.archived').filter({ has: page.getByText(summary.title, { exact: true }) });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(card).toHaveCount(0);
  const restored = await request.get(`/api/sessions/${session.id}`);
  expect(restored.status()).toBe(200);
  expect((await restored.json()).session.archivedAt).toBeUndefined();
  await arena.getByRole('tab', { name: /^Active/ }).click();
  await expect(arena.getByRole('link', { name: `Open ${summary.title}`, exact: true })).toBeVisible();
});
