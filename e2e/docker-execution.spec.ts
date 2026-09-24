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
  await page.goto('/');
  await page.locator('.new-session-menu summary').click();
  await expect(page.locator('.new-session-menu option[value="docker"]')).toHaveJSProperty('disabled', true);
  await expect(page.locator('.new-session-menu').getByRole('link', { name: 'Enable Docker in Arena' })).toBeVisible();
});

test('Docker can be enabled without restarting, persists on reload, and disabling restores Local', async ({ page, request }, testInfo) => {
  await page.goto('/arena');
  const toggle = page.getByRole('checkbox', { name: 'Enable Docker' });
  const settings = page.getByRole('region', { name: 'Docker execution', exact: true });
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(settings.getByText('Setup needed', { exact: true })).toBeVisible();
  await expect(settings.getByText('npm run docker:provision', { exact: true })).toBeVisible();
  await expect(settings.getByText('npm run docker:login -- claude', { exact: true })).toBeVisible();
  await expect(settings.getByText('npm run docker:login -- codex', { exact: true })).toBeVisible();
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

// Real session storage and binding admission, with only Docker execution/readiness represented by
// fixtures. Browser coverage never starts a Docker container or accesses provider credentials.
async function dockerUiFixture(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext,
  readiness = { localAvailable: true, dockerReady: true }) {
  const { checkouts } = await (await request.get('/api/checkouts')).json();
  const projectResponse = await request.post('/api/projects', {
    data: { name: `Docker UI ${Date.now()}`, checkoutIds: [checkouts[0].id] },
  });
  expect(projectResponse.ok(), await projectResponse.text()).toBe(true);
  const { project } = await projectResponse.json();
  const createdSessionIds = new Set<string>();
  const dockerSessionIds = new Set<string>();
  const creations: Array<{ provider: string; execution: string; projectId?: string; checkoutId?: string; sourceSessionId?: string }> = [];
  const failures = { create: false, wait: undefined as Promise<void> | undefined };
  await page.route('**/api/projects', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ json: { projects: [project] } });
    else await route.continue();
  });
  await page.route('**/api/health', async (route) => {
    const upstream = await route.fetch();
    const body = await upstream.json();
    if (!readiness.localAvailable) {
      for (const provider of Object.values(body.providers) as Array<{ available: boolean; supportedModes: string[] }>) {
        provider.available = false;
        provider.supportedModes = [];
      }
    }
    const docker = readiness.dockerReady
      ? { available: true, authenticated: 'unknown', supportedModes: ['ask', 'plan', 'agent'] }
      : { available: false, authenticated: 'unknown', supportedModes: [], message: 'Docker is unavailable or has not been provisioned.' };
    body.executions = { local: { enabled: true, providers: body.providers }, docker: { enabled: true, providers: { claude: docker, codex: docker } } };
    await route.fulfill({ response: upstream, json: body });
  });
  await page.route(/\/api\/sessions(?:[/?]|$)/, async (route) => {
    const create = route.request().method() === 'POST' && new URL(route.request().url()).pathname === '/api/sessions';
    if (create && failures.wait) await failures.wait;
    if (create && failures.create) {
      await route.fulfill({ status: 409, json: { error: 'Repository is no longer available.' } });
      return;
    }
    const input = create ? route.request().postDataJSON() : undefined;
    if (input) creations.push(input);
    const response = await route.fetch(input ? { postData: JSON.stringify({ ...input, checkoutId: undefined, execution: 'local' }) } : {});
    const body = await response.json();
    if (create && body.session) createdSessionIds.add(body.session.id);
    if (new URL(route.request().url()).searchParams.get('loose') === 'true' && body.sessions) {
      body.sessions = body.sessions.filter((session: { id: string }) => createdSessionIds.has(session.id));
    }
    if (input?.checkoutId && body.session) {
      const bound = await request.put(`/api/sessions/${body.session.id}/repositories`, { data: {
        expectedRevision: body.session.revision,
        repositories: [{ ...project.repositories[0], checkoutId: input.checkoutId }],
      } });
      expect(bound.ok(), await bound.text()).toBe(true);
      body.session = (await bound.json()).session;
    }
    if (input?.execution === 'docker' && body.session) dockerSessionIds.add(body.session.id);
    for (const session of body.sessions || (body.session ? [body.session] : [])) {
      if (dockerSessionIds.has(session.id)) session.execution = 'docker';
    }
    await route.fulfill({ response, json: body });
  });
  return { project, checkouts, creations, failures };
}

