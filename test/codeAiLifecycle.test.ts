import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/codeai-lifecycle/route';
import { getConfig } from '@/server/config';
import { getDeviceAuthStore } from '@/server/devices/deviceAuthStore';
import { CodeAiLifecycle } from '@/server/lifecycle/codeAiLifecycle';
import type { ManagedBridge } from '@/server/lifecycle/managedBridge';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { RunRegistry, runRegistry } from '@/server/runs/runRegistry';
import { getSessionStore } from '@/server/storage/sessionStore';
import type { ManagedLifecycleInit, ServerLifecycleMessage } from '@/shared/codeAiLifecycle';

const FINISHED = { operationId: '0f1e2d3c-4b5a-4968-8776-655443322110', outcome: 'rolled-back' as const, finishedAt: '2026-09-23T10:00:00.000Z' };
const globalScope = globalThis as typeof globalThis & {
  __codeaiManagedLifecycle?: ManagedBridge;
  __codeAiLifecycle?: CodeAiLifecycle;
  __codeaiInternalTlsMarker?: string;
};

function fakeBridge(init: Partial<ManagedLifecycleInit> = {}) {
  const sent: ServerLifecycleMessage[] = [];
  let listener: ((message: unknown) => void) | undefined;
  let connected = true;
  const bridge: ManagedBridge = {
    init: { type: 'lifecycle-init', installationRoot: '/installation', slot: '.next-managed-a', releaseId: 'release-a', ...init },
    connected: () => connected,
    send: (message) => { sent.push(message); },
    listen: (next) => { listener = next; },
  };
  return { bridge, sent, deliver: (message: unknown) => listener!(message), disconnect: () => { connected = false; } };
}

function reserveRun(registry: RunRegistry): string {
  const runId = crypto.randomUUID();
  expect(registry.reserve({
    runId, sessionId: crypto.randomUUID(), participantId: 'agent', providerKey: `provider:${runId}`,
    checkoutId: 'checkout', access: 'read', cancel: vi.fn(),
  })).toMatchObject({ accepted: true });
  return runId;
}

describe('the managed server’s lifecycle', () => {
  it('starts idle on its own release and shows the outcome its parent carried over', () => {
    const { bridge } = fakeBridge({ lastOperation: FINISHED });
    const lifecycle = new CodeAiLifecycle(bridge, new RunRegistry());
    expect(lifecycle.snapshot()).toEqual({ available: true, phase: 'idle', releaseId: 'release-a', lastOperation: FINISHED });
    expect(lifecycle.managed).toBe(true);
  });

  it('admits one operation with the scheduler’s lease and asks the parent to build', () => {
    const { bridge, sent } = fakeBridge({ lastOperation: FINISHED });
    const registry = new RunRegistry();
    const lifecycle = new CodeAiLifecycle(bridge, registry);
    const started = lifecycle.start();
    expect(started).toMatchObject({ accepted: true, snapshot: { phase: 'building', releaseId: 'release-a', lastOperation: FINISHED } });
    const operationId = started.accepted ? started.snapshot.operationId : undefined;
    expect(sent).toEqual([{ type: 'lifecycle-request', operationId, action: 'build-and-restart' }]);
    // The lease closes the race with a turn arriving now.
    expect(registry.reserve({
      runId: crypto.randomUUID(), sessionId: 's', participantId: 'p', providerKey: 'k', checkoutId: 'c', access: 'read', cancel: vi.fn(),
    })).toEqual({ accepted: false, reason: 'maintenance' });
    expect(lifecycle.start()).toEqual({ accepted: false, reason: 'busy' });
    expect(sent).toHaveLength(1);
  });

  it('refuses while any run is live, and once the parent’s channel is gone', () => {
    const { bridge, sent, disconnect } = fakeBridge();
    const registry = new RunRegistry();
    const lifecycle = new CodeAiLifecycle(bridge, registry);
    const runId = reserveRun(registry);
    expect(lifecycle.start()).toEqual({ accepted: false, reason: 'live-runs' });
    expect(lifecycle.snapshot().phase).toBe('idle');
    registry.release(runId);
    disconnect();
    expect(lifecycle.managed).toBe(false);
    expect(lifecycle.start()).toEqual({ accepted: false, reason: 'not-managed' });
    expect(sent).toEqual([]);
    expect(registry.acquireMaintenance()).toBe('acquired');
  });

  it('mirrors the parent’s status, releases the lease when told, and answers the parent’s lease requests', () => {
    const { bridge, sent, deliver } = fakeBridge();
    const registry = new RunRegistry();
    const lifecycle = new CodeAiLifecycle(bridge, registry);
    lifecycle.start();
    const restarting = { available: true, phase: 'restarting', releaseId: 'release-a', candidateReleaseId: 'release-b' };
    deliver({ type: 'lifecycle-state', snapshot: restarting });
    expect(lifecycle.snapshot()).toEqual(restarting);
    // Anything outside the contract is ignored.
    deliver({ type: 'lifecycle-state', snapshot: { ...restarting, phase: 'idle', command: 'rm -rf /' } });
    deliver({ type: 'lifecycle-lease', request: 'acquire', granted: true, extra: 1 });
    expect(lifecycle.snapshot()).toEqual(restarting);
    expect(sent).toHaveLength(1);

    deliver({ type: 'lifecycle-lease', request: 'acquire' });
    expect(sent.at(-1)).toEqual({ type: 'lifecycle-lease', request: 'acquire', granted: false });
    deliver({ type: 'lifecycle-lease', request: 'release' });
    deliver({ type: 'lifecycle-lease', request: 'acquire' });
    expect(sent.at(-1)).toEqual({ type: 'lifecycle-lease', request: 'acquire', granted: true });
    deliver({ type: 'lifecycle-lease', request: 'release' });
    const runId = reserveRun(registry);
    deliver({ type: 'lifecycle-lease', request: 'acquire' });
    expect(sent.at(-1)).toEqual({ type: 'lifecycle-lease', request: 'acquire', granted: false });
    registry.release(runId);
  });
});

