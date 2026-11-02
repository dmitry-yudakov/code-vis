import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { CheckoutsResponse, GitWorkingTree, PublicSession } from '../src/shared/types';

async function openChanges(page: Page, request: APIRequestContext) {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const checkout = checkouts.find(item => item.name === 'alpha')!;
  const { project } = await (await request.post('/api/projects', { data: {
    name: `Push ${Date.now()}`, checkoutIds: [checkout.id],
  } })).json();
  const { session } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json() as { session: PublicSession };
  await page.goto('/');
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(project.name) }).click();
  await page.getByRole('combobox', { name: 'All sessions', exact: true }).selectOption(session.id);
  await page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name: /^Changes/ }).click();
  return checkout;
}

const mockStatus = (page: Page, tree: () => Partial<GitWorkingTree>) => page.route('**/api/repository/status?*', route => route.fulfill({ json: {
  tree: { isRepository: true, branch: 'feature/thing', files: [], ...tree() },
} }));
const toast = (page: Page, text: string | RegExp) => page.getByRole('region', { name: 'Notifications' }).locator('.toast').filter({ hasText: text });

for (const theme of ['light', 'dark']) {
  test(`pushes commits, shows progress, and leaves nothing to do: ${theme}`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    let pushed = false;
    await mockStatus(page, () => pushed ? { upstream: 'origin/feature/thing' } : { upstream: 'origin/feature/thing', pushTarget: 'origin/feature/thing', ahead: 2 });
    let finish!: () => void;
    const finishing = new Promise<void>(resolve => { finish = resolve; });
    let body: unknown;
    await page.route('**/api/repository/push', async route => {
      body = route.request().postDataJSON();
      await finishing;
      pushed = true;
      await route.fulfill({ json: { target: 'origin/feature/thing' } });
    });
    const checkout = await openChanges(page, request);
    const button = page.getByRole('button', { name: 'Push 2 commits to origin/feature/thing', exact: true });
    await expect(button).toHaveText('Push');
    await page.screenshot({ path: testInfo.outputPath('push-offered.png'), animations: 'disabled' });
    await button.click();
    await expect(button).toBeDisabled();
    await expect(button).toHaveText('Pushing…');
    finish();
    await expect(toast(page, 'Pushed to origin/feature/thing.')).toHaveAttribute('data-tone', 'success');
    await expect(button).toBeHidden();
    expect(body).toEqual({ checkoutId: checkout.id, target: 'origin/feature/thing' });
  });
}

test('publishes a branch without an upstream', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockStatus(page, () => ({ pushTarget: 'origin/feature/thing', publishes: true }));
  await page.route('**/api/repository/push', route => route.fulfill({ json: { target: 'origin/feature/thing' } }));
  await openChanges(page, request);
  const button = page.getByRole('button', { name: 'Publish this branch to origin/feature/thing', exact: true });
  await expect(button).toHaveText('Publish');
  await button.click();
  await expect(toast(page, 'Pushed to origin/feature/thing.')).toBeVisible();
});

test('does not describe a different push remote with the fetch upstream count', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockStatus(page, () => ({ upstream: 'origin/feature/thing', pushTarget: 'fork/feature/thing', ahead: 2 }));
  await openChanges(page, request);
  await expect(page.getByRole('button', { name: 'Push to fork/feature/thing', exact: true })).toBeVisible();
  await expect(page.locator('.git-branch-summary')).toContainText('↑2');
});

for (const [label, tree] of [
  ['up to date', { upstream: 'origin/feature/thing' }],
  ['local only', {}],
  ['ahead with no destination', { upstream: 'origin/feature/thing', ahead: 1 }],
] as const) {
  test(`offers nothing when ${label}`, async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockStatus(page, () => tree);
    await openChanges(page, request);
    await expect(page.locator('.git-branch-summary')).toContainText('feature/thing');
    await expect(page.locator('.git-branch-summary').getByRole('button')).toHaveCount(0);
  });
}

test('keeps a refusal on screen, refreshes status, and allows a retry', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockStatus(page, () => ({ upstream: 'origin/feature/thing', pushTarget: 'origin/feature/thing', ahead: 1 }));
  let statusReads = 0;
  page.on('request', sent => { if (sent.url().includes('/api/repository/status')) statusReads += 1; });
  await page.route('**/api/repository/push', route => route.fulfill({
    status: 409, json: { error: 'The remote has commits this branch lacks. Pull them first, then push again.' },
  }));
  await openChanges(page, request);
  const button = page.getByRole('button', { name: 'Push 1 commit to origin/feature/thing', exact: true });
  await expect(button).toBeVisible();
  const before = statusReads;
  await button.click();
  await expect(toast(page, 'Pull them first')).toHaveAttribute('data-tone', 'error');
  await expect(button).toBeEnabled();
  await expect.poll(() => statusReads).toBeGreaterThan(before);
});

test('fits a phone beside a long branch name', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('code-ai:theme', 'dark'));
  await mockStatus(page, () => ({ branch: 'feature/a-really-long-branch-name-that-cannot-fit', upstream: 'origin/x', pushTarget: 'origin/x', ahead: 12, behind: 3 }));
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const { project } = await (await request.post('/api/projects', { data: { name: `Push phone ${Date.now()}`, checkoutIds: [checkouts.find(item => item.name === 'alpha')!.id] } })).json();
  const { session } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json() as { session: PublicSession };
  await page.goto('/');
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(project.name) }).click();
  await page.getByRole('combobox', { name: 'All sessions', exact: true }).selectOption(session.id);
  await page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name: /^Changes/ }).click();
  const summary = page.locator('.git-branch-summary');
  const button = summary.getByRole('button', { name: /^Push 12 commits/ });
  await expect(button).toBeVisible();
  const [outer, inner] = await Promise.all([summary.boundingBox(), button.boundingBox()]);
  expect(inner!.x + inner!.width).toBeLessThanOrEqual(outer!.x + outer!.width);
  expect(inner!.height).toBeGreaterThanOrEqual(30);
  await page.screenshot({ path: testInfo.outputPath('push-phone.png'), animations: 'disabled' });
});

test('the real route refuses another origin and reports the real checkout', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const checkout = await openChanges(page, request);
  const refused = await request.post('/api/repository/push', {
    headers: { Origin: 'https://attacker.example' }, data: { checkoutId: checkout.id, target: 'origin/main' },
  });
  expect(refused.status()).toBe(403);
  // alpha is not a repository, so the same-origin request reaches the gate and stops there.
  const reached = await page.evaluate(async id => {
    const response = await fetch('/api/repository/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checkoutId: id, target: 'origin/main' }) });
    return { status: response.status, body: await response.json() };
  }, checkout.id);
  expect(reached.status).toBe(409);
  expect(reached.body.error).toMatch(/Git configuration|another Git operation/);
});