test('project creation offers Docker without a host provider and keeps the selected project', async ({ page, request }, testInfo) => {
  const readiness = { localAvailable: false, dockerReady: false };
  const { project, creations } = await dockerUiFixture(page, request, readiness);
  await page.goto('/');
  const welcome = page.locator('.welcome-screen');
  await expect(welcome.getByRole('heading')).toContainText(project.name);
  await expect(welcome.getByRole('button', { name: 'Create and open' })).toBeDisabled();
  await welcome.getByRole('combobox', { name: 'Execution', exact: true }).selectOption('docker');
  await expect(welcome.getByRole('link', { name: 'Open Docker setup' })).toBeVisible();
  await expect(welcome.getByRole('button', { name: 'Create and open' })).toBeDisabled();
  readiness.dockerReady = true;
  await page.reload();
  await welcome.getByRole('combobox', { name: 'Execution', exact: true }).selectOption('docker');
  await expect(welcome.getByRole('combobox', { name: 'New session provider' })).toHaveValue('claude');
  await welcome.getByRole('button', { name: 'Create and open' }).click();
  const conversation = page.getByRole('complementary', { name: 'Conversation', exact: true });
  await expect(conversation.getByLabel('Session execution', { exact: true })).toHaveText('Docker');
  await expect(page.locator('.project-search-trigger')).toContainText(project.name);
  expect(creations[0]).toEqual({ provider: 'claude', execution: 'docker', projectId: project.id });
  await expect(conversation.getByRole('button', { name: 'Continue in Local', exact: true })).toBeDisabled();
  await page.locator('.new-session-menu summary').click();
  const picker = page.locator('.new-session-menu');
  await expect(picker.getByRole('combobox', { name: 'Execution', exact: true })).toHaveValue('docker');
  await expect(picker.getByRole('button', { name: 'Start session' })).toBeEnabled();
  await picker.getByRole('combobox', { name: 'Execution', exact: true }).selectOption('local');
  await expect(picker.getByRole('button', { name: 'Start session' })).toBeDisabled();
  await picker.getByRole('combobox', { name: 'Execution', exact: true }).selectOption('docker');
  await picker.getByRole('button', { name: 'Start session' }).click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  expect(creations[1].projectId).toBe(project.id);
  expect(creations[1].execution).toBe('docker');
  await page.screenshot({ path: testInfo.outputPath('docker-project-session.png'), fullPage: true });
});

