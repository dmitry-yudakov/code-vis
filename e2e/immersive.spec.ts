import { expect, test, type Page } from '@playwright/test';
import type { ArenaMachineSnapshot, DurableProject, PublicSession } from '../src/shared/types';

const LOCAL = '11111111-1111-4111-8111-111111111111';
const REMOTE = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const REMOTE_PROJECT = '44444444-4444-4444-8444-444444444444';
const SESSION = '55555555-5555-4555-8555-555555555555';
const EMPTY = '66666666-6666-4666-8666-666666666666';
const AGENT = '77777777-7777-4777-8777-777777777777';
const NOW = '2026-09-08T12:00:00.000Z';

declare global {
  interface Window {
    xrFixture: {
      entries: number; ends: number; destroys: number; listeners: number;
      reject: boolean; pending: boolean; resolve?: () => void; systemEnd?: () => void;
    };
  }
}

async function installAdapter(page: Page, options: { supported?: boolean; failImport?: boolean } = {}) {
  await page.addInitScript(({ supported, failImport }) => {
    const stats = window.xrFixture = { entries: 0, ends: 0, destroys: 0, listeners: 0, reject: false, pending: false } as Window['xrFixture'];
    window.__CODEAI_XR_TEST__ = {
      failXRImport: failImport,
      adapter: {
        async isSessionSupported() { return supported !== false; },
        async enterVR() {
          stats.entries++;
          if (stats.reject) throw new DOMException('User denied access', 'NotAllowedError');
          const listeners = { end: new Set<() => void>(), visibilitychange: new Set<() => void>() };
          const session = {
            async end() { stats.ends++; for (const listener of listeners.end) listener(); },
            addEventListener(type: 'end' | 'visibilitychange', listener: () => void) { listeners[type].add(listener); stats.listeners++; },
            removeEventListener(type: 'end' | 'visibilitychange', listener: () => void) { if (listeners[type].delete(listener)) stats.listeners--; },
          };
          stats.systemEnd = () => { for (const listener of listeners.end) listener(); };
          if (stats.pending) await new Promise<void>((resolve) => { stats.resolve = resolve; });
          return session;
        },
        destroy() { stats.destroys++; },
      },
    };
  }, options);
}

