import { expect, test, fulfillArenaSnapshot, pushArenaSnapshot } from './arena-stream';
import type { ArenaSnapshot, CheckoutsResponse, DurableProject } from '../src/shared/types';

for (const theme of ['light', 'dark']) for (const width of [1280, 390]) {
  test(`compact session setup keeps composition and draft actions usable: ${theme} ${width}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    const catalog = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
    const checkout = catalog.checkouts.find(item => item.relativePath === 'alpha')!;
    const target = (await (await request.post('/api/projects', { data: { name: `Compact ${theme} ${width} ${Date.now()}`, checkoutIds: [checkout.id] } })).json()).project as DurableProject;
    await page.goto('/arena');
    const shortcut = page.getByRole('button', { name: `New session in ${target.name}`, exact: true });
    await shortcut.click();
    const dialog = page.getByRole('dialog', { name: 'New session', exact: true });
    const message = dialog.getByRole('textbox', { name: 'First message (optional)' });
    const settings = dialog.getByRole('button', { name: 'Settings', exact: true });
    await expect(message).toBeFocused();
    await expect(settings).toHaveAttribute('aria-expanded', 'false');
    await expect(dialog.getByLabel('Provider', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Mode', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Project', { exact: true })).toBeHidden();
    await expect(dialog.getByLabel('Global instructions')).toBeHidden();
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Clear setup', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Create and open', exact: true })).toBeInViewport();
    expect((await dialog.boundingBox())!.height).toBeLessThan(550);
    await settings.click();
    await expect(dialog.getByLabel('Machine', { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Discard draft', exact: true })).toHaveCount(0);
    await settings.click();
    await message.fill('Review this screenshot');
    await message.evaluate(element => {
      const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 50;
      canvas.getContext('2d')!.fillRect(0, 0, 80, 50);
      const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), c => c.charCodeAt(0));
      const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'screen.png', { type: 'image/png' }));
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    });
    await expect(dialog.getByRole('button', { name: 'Preview image 1' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Attach', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Files or screenshot…', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Attach', exact: true })).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath('compact.png'), animations: 'disabled' });
    await dialog.getByRole('button', { name: 'Close setup', exact: true }).click();
    await expect(shortcut).toBeFocused();
    await shortcut.click();
    await expect(message).toHaveValue('Review this screenshot');
    await expect(dialog.getByRole('button', { name: 'Preview image 1' })).toBeVisible();
    await expect(settings).toHaveAttribute('aria-expanded', 'false');
    await settings.click();
    await page.screenshot({ path: testInfo.outputPath('settings.png'), animations: 'disabled' });
    await dialog.getByRole('button', { name: 'Discard draft', exact: true }).click();
    await expect(dialog).toBeHidden();
    await shortcut.click();
    await expect(message).toHaveValue('');
    await expect(dialog.getByRole('button', { name: 'Preview image 1' })).toHaveCount(0);
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  });
}

test('compact progress recovers a rejected message in the created session and retries once', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const checkout = snapshot.machines[0].checkouts.find(item => item.relativePath === 'alpha')!;
  const target = (await (await request.post('/api/projects', { data: { name: `Progress ${Date.now()}`, checkoutIds: [checkout.id] } })).json()).project as DurableProject;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let creations = 0;
  const messages: Array<{ sessionId: string; messageId: string }> = [];
  page.on('request', req => { if (req.url().endsWith('/api/sessions') && req.method() === 'POST') creations++; });
  await page.route('**/api/agent/message', async route => {
    messages.push(route.request().postDataJSON());
    if (messages.length > 1) return route.continue();
    await held;
    return route.fulfill({ status: 503, json: { error: 'Provider temporarily unavailable. Your draft is kept.' } });
  });
  await page.goto('/arena');
  await page.getByRole('button', { name: `New session in ${target.name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New session', exact: true });
  await dialog.getByRole('textbox').fill('Retry this task');
  await dialog.getByRole('button', { name: 'Start in background', exact: true }).click();
  try {
    await expect(dialog.getByRole('status')).toHaveText('Session created. Sending message…');
    await expect(dialog.getByRole('textbox')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeEnabled();
    release();
    await expect(dialog.getByRole('alert')).toContainText('Provider temporarily unavailable');
    await expect(dialog.getByRole('textbox')).toHaveValue('Retry this task');
    await expect(dialog.getByRole('button', { name: 'Open created session', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('region', { name: 'Notifications' })).toContainText('Session started');
    expect(creations).toBe(1);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual(messages[0]);
  } finally { release(); }
});

test('general setup remembers its machine and keeps an offline remembered target blocked', async ({ page, request }) => {
  const snapshot = await (await request.get('/api/arena')).json() as ArenaSnapshot;
  const local = snapshot.machines.find(entry => entry.machine.kind === 'local')!;
  const remoteId = '99999999-9999-4999-8999-999999999999';
  const remote = { ...structuredClone(local), machine: { ...local.machine, id: remoteId, kind: 'remote' as const, label: 'Last executor' }, projects: [], sessions: [], archivedSessions: [] };
  snapshot.machines.push(remote);
  await page.route('**/api/arena', route => fulfillArenaSnapshot(route, { json: snapshot }));
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/machines/${remoteId}/sessions`, async route => {
    const response = await request.post('/api/sessions', { data: { provider: 'claude', creationRequestId: route.request().postDataJSON().creationRequestId } });
    await held; return route.fulfill({ response });
  });
  await page.goto('/arena');
  const newSession = page.getByRole('main', { name: 'Arena', exact: true }).getByRole('button', { name: 'New session', exact: true });
  await newSession.click();
  const dialog = page.getByRole('dialog', { name: 'New session', exact: true });
  const settings = dialog.getByRole('button', { name: 'Settings', exact: true });
  await settings.click();
  await dialog.getByLabel('Machine', { exact: true }).selectOption(remoteId);
  await dialog.getByRole('button', { name: 'Create and open', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  release();
  await expect(page.getByRole('button', { name: 'Open session', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('code-ai:device:v1:preferences')!).machineId)).toBe(remoteId);
  await page.reload(); await newSession.click();
  await expect(dialog).toContainText('Last executor');
  await settings.click();
  await expect(dialog.getByLabel('Machine', { exact: true })).toHaveValue(remoteId);
  remote.machine.state = 'offline'; await pushArenaSnapshot(page);
  await expect(dialog.getByRole('button', { name: 'Create and open', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('status').filter({ hasText: 'target machine is offline' })).toBeVisible();
  await expect(dialog.getByLabel('Machine', { exact: true })).toHaveValue(remoteId);
  await dialog.getByLabel('Machine', { exact: true }).selectOption(local.machine.id);
  await expect(dialog.getByRole('button', { name: 'Create and open', exact: true })).toBeEnabled();
  // Reload drops the unsubmitted retargeting; the saved offline choice must still win.
  await page.reload(); await newSession.click(); await settings.click();
  await expect(dialog.getByLabel('Machine', { exact: true })).toHaveValue(remoteId);
  await expect(dialog.getByRole('button', { name: 'Create and open', exact: true })).toBeDisabled();
  snapshot.machines.pop();
  await page.reload(); await newSession.click(); await settings.click();
  await expect(dialog.getByLabel('Machine', { exact: true })).toHaveValue(remoteId);
  await expect(dialog.getByLabel('Machine', { exact: true })).toContainText('Unavailable machine');
  await expect(dialog.getByRole('button', { name: 'Create and open', exact: true })).toBeDisabled();
});
