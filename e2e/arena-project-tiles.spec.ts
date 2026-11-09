import { expect, test, fulfillArenaSnapshot, pushArenaSnapshot, type APIRequestContext } from './arena-stream';
import type { ArenaSnapshot, CheckoutsResponse, DurableProject, PublicSession } from '../src/shared/types';

async function projectFixture(request: APIRequestContext, sessionCounts = [3, 1, 1, 1, 1, 1]) {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const checkoutId = checkouts.find(item => item.relativePath === 'alpha')!.id;
  const projects: DurableProject[] = [];
  const sessions: PublicSession[] = [];
  for (let i = 0; i < sessionCounts.length; i++) {
    const { project } = await (await request.post('/api/projects', { data: { name: `Project ${i + 1}`, checkoutIds: [checkoutId] } })).json() as { project: DurableProject };
    projects.push(project);
    for (let j = 0; j < sessionCounts[i]; j++) {
      sessions.push((await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json()).session);
    }
  }
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const owner = snapshot.machines.find(machine => machine.machine.kind === 'local')!;
  snapshot.machines = [owner]; owner.projects = projects; owner.archivedSessions = [];
  owner.sessions = sessions.map(session => owner.sessions.find(item => item.id === session.id)!);
  owner.runs = { active: [], recent: [] };
  owner.sessions.forEach((session, index) => {
    session.title = `Session ${index + 1}`;
    session.updatedAt = new Date(Date.UTC(2026, 10, 8, 12, 0, 7 - index)).toISOString();
    session.lastMessage = { role: 'assistant', author: 'Claude', text: 'Ready for the next instruction. The latest saved response is available here in Arena.', truncated: false };
  });
  return { snapshot, owner, projects, sessions };
}

for (const theme of ['light', 'dark']) test(`project tiles use desktop width and adapt without losing drafts: ${theme}`, async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 2048, height: 1200 });
  await page.addInitScript(theme => localStorage.setItem('code-ai:theme', theme), theme);
  const { snapshot, projects } = await projectFixture(request);
  await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
  await page.goto('/arena');
  await page.getByRole('button', { name: 'Tiles', exact: true }).click();
  const arena = page.getByRole('main', { name: 'Arena', exact: true });
  const panels = page.locator('.arena-group');
  await expect(panels).toHaveCount(6);
  const wide = await panels.evaluateAll(nodes => nodes.map(node => {
    const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height };
  }));
  expect(Math.abs(wide[0].y - wide[1].y)).toBeLessThan(2);
  expect(Math.abs(wide[1].y - wide[2].y)).toBeLessThan(2);
  expect(wide[1].x).toBeGreaterThan(wide[0].x + wide[0].width);
  expect(wide[2].x).toBeGreaterThan(wide[1].x + wide[1].width);
  expect(wide[3].y).toBeGreaterThanOrEqual(wide[0].y + wide[0].height);
  expect(Math.abs(wide[3].y - wide[5].y)).toBeLessThan(2);
  expect(Math.abs(wide[3].x - wide[0].x)).toBeLessThan(2);
  const grid = (await page.locator('.arena-groups').boundingBox())!;
  expect(grid.width).toBeGreaterThan(1800);
  const heading = (await arena.locator('.arena-heading').boundingBox())!;
  expect(Math.abs(heading.x - grid.x)).toBeLessThan(2);
  expect(Math.abs(heading.width - grid.width)).toBeLessThan(2);
  const first = page.getByRole('region', { name: projects[0].name, exact: true });
  const cards = await first.locator('.arena-card').evaluateAll(nodes => nodes.map(node => {
    const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height };
  }));
  expect(Math.abs(cards[0].y - cards[1].y)).toBeLessThan(2);
  expect(cards[2].y).toBeGreaterThanOrEqual(cards[0].y + cards[0].height);
  for (const card of cards) {
    expect(card.x).toBeGreaterThan(wide[0].x);
    expect(card.x + card.width).toBeLessThan(wide[0].x + wide[0].width);
  }
  await expect(panels.last().getByRole('button', { name: `New session in ${projects[5].name}`, exact: true })).toBeEnabled();
  const input = first.getByRole('textbox').first();
  await input.fill('Keep this project draft');
  await page.screenshot({ path: testInfo.outputPath('projects-desktop.png'), fullPage: false });
  for (const [width, columns] of [[1440, 2], [1000, 1], [741, 1]] as const) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => panels.evaluateAll(nodes => {
      const firstRow = nodes[0].getBoundingClientRect().y;
      return nodes.filter(node => Math.abs(node.getBoundingClientRect().y - firstRow) < 2).length;
    })).toBe(columns);
    await expect(input).toHaveValue('Keep this project draft');
    expect(await arena.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('projects-narrow-desktop.png') });
  await page.setViewportSize({ width: 2048, height: 1200 });
  await page.getByRole('button', { name: 'List', exact: true }).click();
  expect((await page.locator('.arena-groups').boundingBox())!.width).toBeLessThanOrEqual(1440);
  await page.getByRole('button', { name: 'Tiles', exact: true }).click();
  await expect(input).toHaveValue('Keep this project draft');
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.getByRole('button', { name: 'Tiles', exact: true })).toHaveCount(0);
  await expect(page.locator('.arena-tile-body')).toHaveCount(0);
  expect(await arena.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('projects-phone.png') });
  await page.setViewportSize({ width: 2048, height: 1200 });
  await expect(input).toHaveValue('Keep this project draft');
  await page.reload();
  await expect(input).toHaveValue('Keep this project draft');
  await first.getByRole('button', { name: `New session in ${projects[0].name}`, exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New session', exact: true })).toBeVisible();
});

