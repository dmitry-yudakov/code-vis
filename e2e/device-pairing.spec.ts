import { expect, test } from '@playwright/test';

for (const [theme, width] of [['light', 1280], ['dark', 1280], ['light', 390], ['dark', 390]] as const) {
  test(`pairs with a short code, retries, manages devices and signs out (${theme}, ${width}px)`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    const deviceId = '11111111-1111-4111-8111-111111111111';
    let authenticated = false;
    let privateRequestsBeforePairing = 0;
    let pairAttempts = 0;

    await page.route('**/api/auth/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          mode: 'paired',
          authenticated,
          transportSecure: true,
          hostLabel: 'Home desktop',
          ...(authenticated ? { device: { id: deviceId, label: 'Kitchen tablet' } } : {}),
        }),
      });
    });
    await page.route('**/api/auth/pair', async (route) => {
      const body = route.request().postDataJSON() as { label?: string; code?: string };
      expect(body).toEqual({ label: 'Kitchen tablet', code: 'abcd-efgh' });
      pairAttempts += 1;
      if (pairAttempts === 1) {
        await route.fulfill({
          status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Could not pair this device. Try again.' }),
        });
        return;
      }
      authenticated = true;
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    await page.route('**/api/auth/devices', async (route) => {
      if (route.request().method() === 'DELETE') {
        authenticated = false;
        await route.fulfill({
          status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, signedOut: true }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          devices: [{
            id: deviceId,
            label: 'Kitchen tablet',
            pairedAt: '2026-09-04T10:00:00.000Z',
            expiresAt: '2027-09-04T10:00:00.000Z',
            current: true,
          }],
        }),
      });
    });
    page.on('request', (request) => {
      if (!authenticated && /\/api\/(arena|projects|sessions|checkouts|agent|repository)/.test(request.url())) {
        privateRequestsBeforePairing += 1;
      }
    });

    await page.goto('/arena');
    await expect(page.getByRole('heading', { name: 'Pair this device' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Pairing code' })).toHaveAttribute('placeholder', 'ABCD-EFGH');
    await page.screenshot({ path: testInfo.outputPath('pairing.png'), fullPage: true });
    expect(privateRequestsBeforePairing).toBe(0);
    await page.getByRole('textbox', { name: 'Device name' }).fill('Kitchen tablet');
    await page.getByRole('textbox', { name: 'Pairing code' }).fill('abcd-efgh');
    await page.getByRole('button', { name: 'Pair device' }).click();
    await expect(page.getByRole('region', { name: 'Pair this device' }).getByRole('alert'))
      .toContainText('Could not pair this device. Try again.');
    await expect(page.getByRole('textbox', { name: 'Pairing code' })).toHaveValue('abcd-efgh');
    await expect(page.getByRole('textbox', { name: 'Device name' })).toHaveValue('Kitchen tablet');
    expect(privateRequestsBeforePairing).toBe(0);
    await page.getByRole('button', { name: 'Pair device' }).click();

    await expect(page.getByRole('heading', { name: 'Arena', exact: true })).toBeVisible();
    if (width === 390) await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.locator('.device-menu > button').click();
    await expect(page.getByText('Kitchen tablet · This device')).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Pair this device' })).toBeVisible();
  });
}