async function workspaceFixture(page: Page) {
  const state = { online: true, failLoad: false, authenticated: true, holdLoad: undefined as Promise<void> | undefined };
  const project = (id: string, name: string): DurableProject => ({ version: 1, revision: 0, id, name, repositories: [], createdAt: NOW, updatedAt: NOW });
  const session = (id: string, projectId: string, title: string): PublicSession => ({
    version: 3, revision: 0, id, projectId, title, repositories: [], createdAt: NOW, updatedAt: NOW,
    participants: [
      { id: `${id}:human`, kind: 'human', displayName: 'You' },
      { id: AGENT, kind: 'agent', displayName: 'Claude', provider: 'claude', role: 'coder', defaultMode: 'plan' },
    ],
    primaryAgentId: AGENT, messages: [], annotations: {}, sketches: [], pinnedDiagramIds: [],
  });
  const local = session(SESSION, PROJECT, 'Canvas session');
  local.sketches = [{ id: 'sketch-fixture', ordinal: 1, sessionId: SESSION, createdAt: NOW, viewBox: [0, 0, 1600, 1000] }];
  const remote = session(EMPTY, REMOTE_PROJECT, 'Empty remote session');
  const snapshot = (id: string, name: string, item: PublicSession): ArenaMachineSnapshot => ({
    machine: { id, label: name, kind: id === LOCAL ? 'local' : 'remote', state: id === REMOTE && !state.online ? 'offline' : 'online', lastSeenAt: NOW },
    projects: [project(item.projectId!, id === LOCAL ? 'Local project' : 'Remote project')],
    checkouts: [], recentCheckoutIds: [],
    providers: { claude: { available: true, authenticated: true, supportedModes: ['ask', 'plan'] }, codex: { available: false, authenticated: 'unknown', supportedModes: [] } },
    sessions: [{ id: item.id, projectId: item.projectId, revision: 0, title: item.title, repositoryCheckoutIds: [], agents: [], updatedAt: NOW }],
    archivedSessions: [], runs: { active: [], recent: [] },
  });
  await page.route('**/api/auth/status', (route) => route.fulfill({ json: { mode: 'paired', authenticated: state.authenticated, transportSecure: true, hostLabel: 'Home' } }));
  await page.route('**/api/projects', (route) => route.fulfill({ json: { projects: [project(PROJECT, 'Local project')] } }));
  await page.route('**/api/checkouts', (route) => route.fulfill({ json: { hostId: LOCAL, checkouts: [], recentCheckoutIds: [] } }));
  await page.route('**/api/arena', (route) => route.fulfill({ json: { machines: [snapshot(LOCAL, 'Home', local), snapshot(REMOTE, 'Laptop', remote)] } }));
  await page.route('**/api/agent/runs*', (route) => route.fulfill({ json: { active: [], recent: [] } }));
  await page.route('**/api/sessions?*', (route) => route.fulfill({ json: { sessions: [local] } }));
  await page.route(`**/api/sessions/${SESSION}`, (route) => route.fulfill({ json: { session: local } }));
  await page.route(`**/api/machines/${REMOTE}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/sessions')) {
      await state.holdLoad;
      await route.fulfill(state.failLoad ? { status: 503, json: { error: 'Remote session loading failed' } } : { json: { sessions: [remote] } });
    } else if (path.endsWith(`/sessions/${EMPTY}`)) await route.fulfill({ json: { session: remote } });
    else await route.fulfill({ json: { active: [], recent: [] } });
  });
  return state;
}

const controls = (page: Page) => page.getByRole('group', { name: 'Immersive workspace controls' });
const openSession = (page: Page, id: string) => controls(page).locator(`[data-immersive-session="${id}"]`).click();
async function enter(page: Page) {
  await page.getByRole('button', { name: 'Enter VR', exact: true }).click();
  await expect(controls(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__?.sessionActive)).toBe(true);
}
async function released(page: Page) {
  await expect.poll(() => page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__?.sessionActive)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__?.liveResources)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.xrFixture.listeners)).toBe(0);
}

for (const location of ['Arena', 'Inbox', 'Flat', 'Spatial', 'Empty'] as const) {
  test(`enters once from ${location} without changing the desktop canvas selection`, async ({ page }) => {
    await installAdapter(page);
    await workspaceFixture(page);
    await page.goto(location === 'Arena' ? '/arena' : location === 'Inbox' ? '/arena/inbox' : '/');
    if (location === 'Spatial') await page.getByRole('button', { name: 'Spatial', exact: true }).click();
    if (location === 'Empty') {
      await page.getByRole('link', { name: 'Arena', exact: true }).click();
      await page.getByRole('button', { name: 'Open Empty remote session', exact: true }).click();
      await expect(page.locator('.empty-canvas')).toBeVisible();
    }
    await expect(page.locator('.app-loading')).toHaveCount(0);
    const before = await page.evaluate(() => localStorage.getItem('code-ai:device:v1:workspace'));
    await enter(page);
    expect(await page.evaluate(() => window.xrFixture.entries)).toBe(1);
    await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click();
    await released(page);
    expect(await page.evaluate(() => window.xrFixture.ends)).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem('code-ai:device:v1:workspace'))).toBe(before);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Enter VR', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => window.xrFixture.entries)).toBe(0);
  });
}

test('retains one XR store across machine/project navigation, loading races, history, failure and Offline', async ({ page }) => {
  await installAdapter(page);
  const state = await workspaceFixture(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open conversation', exact: true }).click();
  await page.getByRole('complementary', { name: 'Conversation' }).locator('textarea').fill('Keep this local draft');
  await enter(page);
  let resolveLoad!: () => void;
  state.holdLoad = new Promise<void>((resolve) => { resolveLoad = resolve; });
  await openSession(page, EMPTY);
  await expect(controls(page).getByRole('status')).toHaveText('Loading session…');
  await openSession(page, SESSION);
  resolveLoad();
  state.holdLoad = undefined;
  await expect(controls(page).getByRole('status')).not.toContainText('Loading');
  await expect(controls(page).locator('strong').first()).toHaveText('Canvas session');
  await openSession(page, EMPTY);
  await expect(controls(page).locator('strong').first()).toHaveText('Empty remote session');
  await page.getByRole('link', { name: 'Arena', exact: true }).click();
  await page.getByRole('link', { name: /^Inbox/ }).click();
  await page.goBack();
  await expect(controls(page)).toBeVisible();
  await openSession(page, SESSION);
  state.failLoad = true;
  await openSession(page, EMPTY);
  await expect(controls(page).getByRole('status')).toContainText('Remote session loading failed');
  state.failLoad = false;
  await openSession(page, SESSION);
  state.online = false;
  await expect(controls(page).locator(`[data-immersive-session="${EMPTY}"]`)).toContainText('Offline');
  await openSession(page, EMPTY);
  await expect(controls(page).getByRole('status')).toContainText('Laptop is Offline');
  await expect(controls(page).locator('strong').first()).toHaveText('Canvas session');
  expect(await page.evaluate(() => ({ entries: window.xrFixture.entries, ends: window.xrFixture.ends, destroys: window.xrFixture.destroys })))
    .toEqual({ entries: 1, ends: 0, destroys: 0 });
  await controls(page).getByRole('button', { name: 'Reset view' }).click();
  await controls(page).getByRole('button', { name: 'Exit VR' }).click();
  await released(page);
  await expect(page.getByRole('complementary', { name: 'Conversation' }).locator('textarea')).toHaveValue('Keep this local draft');
});

test('contains broken canvas/transcript surfaces and cleans up rejection, system end, context loss and revocation', async ({ page }) => {
  await installAdapter(page);
  const state = await workspaceFixture(page);
  await page.goto('/');
  await page.evaluate(() => {
    window.xrFixture.reject = true;
    window.__CODEAI_SPATIAL_TEST__ = { failTextureId: 'sketch-fixture' };
    window.__CODEAI_XR_TEST__!.failTranscript = true;
  });
  await page.getByRole('button', { name: 'Enter VR', exact: true }).click();
  await expect(page.locator('.immersive-entry [role="alert"]')).toContainText('Immersive entry was denied');
  await page.evaluate(() => { window.xrFixture.reject = false; });
  await enter(page);
  await expect.poll(() => page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__?.logicalTexturePixels || 0)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__!.logicalTexturePixels)).toBeLessThanOrEqual(4_194_304);
  await controls(page).getByRole('button', { name: 'Reset view' }).click();
  await openSession(page, EMPTY);
  await expect(controls(page).locator('strong').first()).toHaveText('Empty remote session');
  await page.evaluate(() => window.xrFixture.systemEnd?.());
  await released(page);
  expect(await page.evaluate(() => window.xrFixture.ends)).toBe(0);
  await enter(page);
  await page.locator('.immersive-viewport canvas').dispatchEvent('webglcontextlost');
  await expect(page.locator('.immersive-entry [role="alert"]')).toContainText('WebGL context was lost');
  await released(page);
  expect(await page.evaluate(() => window.xrFixture.ends)).toBe(1);
  await enter(page);
  state.authenticated = false;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('heading', { name: 'Pair this device' })).toBeVisible();
  await released(page);
  await expect.poll(() => page.evaluate(() => window.xrFixture.destroys)).toBe(1);
  expect(await page.evaluate(() => window.xrFixture.ends)).toBe(2);
});

test('ends a pending entry once when access is revoked and when the document leaves', async ({ page }) => {
  await installAdapter(page);
  const state = await workspaceFixture(page);
  await page.goto('/');
  await page.evaluate(() => { window.xrFixture.pending = true; });
  await page.getByRole('button', { name: 'Enter VR', exact: true }).click();
  state.authenticated = false;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('heading', { name: 'Pair this device' })).toBeVisible();
  await page.evaluate(() => window.xrFixture.resolve?.());
  await expect.poll(() => page.evaluate(() => window.xrFixture.ends)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.xrFixture.destroys)).toBe(1);
  await released(page);
  state.authenticated = true;
  await page.reload();
  await page.evaluate(() => { window.xrFixture.pending = true; });
  await page.getByRole('button', { name: 'Enter VR', exact: true }).click();
  await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pagehide')); window.xrFixture.resolve?.(); });
  await expect.poll(() => page.evaluate(() => window.xrFixture.ends)).toBe(1);
  await released(page);
});

for (const failImport of [false, true]) {
  test(`keeps ordinary desktop use lazy and usable with ${failImport ? 'a failed XR import' : 'unsupported XR'}`, async ({ page }) => {
    await installAdapter(page, { supported: failImport, failImport });
    await workspaceFixture(page);
    await page.goto('/');
    if (failImport) await expect(page.locator('.immersive-entry [role="alert"]')).toContainText('The immersive renderer could not load');
    else await expect(page.getByText('VR unavailable', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__CODEAI_XR_BUNDLE_EVALUATIONS__)).toBeUndefined();
    expect(await page.evaluate(() => window.__CODEAI_SPATIAL_INSTRUMENTATION__)).toBeUndefined();
    await expect(page.getByRole('button', { name: 'Flat', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Spatial', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Spatial canvas projection' })).toBeVisible();
  });
}
