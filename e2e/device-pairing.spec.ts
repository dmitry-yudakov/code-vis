import { expect, test } from '@playwright/test';

test('gates paired mode, enters with a one-time code, manages the device, and signs out', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1_000 });
  const deviceId = '11111111-1111-4111-8111-111111111111';
  let authenticated = false;
  let privateRequestsBeforePairing = 0;

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
    expect(body).toEqual({ label: 'Kitchen tablet', code: 'ABCD-EFGH-JKLM-NPQR' });
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
  expect(privateRequestsBeforePairing).toBe(0);
  await page.getByRole('textbox', { name: 'Device name' }).fill('Kitchen tablet');
  await page.getByRole('textbox', { name: 'Pairing code' }).fill('ABCD-EFGH-JKLM-NPQR');
  await page.getByRole('button', { name: 'Pair device' }).click();

  await expect(page.getByRole('heading', { name: 'Arena' })).toBeVisible();
  await page.locator('.device-menu > summary').click();
  await expect(page.getByText('Kitchen tablet · This device')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Pair this device' })).toBeVisible();
});
