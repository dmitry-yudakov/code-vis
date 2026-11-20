import { sessionTab } from './session-tabs';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { CheckoutsResponse } from '../src/shared/types';

const execute = promisify(execFile);
const picker = (page: Page) => page.getByRole('button', { name: /^Switch branch:/ });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Switch branch', exact: true });
const listing = (current = 'main') => ({ head: `${current}:abc`, current, branches: [
  { name: 'feature/a-long-branch-name-for-the-picker', occupied: false },
  { name: 'main', occupied: current === 'main' },
  { name: 'occupied', occupied: true },
] });

async function openRepository(page: Page, request: APIRequestContext, checkoutId?: string) {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  checkoutId ||= checkouts.find(item => item.name === 'alpha')!.id;
  const { project } = await (await request.post('/api/projects', { data: { name: `Branches ${Date.now()}`, checkoutIds: [checkoutId] } })).json();
  const { session } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json();
  await page.goto('/');
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(project.name) }).click();
  await sessionTab(page, session.id).click();
  const toggle = page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name: /^Repository/ });
  if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
  await expect(picker(page)).toBeEnabled();
  return checkoutId;
}

for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
  test(`${theme} ${width}: search and switch branches, refresh History and preserve keyboard access`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    let current = 'main'; let posts = 0; let reads = 0;
    await page.route('**/api/repository/status?*', route => route.fulfill({ json: { tree: { isRepository: true, branch: current, files: [] } } }));
    await page.route('**/api/repository/history?*', route => route.fulfill({ json: { history: { isRepository: true, truncated: false,
      commits: [{ hash: 'a'.repeat(40), subject: `Commit on ${current}`, author: 'Fixture', date: '2026-11-11T10:00:00Z' }],
    } } }));
    await page.route('**/api/repository/branches*', async route => {
      if (route.request().method() === 'GET') { reads++; await route.fulfill({ json: { branches: listing(current) } }); }
      else {
        posts++; const data = route.request().postDataJSON();
        expect(data.head).toBe('main:abc'); current = data.branch;
        await route.fulfill({ json: { branch: current } });
      }
    });
    await openRepository(page, request);
    expect(reads).toBe(0);
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    await expect(page.getByRole('list', { name: 'Recent commits' })).toContainText('Commit on main');
    await picker(page).focus(); await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByText('In another worktree', { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Find local branch' }).fill('feature');
    await expect(dialog(page).getByText('occupied', { exact: true })).toHaveCount(0);
    await expect(page.locator('.MuiDialog-container').filter({ has: dialog(page) })).toHaveCSS('opacity', '1');
    await page.screenshot({ path: testInfo.outputPath('branch-picker.png'), animations: 'disabled' });
    await dialog(page).getByRole('button', { name: 'feature/a-long-branch-name-for-the-picker', exact: true }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(picker(page)).toHaveAccessibleName('Switch branch: feature/a-long-branch-name-for-the-picker');
    await expect(page.getByRole('list', { name: 'Recent commits' })).toContainText('Commit on feature/');
    expect(posts).toBe(1);
    await page.screenshot({ path: testInfo.outputPath('branch-switched.png') });
    await picker(page).click(); await page.keyboard.press('Escape'); await expect(picker(page)).toBeFocused();
  });
}

test('branch list and switch failures recover, with only one pending mutation', async ({ page, request }) => {
  let current = 'main'; let failedList = true; let failedSwitch = true; let posts = 0;
  let finish: (() => void) | undefined;
  await page.route('**/api/repository/status?*', route => route.fulfill({ json: { tree: { isRepository: true, branch: current, files: [] } } }));
  await page.route('**/api/repository/branches*', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill(failedList ? { status: 409, json: { error: 'Git is busy. Retry.' } } : { json: { branches: listing(current) } });
    } else {
      posts++;
      if (failedSwitch) await route.fulfill({ status: 409, json: { error: 'Local changes would be overwritten. Commit or stash them.' } });
      else {
        await new Promise<void>(resolve => { finish = resolve; });
        current = route.request().postDataJSON().branch;
        await route.fulfill({ json: { branch: current } });
      }
    }
  });
  await openRepository(page, request); await picker(page).click();
  await expect(dialog(page).getByRole('alert')).toContainText('Git is busy');
  failedList = false; await dialog(page).getByRole('button', { name: 'Refresh branches' }).click();
  const target = dialog(page).getByRole('button', { name: 'feature/a-long-branch-name-for-the-picker', exact: true });
  await target.click();
  await expect(dialog(page).getByRole('alert')).toContainText('Local changes');
  await expect(page.locator('.repository-branch-picker')).toHaveAttribute('aria-label', 'Switch branch: main');
  failedSwitch = false; await target.click();
  await expect(target).toBeDisabled();
  await expect(dialog(page).getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(dialog(page)).toBeVisible();
  expect(posts).toBe(2); finish!();
  await expect(dialog(page)).toBeHidden();
  await expect(picker(page)).toHaveAccessibleName('Switch branch: feature/a-long-branch-name-for-the-picker');
});

test('real branch route switches a disposable checkout and preserves conflicting edits', async ({ page, request }) => {
  const repository = await mkdtemp(path.resolve('test/fixtures/projects/branch-switch-'));
  const git = (...args: string[]) => execute('git', args, { cwd: repository });
  try {
    await git('init', '-q', '-b', 'main');
    await git('config', 'user.name', 'Fixture'); await git('config', 'user.email', 'fixture@example.invalid');
    await writeFile(path.join(repository, 'file.txt'), 'main\n'); await git('add', '.'); await git('commit', '-qm', 'main');
    await git('switch', '-qc', 'feature'); await writeFile(path.join(repository, 'file.txt'), 'feature\n'); await git('commit', '-qam', 'feature');
    await git('switch', '-q', 'main');
    const response = await request.get('/api/checkouts');
    const { checkouts } = await response.json() as CheckoutsResponse;
    const checkoutId = checkouts.find(item => item.name === path.basename(repository))!.id;
    await openRepository(page, request, checkoutId);
    await picker(page).click();
    await dialog(page).getByRole('button', { name: 'feature', exact: true }).click();
    await expect(picker(page)).toHaveAccessibleName('Switch branch: feature');
    expect(await readFile(path.join(repository, 'file.txt'), 'utf8')).toBe('feature\n');
    await writeFile(path.join(repository, 'file.txt'), 'local work\n');
    await picker(page).click(); await dialog(page).getByRole('button', { name: 'main', exact: true }).click();
    await expect(dialog(page).getByRole('alert')).toContainText('would be overwritten');
    expect(await readFile(path.join(repository, 'file.txt'), 'utf8')).toBe('local work\n');
    expect((await git('branch', '--show-current')).stdout.trim()).toBe('feature');
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.repository-file')).toContainText('file.txt');
  } finally { await rm(repository, { recursive: true, force: true }); }
});