test('continuation opens fresh sessions in both directions with an editable recap and preserves source drafts', async ({ page, request }) => {
  const { creations } = await dockerUiFixture(page, request);
  await page.goto('/');
  await page.locator('.welcome-screen').getByRole('button', { name: 'Create and open' }).click();
  const conversation = page.getByRole('complementary', { name: 'Conversation', exact: true });
  await expect(conversation.getByLabel('Session execution', { exact: true })).toHaveText('Local');
  const sourceId = await page.getByRole('combobox', { name: 'Session', exact: true }).inputValue();
  await conversation.locator('textarea').fill('Remember this source request for the next session.');
  await conversation.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(conversation.getByRole('button', { name: 'Continue in Docker', exact: true })).toBeDisabled();
  await expect(conversation.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  const sourceBefore = (await (await request.get(`/api/sessions/${sourceId}`)).json()).session;
  const draft = 'Unsent original draft. '.repeat(100);
  await conversation.locator('textarea').fill(draft);
  await conversation.getByRole('button', { name: 'Continue in Docker', exact: true }).click();
  await expect(conversation.getByLabel('Session execution', { exact: true })).toHaveText('Docker');
  const dockerId = await page.getByRole('combobox', { name: 'Session', exact: true }).inputValue();
  expect(dockerId).not.toBe(sourceId);
  expect(creations[1]).toEqual({ provider: 'claude', execution: 'docker', sourceSessionId: sourceId });
  await expect(conversation.locator('.chat-message')).toHaveCount(0);
  await expect(conversation.locator('textarea')).toHaveValue(/Remember this source request/);
  expect((await conversation.locator('textarea').inputValue()).length).toBeLessThanOrEqual(7_600);
  expect((await (await request.get(`/api/sessions/${sourceId}`)).json()).session).toEqual(sourceBefore);
  expect((await (await request.get(`/api/sessions/${dockerId}`)).json()).session.repositories).toEqual(sourceBefore.repositories);
  expect((await (await request.get('/api/agent/runs')).json()).active).toEqual([]);
  await conversation.locator('textarea').fill('Edited recap for Local.');
  await conversation.getByRole('button', { name: 'Continue in Local', exact: true }).click();
  await expect(conversation.getByLabel('Session execution', { exact: true })).toHaveText('Local');
  expect(creations[2]).toEqual({ provider: 'claude', execution: 'local', sourceSessionId: dockerId });
  await expect(conversation.locator('textarea')).toHaveValue(/Edited recap for Local\./);
  await expect(conversation.locator('.chat-message')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Session', exact: true }).selectOption(sourceId);
  await expect(conversation.locator('textarea')).toHaveValue(draft);
});

test('a new Docker session never inherits Agent, and continuing carries the agent\'s own model', async ({ page, request }) => {
  await dockerUiFixture(page, request);
  await page.goto('/');
  await page.locator('.welcome-screen').getByRole('button', { name: 'Create and open' }).click();
  const conversation = page.getByRole('complementary', { name: 'Conversation', exact: true });
  const execution = conversation.getByLabel('Session execution', { exact: true });
  await expect(execution).toHaveText('Local');
  const localId = await page.getByRole('combobox', { name: 'Session', exact: true }).inputValue();
  const mode = (name: string) => conversation.getByRole('radio', { name, exact: true });
  const menu = conversation.locator('.model-menu');
  const choose = async (model: string, effort: string) => {
    await menu.locator('summary').click();
    await menu.getByRole('radiogroup', { name: 'Model' }).getByRole('radio', { name: model, exact: true }).click();
    await menu.getByRole('radiogroup', { name: 'Effort' }).getByRole('radio', { name: effort, exact: true }).click();
    await menu.locator('summary').click();
  };

  // The main agent's own choice differs from Claude's last choice, which the reviewer made.
  await mode('Agent').click();
  await choose('Opus', 'High');
  await conversation.locator('.add-agent-menu summary').click();
  await conversation.getByLabel('Role').selectOption('reviewer');
  await conversation.getByRole('button', { name: 'Add participant' }).click();
  await expect(conversation.locator('.participant-chip.active')).toContainText('Claude Reviewer');
  await choose('Sonnet', 'Low');
  await conversation.locator('.participant-chip').filter({ hasText: 'Main' }).click();
  await expect(menu.locator('summary')).toHaveText('Opus · High');

  // Docker Agent edits without approvals, so a Docker session starts in Ask although Agent was last.
  await page.locator('.new-session-menu summary').click();
  const picker = page.locator('.new-session-menu');
  await picker.getByRole('combobox', { name: 'Execution', exact: true }).selectOption('docker');
  await picker.getByRole('button', { name: 'Start session' }).click();
  await expect(execution).toHaveText('Docker');
  await expect(mode('Ask')).toHaveAttribute('aria-checked', 'true');

  // The Docker worker lists no models here, yet the round trip brings the main agent's own choice back.
  await page.getByRole('combobox', { name: 'Session', exact: true }).selectOption(localId);
  await expect(execution).toHaveText('Local');
  await conversation.getByRole('button', { name: 'Continue in Docker', exact: true }).click();
  await expect(execution).toHaveText('Docker');
  await conversation.getByRole('button', { name: 'Continue in Local', exact: true }).click();
  await expect(execution).toHaveText('Local');
  await expect(menu.locator('summary')).toHaveText('Opus · High');
});

test('loose Docker creation selects a checkout and failed creation keeps its options open', async ({ page, request }) => {
  const { checkouts, creations, failures } = await dockerUiFixture(page, request);
  await page.goto('/');
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: /^No project/ }).click();
  const welcome = page.locator('.welcome-screen');
  await welcome.getByRole('combobox', { name: 'Execution', exact: true }).selectOption('docker');
  await welcome.getByRole('combobox', { name: 'Repository', exact: true }).selectOption('');
  await expect(welcome.getByRole('button', { name: 'Create and open' })).toBeDisabled();
  await welcome.getByRole('combobox', { name: 'Repository', exact: true }).selectOption(checkouts[0].id);
  failures.create = true;
  let resumeCreation!: () => void;
  failures.wait = new Promise<void>((resolve) => { resumeCreation = resolve; });
  await welcome.getByRole('button', { name: 'Create and open' }).click();
  await expect(welcome.getByRole('button', { name: 'Creating…' })).toBeDisabled();
  await expect(welcome.getByRole('combobox', { name: 'Execution', exact: true })).toBeDisabled();
  resumeCreation();
  failures.wait = undefined;
  await expect(welcome.getByRole('alert')).toHaveText('Repository is no longer available.');
  await expect(welcome.getByRole('combobox', { name: 'Execution', exact: true })).toHaveValue('docker');
  await expect(welcome.getByRole('button', { name: 'Create and open' })).toBeEnabled();
  failures.create = false;
  await welcome.getByRole('button', { name: 'Create and open' }).click();
  await expect(page.getByLabel('Session execution', { exact: true })).toHaveText('Docker');
  expect(creations[0]).toEqual({ provider: 'claude', execution: 'docker', checkoutId: checkouts[0].id });
});
