import { expect, test } from '@playwright/test';
import type { ArenaSnapshot, PublicSession } from '../src/shared/types';

for (const [appearance, width] of [['light', 1440], ['dark', 360]] as const) {
  test(`Inbox item opens its session and retains read state: ${appearance} ${width}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme => localStorage.setItem('code-ai:theme', theme), appearance);
    const created = await request.post('/api/sessions', { data: { provider: 'claude' } });
    expect(created.status()).toBe(201);
    const { session } = await created.json() as { session: PublicSession };
    const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
    const owner = snapshot.machines.find(machine => machine.sessions.some(item => item.id === session.id))!;
    owner.sessions.find(item => item.id === session.id)!.title = 'Clickable Inbox session';
    owner.runs.recent.push({
      runId: crypto.randomUUID(), sessionId: session.id, participantId: session.primaryAgentId,
      state: 'finished', outcome: 'completed', enqueuedAt: Date.now(), finishedAt: Date.now(),
      pendingPermissionCount: 0, pendingPermissions: [],
    });
    owner.machine.state = 'offline';
    await page.route('**/api/arena', route => route.fulfill({ json: snapshot }));
    await page.goto('/arena/inbox');
    const arena = page.getByRole('main', { name: 'Arena' });
    const item = arena.locator('.arena-inbox-item').filter({ hasText: 'Clickable Inbox session' });
    const open = item.getByRole('link', { name: 'Open Clickable Inbox session', exact: true });
    await expect(open).toHaveAccessibleDescription(/Finished.*No project.*Turn completed/);
    await expect(open).toBeDisabled();
    await item.locator('strong').click({ force: true });
    await expect(page).toHaveURL(/\/arena\/inbox$/);
    await expect(item).not.toHaveClass(/read/);

    owner.machine.state = 'online';
    await arena.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(open).toBeEnabled();
    expect(await arena.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await open.hover();
    await page.screenshot({ path: testInfo.outputPath('inbox.png'), animations: 'disabled' });
    // Padding belongs to the same action as the title and status badge.
    await open.click({ position: { x: 8, y: 8 } });
    await expect(page).toHaveURL(/\/\?(?:session|project)=/);
    await expect(page.getByRole('combobox', { name: 'All sessions', exact: true })).toHaveValue(session.id);
    const openInbox = async () => {
      const views = page.getByRole('navigation', { name: 'Views', exact: true });
      if (width === 360) await views.getByRole('button', { name: /^More/ }).click();
      await page.getByRole('link', { name: /^Inbox/ }).click();
    };
    await openInbox();
    await expect(item).toHaveClass(/read/);
    await page.reload();
    await expect(item).toHaveClass(/read/);
    for (const key of ['Enter', 'Space']) {
      await open.focus();
      await page.keyboard.press(key);
      await expect(page).toHaveURL(/\/\?(?:session|project)=/);
      await expect(page.getByRole('combobox', { name: 'All sessions', exact: true })).toHaveValue(session.id);
      await openInbox();
    }
    await page.unrouteAll({ behavior: 'wait' });
  });
}
