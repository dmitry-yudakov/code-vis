import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { CheckoutsResponse, GitHistory, PublicSession } from '../src/shared/types';

const commit = (subject = 'Keep repository review focused', hash = 'a'.repeat(40)) => ({
  hash, subject, author: 'Alex Example', date: '2026-11-04T09:30:00+02:00',
});
const history = (subject?: string): GitHistory => ({ isRepository: true, commits: [commit(subject)], truncated: false });
const panel = (page: Page) => page.getByRole('complementary', { name: 'Repository', exact: true });
const historyTab = (page: Page) => panel(page).getByRole('tab', { name: 'History', exact: true });

async function openRepository(page: Page, request: APIRequestContext, count = 1) {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const ids = ['alpha', 'beta'].map(name => checkouts.find(item => item.name === name)!.id);
  await page.route('**/api/repository/status?*', route => route.fulfill({ json: { tree: {
    isRepository: true, branch: new URL(route.request().url()).searchParams.get('checkoutId') === ids[1] ? 'feature/beta' : 'feature/a-long-branch-name-to-check-truncation',
    files: [{ path: 'src/changed.ts', status: 'modified', staged: false, unstaged: true }],
  } } }));
  const { project } = await (await request.post('/api/projects', { data: {
    name: `Repository panel ${Date.now()}`, checkoutIds: ids.slice(0, count),
  } })).json();
  const { session } = await (await request.post('/api/sessions', { data: { projectId: project.id, provider: 'claude' } })).json() as { session: PublicSession };
  await page.goto('/');
  await page.locator('.project-search-trigger').click();
  await page.getByRole('option', { name: new RegExp(project.name) }).click();
  await page.getByRole('combobox', { name: 'All sessions', exact: true }).selectOption(session.id);
  const toggle = page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name: /^Repository/ });
  if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
  await expect(panel(page).getByRole('button', { name: 'Refresh Git status', exact: true })).toBeEnabled();
  return { ids, session };
}