describe.sequential('the CodeAI lifecycle route', () => {
  let dataDir: string;
  let root: string;
  let installation: string;
  let credential: string;
  let fake: ReturnType<typeof fakeBridge>;

  async function repository(relative: string): Promise<string> {
    const directory = path.join(root, relative);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'package.json'), '{}');
    return realpath(directory);
  }

  async function project(name: string, relative: string, role: 'primary' | 'reference' = 'primary') {
    const checkout = (await getCheckoutRegistry(root, 2).list()).find((item) => item.relativePath === relative)!;
    const store = getSessionStore(dataDir, 'Home');
    const created = await store.createProject(name, [checkout.id]);
    if (role === 'primary') return created;
    return store.updateProject(created.id, {
      expectedRevision: created.revision,
      repositories: created.repositories.map((binding) => ({ ...binding, role })),
    });
  }

  function request(url: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Request {
    return new Request(`https://codeai.test${url}`, {
      method: init.method || 'GET',
      headers: {
        'x-codeai-internal-transport': 'lifecycle-test', Cookie: `__Host-codeai-device=${credential}`,
        ...(init.method === 'POST' ? { Origin: 'https://codeai.test', 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  }

  const snapshot = async (projectId: string) => (await GET(request(`/api/codeai-lifecycle?projectId=${projectId}`))).json();
  const start = (body: unknown, headers?: Record<string, string>) => POST(request('/api/codeai-lifecycle', { method: 'POST', body, headers }));

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'codeai-lifecycle-'));
    root = await mkdtemp(path.join(os.tmpdir(), 'codeai-lifecycle-repositories-'));
    installation = await repository('installation');
    const copy = await repository('copies/code-ai');
    vi.stubEnv('CODEAI_DATA_DIR', dataDir);
    vi.stubEnv('CODEAI_REPOSITORIES_ROOT', root);
    vi.stubEnv('CODEAI_REPOSITORIES_DEPTH', '2');
    vi.stubEnv('CODEAI_HOST_LABEL', 'Home');
    // The managed root, not this setting, decides which checkout is CodeAI's own.
    vi.stubEnv('CODEAI_INSTALLATION_ROOT', copy);
    vi.stubEnv('CODEAI_REMOTE_ACCESS', 'paired');
    vi.stubEnv('CODEAI_PUBLIC_ORIGIN', 'https://codeai.test');
    globalScope.__codeaiInternalTlsMarker = 'lifecycle-test';
    fake = fakeBridge({ installationRoot: installation });
    globalScope.__codeaiManagedLifecycle = fake.bridge;
    delete globalScope.__codeAiLifecycle;
    const store = getDeviceAuthStore(dataDir);
    credential = (await store.pair((await store.issuePairingCode()).code, 'Headset')).credential;
  });

  afterEach(() => {
    delete globalScope.__codeaiManagedLifecycle;
    delete globalScope.__codeAiLifecycle;
    runRegistry.releaseMaintenance();
    vi.unstubAllEnvs();
  });

  it('uses the root its parent verified as the installation', () => {
    expect(getConfig().installationRoot).toBe(installation);
    delete globalScope.__codeaiManagedLifecycle;
    expect(getConfig().installationRoot).not.toBe(installation);
  });

  it('is available only for the exact local self project of a managed server', async () => {
    const self = await project('Renamed anything', 'installation');
    const copy = await project('CodeAI', 'copies/code-ai');
    const reference = await project('Reference only', 'installation', 'reference');
    expect(await snapshot(self.id)).toEqual({ available: true, phase: 'idle', releaseId: 'release-a' });
    expect(await snapshot(copy.id)).toEqual({ available: false, reason: 'not-self-project' });
    expect(await snapshot(reference.id)).toEqual({ available: false, reason: 'not-self-project' });
    expect(await snapshot(crypto.randomUUID())).toEqual({ available: false, reason: 'not-self-project' });

    // An initialization outside the contract never makes a server managed.
    delete globalScope.__codeAiLifecycle;
    globalScope.__codeaiManagedLifecycle = fakeBridge({ installationRoot: installation, releaseId: '../release' }).bridge;
    expect(await snapshot(self.id)).toEqual({ available: false, reason: 'not-managed' });
    globalScope.__codeaiManagedLifecycle = fake.bridge;

    fake.disconnect();
    expect(await snapshot(self.id)).toEqual({ available: false, reason: 'not-managed' });
    delete globalScope.__codeaiManagedLifecycle;
    delete globalScope.__codeAiLifecycle;
    expect(await snapshot(self.id)).toEqual({ available: false, reason: 'not-managed' });
  });

  it('answers only a paired personal device', async () => {
    const self = await project('CodeAI', 'installation');
    const unpaired = await GET(request(`/api/codeai-lifecycle?projectId=${self.id}`, { headers: { Cookie: '' } }));
    expect(unpaired.status).toBe(401);
    const bearer = await POST(request('/api/codeai-lifecycle', {
      method: 'POST', body: { action: 'build-and-restart', projectId: self.id }, headers: { Cookie: '', Authorization: 'Bearer machine' },
    }));
    expect(bearer.status).toBe(401);
    expect(fake.sent).toEqual([]);
  });

  it('accepts only the fixed action from the exact origin, and starts one build', async () => {
    const self = await project('CodeAI', 'installation');
    const valid = { action: 'build-and-restart', projectId: self.id };
    expect((await start(valid, { Origin: 'https://elsewhere.test' })).status).toBe(403);
    for (const body of [
      { ...valid, command: 'npm run build' }, { ...valid, action: 'restart' }, { action: 'build-and-restart' },
      { ...valid, slot: '.next-managed-a' }, { ...valid, env: { NODE_OPTIONS: '--inspect' } },
    ]) expect((await start(body)).status, JSON.stringify(body)).toBe(400);
    expect(fake.sent).toEqual([]);

    const accepted = await start(valid);
    expect(accepted.status).toBe(202);
    const { snapshot: building } = await accepted.json();
    expect(building).toMatchObject({ available: true, phase: 'building', releaseId: 'release-a', operationId: expect.any(String) });
    expect(fake.sent).toEqual([{ type: 'lifecycle-request', operationId: building.operationId, action: 'build-and-restart' }]);
    expect(await snapshot(self.id)).toEqual(building);

    const second = await start(valid);
    expect(second.status).toBe(409);
    expect((await second.json()).error).toContain('already building');
    expect(fake.sent).toHaveLength(1);
  });

  it('demands the exact origin in local mode too', async () => {
    const self = await project('CodeAI', 'installation');
    vi.stubEnv('CODEAI_REMOTE_ACCESS', 'local');
    expect((await start({ action: 'build-and-restart', projectId: self.id }, { Origin: 'https://elsewhere.test' })).status).toBe(403);
    expect(fake.sent).toEqual([]);
    expect((await start({ action: 'build-and-restart', projectId: self.id })).status).toBe(202);
  });

  it('refuses another project, an unmanaged server, and a machine with a live run', async () => {
    const self = await project('CodeAI', 'installation');
    const copy = await project('CodeAI', 'copies/code-ai');
    expect((await start({ action: 'build-and-restart', projectId: copy.id })).status).toBe(400);

    const runId = reserveRun(runRegistry);
    const busy = await start({ action: 'build-and-restart', projectId: self.id });
    expect(busy.status).toBe(409);
    expect((await busy.json()).error).toContain('Agent turns are queued or running');
    runRegistry.release(runId);

    delete globalScope.__codeaiManagedLifecycle;
    delete globalScope.__codeAiLifecycle;
    const unmanaged = await start({ action: 'build-and-restart', projectId: self.id });
    expect(unmanaged.status).toBe(409);
    expect((await unmanaged.json()).error).toContain('npm run start:managed');
    expect(fake.sent).toEqual([]);
  });
});
