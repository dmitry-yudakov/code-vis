import { expect, test } from '@playwright/test';

test('Local remains the creation default and Docker cannot be selected while disabled', async ({ page, request }) => {
  await page.goto('/arena');
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Execution', exact: true })).toHaveCount(0);
  const response = await request.post('/api/sessions', { data: { provider: 'claude', execution: 'docker', checkoutId: 'unavailable' } });
  expect(response.ok()).toBe(false);
});

test('Docker creation explains direct edits and an unavailable backend cannot create a session', async ({ page }) => {
  await page.route('**/api/health', async (route) => {
    const upstream = await route.fetch();
    const body = await upstream.json();
    const unavailable = { available: false, authenticated: 'unknown', supportedModes: [], message: 'Docker is unavailable or has not been provisioned.' };
    body.executions = {
      local: { enabled: true, providers: body.providers },
      docker: { enabled: true, providers: { claude: unavailable, codex: unavailable } },
    };
    await route.fulfill({ response: upstream, json: body });
  });
  await page.goto('/arena');
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  const execution = page.getByRole('combobox', { name: 'Execution', exact: true });
  await expect(execution).toHaveValue('local');
  await execution.selectOption('docker');
  await expect(page.getByText('Agent edits this repository directly and runs commands without individual approvals. Mounted files, including ignored files, are accessible.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create and open' })).toBeDisabled();
  await expect(page.getByText('Docker is unavailable or has not been provisioned.', { exact: true })).toBeVisible();
  await execution.selectOption('local');
  await expect(page.getByRole('button', { name: 'Create and open' })).toBeEnabled();
});