for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
  test(`${theme} ${width}: compact repository, inset branch and keyboard Changes/History tabs`, async ({ page, request }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
    let reads = 0;
    await page.route('**/api/repository/history?*', route => { reads++; return route.fulfill({ json: { history: history() } }); });
    await openRepository(page, request);
    await expect(panel(page).getByRole('heading', { name: 'Repository', exact: true })).toBeVisible();
    await expect(panel(page).getByRole('region', { name: 'Session repositories' })).toBeHidden();
    await expect(panel(page).getByRole('combobox', { name: 'Current repository' })).toHaveCount(0);
    expect(reads).toBe(0);
    const [outer, branch] = await Promise.all([panel(page).boundingBox(), page.locator('.git-branch-summary').boundingBox()]);
    expect(branch!.x - outer!.x).toBeGreaterThanOrEqual(12);
    expect(outer!.x + outer!.width - branch!.x - branch!.width).toBeGreaterThanOrEqual(12);
    expect(branch!.height).toBeLessThanOrEqual(40);
    await page.screenshot({ path: testInfo.outputPath('repository-changes.png') });
    const manage = panel(page).getByRole('button', { name: 'Manage repositories', exact: true });
    await manage.click();
    await expect(page.getByRole('region', { name: 'Session repositories' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('repository-management.png') });
    await page.keyboard.press('Escape');
    await expect(manage).toBeFocused();
    const changes = panel(page).getByRole('tab', { name: /^Changes/ });
    await changes.focus();
    await page.keyboard.press('ArrowRight');
    await expect(historyTab(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(historyTab(page)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('list', { name: 'Recent commits' })).toContainText('Keep repository review focused');
    await expect(panel(page).getByRole('tabpanel')).toContainText('Alex Example');
    await expect(panel(page).getByRole('tabpanel')).toContainText('aaaaaaaa');
    expect(reads).toBe(1);
    await page.screenshot({ path: testInfo.outputPath('repository-history.png') });
    await changes.click();
    await expect(page.locator('.repository-file')).toContainText('changed.ts');
  });
}

test('manages repositories on demand and persists primary, order and removal', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { ids, session } = await openRepository(page, request);
  const manage = page.getByRole('button', { name: 'Manage repositories', exact: true });
  await manage.click();
  const form = page.getByRole('region', { name: 'Session repositories' });
  await form.getByRole('combobox', { name: 'Repository to add' }).selectOption(ids[1]);
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(form.locator('.repository-binding')).toHaveCount(2);
  await form.getByRole('button', { name: 'Make beta primary', exact: true }).click();
  await expect(form.locator('.repository-binding').filter({ hasText: 'beta' })).toContainText('primary');
  await form.getByRole('button', { name: 'Move beta up', exact: true }).click();
  await expect(form.locator('.repository-binding strong')).toHaveText(['beta', 'alpha']);
  await page.keyboard.press('Escape');
  await panel(page).getByRole('combobox', { name: 'Current repository' }).selectOption(ids[0]);
  await expect(page.locator('.git-branch-summary')).toContainText('feature/a-long');
  await manage.click();
  await form.getByRole('button', { name: 'Remove alpha', exact: true }).click();
  await expect(form.locator('.repository-binding')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(panel(page).getByRole('combobox', { name: 'Current repository' })).toHaveCount(0);
  await expect.poll(async () => {
    const data = await (await request.get(`/api/sessions/${session.id}`)).json() as { session: PublicSession };
    return data.session.repositories.map(item => [item.checkoutId, item.role]);
  }).toEqual([[ids[1], 'primary']]);
  await page.reload();
  await expect(panel(page).locator('.repository-name')).toHaveText('beta');
  await expect(page.getByRole('region', { name: 'Session repositories' })).toBeHidden();
});

test('shows the first-repository form directly and hides it once attached', async ({ page, request }) => {
  const { ids, session } = await openRepository(page, request, 0);
  const form = page.getByRole('region', { name: 'Session repositories' });
  await expect(form).toBeVisible();
  await form.getByRole('combobox', { name: 'Repository to add' }).selectOption(ids[0]);
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole('button', { name: 'Manage repositories', exact: true })).toBeVisible();
  const data = await (await request.get(`/api/sessions/${session.id}`)).json() as { session: PublicSession };
  expect(data.session.repositories[0].role).toBe('primary');
});

test('retains selected-file review across History and Changes', async ({ page, request }) => {
  await page.setViewportSize({ width: 1720, height: 900 });
  await page.route('**/api/repository/history?*', route => route.fulfill({ json: { history: history() } }));
  await page.route('**/api/repository/diff?*', route => route.fulfill({ json: { diff: {
    path: 'src/changed.ts', unstaged: '@@ -1 +1 @@\n-before\n' + '+after\n'.repeat(200),
  } } }));
  await openRepository(page, request);
  await page.locator('.repository-file').click();
  const inspector = page.getByRole('region', { name: 'Changes in src/changed.ts', exact: true });
  await expect(inspector).toBeVisible();
  await inspector.getByRole('button', { name: 'Wrap text', exact: true }).click();
  await inspector.locator('.diff-inspector-scroll').evaluate(node => { node.scrollTop = 300; });
  await historyTab(page).click();
  await expect(inspector).toBeHidden();
  await expect(page.getByRole('list', { name: 'Recent commits' })).toBeVisible();
  await panel(page).getByRole('tab', { name: /^Changes/ }).click();
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Wrap text', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(await inspector.locator('.diff-inspector-scroll').evaluate(node => node.scrollTop)).toBe(300);
  await expect(page.locator('.repository-file')).toHaveAttribute('aria-pressed', 'true');
});

test('automatically refreshes on Repository activation and coalesces browser activation signals', async ({ page, request }) => {
  await openRepository(page, request);
  await expect(page.locator('.repository-file')).toBeVisible();
  let reads = 0;
  await page.route('**/api/repository/status?*', route => {
    reads++;
    return route.fulfill({ json: { tree: { isRepository: true, branch: `activation-${reads}`, files: [] } } });
  });
  const toggle = page.getByRole('navigation', { name: 'Views', exact: true }).getByRole('button', { name: /^Repository/ });
  await toggle.click();
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(250);
  expect(reads).toBe(0);
  await toggle.click();
  await expect(page.locator('.git-branch-summary')).toContainText('activation-1');
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await expect(page.locator('.git-branch-summary')).toContainText('activation-2');
  await page.waitForTimeout(250);
  expect(reads).toBe(2);
});

test('automatic refresh keeps the open diff, wrapping and scroll while reading unchanged file metadata', async ({ page, request }) => {
  await page.setViewportSize({ width: 1720, height: 900 });
  let version = 'before refresh';
  let release!: () => void;
  let held: Promise<void> | undefined;
  await page.route('**/api/repository/diff?*', async route => {
    const text = version;
    await held;
    await route.fulfill({ json: { diff: { path: 'src/changed.ts', unstaged: `@@ -1 +1 @@\n-old\n+${text}\n` + '+line\n'.repeat(200) } } });
  });
  await openRepository(page, request);
  await page.locator('.repository-file').click();
  const inspector = page.getByRole('region', { name: 'Changes in src/changed.ts', exact: true });
  await expect(inspector).toContainText('before refresh');
  await inspector.getByRole('button', { name: 'Wrap text', exact: true }).click();
  await inspector.locator('.diff-inspector-scroll').evaluate(node => { node.scrollTop = 300; });
  version = 'after refresh';
  held = new Promise<void>(resolve => { release = resolve; });
  const reading = page.waitForRequest('**/api/repository/diff?*');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await reading;
  await expect(inspector).toContainText('before refresh');
  expect(await inspector.locator('.diff-inspector-scroll').evaluate(node => node.scrollTop)).toBe(300);
  release();
  await expect(inspector).toContainText('after refresh');
  await expect(inspector.getByRole('button', { name: 'Wrap text', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(await inspector.locator('.diff-inspector-scroll').evaluate(node => node.scrollTop)).toBe(300);
  await expect(page.locator('.repository-file')).toHaveAttribute('aria-pressed', 'true');
  await page.route('**/api/repository/status?*', route => route.fulfill({ json: { tree: { isRepository: true, branch: 'main', files: [] } } }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(inspector).toHaveCount(0);
  await expect(panel(page)).toContainText('Nothing to review');
});

test('automatic refresh serializes reads and coalesces requests during an in-flight read', async ({ page, request }) => {
  await openRepository(page, request);
  let reads = 0;
  let inFlight = 0;
  let maximumInFlight = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/repository/status?*', async route => {
    const read = ++reads;
    maximumInFlight = Math.max(maximumInFlight, ++inFlight);
    if (read === 1) await held;
    await route.fulfill({ json: { tree: { isRepository: true, branch: `serialized-${read}`, files: [] } } });
    inFlight--;
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => reads).toBe(1);
  for (let burst = 0; burst < 2; burst++) {
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await page.waitForTimeout(200);
  }
  expect(reads).toBe(1);
  release();
  await expect(page.locator('.git-branch-summary')).toContainText('serialized-2');
  await page.waitForTimeout(200);
  expect(reads).toBe(2);
  expect(maximumInFlight).toBe(1);
});

test('automatic refresh ignores a late status response after switching checkouts', async ({ page, request }) => {
  const { ids } = await openRepository(page, request, 2);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/repository/status?*', async route => {
    const alpha = new URL(route.request().url()).searchParams.get('checkoutId') === ids[0];
    if (alpha) await held;
    await route.fulfill({ json: { tree: { isRepository: true, branch: alpha ? 'stale-alpha' : 'current-beta', files: [] } } });
  });
  const reading = page.waitForRequest('**/api/repository/status?*');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await reading;
  await panel(page).getByRole('combobox', { name: 'Current repository' }).selectOption(ids[1]);
  await expect(page.locator('.git-branch-summary')).toContainText('current-beta');
  release();
  await expect(page.locator('.git-branch-summary')).not.toContainText('stale-alpha');
});

test('automatic refresh waits while the browser tab is hidden and recovers after failure', async ({ page, request }) => {
  await openRepository(page, request);
  let reads = 0;
  await page.route('**/api/repository/status?*', route => {
    reads++;
    return route.fulfill(reads === 1 ? { status: 400, json: { error: 'Repository is busy.' } }
      : { json: { tree: { isRepository: true, branch: 'recovered', files: [] } } });
  });
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await page.waitForTimeout(200);
  expect(reads).toBe(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(panel(page)).toContainText('Repository is busy.');
  await panel(page).getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.git-branch-summary')).toContainText('recovered');
  expect(reads).toBe(2);
});

test('automatic status failure retains file review and permits independent history retry', async ({ page, request }) => {
  await page.setViewportSize({ width: 1720, height: 900 });
  let historyReads = 0;
  await page.route('**/api/repository/history?*', route => {
    historyReads++;
    return route.fulfill(historyReads === 1 ? { status: 400, json: { error: 'History failed once.' } }
      : { json: { history: history('History recovered despite status failure') } });
  });
  await page.route('**/api/repository/diff?*', route => route.fulfill({ json: { diff: {
    path: 'src/changed.ts', unstaged: '@@ -1 +1 @@\n-before\n' + '+after\n'.repeat(200),
  } } }));
  await openRepository(page, request);
  await page.locator('.repository-file').click();
  const inspector = page.getByRole('region', { name: 'Changes in src/changed.ts', exact: true });
  await expect(inspector).toContainText('+after');
  await inspector.getByRole('button', { name: 'Wrap text', exact: true }).click();
  await inspector.locator('.diff-inspector-scroll').evaluate(node => { node.scrollTop = 300; });
  await page.route('**/api/repository/status?*', route => route.fulfill({ status: 400, json: { error: 'Status is temporarily busy.' } }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(panel(page)).toContainText('Status is temporarily busy.');
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Wrap text', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(await inspector.locator('.diff-inspector-scroll').evaluate(node => node.scrollTop)).toBe(300);
  await historyTab(page).click();
  await expect(panel(page)).toContainText('History failed once.');
  await panel(page).getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(panel(page)).toContainText('History recovered despite status failure');
  await expect(panel(page)).toContainText('Status is temporarily busy.');
  await panel(page).getByRole('tab', { name: /^Changes/ }).click();
  await expect(inspector).toBeVisible();
  expect(await inspector.locator('.diff-inspector-scroll').evaluate(node => node.scrollTop)).toBe(300);
});

test('automatic history refresh keeps the list and scroll while its new snapshot loads', async ({ page, request }) => {
  let reads = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/repository/history?*', async route => {
    const read = ++reads;
    if (read === 2) await held;
    await route.fulfill({ json: { history: { isRepository: true, truncated: false,
      commits: Array.from({ length: 100 }, (_, index) => commit(`Snapshot ${read}, commit ${index}`, index.toString(16).padStart(40, '0'))),
    } } });
  });
  await openRepository(page, request);
  await historyTab(page).click();
  const list = page.getByRole('list', { name: 'Recent commits' });
  await expect(list).toContainText('Snapshot 1, commit 0');
  const scroll = panel(page).locator('.repository-summary-scroll');
  await scroll.evaluate(node => { node.scrollTop = 300; });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => reads).toBe(2);
  await expect(list).toContainText('Snapshot 1, commit 0');
  expect(await scroll.evaluate(node => node.scrollTop)).toBe(300);
  release();
  await expect(list).toContainText('Snapshot 2, commit 0');
  expect(await scroll.evaluate(node => node.scrollTop)).toBe(300);
});

test('retries failed history, refreshes it, and announces the recent-history limit', async ({ page, request }) => {
  let reads = 0;
  await page.route('**/api/repository/history?*', route => {
    reads++;
    return route.fulfill(reads === 1 ? { status: 400, json: { error: 'Git history is busy. Try again.' } }
      : { json: { history: { ...history(`Read ${reads}`), truncated: true } } });
  });
  await openRepository(page, request);
  await historyTab(page).click();
  await expect(panel(page).getByRole('alert')).toContainText('Git history is busy. Try again.');
  await panel(page).getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(panel(page)).toContainText('Read 2');
  await expect(panel(page)).toContainText('Showing the latest 100 commits on this branch.');
  await panel(page).getByRole('button', { name: 'Refresh Git status', exact: true }).click();
  await expect(panel(page)).toContainText('Read 3');
});

test('ignores a late history response after switching repositories', async ({ page, request }) => {
  const { ids } = await openRepository(page, request, 2);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/repository/history?*', async route => {
    const alpha = new URL(route.request().url()).searchParams.get('checkoutId') === ids[0];
    if (alpha) await held;
    await route.fulfill({ json: { history: history(alpha ? 'Stale alpha' : 'Current beta') } });
  });
  await historyTab(page).click();
  await expect(panel(page).getByRole('status')).toContainText('Reading Git history');
  await panel(page).getByRole('combobox', { name: 'Current repository' }).selectOption(ids[1]);
  await expect(panel(page)).toContainText('Current beta');
  release();
  await expect(panel(page)).not.toContainText('Stale alpha');
});

for (const isRepository of [true, false]) test(`history explains an empty ${isRepository ? 'branch' : 'non-Git folder'}`, async ({ page, request }) => {
  await page.route('**/api/repository/history?*', route => route.fulfill({ json: { history: { isRepository, commits: [], truncated: false } } }));
  await openRepository(page, request);
  await historyTab(page).click();
  await expect(panel(page)).toContainText(isRepository ? 'No commits yet' : 'Not a Git repository');
});

test('the real history route accepts a known checkout and rejects an unknown one', async ({ request }) => {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  const response = await request.get(`/api/repository/history?checkoutId=${checkouts.find(item => item.name === 'alpha')!.id}`);
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ history: { isRepository: false, commits: [], truncated: false } });
  expect((await request.get('/api/repository/history?checkoutId=unknown')).status()).toBe(400);
});

