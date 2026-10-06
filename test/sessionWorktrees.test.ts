import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConfig } from '@/server/config';
import { CheckoutRegistry, getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { createManagedWorktree, readWorktreeRecords, reconcileWorktrees, resolveManagedWorktree, sourceWorktreeCapability, worktreeCapability } from '@/server/repository/managedWorktrees';
import { runGitRead } from '@/server/repository/gitRead';
import { resolveSelfProject } from '@/server/repository/selfProject';
import { getSessionStore, publicSession, type SessionStore } from '@/server/storage/sessionStore';
import * as sessionStorage from '@/server/storage/sessionStore';
import * as managedWorktrees from '@/server/repository/managedWorktrees';
import { runRegistry } from '@/server/runs/runRegistry';
import { TurnCheckpoints } from '@/server/repository/turnCheckpoints';
import { RepositoryModelStore } from '@/server/model/repositoryModelStore';
import { createSessionRequestSchema } from '@/shared/protocol';
import { durableSessionSchema, publicSessionSchema } from '@/shared/sessionSchema';
import { POST } from '@/app/api/sessions/route';
import { PUT as PUT_REPOSITORIES } from '@/app/api/sessions/[sessionId]/repositories/route';
import { POST as POST_MESSAGE } from '@/app/api/agent/message/route';

const execute = promisify(execFile);
let root: string; let source: string; let store: SessionStore; let checkoutId: string;
const git = async (cwd: string, ...args: string[]) => (await execute('git', args, { cwd, env: {
  PATH: process.env.PATH, HOME: '/nonexistent', NODE_ENV: 'test', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
} })).stdout.trim();
const request = (extra: Record<string, unknown> = {}) => createSessionRequestSchema.parse({ provider: 'claude',
  execution: 'local', checkoutMode: 'worktree', creationRequestId: randomUUID(), checkoutId, ...extra });
const create = (body: unknown) => POST(new Request('http://localhost/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'codeai-worktrees-'));
  source = path.join(root, 'source'); await mkdir(source);
  vi.stubEnv('CODEAI_REPOSITORIES_ROOT', source);
  vi.stubEnv('CODEAI_DATA_DIR', path.join(root, 'data'));
  vi.stubEnv('CODEAI_WORKTREES_ROOT', path.join(root, 'worktrees'));
  await git(source, 'init', '-q');
  await git(source, 'config', 'user.name', 'Worktree fixture'); await git(source, 'config', 'user.email', 'test@example.invalid');
  await writeFile(path.join(source, 'file.txt'), 'committed\n');
  await writeFile(path.join(source, '.gitignore'), 'ignored.txt\nnode_modules/\n.env.local\n');
  await git(source, 'add', '.'); await git(source, 'commit', '-qm', 'fixture');
  checkoutId = (await new CheckoutRegistry(source).list())[0].id;
  store = getSessionStore(getConfig().dataDir, 'Worktree fixture');
});
afterEach(async () => { vi.restoreAllMocks(); await store.close(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

describe('managed session worktrees with real Git', () => {
  it('materializes only the committed baseline, preserves dirty source/index, and keeps project identity', async () => {
    await writeFile(path.join(source, 'file.txt'), 'staged\n'); await git(source, 'add', 'file.txt');
    await writeFile(path.join(source, 'file.txt'), 'unstaged\n');
    await writeFile(path.join(source, 'untracked.txt'), 'untracked'); await writeFile(path.join(source, 'ignored.txt'), 'local setup');
    await writeFile(path.join(source, '.env.local'), 'private'); await mkdir(path.join(source, 'node_modules'));
    const head = await git(source, 'rev-parse', 'HEAD'); const branch = await git(source, 'branch', '--show-current');
    const index = await readFile(path.join(source, '.git/index')); const status = await git(source, 'status', '--porcelain');
    const project = await store.createProject('Project', [checkoutId]);
    const ordinary = await store.createSession({ provider: 'claude', projectId: project.id });
    const session = await createManagedWorktree(request({ checkoutId: undefined, projectId: project.id }), getConfig());
    const checkout = await getCheckoutRegistry(source).resolve(session.repositories[0].checkoutId);
    expect(session).toMatchObject({ version: 10, projectId: project.id, worktree: { originCheckoutId: checkoutId, baseCommit: head, branch: `codeai/session-${session.id}` } });
    expect(await git(checkout.realPath, 'rev-parse', 'HEAD')).toBe(head);
    expect(await git(checkout.realPath, 'branch', '--show-current')).toBe(session.worktree!.branch);
    expect(await readFile(path.join(checkout.realPath, 'file.txt'), 'utf8')).toBe('committed\n');
    for (const file of ['untracked.txt', 'ignored.txt', '.env.local', 'node_modules']) await expect(lstat(path.join(checkout.realPath, file))).rejects.toThrow();
    expect(await git(source, 'rev-parse', 'HEAD')).toBe(head); expect(await git(source, 'branch', '--show-current')).toBe(branch);
    expect(await readFile(path.join(source, '.git/index'))).toEqual(index); expect(await git(source, 'status', '--porcelain')).toBe(status);
    expect((await store.getProject(project.id)).repositories).toEqual(project.repositories);
    expect(await resolveSelfProject(project.id, { ...getConfig(), installationRoot: source })).toEqual(project);
    expect((await store.getSession(ordinary.id)).repositories).toEqual(ordinary.repositories);
    expect(JSON.stringify(publicSession(session))).not.toContain(root);
    expect(publicSessionSchema.safeParse(publicSession(session)).success).toBe(true);
    expect(durableSessionSchema.safeParse({ ...session, version: 9 }).success).toBe(false);
  });

  it('deduplicates lost responses, rejects mismatches, and inherits provenance from current-checkout creation', async () => {
    const input = request(); const first = await create(input); expect(first.status).toBe(201);
    const session = (await first.json()).session;
    const duplicate = await create(input); expect(duplicate.status).toBe(201); expect((await duplicate.json()).session.id).toBe(session.id);
    expect((await create({ ...input, provider: 'codex' })).status).toBe(409);
    const shared = await create({ provider: 'claude', checkoutId: session.repositories[0].checkoutId });
    expect(shared.status).toBe(201); const current = (await shared.json()).session;
    expect(current.worktree).toEqual(session.worktree);
    const continuation = await create({ provider: 'claude', execution: 'local', sourceSessionId: session.id });
    const next = (await continuation.json()).session;
    expect(next.worktree).toEqual(session.worktree); expect(next.repositories).toEqual(session.repositories);
    expect(next.primaryAgentId).not.toBe(session.primaryAgentId);
    expect((await create({ provider: 'claude', execution: 'docker', sourceSessionId: session.id })).status).toBe(409);
    expect(await readWorktreeRecords(getConfig().dataDir)).toHaveLength(1);
    await expect(store.createProject('Wrong', [session.repositories[0].checkoutId])).rejects.toThrow(/cannot be added/);
  });

  it('keeps managed bindings fixed and idempotent without attaching them to the project', async () => {
    const project = await store.createProject('Project', [checkoutId]);
    const session = await createManagedWorktree(request({ checkoutId: undefined, projectId: project.id }), getConfig());
    const update = (repositories: unknown[]) => PUT_REPOSITORIES(new Request('http://localhost', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: session.revision, repositories }) }), { params: Promise.resolve({ sessionId: session.id }) });
    expect((await update(session.repositories)).status).toBe(200);
    expect((await update(project.repositories)).status).toBe(409);
    expect((await update([{ ...session.repositories[0], checkoutId: 'unknown-checkout' }])).status).toBe(409);
    expect((await store.getProject(project.id)).repositories).toEqual(project.repositories);
    await expect(store.updateProject(project.id, { expectedRevision: project.revision, repositories: session.repositories })).rejects.toThrow(/cannot be added/);
    const ordinary = await store.createSession({ provider: 'claude' });
    await expect(store.setSessionRepositories(ordinary.id, session.repositories, ordinary.revision)).rejects.toThrow(/cannot be added/);
  });

  it('finishes a failed session save on matching retry and after restart without recapturing the source HEAD', async () => {
    const input = request(); const save = vi.spyOn(store, 'savePreparedWorktreeSession').mockRejectedValueOnce(Object.assign(new Error('disk full'), { code: 'ENOSPC' }));
    await expect(createManagedWorktree(input, getConfig())).rejects.toThrow(/retained/);
    const [intent] = await readWorktreeRecords(getConfig().dataDir); expect(intent.state).toBe('materialized');
    expect(await store.listSessions()).toEqual([]);
    await writeFile(path.join(source, 'file.txt'), 'new commit'); await git(source, 'add', '.'); await git(source, 'commit', '-qm', 'later');
    save.mockRestore(); await store.close();
    await reconcileWorktrees(getConfig());
    const session = await createManagedWorktree(input, getConfig());
    expect(session.id).toBe(intent.session.id); expect(session.worktree!.baseCommit).toBe(intent.session.worktree!.baseCommit);
    expect(await git((await getCheckoutRegistry(source).resolve(session.repositories[0].checkoutId)).realPath, 'rev-parse', 'HEAD')).toBe(intent.session.worktree!.baseCommit);
  });

  it('retains an immutable intent before mutation across changed project bindings and HEAD', async () => {
    const project = await store.createProject('Frozen project', [checkoutId]);
    const originalHead = await git(source, 'rev-parse', 'HEAD');
    const input = request({ checkoutId: undefined, projectId: project.id });
    const originalWrite = sessionStorage.atomicWrite;
    const spy = vi.spyOn(sessionStorage, 'atomicWrite').mockImplementation(async (...args) => {
      await originalWrite(...args);
      if (args[0].endsWith(`${input.creationRequestId}.json`) && (args[1] as { state: string }).state === 'intent') throw Object.assign(new Error('interruption'), { code: 'EIO' });
    });
    await expect(createManagedWorktree(input, getConfig())).rejects.toThrow(/retained/);
    spy.mockRestore();
    const records = await readWorktreeRecords(getConfig().dataDir);
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.state).toBe('intent');
    await store.updateProject(project.id, { expectedRevision: project.revision, repositories: [] });
    await writeFile(path.join(source, 'file.txt'), 'later'); await git(source, 'add', '.'); await git(source, 'commit', '-qm', 'later');
    await reconcileWorktrees(getConfig());
    const session = await createManagedWorktree(input, getConfig());
    expect(session.worktree!.baseCommit).toBe(originalHead); expect(session.projectId).toBe(project.id);
    expect(session.repositories[0].checkoutId).toBe(record.checkoutId);
  });

  it('holds the existing maintenance lease through persistence and rejects runs, Undo, and duplicate submissions', async () => {
    const input = request(); let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const original = store.savePreparedWorktreeSession.bind(store);
    const save = vi.spyOn(store, 'savePreparedWorktreeSession').mockImplementation(async (session) => { await wait; return original(session); });
    const pending = createManagedWorktree(input, getConfig());
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    expect(runRegistry.reserve({ runId: randomUUID(), sessionId: randomUUID(), participantId: 'agent', providerKey: 'test', checkoutId, access: 'write', cancel() {} })).toMatchObject({ accepted: false, reason: 'maintenance' });
    expect(runRegistry.acquireCheckoutWrite(source)).toBeUndefined();
    await expect(createManagedWorktree(input, getConfig())).rejects.toThrow(/idle machine/);
    release(); await pending;
    const undo = runRegistry.acquireCheckoutWrite(source)!;
    try { await expect(createManagedWorktree(request(), getConfig())).rejects.toThrow(/idle machine/); } finally { undo(); }
    const runId = randomUUID(); runRegistry.reserve({ runId, sessionId: randomUUID(), participantId: 'agent', providerKey: runId, checkoutId, access: 'write', cancel() {} });
    try { await expect(createManagedWorktree(request(), getConfig())).rejects.toThrow(/idle machine/); } finally { runRegistry.release(runId); }
  });

  it.each(['before-git', 'complete-git', 'partial-git', 'external-ignore'] as const)('reconciles the %s restart boundary conservatively', async (boundary) => {
    const input = request(); const originalWrite = sessionStorage.atomicWrite;
    const save = vi.spyOn(sessionStorage, 'atomicWrite').mockImplementation(async (...args) => {
      await originalWrite(...args);
      if (args[0].endsWith(`${input.creationRequestId}.json`) && (args[1] as { state: string }).state === 'creating'
        && !(args[1] as { gitDirectory?: unknown }).gitDirectory) throw Object.assign(new Error('stopped before Git'), { code: 'EIO' });
    });
    await expect(createManagedWorktree(input, getConfig())).rejects.toThrow(/retained/); save.mockRestore();
    const [record] = await readWorktreeRecords(getConfig().dataDir); expect(record.state).toBe('creating');
    if (boundary !== 'before-git') {
      await git(source, 'worktree', 'add', '--no-checkout', '-b', record.session.worktree!.branch, record.destination, record.session.worktree!.baseCommit);
      if (boundary === 'complete-git' || boundary === 'external-ignore') await git(record.destination, 'read-tree', '--reset', '-u', record.session.worktree!.baseCommit);
      if (boundary === 'external-ignore') {
        const privateIgnore = path.join(root, 'private-ignore'); await writeFile(privateIgnore, 'extra.txt\n');
        await git(source, 'config', 'core.excludesFile', privateIgnore);
        await writeFile(path.join(record.destination, 'extra.txt'), 'retained user work');
      }
    }
    await reconcileWorktrees(getConfig());
    if (boundary === 'partial-git' || boundary === 'external-ignore') {
      expect((await readWorktreeRecords(getConfig().dataDir))[0].state).toBe('unavailable');
      await expect(createManagedWorktree(input, getConfig())).rejects.toThrow(/ambiguous/);
      expect(await lstat(record.destination)).toBeDefined();
      expect(await git(source, 'branch', '--list', record.session.worktree!.branch)).toContain(record.session.worktree!.branch);
      expect((await getCheckoutRegistry(source).resolve(checkoutId)).realPath).toBe(source);
    } else {
      const session = await createManagedWorktree(input, getConfig()); expect(session.id).toBe(record.session.id);
      expect(await readFile(path.join(record.destination, 'file.txt'), 'utf8')).toBe('committed\n');
    }
  });

  it('refuses a pre-existing destination without touching it or creating a branch', async () => {
    const input = request(); const originalWrite = sessionStorage.atomicWrite;
    const save = vi.spyOn(sessionStorage, 'atomicWrite').mockImplementation(async (...args) => {
      await originalWrite(...args);
      const record = args[1] as { state?: string; destination?: string };
      if (args[0].endsWith(`${input.creationRequestId}.json`) && record.state === 'intent') {
        await mkdir(record.destination!); await writeFile(path.join(record.destination!, 'keep.txt'), 'existing');
      }
    });
    await expect(createManagedWorktree(input, getConfig())).rejects.toThrow(/already exists/); save.mockRestore();
    const [record] = await readWorktreeRecords(getConfig().dataDir);
    expect(await readFile(path.join(record.destination, 'keep.txt'), 'utf8')).toBe('existing');
    expect(await git(source, 'branch', '--list', 'codeai/*')).toBe(''); expect(await store.listSessions()).toEqual([]);
  });

  it('does not let retained failed creation block unrelated ready checkouts while another run is active', async () => {
    const ready = await createManagedWorktree(request(), getConfig());
    const save = vi.spyOn(store, 'savePreparedWorktreeSession').mockRejectedValue(Object.assign(new Error('disk full'), { code: 'ENOSPC' }));
    await expect(createManagedWorktree(request(), getConfig())).rejects.toThrow(/retained/);
    const runId = randomUUID();
    expect(runRegistry.reserve({ runId, sessionId: randomUUID(), participantId: 'agent', providerKey: runId,
      checkoutId: 'unrelated', checkoutPath: path.join(root, 'unrelated'), access: 'write', cancel() {} }).accepted).toBe(true);
    try {
      expect((await getCheckoutRegistry(source).resolve(checkoutId)).realPath).toBe(source);
      expect((await getCheckoutRegistry(source).resolve(ready.repositories[0].checkoutId)).worktree).toEqual(ready.worktree);
      const unfinished = (await readWorktreeRecords(getConfig().dataDir)).find((record) => record.state !== 'ready')!;
      await expect(getCheckoutRegistry(source).resolve(unfinished.checkoutId)).rejects.toThrow(/unfinished/);
    } finally { runRegistry.release(runId); save.mockRestore(); }
  });

  it('keeps complete checkout catalogs when concurrent refreshes interleave managed validation', async () => {
    const checkoutIds: string[] = [checkoutId];
    // Creation uses one maintenance lease, so only catalog reads are concurrent here.
    for (let count = 0; count < 3; count++) checkoutIds.push((await createManagedWorktree(request(), getConfig())).repositories[0].checkoutId);
    const registry = getCheckoutRegistry(source);
    const original = managedWorktrees.resolveManagedWorktree;
    let releaseFirst!: () => void; const firstWait = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let releaseSecond!: () => void; const secondWait = new Promise<void>((resolve) => { releaseSecond = resolve; });
    let calls = 0;
    const resolve = vi.spyOn(managedWorktrees, 'resolveManagedWorktree').mockImplementation(async (...args) => {
      const call = ++calls;
      if (call === 2) await firstWait;
      if (call === 3) await secondWait;
      return original(...args);
    });
    const first = registry.refresh();
    await vi.waitFor(() => expect(calls).toBe(2));
    const second = registry.refresh();
    try {
      await vi.waitFor(() => expect(calls).toBe(3)); releaseFirst();
      expect((await first).map((checkout) => checkout.id).sort()).toEqual(checkoutIds.sort());
    } finally { releaseFirst(); releaseSecond(); await second; resolve.mockRestore(); }
  });

  it('keeps two writing checkouts independent and restores only the worktree through Undo', async () => {
    const a = await createManagedWorktree(request(), getConfig()); const b = await createManagedWorktree(request(), getConfig());
    const registry = getCheckoutRegistry(source); const ca = await registry.resolve(a.repositories[0].checkoutId); const cb = await registry.resolve(b.repositories[0].checkoutId);
    const checkpoints = new TurnCheckpoints(getConfig().dataDir);
    const saved = await checkpoints.capture({ runId: randomUUID(), sessionId: a.id, messageId: randomUUID(), checkoutId: ca.id, checkoutPath: ca.realPath });
    const started: string[] = []; let finish!: () => void; const wait = new Promise<void>((resolve) => { finish = resolve; });
    const runIds: string[] = [];
    for (const [session, checkout] of [[a, ca], [b, cb]] as const) {
      const runId = randomUUID(); runIds.push(runId);
      expect(runRegistry.reserve({ runId, sessionId: session.id, participantId: session.primaryAgentId, providerKey: session.primaryAgentId,
        checkoutId: checkout.id, checkoutPath: checkout.realPath, access: 'write', cancel() {} }).accepted).toBe(true);
      runRegistry.activate(runId, { async execute() { started.push(session.id); await writeFile(path.join(checkout.realPath, 'file.txt'), session.id); await wait; }, async cancelQueued() {} });
    }
    await vi.waitFor(() => expect(started).toHaveLength(2)); finish(); await Promise.all(runIds.map((id) => runRegistry.wait(id)));
    await checkpoints.finish(saved); await checkpoints.undo(saved);
    expect(await readFile(path.join(ca.realPath, 'file.txt'), 'utf8')).toBe('committed\n');
    expect(await readFile(path.join(cb.realPath, 'file.txt'), 'utf8')).toBe(b.id);
    expect(await readFile(path.join(source, 'file.txt'), 'utf8')).toBe('committed\n');
    expect((await runGitRead(ca.realPath, ['branch', '--show-current'])).trim()).toBe(a.worktree!.branch);
    const models = new RepositoryModelStore();
    const model = { entities: [{ id: 'repo:file:file.txt', kind: 'file' as const, name: 'file.txt', origin: 'llm' as const, description: 'First worktree' }], relations: [] };
    expect(models.merge(ca.realPath, model).ok).toBe(true);
    expect(models.get(cb.realPath)).toEqual({ entities: [], relations: [] });
    expect(models.merge(cb.realPath, { ...model, entities: [{ ...model.entities[0], description: 'Second worktree' }] }).ok).toBe(true);
    expect(models.get(ca.realPath).entities[0].description).toBe('First worktree');
  });

  it('preserves archive/Restore and missing-checkout history; refuses replaced Git linkage', async () => {
    const session = await createManagedWorktree(request(), getConfig()); const [record] = await readWorktreeRecords(getConfig().dataDir);
    const archived = await store.archiveSession(session.id, session.revision); await store.close();
    expect((await store.getArchivedSession(session.id)).worktree).toEqual(session.worktree);
    const restored = await store.restoreSession(session.id, archived.revision); expect(restored.worktree).toEqual(session.worktree);
    await rename(record.destination, `${record.destination}-moved`);
    await expect(getCheckoutRegistry(source).resolve(record.checkoutId)).rejects.toThrow();
    expect((await store.getSession(session.id)).worktree).toEqual(session.worktree);
    await rename(`${record.destination}-moved`, record.destination);
    await writeFile(path.join(record.destination, '.git'), `gitdir: ${path.join(source, '.git')}\n`);
    await expect(resolveManagedWorktree(record, getConfig())).rejects.toThrow(/linkage/);
    await expect(runGitRead(record.destination, ['status', '--porcelain'])).rejects.toThrow(/linkage/);
  });

  it('blocks creation and operations after Docker provisioning even with Docker disabled', async () => {
    const session = await createManagedWorktree(request(), getConfig()); const [record] = await readWorktreeRecords(getConfig().dataDir);
    await mkdir(path.join(getConfig().dataDir, 'docker')); await writeFile(path.join(getConfig().dataDir, 'docker/profile.json'), '{}');
    expect((await worktreeCapability(getConfig())).message).toMatch(/helper lacks linked/);
    await expect(createManagedWorktree(request(), getConfig())).rejects.toThrow(/Docker-provisioned/);
    await expect(getCheckoutRegistry(source).resolve(record.checkoutId)).rejects.toThrow(/Docker-provisioned/);
    await expect(runGitRead(record.destination, ['status'])).rejects.toThrow(/Docker-provisioned/);
    const turn = await POST_MESSAGE(new Request('http://localhost/api/agent/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      sessionId: session.id, messageId: randomUUID(), participantId: session.primaryAgentId, text: 'test', mode: 'ask', diagramAttachments: [],
    }) }));
    expect(turn.status).toBe(409); expect((await turn.json()).error).toMatch(/Docker-provisioned/);
    expect((await store.getSession(session.id)).messages).toEqual([]);
  });

  it.each(['filter', 'promisor', 'alternates', 'symlink', 'unborn', 'submodule', 'missing-object'])('refuses %s before mutation and never executes fixture filters or credential helpers', async (kind) => {
    const marker = path.join(root, 'marker');
    await git(source, 'config', 'credential.helper', `!touch ${marker}`);
    if (kind === 'filter') { await git(source, 'config', 'filter.fixture.process', `touch ${marker}`); await writeFile(path.join(source, '.gitattributes'), '* filter=fixture\n'); }
    if (kind === 'promisor') { await git(source, 'config', 'remote.origin.promisor', 'true'); await git(source, 'config', 'remote.origin.url', `ext::touch ${marker}`); }
    if (kind === 'alternates') await writeFile(path.join(source, '.git/objects/info/alternates'), '/outside/objects\n');
    if (kind === 'symlink') { await rename(path.join(source, '.git/objects'), path.join(root, 'objects')); await symlink(path.join(root, 'objects'), path.join(source, '.git/objects')); }
    if (kind === 'unborn') await git(source, 'symbolic-ref', 'HEAD', 'refs/heads/unborn');
    if (kind === 'submodule') { const head = await git(source, 'rev-parse', 'HEAD'); await git(source, 'update-index', '--add', '--cacheinfo', `160000,${head},submodule`); await git(source, 'commit', '-qm', 'submodule'); }
    if (kind === 'missing-object') { const blob = await git(source, 'rev-parse', 'HEAD:file.txt'); await rm(path.join(source, '.git/objects', blob.slice(0, 2), blob.slice(2))); }
    await expect(createManagedWorktree(request(), getConfig())).rejects.toThrow();
    expect(await store.listSessions()).toEqual([]); expect(await readWorktreeRecords(getConfig().dataDir)).toEqual([]);
    expect(await git(source, 'branch', '--list', 'codeai/*')).toBe(''); await expect(lstat(marker)).rejects.toThrow();
  });

  it('suppresses checkout hooks while creating and refuses unsafe roots and changed parents', async () => {
    const marker = path.join(root, 'hook-marker'); const hook = path.join(source, '.git/hooks/post-checkout');
    await writeFile(hook, `#!/bin/sh\ntouch '${marker}'\n`); await chmod(hook, 0o755);
    await createManagedWorktree(request(), getConfig()); await expect(lstat(marker)).rejects.toThrow();
    const [record] = await readWorktreeRecords(getConfig().dataDir);
    vi.stubEnv('CODEAI_WORKTREES_ROOT', source); await expect(createManagedWorktree(request(), getConfig())).rejects.toThrow(/separate/);
    vi.stubEnv('CODEAI_WORKTREES_ROOT', path.join(root, 'worktrees'));
    await rename(record.root, `${record.root}-old`); await symlink(`${record.root}-old`, record.root);
    await expect(resolveManagedWorktree(record, getConfig())).rejects.toThrow(/symbolic|parent|unavailable/);
    expect((await store.getSession(record.session.id)).id).toBe(record.session.id);
  });

  it('supports SHA-256 object ids', async () => {
    await rm(path.join(source, '.git'), { recursive: true, force: true });
    await git(source, 'init', '-q', '--object-format=sha256'); await git(source, 'config', 'user.name', 'Fixture'); await git(source, 'config', 'user.email', 'test@example.invalid');
    await git(source, 'add', '.'); await git(source, 'commit', '-qm', 'sha256');
    const session = await createManagedWorktree(request(), getConfig()); expect(session.worktree!.baseCommit).toHaveLength(64);
  });

  it('isolates a damaged journal entry but counts unfinished intents toward the host session limit', async () => {
    const session = await createManagedWorktree(request(), getConfig());
    const directory = path.join(getConfig().dataDir, 'worktrees');
    await Promise.all(Array.from({ length: 999 }, () => writeFile(path.join(directory, `${randomUUID()}.json`), 'damaged')));
    expect((await getCheckoutRegistry(source).resolve(session.repositories[0].checkoutId)).worktree).toEqual(session.worktree);
    await expect(store.createSession({ provider: 'claude' })).rejects.toThrow(/at most 1000 sessions/);
    await expect(createManagedWorktree(request(), getConfig())).rejects.toThrow(/at most 1000 sessions/);
    expect(await git(source, 'branch', '--list', '--format=%(refname:short)', 'codeai/*')).toBe(session.worktree!.branch);
  });

  it('rejects multiple-repository and repository-free worktree creation without affecting ordinary creation', async () => {
    const project = await store.createProject('Unbound project', []);
    expect((await create({ provider: 'claude', projectId: project.id })).status).toBe(201);
    expect((await create(request({ checkoutId: undefined, projectId: project.id }))).status).toBe(400);
    const host = await store.host();
    const multi = await store.updateProject(project.id, { expectedRevision: project.revision, repositories: [
      { id: randomUUID(), hostId: host.id, checkoutId, role: 'primary' },
      { id: randomUUID(), hostId: host.id, checkoutId: 'other-checkout', role: 'reference' },
    ] });
    expect((await create(request({ checkoutId: undefined, projectId: multi.id }))).status).toBe(400);
    expect(await readWorktreeRecords(getConfig().dataDir)).toEqual([]);
  });

  it('reserves the final host slot atomically before another ordinary session can be admitted', async () => {
    await store.host(); const directory = path.join(getConfig().dataDir, 'worktrees'); await mkdir(directory);
    await Promise.all(Array.from({ length: 999 }, () => writeFile(path.join(directory, `${randomUUID()}.json`), 'damaged')));
    let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; });
    const original = store.prepareWorktreeSession.bind(store);
    let prepared = false;
    const prepare = vi.spyOn(store, 'prepareWorktreeSession').mockImplementation(async (...args) => {
      const session = await original(...args); prepared = true; await wait; return session;
    });
    const pending = createManagedWorktree(request(), getConfig());
    try {
      await vi.waitFor(() => expect(prepared).toBe(true));
      await expect(store.createSession({ provider: 'claude' })).rejects.toThrow(/at most 1000 sessions/);
    } finally { release(); prepare.mockRestore(); }
    const session = await pending;
    expect(await readWorktreeRecords(getConfig().dataDir)).toHaveLength(1);
    expect((await store.listSessions()).map((item) => item.id)).toEqual([session.id]);
  });

  it.each([
    { checkoutMode: 'unknown' }, { execution: 'docker' }, { creationRequestId: undefined }, { checkoutId: undefined },
    { sourceSessionId: randomUUID() }, { path: '/outside' }, { branch: 'chosen' }, { flags: ['--force'] },
  ])('strictly rejects malformed worktree requests %j', async (invalid) => {
    const valid = request(); const response = await create({ ...valid, ...invalid }); expect(response.status).toBe(400);
    expect(await readWorktreeRecords(getConfig().dataDir)).toEqual([]);
  });
});
