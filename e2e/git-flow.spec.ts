import { sessionTab } from './session-tabs';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { CheckoutsResponse } from '../src/shared/types';

const execute = promisify(execFile);
const repositoryPanel = (page: Page) => page.getByRole('complementary', { name: 'Repository', exact: true });
async function fixture(page: Page, request: APIRequestContext) {
  const cwd = await mkdtemp(path.resolve('test/fixtures/projects/git-flow-'));
  const git = async (...args: string[]) => (await execute('git', args, { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } })).stdout.trim();
  await git('init', '-q', '-b', 'main'); await git('config', 'user.name', 'Browser Owner'); await git('config', 'user.email', 'browser@example.invalid');
  await writeFile(path.join(cwd, 'tracked.txt'), 'original\n'); await git('add', '.'); await git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'Initial');
  await writeFile(path.join(cwd, 'tracked.txt'), 'changed\n'); await writeFile(path.join(cwd, 'new.txt'), 'new file\n');
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const checkout = checkouts.find(item => item.name === path.basename(cwd))!;
  expect(checkout).toBeDefined();
  const { project } = await (await request.post('/api/projects', { data: { name: path.basename(cwd), checkoutIds: [checkout.id] } })).json();
  const { session } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json();
  await page.goto('/');
  await page.locator('.project-search-trigger').click(); await page.getByRole('option', { name: new RegExp(project.name) }).click();
  await sessionTab(page, session.id).click();
  const toggle = page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name: /^Repository/ });
  if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
  await expect(repositoryPanel(page).getByRole('button', { name: 'Stage all', exact: true })).toBeEnabled();
  return { cwd, git, checkoutId: checkout.id };
}