test('loads Git history when an unavailable saved Reports view falls back to Repository', async ({ page, request }) => {
  await page.route('**/api/repository/history?*', route => route.fulfill({ json: { history: history('History after Reports fallback') } }));
  const { session } = await openRepository(page, request);
  await page.evaluate(id => {
    const key = 'code-ai:device:v1:view-panel-layouts';
    const stored = JSON.parse(localStorage.getItem(key)!);
    stored.layouts[id].sideTab = 'reports';
    localStorage.setItem(key, JSON.stringify(stored));
  }, session.id);
  await page.reload();
  await expect(panel(page).getByRole('heading', { name: 'Repository', exact: true })).toBeVisible();
  await historyTab(page).click();
  await expect(panel(page)).toContainText('History after Reports fallback', { timeout: 3000 });
});

test('phone history scrolls through 100 commits with branch and tabs still in reach', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/repository/history?*', route => route.fulfill({ json: { history: {
    isRepository: true, truncated: true,
    commits: Array.from({ length: 100 }, (_, i) => commit(`Commit ${i + 1}`, i.toString(16).padStart(40, '0'))),
  } } }));
  await openRepository(page, request);
  await historyTab(page).click();
  const scroll = panel(page).locator('.repository-summary-scroll');
  await expect(page.getByRole('list', { name: 'Recent commits' }).getByRole('listitem')).toHaveCount(100);
  expect(await scroll.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await scroll.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect(panel(page).getByText('Commit 100', { exact: true })).toBeInViewport();
  await expect(panel(page).getByText('Showing the latest 100 commits on this branch.', { exact: true })).toBeInViewport();
  await expect(historyTab(page)).toBeInViewport();
  await expect(page.locator('.git-branch-summary')).toBeInViewport();
  await panel(page).getByRole('tab', { name: /^Changes/ }).click();
  await expect(page.locator('.repository-file')).toBeInViewport();
});
