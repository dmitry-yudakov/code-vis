import { mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ managed: true, phase: 'idle', machineRequest: false }));
vi.mock('@/server/lifecycle/codeAiLifecycle', () => ({ getCodeAiLifecycle: () => state.managed
  ? { managed: true, snapshot: () => ({ phase: state.phase }) } : undefined }));
vi.mock('@/server/devices/deviceAuthorization', async (original) => ({
  ...await original<typeof import('@/server/devices/deviceAuthorization')>(),
  authenticatedMachineRequest: async () => state.machineRequest ? { homeMachineId: 'attached-home' } : undefined,
}));

import { GET, POST } from '@/app/api/codeai-session/route';
import { getConfig } from '@/server/config';
import { getSessionStore, type SessionStore } from '@/server/storage/sessionStore';
import { machineOperationAllowed } from '@/server/machines/machineRoutePolicy';

let root: string;
let store: SessionStore;
const post = (body: unknown) => POST(new Request('http://localhost/api/codeai-session', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'codeai-self-launch-'));
  await mkdir(path.join(root, 'repositories/codeai/.git'), { recursive: true });
  await mkdir(path.join(root, 'repositories/lookalike/.git'), { recursive: true });
  vi.stubEnv('CODEAI_DATA_DIR', path.join(root, 'data'));
  vi.stubEnv('CODEAI_REPOSITORIES_ROOT', path.join(root, 'repositories'));
  vi.stubEnv('CODEAI_INSTALLATION_ROOT', path.join(root, 'repositories/codeai'));
  vi.stubEnv('CODEAI_REMOTE_ACCESS', 'local');
  state.managed = true; state.phase = 'idle'; state.machineRequest = false;
  store = getSessionStore(getConfig().dataDir, 'Self fixture');
});
afterEach(async () => { await store.close(); vi.unstubAllEnvs(); });

describe('managed installation session setup', () => {
  it('discovers independently of current project, with no mutation or leaked path', async () => {
    const response = await GET(new Request('http://localhost/api/codeai-session'));
    expect(response.status).toBe(200);
    const availability = await response.json();
    expect(availability).toMatchObject({ available: true, phase: 'idle', checkoutName: 'codeai' });
    expect(JSON.stringify(availability)).not.toContain(root);
    expect(await store.listProjects()).toEqual([]);
    expect(await store.listSessions()).toEqual([]);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('prepares one self project concurrently and creates one Local session with exact replay', async () => {
    const preparations = await Promise.all([post({ action: 'prepare' }), post({ action: 'prepare' })]);
    const [a, b] = await Promise.all(preparations.map((response) => response.json()));
    expect(a.preparedContext).toEqual(b.preparedContext);
    expect(await store.listProjects()).toHaveLength(1);
    const request = { action: 'create', preparedContext: a.preparedContext, provider: 'claude', creationRequestId: crypto.randomUUID() };
    const created = await post(request);
    expect(created.status).toBe(201);
    const session = (await created.json()).session;
    expect(session).toMatchObject({ projectId: a.project.id, execution: 'local', repositories: a.project.repositories });
    expect(session).not.toHaveProperty('creationReceipt');
    expect((await post({ ...request, preparedContext: { ...a.preparedContext, checkoutId: 'forged' } })).status).toBe(409);
    await store.deleteProject(a.project.id, a.project.revision);
    expect((await (await post(request)).json()).session.id).toBe(session.id);
    expect(await store.listSessions()).toHaveLength(1);
  });

  it('rejects changed prepared bindings and forged execution or checkout fields without retargeting', async () => {
    const prepared = await (await post({ action: 'prepare' })).json();
    const project = prepared.project;
    await store.updateProject(project.id, { expectedRevision: project.revision, repositories: [] });
    const request = { action: 'create', preparedContext: prepared.preparedContext, provider: 'claude', creationRequestId: crypto.randomUUID() };
    expect((await post(request)).status).toBe(409);
    expect((await post({ ...request, execution: 'docker' })).status).toBe(400);
    expect((await post({ ...request, checkoutId: 'lookalike' })).status).toBe(400);
    expect(await store.listSessions()).toEqual([]);
    expect(await store.listProjects()).toHaveLength(1);
  });

  it('allows a renamed verified self project, and refuses unmanaged, maintenance, or machine-auth calls', async () => {
    const prepared = await (await post({ action: 'prepare' })).json();
    await store.updateProject(prepared.project.id, { expectedRevision: prepared.project.revision, name: 'Renamed installation' });
    const request = { action: 'create', preparedContext: prepared.preparedContext, provider: 'codex', creationRequestId: crypto.randomUUID() };
    state.phase = 'building';
    expect((await post(request)).status).toBe(409);
    state.phase = 'idle';
    expect((await post(request)).status).toBe(201);
    state.managed = false;
    expect(await (await GET(new Request('http://localhost'))).json()).toMatchObject({ available: false, reason: 'not-managed' });
    expect((await post({ action: 'prepare' })).status).toBe(409);
    state.machineRequest = true;
    expect((await post({ action: 'prepare' })).status).toBe(403);
    expect(machineOperationAllowed('GET', ['codeai-session'])).toBe(false);
    expect(machineOperationAllowed('POST', ['codeai-session'])).toBe(false);
  });
});
