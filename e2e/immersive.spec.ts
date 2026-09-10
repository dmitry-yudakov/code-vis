import type { RootState } from '@react-three/fiber';
import type { XRStore } from '@react-three/xr';
import type { Mesh } from 'three';
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
    xrScene?: RootState;
    xrStore?: XRStore;
    xrFixture: {
      entries: number; ends: number; destroys: number; listeners: number;
      reject: boolean; pending: boolean; resolve?: () => void; systemEnd?: () => void;
      setVisibility?: (visibility: XRVisibilityState) => void;
      setControllers?: (count: number) => void;
    };
  }
}

async function installAdapter(page: Page, options: { supported?: boolean; failImport?: boolean } = {}) {
  await page.addInitScript(({ supported, failImport }) => {
    const stats = window.xrFixture = { entries: 0, ends: 0, destroys: 0, listeners: 0, reject: false, pending: false } as Window['xrFixture'];
    window.__CODEAI_XR_TEST__ = {
      failXRImport: failImport,
      onStore(store) { window.xrStore = store; },
      onWorkspace(state) { window.xrScene = state; },
      adapter: {
        async isSessionSupported() { return supported !== false; },
        async enterVR() {
          stats.entries++;
          if (stats.reject) throw new DOMException('User denied access', 'NotAllowedError');
          const listeners = { end: new Set<() => void>(), visibilitychange: new Set<() => void>(), inputsourceschange: new Set<() => void>() };
          const session = {
            visibilityState: 'visible' as XRVisibilityState,
            // Native XRInputSourceArray is iterable, not an Array with filter().
            inputSources: new Set<Pick<XRInputSource, 'targetRayMode' | 'hand'>>(),
            async end() { stats.ends++; for (const listener of listeners.end) listener(); },
            addEventListener(type: keyof typeof listeners, listener: () => void) { listeners[type].add(listener); stats.listeners++; },
            removeEventListener(type: keyof typeof listeners, listener: () => void) { if (listeners[type].delete(listener)) stats.listeners--; },
          };
          stats.systemEnd = () => { for (const listener of listeners.end) listener(); };
          stats.setVisibility = (visibility) => {
            session.visibilityState = visibility;
            for (const listener of listeners.visibilitychange) listener();
          };
          stats.setControllers = (count) => {
            session.inputSources = new Set(Array.from({ length: count }, () => ({ targetRayMode: 'tracked-pointer' as const })));
            // Exercise the actual store subscription path that previously ended VR. Native
            // controller rendering stays inactive in this adapter without a reference space.
            window.xrStore?.setState({ inputSourceStates: Array.from({ length: count }, () => ({
              type: 'controller', gamepad: {},
            })) as unknown as ReturnType<XRStore['getState']>['inputSourceStates'] });
            for (const listener of listeners.inputsourceschange) listener();
          };
          if (stats.pending) await new Promise<void>((resolve) => { stats.resolve = resolve; });
          return session;
        },
        destroy() { stats.destroys++; },
      },
    };
  }, options);
}