for (const theme of ['light', 'dark']) test(`active projects fill spare row width and empty projects use compact rows: ${theme}`, async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.addInitScript(theme => localStorage.setItem('code-ai:theme', theme), theme);
  const { snapshot, owner, projects } = await projectFixture(request, [1, 2, 2, 1, 1, 0, 0]);
  await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
  await page.goto('/arena');
  await page.getByRole('button', { name: 'Tiles', exact: true }).click();
  const panels = page.locator('.arena-group');
  await expect(panels).toHaveCount(7);
  const boxes = await panels.evaluateAll(nodes => nodes.map(node => {
    const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height };
  }));
  expect(Math.abs(boxes[0].y - boxes[2].y)).toBeLessThan(2);
  expect(boxes[3].y).toBeGreaterThanOrEqual(boxes[0].y + boxes[0].height);
  expect(Math.abs(boxes[3].y - boxes[4].y)).toBeLessThan(2);
  expect(boxes[3].width).toBeGreaterThan(boxes[0].width * 1.4);
  expect(boxes[4].width).toBeGreaterThan(boxes[0].width * 1.4);
  const grid = (await page.locator('.arena-project-grid').boundingBox())!;
  expect(Math.abs(boxes[4].x + boxes[4].width - grid.x - grid.width)).toBeLessThan(2);
  for (const empty of boxes.slice(5)) {
    expect(Math.abs(empty.width - grid.width)).toBeLessThan(2);
    expect(empty.height).toBeLessThan(boxes[4].height * .5);
    expect(empty.y).toBeGreaterThanOrEqual(boxes[4].y + boxes[4].height);
  }
  const initialNames = await panels.locator(':scope > header h3').allTextContents();
  expect(initialNames.slice(0, 5)).toEqual(projects.slice(0, 5).map(project => project.name));
  const firstInput = panels.first().getByRole('textbox').first();
  await firstInput.fill('Keep my draft and focus while projects resize');
  await page.screenshot({ path: testInfo.outputPath('active-project-space.png') });
  const empty = page.getByRole('region', { name: projects[5].name, exact: true });
  await expect(empty.getByRole('button', { name: `New session in ${projects[5].name}`, exact: true })).toBeEnabled();
  owner.sessions.push({ ...owner.sessions[3], id: crypto.randomUUID(), projectId: projects[5].id, title: 'A newly active project' });
  await pushArenaSnapshot(page);
  await expect(empty.getByRole('textbox')).toHaveCount(1);
  expect((await empty.boundingBox())!.width).toBeGreaterThanOrEqual(520);
  await expect(firstInput).toHaveValue('Keep my draft and focus while projects resize');
  await expect(firstInput).toBeFocused();
  await expect(panels.locator(':scope > header h3')).toHaveText(initialNames);
  owner.sessions.pop();
  await pushArenaSnapshot(page);
  await expect(empty.getByRole('textbox')).toHaveCount(0);
  expect((await empty.boundingBox())!.height).toBeLessThan(boxes[4].height * .5);
  await expect(firstInput).toBeFocused();
  expect(await page.getByRole('main', { name: 'Arena', exact: true }).evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test('project panels contain long names and keep machine boundaries and offline guards', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { snapshot, owner, projects } = await projectFixture(request, [3, 1, 1, 1, 1, 0]);
  projects[0].name = 'LongProject'.repeat(20);
  projects[5].name = 'LongEmptyProject'.repeat(20);
  owner.checkouts.find(item => item.id === projects[0].repositories[0].checkoutId)!.name = 'LongRepository'.repeat(20);
  const remote = structuredClone(owner);
  remote.machine = { ...remote.machine, id: crypto.randomUUID(), kind: 'remote', label: 'Offline executor', state: 'offline' };
  snapshot.machines.push(remote);
  await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
  await page.goto('/arena');
  await page.getByRole('button', { name: 'Tiles', exact: true }).click();
  const localRegion = page.getByRole('region', { name: owner.machine.label, exact: true });
  const remoteRegion = page.getByRole('region', { name: remote.machine.label, exact: true });
  await expect(localRegion.locator('.arena-group')).toHaveCount(6);
  await expect(remoteRegion.locator('.arena-group')).toHaveCount(6);
  const localBounds = (await localRegion.boundingBox())!, remoteBounds = (await remoteRegion.boundingBox())!;
  expect(remoteBounds.y).toBeGreaterThanOrEqual(localBounds.y + localBounds.height);
  for (const width of [1440, 1000, 741]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.getByRole('main', { name: 'Arena', exact: true }).evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await localRegion.locator('.arena-group').evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth))).toBe(true);
  }
  const remotePanel = remoteRegion.locator('.arena-group').first();
  await expect(remotePanel.getByRole('button', { name: /^New session in/ })).toBeDisabled();
  await expect(remotePanel.getByRole('textbox').first()).toBeDisabled();
  await expect(remotePanel.getByRole('button', { name: 'Archive session', exact: true }).first()).toBeDisabled();
  await expect(remotePanel.getByRole('link')).toHaveCount(0);
  await localRegion.locator('.arena-group').first().screenshot({ path: testInfo.outputPath('long-project-names.png') });
});
