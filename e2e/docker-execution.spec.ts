import { expect, test } from '@playwright/test';

test.beforeEach(async ({ request, baseURL }) => {
  const response = await request.patch('/api/execution/docker', {
    headers: { Origin: baseURL! }, data: { enabled: false },
  });
  expect(response.ok(), await response.text()).toBe(true);
});

test.afterEach(async ({ request, baseURL }) => {
  await request.patch('/api/execution/docker', {
    headers: { Origin: baseURL! }, data: { enabled: false },
  });
});

test('Local remains the creation default and Docker cannot be selected while disabled', async ({ page, request }) => {
  await page.goto('/arena');
  await expect(page.getByRole('checkbox', { name: 'Enable Docker' })).not.toBeChecked();
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Execution', exact: true })).toHaveCount(0);
  const response = await request.post('/api/sessions', { data: { provider: 'claude', execution: 'docker', checkoutId: 'unavailable' } });
  expect(response.ok()).toBe(false);
});

test('Docker can be enabled without restarting, persists on reload, and disabling restores Local', async ({ page, request }, testInfo) => {
  await page.goto('/arena');
  const toggle = page.getByRole('checkbox', { name: 'Enable Docker' });
  const settings = page.getByRole('region', { name: 'Docker execution', exact: true });
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(settings.getByText('Setup needed', { exact: true })).toBeVisible();
  await expect(settings.getByText('npm run docker:provision', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('docker-setup.png'), fullPage: true });
  await settings.getByRole('button', { name: 'Check again' }).click();
  await expect(toggle).toBeChecked();
  await page.reload();
  await expect(toggle).toBeChecked();
  expect((await (await request.get('/api/health')).json()).executions.docker.enabled).toBe(true);
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  const execution = page.getByRole('combobox', { name: 'Execution', exact: true });
  await expect(execution).toHaveValue('local');
  await execution.selectOption('docker');
  await expect(page.getByRole('button', { name: 'Create and open' })).toBeDisabled();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(execution).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create and open' })).toBeEnabled();
  const rejected = await request.post('/api/sessions', { data: { provider: 'claude', execution: 'docker' } });
  expect(rejected.status()).toBe(409);
  await page.reload();
  await expect(toggle).not.toBeChecked();
});

test('failed saves remain visible and do not change the saved toggle', async ({ page }) => {
  await page.route('**/api/execution/docker', (route) => route.fulfill({
    status: 503, json: { error: 'Could not save Docker settings.' },
  }));
  await page.goto('/arena');
  const toggle = page.getByRole('checkbox', { name: 'Enable Docker' });
  await toggle.click();
  await expect(page.getByRole('region', { name: 'Docker execution', exact: true }).getByRole('alert')).toHaveText('Could not save Docker settings.');
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeEnabled();
});

test('Docker creation explains direct edits and an unavailable backend cannot create a session', async ({ page }) => {
  let ready = false;
  await page.route('**/api/health', async (route) => {
    const upstream = await route.fetch();
    const body = await upstream.json();
    const docker = ready
      ? { available: true, authenticated: 'unknown', supportedModes: ['ask', 'plan', 'agent'] }
      : { available: false, authenticated: 'unknown', supportedModes: [], message: 'Docker is unavailable or has not been provisioned.' };
    body.executions = {
      local: { enabled: true, providers: body.providers },
      docker: { enabled: true, providers: { claude: docker, codex: docker } },
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
  await expect(page.getByRole('region', { name: 'Create session', exact: true }).getByText('Docker is unavailable or has not been provisioned.', { exact: true })).toBeVisible();
  await execution.selectOption('local');
  await expect(page.getByRole('button', { name: 'Create and open' })).toBeEnabled();
  ready = true;
  const settings = page.getByRole('region', { name: 'Docker execution', exact: true });
  await settings.getByRole('button', { name: 'Check again' }).click();
  await expect(settings.getByText('Ready', { exact: true })).toBeVisible();
  await expect(execution).toHaveValue('local');
  await execution.selectOption('docker');
  await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption('none');
  await expect(page.getByRole('button', { name: 'Create and open' })).toBeEnabled();
});