async function workspaceFixture(page: Page, withRepository = false) {
  const state = { annotationWrites: 0, diffReads: 0, statusReads: 0, holdDiff: undefined as Promise<void> | undefined, online: true, failLoad: false, authenticated: true, holdLoad: undefined as Promise<void> | undefined };
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
  if (withRepository) {
    local.repositories = [{ id: 'binding', hostId: LOCAL, checkoutId: 'checkout', role: 'primary' }];
    local.messages = [{ id: 'reading-fixture', role: 'assistant', authorId: AGENT, createdAt: NOW, status: 'complete', rawMarkdown: '', blocks: [
      { kind: 'markdown', markdown: 'Reading fixture: keep the conversation, diagram, and repository evidence beside one another. Compare the result, then arrange the panels from your seat.' },
      { kind: 'code', language: 'ts', source: 'function resetWorkspace() {\n  return panels.map(panel => ({ ...panel, open: true }));\n}' },
      { kind: 'diagram', artifact: { id: 'reading-diagram', sessionId: SESSION, messageId: 'reading-fixture', ordinal: 1, source: 'flowchart LR\n A[Conversation] --> B[Canvas] --> C[Evidence]', createdAt: NOW, status: 'ready', derivedFromDiagramIds: [], evidence: [] } },
    ] }];
  }
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
  await page.route('**/api/checkouts', (route) => route.fulfill({ json: { hostId: LOCAL, checkouts: withRepository ? [{ id: 'checkout', name: 'Fixture', relativePath: 'fixture' }] : [], recentCheckoutIds: [] } }));
  await page.route('**/api/arena', (route) => route.fulfill({ json: { machines: [snapshot(LOCAL, 'Home', local), snapshot(REMOTE, 'Laptop', remote)] } }));
  await page.route('**/api/agent/runs*', (route) => route.fulfill({ json: { active: [], recent: [] } }));
  await page.route('**/api/sessions?*', (route) => route.fulfill({ json: { sessions: [local] } }));
  await page.route(`**/api/sessions/${SESSION}/annotations`, (route) => {
    state.annotationWrites++;
    return route.fulfill({ json: { session: local } });
  });
  await page.route(`**/api/sessions/${SESSION}`, (route) => route.fulfill({ json: { session: local } }));
  await page.route(`**/api/machines/${REMOTE}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/sessions')) {
      await state.holdLoad;
      await route.fulfill(state.failLoad ? { status: 503, json: { error: 'Remote session loading failed' } } : { json: { sessions: [remote] } });
    } else if (path.endsWith(`/sessions/${EMPTY}`)) await route.fulfill({ json: { session: remote } });
    else await route.fulfill({ json: { active: [], recent: [] } });
  });
  await page.route('**/api/repository/status?*', (route) => {
    state.statusReads++;
    return route.fulfill({ json: { tree: { isRepository: true, files: [
      { path: 'fixture.ts', status: 'modified', staged: true, unstaged: true },
      { path: 'other.ts', status: 'modified', staged: false, unstaged: true },
    ] } } });
  });
  await page.route('**/api/repository/diff?*', async (route) => {
    state.diffReads++;
    await state.holdDiff;
    const path = new URL(route.request().url()).searchParams.get('path');
    return route.fulfill({ json: { diff: { path, staged: '@@ staged @@\n+  first change',
      unstaged: Array.from({ length: 60 }, (_, i) => `+  ${path} line ${i}`).join('\n') } } });
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

test('keeps VR and panel state through controller removal, reconnection and visibility interruptions', async ({ page }) => {
  await installAdapter(page);
  await workspaceFixture(page);
  await page.goto('/');
  await enter(page);
  await controls(page).locator('[data-immersive-action="panel:evidence:close"]').click();
  const layout = await page.evaluate(() => localStorage.getItem('code-ai:device:v1:immersive-layout'));
  for (const count of [2, 1, 0, 1, 2]) {
    await page.evaluate((count) => window.xrFixture.setControllers?.(count), count);
    await expect(controls(page)).toBeVisible();
    expect(await page.evaluate(() => window.xrFixture.ends)).toBe(0);
  }
  for (const visibility of ['visible-blurred', 'hidden', 'visible'] as const) {
    await page.evaluate((visibility) => window.xrFixture.setVisibility?.(visibility), visibility);
    await expect(controls(page)).toBeVisible();
    expect(await page.evaluate(() => window.xrFixture.ends)).toBe(0);
  }
  expect(await page.evaluate(() => localStorage.getItem('code-ai:device:v1:immersive-layout'))).toBe(layout);
  expect(await page.evaluate(() => window.xrFixture.entries)).toBe(1);
  const events = await page.evaluate(() => window.__CODEAI_VR_DIAGNOSTICS__!().events);
  expect(events.filter((event) => event.event === 'controllers-changed').map((event) => event.controllers)).toEqual([2, 1, 0, 1, 2]);
  expect(events.filter((event) => event.event === 'visibility-changed').map((event) => event.visibility)).toEqual(['visible-blurred', 'hidden', 'visible']);
  // Content actions remain usable after input/visibility resume.
  await controls(page).locator('[data-immersive-action="panel:evidence:open"]').click();
  await expect(controls(page).locator('[data-immersive-panel="evidence"]')).toHaveAttribute('data-open', 'true');
  await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click();
  await released(page);
  expect(await page.evaluate(() => window.__CODEAI_VR_DIAGNOSTICS__!().events.slice(-2).map((event) => event.event)))
    .toEqual(['exit-requested', 'session-ended']);
});

test('samples diagnostics and removes the timer and error listeners after session end', async ({ page }) => {
  await page.clock.install();
  await installAdapter(page);
  await workspaceFixture(page);
  await page.goto('/');
  await enter(page);
  await expect.poll(() => page.evaluate(() => window.__CODEAI_VR_DIAGNOSTICS__!().events.filter((event) => event.event === 'sample').length), { timeout: 15_000 }).toBeGreaterThan(0);
  const sample = await page.evaluate(() => window.__CODEAI_VR_DIAGNOSTICS__!().events.find((event) => event.event === 'sample'));
  expect(sample).toMatchObject({ sessionActive: true, visibility: 'visible', controllers: 0 });
  expect(sample!.frames).toBeGreaterThan(0);
  expect(sample!.textures).toBeGreaterThan(0);
  await page.evaluate(() => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'Do not persist arbitrary error content' }));
    window.dispatchEvent(new Event('unhandledrejection'));
  });
  expect(await page.evaluate(() => window.__CODEAI_VR_DIAGNOSTICS__!().events.slice(-2).map((event) => event.event)))
    .toEqual(['window-error', 'unhandled-rejection']);
  await page.evaluate(() => window.xrFixture.systemEnd?.());
  await released(page);
  await expect(page.locator('.immersive-entry [role="alert"]')).toContainText('headset or browser ended VR');
  const previous = await page.evaluate(() => window.__CODEAI_VR_DIAGNOSTICS__!().events);
  await page.evaluate(() => {
    window.dispatchEvent(new ErrorEvent('error'));
    window.dispatchEvent(new Event('unhandledrejection'));
  });
  await page.clock.fastForward(20_000);
  expect(await page.evaluate(() => window.__CODEAI_VR_DIAGNOSTICS__!().events)).toEqual(previous);
});

test('retains VR exit diagnostics across reload with a new document identity', async ({ page }) => {
  await installAdapter(page);
  await workspaceFixture(page);
  await page.goto('/');
  await enter(page);
  await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click();
  await released(page);
  const previous = await page.evaluate(() => window.__CODEAI_VR_DIAGNOSTICS__!().events);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Enter VR', exact: true })).toBeEnabled();
  const reloaded = await page.evaluate(() => window.__CODEAI_VR_DIAGNOSTICS__!().events);
  expect(reloaded.slice(0, previous.length)).toEqual(previous);
  expect(reloaded.at(-1)?.event).toBe('page-ready');
  expect(reloaded.at(-1)?.pageStartedAt).not.toBe(previous.at(-1)?.pageStartedAt);
  expect(await page.evaluate(() => window.xrFixture.entries)).toBe(0);
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
  expect(await page.evaluate(() => window.__CODEAI_VR_DIAGNOSTICS__!().events.slice(-2).map((event) => event.event)))
    .toEqual(['webgl-context-lost', 'session-ended']);
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

const panel = (page: Page, id: string) => controls(page).locator(`[data-immersive-panel="${id}"]`);
const panelAction = (page: Page, id: string, command: string) => controls(page).locator(`[data-immersive-action="panel:${id}:${command}"]`).click();
const storedLayout = (page: Page) => page.evaluate(() => localStorage.getItem('code-ai:device:v1:immersive-layout'));
const livePanelIds = (page: Page) => page.evaluate(() => {
  const ids: string[] = [];
  window.xrScene?.scene.traverse((object) => { if (object.userData.workspacePanel) ids.push(object.userData.workspacePanel); });
  return ids.sort();
});

async function pointAtAction(page: Page, action: string) {
  await expect.poll(() => page.evaluate((action) => {
    let target: Mesh | undefined;
    window.xrScene?.scene.traverse((object) => { if (object.userData.immersiveAction === action) target = object as Mesh; });
    if (!target || !window.xrScene) return false;
    const { camera, scene } = window.xrScene;
    scene.updateMatrixWorld(true);
    // Aim inside a triangle: the exact center lies on the quad's shared edge and can
    // miss both triangles through floating-point rounding at some camera angles.
    camera.lookAt(target.localToWorld(camera.position.clone().set(0.01, 0.005, 0)));
    camera.updateMatrixWorld(true);
    return true;
  }, action)).toBe(true);
  await page.locator('.immersive-viewport').evaluate((element: HTMLElement) => {
    element.style.opacity = '1'; element.style.zIndex = '200'; element.style.pointerEvents = 'auto';
    element.querySelector('canvas')!.style.pointerEvents = 'auto';
  });
  const box = (await page.locator('.immersive-viewport canvas').boundingBox())!;
  // Camera rotation alone does not emit a desktop pointer event. Move off the last
  // screen coordinate before pointing at the new target to refresh the hover ray.
  await page.mouse.move(box.x + box.width / 2 + 2, box.y + box.height / 2 + 2);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}
async function showPanel(page: Page, id: string) {
  await pointAtAction(page, `panel:${id}:focus`);
  await page.evaluate((id) => {
    const { scene, camera } = window.xrScene!;
    const object = scene.getObjectByName(`${id[0].toUpperCase()}${id.slice(1)} panel`)!;
    camera.lookAt(object.getWorldPosition(camera.position.clone()));
    camera.updateMatrixWorld(true);
  }, id);
}
async function hideProjection(page: Page) {
  await page.locator('.immersive-viewport').evaluate((element: HTMLElement) => {
    element.style.opacity = '0'; element.style.zIndex = ''; element.style.pointerEvents = 'none';
    element.querySelector('canvas')!.style.pointerEvents = 'none';
  });
}

async function moveHeldPanel(page: Page) {
  // Translating the ray origin exercises the same push/pull math as a tracked controller.
  await page.evaluate(() => {
    const { camera } = window.xrScene!;
    const direction = camera.getWorldDirection(camera.position.clone());
    direction.y = 0;
    camera.position.addScaledVector(direction.normalize(), -0.2);
    camera.position.x += 0.03; camera.position.y += 0.12;
    camera.updateMatrixWorld(true);
  });
  const box = (await page.locator('.immersive-viewport canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 + 6, box.y + box.height / 2, { steps: 3 });
}

test('arranges every panel, isolates content actions, recovers tools and restores device layouts', async ({ page }) => {
  await installAdapter(page);
  const fixture = await workspaceFixture(page);
  await page.goto('/');
  await expect(page.locator('.app-loading')).toHaveCount(0);
  await expect.poll(() => fixture.annotationWrites).toBe(1);
  const desktop = await page.evaluate(() => localStorage.getItem('code-ai:device:v1:workspace'));
  const record = await page.evaluate(async (id) => (await fetch(`/api/sessions/${id}`)).text(), SESSION);
  let writes = 0;
  page.on('request', (request) => { if (request.method() !== 'GET' && request.url().includes('/api/')) writes++; });
  await enter(page);
  await expect.poll(() => livePanelIds(page)).toEqual(['canvas', 'conversation', 'evidence', 'sessions']);
  for (const id of ['canvas', 'conversation', 'evidence', 'sessions']) {
    await panelAction(page, id, 'focus');
    await expect(panel(page, id)).toHaveAttribute('data-focused', 'true');
    const before = JSON.parse((await panel(page, id).getAttribute('data-layout'))!);
    const savedBeforeDrag = await storedLayout(page);
    await expect.poll(() => page.evaluate((id) => {
      const { scene, camera } = window.xrScene!;
      const title = id[0].toUpperCase() + id.slice(1);
      const panel = scene.getObjectByName(`${title} panel`)!;
      const toolbar = scene.getObjectByName(`${title} toolbar`);
      if (!toolbar) return false;
      scene.updateMatrixWorld(true);
      const icons: Mesh[] = [];
      toolbar.traverse((object) => { if (object.userData.immersiveAction) icons.push(object as Mesh); });
      return icons.length === 3 && icons.every((icon) => {
        const position = panel.worldToLocal(icon.getWorldPosition(camera.position.clone()));
        const size = (icon.geometry as import('three').PlaneGeometry).parameters;
        return position.y + size.height / 2 < -0.92 && size.width === size.height;
      });
    }, id)).toBe(true);
    for (const [command, label] of [['resize', 'Size'], ['close', 'Close'], ['drag', 'Drag']]) {
      await pointAtAction(page, `panel:${id}:${command}`);
      await expect.poll(() => page.evaluate(({ id, label }) =>
        window.xrScene?.scene.getObjectByName(`${label} ${id[0].toUpperCase()}${id.slice(1)} tooltip`)?.visible,
      { id, label })).toBe(true);
      expect(await storedLayout(page)).toBe(savedBeforeDrag);
    }
    await pointAtAction(page, `panel:${id}:focus`);
    await expect.poll(() => page.evaluate((id) =>
      window.xrScene?.scene.getObjectByName(`Drag ${id[0].toUpperCase()}${id.slice(1)} tooltip`)?.visible, id)).toBe(false);
    await pointAtAction(page, `panel:${id}:drag`);
    await page.mouse.down();
    await moveHeldPanel(page);
    await expect.poll(() => page.evaluate((id) => window.xrScene?.scene.getObjectByName(`${id[0].toUpperCase()}${id.slice(1)} content`)?.pointerEvents, id)).toBe('none');
    expect(await storedLayout(page)).toBe(savedBeforeDrag);
    await page.mouse.up();
    await pointAtAction(page, `panel:${id}:resize`);
    await page.mouse.down(); await page.mouse.up();
    await pointAtAction(page, `panel:${id}:extra-large`);
    await page.mouse.down(); await page.mouse.up();
    await hideProjection(page);
    const moved = JSON.parse((await panel(page, id).getAttribute('data-layout'))!);
    expect(moved.height).toBeGreaterThan(before.height);
    expect(moved.distance).toBeLessThan(before.distance);
    expect(moved.angle).not.toBe(before.angle);
    expect(moved.size).toBe('extra-large');
    await pointAtAction(page, `panel:${id}:close`);
    await page.mouse.down(); await page.mouse.up();
    await hideProjection(page);
    await expect.poll(() => livePanelIds(page)).not.toContain(id);
    await panelAction(page, id, 'open');
    await expect(panel(page, id)).toHaveAttribute('data-layout', JSON.stringify(moved));
  }
  const saved = await storedLayout(page);
  await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click();
  await released(page);
  expect(await page.evaluate(() => localStorage.getItem('code-ai:device:v1:workspace'))).toBe(desktop);
  expect(writes).toBe(0);
  expect(await page.evaluate(async (id) => (await fetch(`/api/sessions/${id}`)).text(), SESSION)).toBe(record);
  await page.reload();
  await enter(page);
  expect(await storedLayout(page)).toBe(saved);
  await openSession(page, EMPTY);
  await expect(panel(page, 'canvas')).toHaveAttribute('data-layout', JSON.stringify({ angle: 19, height: 0, distance: 2.6, size: 'medium', open: true }));
  await openSession(page, SESSION);
  await expect(panel(page, 'canvas')).not.toHaveAttribute('data-layout', JSON.stringify({ angle: 19, height: 0, distance: 2.6, size: 'medium', open: true }));
  await controls(page).getByRole('button', { name: 'Reset workspace', exact: true }).click();
  await expect(panel(page, 'canvas')).toHaveAttribute('data-layout', JSON.stringify({ angle: 19, height: 0, distance: 2.6, size: 'medium', open: true }));
  await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click();
  await released(page);
});

test('selects real world controls by ray, ignores hover and recenters restored panels on re-entry', async ({ page }) => {
  await installAdapter(page);
  await page.addInitScript(() => localStorage.setItem('code-ai:device:v1:immersive-layout', '{corrupt'));
  await workspaceFixture(page);
  await page.goto('/');
  await enter(page);
  await pointAtAction(page, 'panel:conversation:focus');
  await expect(panel(page, 'canvas')).toHaveAttribute('data-focused', 'true');
  await page.mouse.down(); await page.mouse.up();
  await expect(panel(page, 'conversation')).toHaveAttribute('data-focused', 'true');
  await pointAtAction(page, 'panel:conversation:drag');
  await page.mouse.down();
  await moveHeldPanel(page);
  await page.mouse.up();
  expect(JSON.parse((await panel(page, 'conversation').getAttribute('data-layout'))!).angle).not.toBe(-19);
  await hideProjection(page);
  await page.evaluate(() => { window.xrScene!.camera.position.set(1, 1.6, 2); window.xrScene!.camera.rotation.set(0, Math.PI / 2, 0); });
  await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click();
  await released(page);
  const saved = await storedLayout(page);
  await enter(page);
  await expect.poll(() => page.evaluate(() => {
    const origin = window.xrScene?.scene.getObjectByName('Workspace origin');
    return origin ? { position: origin.position.toArray(), yaw: Math.round(origin.rotation.y * 1e8) / 1e8 } : undefined;
  })).toEqual({ position: [1, 1.6, 2], yaw: Math.round(Math.PI / 2 * 1e8) / 1e8 });
  expect(await storedLayout(page)).toBe(saved);
  await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click();
  await released(page);
});

test('cancels captured drags safely and chooses every size preset through the world menu', async ({ page }) => {
  test.setTimeout(90_000);
  await installAdapter(page);
  const fixture = await workspaceFixture(page, true);
  await page.goto('/');
  await enter(page);
  await panelAction(page, 'canvas', 'focus');
  const saved = await storedLayout(page);
  await pointAtAction(page, 'panel:canvas:drag');
  await page.mouse.down();
  await moveHeldPanel(page);
  // Leave the panel completely: capture must keep the preview moving without a content click.
  await page.mouse.move(1, 1);
  expect(await storedLayout(page)).toBe(saved);
  await page.locator('.immersive-viewport canvas').dispatchEvent('pointercancel', { pointerId: 1, button: 0 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.xrScene?.scene.getObjectByName('Canvas panel')?.userData.editing)).toBeUndefined();
  expect(await storedLayout(page)).toBe(saved);
  await expect.poll(() => page.evaluate(() => window.xrScene?.internal.capturedMap.size)).toBe(0);

  await pointAtAction(page, 'panel:evidence:drag');
  await page.mouse.down();
  await moveHeldPanel(page);
  await hideProjection(page);
  const reads = fixture.diffReads;
  // Programmatic click represents another controller trying a content action during the drag.
  await controls(page).locator('[data-immersive-action="next-file"]').evaluate((button: HTMLButtonElement) => button.click());
  expect(fixture.diffReads).toBe(reads);
  await controls(page).locator('[data-immersive-action="reset-workspace"]').evaluate((button: HTMLButtonElement) => button.click());
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.xrScene?.internal.capturedMap.size)).toBe(0);

  for (const [size, scale] of [['small', 0.85], ['medium', 1], ['large', 1.15], ['extra-large', 1.3]] as const) {
    await pointAtAction(page, 'panel:canvas:resize');
    await page.mouse.down(); await page.mouse.up();
    await pointAtAction(page, `panel:canvas:${size}`);
    await page.mouse.down(); await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.xrScene?.scene.getObjectByName('Canvas panel')?.scale.x)).toBe(scale);
  }
  await pointAtAction(page, 'panel:canvas:resize');
  await page.screenshot({ path: 'test-results/vr-panel-toolbar.png' });
  await page.mouse.down(); await page.mouse.up();
  await showPanel(page, 'canvas');
  await page.screenshot({ path: 'test-results/vr-panel-size-menu.png' });
  await pointAtAction(page, 'panel:canvas:drag');
  await page.mouse.down();
  await moveHeldPanel(page);
  const beforeExit = await storedLayout(page);
  await page.evaluate(() => window.xrFixture.systemEnd?.());
  await page.mouse.up();
  await released(page);
  await hideProjection(page);
  await enter(page);
  expect(await storedLayout(page)).toBe(beforeExit);
  await expect.poll(() => page.evaluate(() => window.xrScene?.scene.getObjectByName('Canvas panel')?.userData.editing)).toBeUndefined();
  await pointAtAction(page, 'panel:canvas:drag');
  await page.mouse.down();
  await moveHeldPanel(page);
  await hideProjection(page);
  await controls(page).locator(`[data-immersive-session="${EMPTY}"]`).evaluate((button: HTMLButtonElement) => button.click());
  await expect(controls(page).locator('strong').first()).toHaveText('Empty remote session');
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.xrScene?.internal.capturedMap.size)).toBe(0);
  expect(await storedLayout(page)).toBe(beforeExit);
  await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click();
  await released(page);
});

test('shares a paged diff with desktop and bounds resources across twenty open/close/reset cycles', async ({ page }) => {
  test.setTimeout(120_000);
  await installAdapter(page);
  const state = await workspaceFixture(page, true);
  await page.goto('/');
  await enter(page);
  await controls(page).getByRole('button', { name: 'Next file', exact: true }).click();
  await expect.poll(() => state.diffReads).toBe(1);
  await expect(page.getByRole('region', { name: 'Changes in fixture.ts' })).toBeAttached();
  await expect.poll(() => page.evaluate(() => {
    let ready = false;
    window.xrScene?.scene.getObjectByName('Evidence content')?.traverse((object) => {
      const mesh = object as Mesh;
      const material = mesh.material as { map?: { image?: HTMLCanvasElement } } | undefined;
      if (material?.map?.image?.width === 1024 && material.map.image.height === 768) ready = true;
    });
    return ready;
  })).toBe(true);
  await controls(page).getByRole('button', { name: 'Next page', exact: true }).click();
  expect(state.diffReads).toBe(1);
  await panelAction(page, 'evidence', 'resize');
  await controls(page).getByRole('button', { name: 'Next file', exact: true }).click();
  expect(state.diffReads).toBe(1);
  await panelAction(page, 'evidence', 'done');
  await controls(page).getByRole('button', { name: 'Next canvas', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.xrScene?.scene.getObjectByName('Active canvas')?.userData)).toMatchObject({ canvasTarget: 'reading-diagram', canvasStatus: 'ready' });
  const aspect = await page.evaluate(() => {
    const { scene, camera } = window.xrScene!;
    scene.updateMatrixWorld(true);
    const mesh = scene.getObjectByName('Active canvas') as Mesh;
    const scale = mesh.getWorldScale(camera.position.clone());
    const size = (mesh.geometry as import('three').PlaneGeometry).parameters;
    const image = (mesh.material as import('three').MeshBasicMaterial).map!.image as HTMLCanvasElement;
    return { world: size.width * scale.x / (size.height * scale.y), raster: image.width / image.height };
  });
  expect(aspect.world).toBeCloseTo(aspect.raster, 1);
  await showPanel(page, 'conversation');
  await page.screenshot({ path: 'test-results/vr-conversation-panel.png' });
  await showPanel(page, 'evidence');
  await page.screenshot({ path: 'test-results/vr-evidence-panel.png' });
  await showPanel(page, 'canvas');
  await page.screenshot({ path: 'test-results/vr-canvas-panel.png' });
  await hideProjection(page);
  const baseline = await page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__!.liveResources);
  for (let cycle = 0; cycle < 20; cycle++) {
    for (const id of ['canvas', 'conversation', 'evidence', 'sessions']) await panelAction(page, id, 'close');
    await expect.poll(() => livePanelIds(page)).toEqual([]);
    await expect.poll(() => page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__!.logicalTexturePixels)).toBeLessThan(800_000);
    await controls(page).getByRole('button', { name: 'Reset workspace', exact: true }).click();
    await expect.poll(() => livePanelIds(page)).toHaveLength(4);
    expect(await page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__!.logicalTexturePixels)).toBeLessThanOrEqual(4_194_304);
  }
  await expect.poll(() => page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__!.liveResources)).toBeLessThanOrEqual(baseline + 12);
  expect(state.diffReads).toBe(1);
  await test.info().attach('vr-resource-budget', { body: JSON.stringify(await page.evaluate(() => window.__CODEAI_IMMERSIVE_INSTRUMENTATION__), null, 2), contentType: 'application/json' });
  await controls(page).getByRole('button', { name: 'Exit VR', exact: true }).click();
  await released(page);
});

test('ignores a delayed diff after navigating to another machine and keeps recovery controls available', async ({ page }) => {
  await installAdapter(page);
  const state = await workspaceFixture(page, true);
  await page.goto('/');
  await enter(page);
  await expect.poll(() => state.statusReads).toBeGreaterThan(0);
  let resolveDiff!: () => void;
  state.holdDiff = new Promise<void>((resolve) => { resolveDiff = resolve; });
  await controls(page).getByRole('button', { name: 'Next file', exact: true }).click();
  await expect.poll(() => state.diffReads).toBe(1);
  await openSession(page, EMPTY);
  await expect(controls(page).locator('strong').first()).toHaveText('Empty remote session');
  resolveDiff();
  state.holdDiff = undefined;
  await expect(page.getByRole('region', { name: 'Changes in fixture.ts' })).toHaveCount(0);
  await controls(page).getByRole('button', { name: 'Next file', exact: true }).click();
  expect(state.diffReads).toBe(1);
  await pointAtAction(page, 'exit');
  await page.mouse.down(); await page.mouse.up();
  await released(page);
});