for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
  test(`${theme} ${width}: stage, unstage, commit only the index and inspect history details`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    const { cwd, git } = await fixture(page, request);
    try {
      const panel = repositoryPanel(page);
      await expect(panel.getByRole('button', { name: 'Commit staged', exact: true })).toBeDisabled();
      await panel.getByRole('textbox', { name: 'Commit message' }).fill('Save chosen file\n\nA full commit body ✓');
      await panel.getByRole('tab', { name: 'History', exact: true }).click();
      await panel.getByRole('tab', { name: /^Changes/ }).click();
      await expect(panel.getByRole('textbox', { name: 'Commit message' })).toHaveValue('Save chosen file\n\nA full commit body ✓');
      await panel.getByRole('button', { name: 'Stage tracked.txt', exact: true }).click();
      await expect(panel.getByRole('button', { name: 'Unstage tracked.txt', exact: true })).toBeEnabled();
      await panel.getByRole('button', { name: 'Unstage tracked.txt', exact: true }).click();
      await expect(panel.getByRole('button', { name: 'Stage tracked.txt', exact: true })).toBeEnabled();
      await panel.getByRole('button', { name: 'Stage all', exact: true }).click();
      await expect(panel.getByRole('button', { name: 'Commit staged (2)', exact: true })).toBeEnabled();
      await panel.getByRole('button', { name: 'Unstage all', exact: true }).click();
      await expect(panel.getByRole('button', { name: 'Commit staged', exact: true })).toBeDisabled();
      await panel.getByRole('button', { name: 'Stage tracked.txt', exact: true }).click();
      await expect(panel.getByRole('button', { name: 'Commit staged (1)', exact: true })).toBeEnabled();
      await writeFile(path.join(cwd, 'tracked.txt'), 'later work\n');
      await page.screenshot({ path: testInfo.outputPath('git-staging.png') });
      await panel.getByRole('button', { name: 'Commit staged (1)', exact: true }).click();
      await expect(panel.getByRole('alert')).toContainText('Committed');
      await expect(panel.getByRole('textbox', { name: 'Commit message' })).toHaveValue('');
      expect(await git('show', 'HEAD:tracked.txt')).toBe('changed');
      expect(await readFile(path.join(cwd, 'tracked.txt'), 'utf8')).toBe('later work\n');
      expect(await git('status', '--porcelain')).toContain('?? new.txt');
      await panel.getByRole('tab', { name: 'History', exact: true }).click();
      const row = panel.getByRole('button', { name: /Save chosen file/ });
      await row.click();
      const hash = await git('rev-parse', 'HEAD');
      const details = panel.getByRole('region', { name: `Commit ${hash.slice(0, 8)} details`, exact: true });
      await expect(details).toContainText('A full commit body ✓');
      await expect(details).toContainText('browser@example.invalid');
      await details.getByRole('button', { name: 'M tracked.txt', exact: true }).click();
      await expect(details.getByRole('region', { name: 'Commit changes in tracked.txt', exact: true })).toContainText('+changed');
      await expect(details).not.toContainText('+later work');
      await page.screenshot({ path: testInfo.outputPath('git-commit-details.png') });
      const bounds = await details.boundingBox(); const outer = await panel.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(outer!.x); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(outer!.x + outer!.width + 1);
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
}

test('stages and commits with a stale worktree registration', async ({ page, request }) => {
  const { cwd, git } = await fixture(page, request);
  const sibling = await mkdtemp(`${cwd}-temporary-`);
  try {
    await git('worktree', 'add', '--detach', '-q', sibling);
    await rm(sibling, { recursive: true });
    await git('config', 'gitg.mainline', 'main');
    const panel = repositoryPanel(page);
    await panel.getByRole('button', { name: 'Stage tracked.txt', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Unstage tracked.txt', exact: true })).toBeEnabled();
    await panel.getByRole('textbox', { name: 'Commit message' }).fill('Commit with a stale worktree');
    await panel.getByRole('button', { name: 'Commit staged (1)', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('Committed');
    expect(await git('show', 'HEAD:tracked.txt')).toBe('changed');
    expect(await git('worktree', 'list', '--porcelain')).toContain('prunable');
  } finally {
    await rm(sibling, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

test('staging/commit failures preserve drafts, allow retry and prevent duplicate submissions', async ({ page, request }) => {
  const { cwd, git } = await fixture(page, request);
  try {
    const panel = repositoryPanel(page);
    await page.route('**/api/repository/index', route => route.fulfill({ status: 409, json: { error: 'Checkout busy. Retry after the turn finishes.' } }));
    await panel.getByRole('button', { name: 'Stage tracked.txt', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('Checkout busy');
    await page.unroute('**/api/repository/index');
    await panel.getByRole('button', { name: 'Stage tracked.txt', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Unstage tracked.txt', exact: true })).toBeEnabled();
    await panel.getByRole('textbox', { name: 'Commit message' }).fill('Keep this draft');
    let calls = 0; let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/repository/commit', async route => { calls++; await held; await route.fulfill({ status: 409, json: { error: 'The branch or staged changes changed. Refresh Changes and retry.' } }); });
    await panel.getByRole('button', { name: 'Commit staged (1)', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Commit staged (1)', exact: true })).toBeDisabled();
    await expect(panel.getByRole('button', { name: 'Stage all', exact: true })).toBeDisabled();
    release();
    await expect(panel.getByRole('alert')).toContainText('staged changes changed'); expect(calls).toBe(1);
    await expect(panel.getByRole('textbox', { name: 'Commit message' })).toHaveValue('Keep this draft');
    await page.unroute('**/api/repository/commit');
    await panel.getByRole('button', { name: 'Commit staged (1)', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('Committed'); expect(await git('rev-list', '--count', 'HEAD')).toBe('2');
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('commit details and patches recover independently from failed reads', async ({ page, request }) => {
  const { cwd, git } = await fixture(page, request);
  try {
    const panel = repositoryPanel(page); const hash = await git('rev-parse', 'HEAD');
    let detailsFail = true; let patchFail = true;
    await page.route('**/api/repository/commit?*', async route => {
      const query = new URL(route.request().url()).searchParams;
      if (query.has('path') ? patchFail : detailsFail) return route.fulfill({ status: 400, json: { error: 'Read failed. Try again.' } });
      return route.continue();
    });
    await panel.getByRole('tab', { name: 'History', exact: true }).click();
    await panel.getByRole('button', { name: /Initial/ }).click();
    const details = panel.getByRole('region', { name: `Commit ${hash.slice(0, 8)} details`, exact: true });
    await expect(details.getByRole('alert')).toContainText('Read failed'); detailsFail = false;
    await details.getByRole('button', { name: 'Retry', exact: true }).click();
    await details.getByRole('button', { name: 'A tracked.txt', exact: true }).click();
    await expect(details.getByRole('alert')).toContainText('Read failed'); patchFail = false;
    await details.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(details.getByLabel('Unified diff')).toContainText('+original');
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
