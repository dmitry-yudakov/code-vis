import { expect, test, type Page } from '@playwright/test';
import type { DockerUpdateOperation, DockerVersionsStatus } from '../src/shared/types';

const READY = { available: true, authenticated: 'unknown', supportedModes: ['ask', 'plan', 'agent'] };
const BEFORE: DockerVersionsStatus = {
  providers: {
    claude: { version: '2.1.226', minimum: '2.1.226', latest: { version: '2.1.280', downgrade: false } },
    codex: { version: '0.156.1', minimum: '0.152.0', previous: { version: '0.152.0', downgrade: true } },
  },
  releases: { checkedAt: '2026-09-23T12:00:00.000Z' },
};
const AFTER: DockerVersionsStatus = {
  ...BEFORE,
  providers: { ...BEFORE.providers, claude: { version: '2.1.280', minimum: '2.1.226', previous: { version: '2.1.226', downgrade: true } } },
};

function operation(state: DockerUpdateOperation['state'], extra: Partial<DockerUpdateOperation> = {}): DockerUpdateOperation {
  return { id: 'update-1', provider: 'claude', version: '2.1.280', state, startedAt: '2026-09-23T12:00:00.000Z', ...extra };
}

/** Docker is ready on this machine; each health read is counted, since a switch should refresh it. */
async function dockerReady(page: Page) {
  const reads = { health: 0 };
  await page.route('**/api/health', async (route) => {
    reads.health += 1;
    const upstream = await route.fetch();
    const body = await upstream.json();
    body.executions = { local: { enabled: true, providers: body.providers }, docker: { enabled: true, providers: { claude: READY, codex: READY } } };
    await route.fulfill({ response: upstream, json: body });
  });
  return reads;
}

const rows = (page: Page) => page.getByRole('group', { name: 'Docker CLI versions' });

const FAILED_READ = { status: 503, json: { error: 'Could not read the Docker CLI versions. Check that Docker is running.' } };

for (const [when, failed] of [['the first read after starting', 0], ['a later poll', 1]] as const) {
  test(`an update keeps its progress through a failed read on ${when}, then shows the switch and refreshes readiness`, async ({ page }) => {
    const reads = await dockerReady(page);
    // Once started, reads answer in order and the last one repeats. One fails, as a phone on a weak
    // network might.
    const polls: Array<{ status: number; json: object }> = [
      { status: 200, json: { ...BEFORE, operation: operation('building') } },
      { status: 200, json: { ...BEFORE, operation: operation('checking') } },
      { status: 200, json: { ...AFTER, operation: operation('switched', { message: 'Claude 2.1.280 replaced 2.1.226. New turns use it.' }) } },
    ];
    polls.splice(failed, failed ? 0 : 1, FAILED_READ);
    let started = false;
    let read = 0;
    await page.route('**/api/execution/docker/versions*', async (route) => {
      if (route.request().method() === 'POST') {
        expect(route.request().postDataJSON()).toEqual({ provider: 'claude', target: 'latest' });
        started = true;
        await route.fulfill({ status: 202, json: { operation: operation('building') } });
        return;
      }
      await route.fulfill(started ? polls[Math.min(read++, polls.length - 1)] : { status: 200, json: BEFORE });
    });
    await page.goto('/arena');
    await expect(rows(page)).toContainText('Claude2.1.2262.1.280 available');
    const healthBefore = reads.health;
    await rows(page).getByRole('button', { name: 'Update', exact: true }).click();
    await expect(rows(page).getByRole('status')).toHaveText('Building Claude 2.1.280…');
    await expect(rows(page).getByRole('button', { name: 'Check for updates' })).toBeDisabled();
    // Arena polls every two seconds, and a failed read costs one round.
    await expect(rows(page).getByRole('status')).toHaveText('Checking Claude 2.1.280 offline…', { timeout: 10_000 });
    await expect(rows(page).getByRole('alert')).toHaveCount(0);
    await expect(rows(page).getByRole('status')).toHaveText('Claude 2.1.280 replaced 2.1.226. New turns use it.', { timeout: 10_000 });
    await expect(rows(page).getByRole('button', { name: 'Roll back to 2.1.226' })).toBeEnabled();
    // Docker Codex's model list may have changed with the worker, so readiness is read again.
    await expect.poll(() => reads.health).toBeGreaterThan(healthBefore);
  });
}

test('an update another device started is shown instead of starting a second one', async ({ page }) => {
  await dockerReady(page);
  let other = false;
  await page.route('**/api/execution/docker/versions*', async (route) => {
    if (route.request().method() === 'POST') {
      other = true;
      await route.fulfill({ status: 409, json: { error: 'Another Docker CLI update is running on this machine. Wait for it to finish.' } });
      return;
    }
    await route.fulfill({ json: other ? { ...BEFORE, operation: operation('building', { provider: 'codex', version: '0.152.0' }) } : BEFORE });
  });
  await page.goto('/arena');
  await rows(page).getByRole('button', { name: 'Update', exact: true }).click();
  await expect(rows(page).getByRole('alert')).toHaveText('Another Docker CLI update is running on this machine. Wait for it to finish.');
  await expect(rows(page).getByRole('status')).toHaveText('Building Codex 0.152.0…');
  await expect(rows(page).getByRole('button', { name: 'Update', exact: true })).toBeDisabled();
});

test('a rollback to an older version asks first, and declining sends nothing', async ({ page }) => {
  await dockerReady(page);
  const posts: unknown[] = [];
  await page.route('**/api/execution/docker/versions*', async (route) => {
    if (route.request().method() === 'POST') posts.push(route.request().postDataJSON());
    await route.fulfill({ json: BEFORE });
  });
  await page.goto('/arena');
  const messages: string[] = [];
  page.once('dialog', (dialog) => { messages.push(dialog.message()); void dialog.dismiss(); });
  await rows(page).getByRole('button', { name: 'Roll back to 0.152.0' }).click();
  expect(messages).toEqual([expect.stringContaining('The newer CLI may already have migrated Codex’s shared Docker home')]);
  await expect(rows(page).getByRole('button', { name: 'Roll back to 0.152.0' })).toBeEnabled();
  expect(posts).toEqual([]);
});
