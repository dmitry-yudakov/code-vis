import { expect, test } from '@playwright/test';
import { openMachineSettings } from './machine-settings';

test('security can be dismissed across reloads and remains available from settings', async ({ page }) => {
  await page.goto('/arena');
  const arena = page.getByRole('main', { name: 'Arena' });
  const notice = arena.getByRole('region', { name: 'Security level' });
  await expect(notice.getByRole('button', { name: 'Dismiss security notice' })).toBeVisible({ timeout: 2_000 });
  await notice.getByRole('button', { name: 'Dismiss security notice' }).click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(arena.getByRole('heading', { name: 'Arena', exact: true })).toBeVisible();
  await expect(notice).toHaveCount(0);
  await expect(arena.getByRole('region', { name: 'Docker execution' })).toHaveCount(0);
  await expect(arena.getByRole('region', { name: 'Global instructions' })).toHaveCount(0);
  const settings = await openMachineSettings(page);
  await expect(settings.getByRole('region', { name: 'Security level' })).toContainText('Guarded');
  await expect(settings.getByRole('region', { name: 'Security level' }).locator('input, select, button')).toHaveCount(0);
  await expect(settings.getByRole('region', { name: 'Global instructions' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await expect(page.locator('.more-menu > summary')).toBeFocused();
});

test('a changed security level shows the notice again', async ({ page }) => {
  let native = false;
  await page.route('**/api/arena**', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const machine of body.machines) if (machine.machine.kind === 'local') machine.securityLevel = native ? 'native' : 'guarded';
    await route.fulfill({ response, json: body });
  });
  await page.goto('/arena');
  const notice = page.getByRole('main', { name: 'Arena' }).getByRole('region', { name: 'Security level' });
  await notice.getByRole('button', { name: 'Dismiss security notice' }).click();
  native = true;
  await page.reload();
  await expect(notice).toContainText('Native');
});

test('dismissing one machine does not dismiss another machine', async ({ page }) => {
  let replacement = false;
  await page.route('**/api/arena', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (replacement) for (const machine of body.machines) if (machine.machine.kind === 'local') machine.machine.id = 'different-home-machine';
    await route.fulfill({ response, json: body });
  });
  await page.goto('/arena');
  const notice = page.getByRole('main', { name: 'Arena' }).getByRole('region', { name: 'Security level' });
  await notice.getByRole('button', { name: 'Dismiss security notice' }).click();
  replacement = true;
  await page.reload();
  await expect(notice.getByRole('button', { name: 'Dismiss security notice' })).toBeVisible();
});

for (const theme of ['Light', 'Dark']) {
  test(`settings fit a narrow screen in ${theme} theme`, async ({ page }, testInfo) => {
    await page.goto('/arena');
    await page.locator('.more-menu > summary').click();
    await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: theme, exact: true }).click();
    await page.locator('.more-menu > summary').click();
    await page.setViewportSize({ width: 360, height: 800 });
    const settings = await openMachineSettings(page);
    await expect(settings.getByRole('checkbox', { name: 'Enable Docker' })).toBeVisible();
    expect(await settings.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const box = await settings.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    await page.screenshot({ path: testInfo.outputPath(`settings-${theme.toLowerCase()}.png`) });
    await settings.getByRole('button', { name: 'Close settings' }).click();
    await expect(settings).toBeHidden();
  });
}

test('both new-session forms hide global instructions under Advanced settings', async ({ page }) => {
  await page.goto('/arena');
  await page.getByRole('main', { name: 'Arena' }).getByRole('button', { name: 'New session' }).click();
  const setup = page.getByRole('dialog', { name: 'New session', exact: true });
  await expect(setup.getByLabel('Global instructions')).toBeHidden();
  await setup.getByText('Advanced settings', { exact: true }).click();
  await setup.getByLabel('Global instructions').selectOption('isolated');
  await setup.getByRole('button', { name: 'Create and open' }).click();
  await expect(setup).toBeHidden();
  await page.locator('.new-session-menu > summary').click();
  const form = page.locator('.new-session-menu');
  await expect(form.getByLabel('Global instructions')).toBeHidden();
  await form.getByText('Advanced settings', { exact: true }).click();
  await expect(form.getByLabel('Global instructions')).toHaveValue('isolated');
});
