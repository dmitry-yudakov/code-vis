import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
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
import * as gitReader from '@/server/repository/gitRead';
import { runRegistry } from '@/server/runs/runRegistry';
import { TurnCheckpoints } from '@/server/repository/turnCheckpoints';
import { RepositoryModelStore } from '@/server/model/repositoryModelStore';
import { createSessionRequestSchema } from '@/shared/protocol';
import { durableSessionSchema, publicSessionSchema } from '@/shared/sessionSchema';
import { POST } from '@/app/api/sessions/route';
import { PUT as PUT_REPOSITORIES } from '@/app/api/sessions/[sessionId]/repositories/route';
import { DockerRuntime, DockerTerminationError } from '@/server/execution/dockerRuntime';
import { validateDockerCheckout } from '@/server/execution/dockerProfile';
import { worktreeChoice } from '@/features/conversation/worktreeChoice';

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
  vi.stubEnv('CODEAI_REMOTE_ACCESS', 'local');
  vi.stubEnv('CODEAI_DOCKER_ENABLED', 'false');
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
  it.each([['source', false], ['sibling', false], ['source', true], ['sibling', true]] as const)(
    'creates an independent worktree while a %s writing turn is running (Docker provisioned: %s)', async (location, provisioned) => {
    const first = location === 'sibling' ? await createManagedWorktree(request(), getConfig()) : undefined;
    const [sibling] = await readWorktreeRecords(getConfig().dataDir);
    const workingPath = sibling?.destination || source;
    const baseline = await git(source, 'rev-parse', 'HEAD');
    await writeFile(path.join(workingPath, 'file.txt'), 'unfinished task\n');
    const indexPath = sibling ? path.join(sibling.gitDirectory!.path, 'index') : path.join(source, '.git', 'index');
    const index = await readFile(indexPath);
    if (provisioned) {
      await mkdir(path.join(getConfig().dataDir, 'docker'), { recursive: true });
      await writeFile(path.join(getConfig().dataDir, 'docker/profile.json'), '{}');
      vi.spyOn(DockerRuntime.prototype, 'reconcile').mockResolvedValue([]);
      vi.spyOn(gitReader, 'isolatedGitRead').mockImplementation(async (cwd, args) => git(cwd, ...args));
    }
    const runId = randomUUID();
    const executeTurn = vi.fn(async () => new Promise<void>(() => {}));
    expect(runRegistry.reserve({ runId, sessionId: first?.id || randomUUID(), participantId: 'agent', providerKey: runId,
      checkoutId: sibling?.checkoutId || checkoutId, checkoutPath: workingPath, access: 'write', cancel() {} }).accepted).toBe(true);
    runRegistry.activate(runId, { execute: executeTurn, cancelQueued: async () => {} });
    await vi.waitFor(() => expect(executeTurn).toHaveBeenCalledOnce());
    try {
      const response = await create(request());
      expect(response.status).toBe(201);
      const created = (await response.json()).session;
      expect(created.worktree.baseCommit).toBe(baseline);
      const record = (await readWorktreeRecords(getConfig().dataDir)).find((entry) => entry.session.id === created.id)!;
      expect(record.destination).not.toBe(workingPath);
      expect(await readFile(path.join(record.destination, 'file.txt'), 'utf8')).toBe('committed\n');
      expect(await readFile(path.join(workingPath, 'file.txt'), 'utf8')).toBe('unfinished task\n');
      expect(await readFile(indexPath)).toEqual(index);
      expect(runRegistry.list().active).toContainEqual(expect.objectContaining({ runId, state: 'running' }));
    } finally { runRegistry.finish(runId); }
  });

  it('keeps the captured baseline when a running source task commits during creation', async () => {
    const baseline = await git(source, 'rev-parse', 'HEAD');
    const prepare = store.prepareWorktreeSession.bind(store);
    vi.spyOn(store, 'prepareWorktreeSession').mockImplementationOnce(async (...args) => {
      await writeFile(path.join(source, 'file.txt'), 'new source commit\n');
      await git(source, 'add', '.'); await git(source, 'commit', '-qm', 'concurrent source task');
      return prepare(...args);
    });
    const runId = randomUUID();
    runRegistry.reserve({ runId, sessionId: randomUUID(), participantId: 'agent', providerKey: runId,
      checkoutId, checkoutPath: source, access: 'write', execution: 'local', cancel() {} });
    runRegistry.activate(runId, { execute: async () => new Promise<void>(() => {}), cancelQueued: async () => {} });
    try {
      const created = await createManagedWorktree(request(), getConfig());
      expect(created.worktree!.baseCommit).toBe(baseline);
      const [record] = await readWorktreeRecords(getConfig().dataDir);
      expect(await readFile(path.join(record.destination, 'file.txt'), 'utf8')).toBe('committed\n');
      expect(await readFile(path.join(source, 'file.txt'), 'utf8')).toBe('new source commit\n');
      expect(await git(source, 'rev-parse', 'HEAD')).not.toBe(baseline);
      expect(await git(source, 'status', '--porcelain')).toBe('');
    } finally { runRegistry.finish(runId); }
  });

  it.each(['metadata', 'refs', 'filter'] as const)('refuses a concurrent source %s change at the mutation boundary', async (change) => {
    const input = request(); const originalWrite = sessionStorage.atomicWrite;
    vi.spyOn(sessionStorage, 'atomicWrite').mockImplementation(async (...args) => {
      await originalWrite(...args);
      if (args[0].endsWith(`${input.creationRequestId}.json`) && (args[1] as { state?: string; gitDirectory?: unknown }).state === 'creating'
        && !(args[1] as { gitDirectory?: unknown }).gitDirectory) {
        if (change === 'metadata') {
          await rename(path.join(source, '.git'), path.join(root, 'original-git'));
          await cp(path.join(root, 'original-git'), path.join(source, '.git'), { recursive: true });
        } else if (change === 'refs') {
          await mkdir(path.join(root, 'external-refs'));
          await rename(path.join(source, '.git/refs/heads'), path.join(root, 'original-heads'));
          await symlink(path.join(root, 'external-refs'), path.join(source, '.git/refs/heads'));
        } else await git(source, 'config', 'filter.planted.smudge', 'false');
      }
    });
    const runId = randomUUID();
    runRegistry.reserve({ runId, sessionId: randomUUID(), participantId: 'agent', providerKey: runId,
      checkoutId, checkoutPath: source, access: 'write', execution: 'local', cancel() {} });
    try {
      await expect(createManagedWorktree(input, getConfig())).rejects.toThrow(change === 'metadata' ? /moved or changed/
        : change === 'refs' ? /symbolic links/ : /checkout filters/);
      const [record] = await readWorktreeRecords(getConfig().dataDir);
      expect(record.state).toBe('creating');
      await expect(lstat(record.destination)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await git(source, 'branch', '--list', 'codeai/*')).toBe('');
      if (change === 'refs') expect(await readdir(path.join(root, 'external-refs'))).toEqual([]);
    } finally { runRegistry.release(runId); }
  });

  it.each([false, true])('refuses a filter planted before materialization (Docker provisioned: %s)', async (provisioned) => {
    await writeFile(path.join(source, '.gitattributes'), '*.txt filter=planted\n');
    await git(source, 'add', '.'); await git(source, 'commit', '-qm', 'attributes without configured filter');
    if (provisioned) {
      await mkdir(path.join(getConfig().dataDir, 'docker'), { recursive: true });
      await writeFile(path.join(getConfig().dataDir, 'docker/profile.json'), '{}');
      vi.spyOn(DockerRuntime.prototype, 'reconcile').mockResolvedValue([]);
      vi.spyOn(gitReader, 'isolatedGitRead').mockImplementation(async (cwd, args) => git(cwd, ...args));
    }
    const input = request(); const originalWrite = sessionStorage.atomicWrite;
    const marker = path.join(root, 'filter-ran');
    vi.spyOn(sessionStorage, 'atomicWrite').mockImplementation(async (...args) => {
      await originalWrite(...args);
      const record = args[1] as { state?: string; gitDirectory?: unknown };
      if (args[0].endsWith(`${input.creationRequestId}.json`) && record.state === 'creating' && record.gitDirectory) {
        await git(source, 'config', 'filter.planted.smudge', `cat; touch ${marker}`);
      }
    });
    await expect(createManagedWorktree(input, getConfig())).rejects.toThrow(/checkout filters/);
    await expect(lstat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    const [record] = await readWorktreeRecords(getConfig().dataDir);
    expect(record.state).toBe('creating');
    await expect(lstat(path.join(record.destination, 'file.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses changed destination linkage before materialization', async () => {
    const input = request(); const originalWrite = sessionStorage.atomicWrite;
    vi.spyOn(sessionStorage, 'atomicWrite').mockImplementation(async (...args) => {
      await originalWrite(...args);
      const record = args[1] as { state?: string; gitDirectory?: unknown; destination?: string };
      if (args[0].endsWith(`${input.creationRequestId}.json`) && record.state === 'creating' && record.gitDirectory) {
        await writeFile(path.join(record.destination!, '.git'), `gitdir: ${path.join(source, '.git')}\n`);
      }
    });
    await expect(createManagedWorktree(input, getConfig())).rejects.toThrow(/linkage/);
    const [record] = await readWorktreeRecords(getConfig().dataDir);
    expect(record.state).toBe('creating');
    expect(await readFile(path.join(source, 'file.txt'), 'utf8')).toBe('committed\n');
    await expect(lstat(path.join(record.destination, 'file.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('shares creation UUIDs across current/worktree branches, including simultaneous conflicting requests', async () => {
    const ordinary = { provider: 'claude', checkoutId, creationRequestId: randomUUID(), checkoutMode: 'current' };
    expect((await create(ordinary)).status).toBe(201);
    expect((await create({ ...ordinary, checkoutMode: 'worktree' })).status).toBe(409);
    const worktree = request();
    expect((await create(worktree)).status).toBe(201);
    expect((await create({ ...worktree, checkoutMode: 'current' })).status).toBe(409);
    const raced = { ...ordinary, creationRequestId: randomUUID() };
    const results = await Promise.all([create(raced), create({ ...raced, checkoutMode: 'worktree' })]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(await store.listSessions()).toHaveLength(3);
    expect(await readWorktreeRecords(getConfig().dataDir)).toHaveLength(1);
  });

  it('lists ordinary sources repeatedly and concurrently without Git helpers or checkout leases after provisioning', async () => {
    const config = getConfig();
    await mkdir(path.join(config.dataDir, 'docker'), { recursive: true });
    await writeFile(path.join(config.dataDir, 'docker/profile.json'), '{}');
    const helper = vi.spyOn(gitReader, 'isolatedGitRead').mockRejectedValue(new Error('Listing must not execute Git'));
    const readLease = vi.spyOn(runRegistry, 'acquireCheckoutRead');
    const branch = await git(source, 'branch', '--show-current');
    const registry = getCheckoutRegistry(source);
    expect(runRegistry.acquireMaintenance()).toBe('acquired');
    try {
      for (let poll = 0; poll < 3; poll += 1) {
        const results = await Promise.all([registry.list(), registry.list(), registry.list()]);
        for (const checkouts of results) {
          expect(checkouts[0].worktreeCreation).toMatchObject({ available: true, branch });
          expect(checkouts[0]).not.toHaveProperty('realPath');
        }
      }
      expect(helper).not.toHaveBeenCalled();
      expect(readLease).not.toHaveBeenCalled();
    } finally { runRegistry.releaseMaintenance(); }
    expect(runRegistry.acquireMaintenance()).toBe('acquired');
    runRegistry.releaseMaintenance();
  });

  it('reads current source branch labels and detached SHA-1/SHA-256 HEAD without running Git', async () => {
    const checkout = (await new CheckoutRegistry(source).refresh())[0];
    const capability = { available: true };
    const branch = await git(source, 'branch', '--show-current');
    expect(await sourceWorktreeCapability(checkout, capability)).toMatchObject({ available: true, branch });
    await writeFile(path.join(source, '.git/HEAD'), 'ref: refs/heads/changed-branch\n');
    expect(await sourceWorktreeCapability(checkout, capability)).toMatchObject({ available: true, branch: 'changed-branch' });
    for (const length of [40, 64]) {
      await writeFile(path.join(source, '.git/HEAD'), `${'a'.repeat(length)}\n`);
      expect(await sourceWorktreeCapability(checkout, capability)).toMatchObject({ available: true, branch: 'Detached HEAD' });
    }
  });

  it.each(['missing', 'oversized', 'malformed', 'directory', 'fifo', 'symlink'] as const)('does not offer worktree creation for a %s HEAD', async (kind) => {
    const checkout = (await new CheckoutRegistry(source).refresh())[0];
    const head = path.join(source, '.git/HEAD');
    await rm(head);
    if (kind === 'oversized') await writeFile(head, `ref: refs/heads/${'x'.repeat(4096)}\n`);
    if (kind === 'malformed') await writeFile(head, 'not a Git HEAD\n');
    if (kind === 'directory') await mkdir(head);
    if (kind === 'fifo') await execute('mkfifo', [head]);
    if (kind === 'symlink') {
      const outside = path.join(root, 'outside-head');
      await writeFile(outside, 'ref: refs/heads/outside\n');
      await symlink(outside, head);
    }
    expect(await sourceWorktreeCapability(checkout, { available: true })).toMatchObject({ available: false });
  });

  it('does not offer another worktree from a non-Git source, redirected metadata, or a managed worktree', async () => {
    const checkout = (await new CheckoutRegistry(source).refresh())[0];
    const session = await createManagedWorktree(request(), getConfig());
    const managed = await getCheckoutRegistry(source).resolve(session.repositories[0].checkoutId);
    expect(await sourceWorktreeCapability(managed, { available: true })).toMatchObject({ available: false });
    await rename(path.join(source, '.git'), path.join(root, 'outside-git'));
    expect(await sourceWorktreeCapability(checkout, { available: true })).toMatchObject({ available: false });
    await symlink(path.join(root, 'outside-git'), path.join(source, '.git'));
    expect(await sourceWorktreeCapability(checkout, { available: true })).toMatchObject({ available: false });
  });

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

  it('holds source scopes through persistence while admitting unrelated turns and refusing competing operations', async () => {
    const input = request(); let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const original = store.savePreparedWorktreeSession.bind(store);
    const save = vi.spyOn(store, 'savePreparedWorktreeSession').mockImplementation(async (session) => { await wait; return original(session); });
    const pending = createManagedWorktree(input, getConfig());
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    const unrelatedId = randomUUID();
    try {
      expect(runRegistry.reserve({ runId: unrelatedId, sessionId: randomUUID(), participantId: 'agent', providerKey: 'test', checkoutId: 'other', checkoutPath: path.join(root, 'other'), access: 'write', cancel() {} })).toMatchObject({ accepted: true });
      expect(runRegistry.acquireMaintenance()).toBe('live-runs');
      expect(runRegistry.acquireCheckoutWrite(source)).toBeUndefined();
      const duplicate = createManagedWorktree(input, getConfig());
      release(); const [first, replay] = await Promise.all([pending, duplicate]);
      expect(replay.id).toBe(first.id);
    } finally { runRegistry.release(unrelatedId); release(); await pending; }
    const undo = runRegistry.acquireCheckoutWrite(source)!;
    try { await expect(createManagedWorktree(request(), getConfig())).rejects.toThrow(/Undo/); } finally { undo(); }
    const runId = randomUUID(); runRegistry.reserve({ runId, sessionId: randomUUID(), participantId: 'agent', providerKey: runId, checkoutId, access: 'write', cancel() {} });
    try { await expect(createManagedWorktree(request(), getConfig())).rejects.toThrow(/turn/); } finally { runRegistry.release(runId); }
  });

  it('creates beside an unrelated reserved turn but reports a related Docker writer before any new intent', async () => {
    const unrelated = path.join(root, 'unrelated'); await mkdir(unrelated); await git(unrelated, 'init', '-q');
    vi.stubEnv('CODEAI_REPOSITORIES_ROOT', root);
    const runId = randomUUID(), sessionId = randomUUID();
    runRegistry.reserve({ runId, sessionId, participantId: 'agent', providerKey: runId, checkoutId: 'other', checkoutPath: path.join(root, 'unrelated'), access: 'write', cancel() {} });
    let first;
    try { first = await createManagedWorktree(request(), getConfig()); } finally { runRegistry.release(runId); }
    const [record] = await readWorktreeRecords(getConfig().dataDir);
    const related = randomUUID();
    runRegistry.reserve({ runId: related, sessionId: first.id, participantId: 'agent', providerKey: related, checkoutId: record.checkoutId,
      checkoutPath: record.destination, execution: 'docker', access: 'write', cancel() {} });
    try {
      const response = await create(request());
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ worktreeConflict: { machineId: (await store.host()).id, sourceCheckoutId: checkoutId, kind: 'turn', blockingTurns: [{ sessionId: first.id, state: 'preparing' }] } });
      expect(await readWorktreeRecords(getConfig().dataDir)).toHaveLength(1);
    } finally { runRegistry.release(related); }
    await expect(createManagedWorktree(request(), getConfig())).resolves.toHaveProperty('worktree');
  });

  it('excludes user-created Local linked worktrees outside the managed folder before and after scope grant', async () => {
    const linked = path.join(root, 'linked');
    await git(source, 'worktree', 'add', '-b', 'user-linked', linked);
    vi.stubEnv('CODEAI_REPOSITORIES_ROOT', root);
    const registry = getCheckoutRegistry(root);
    const linkedCheckout = (await registry.refresh()).find((checkout) => checkout.realPath === linked)!;
    expect((await registry.resolve(linkedCheckout.id)).realPath).toBe(linked);
    const runId = randomUUID(), sessionId = randomUUID();
    runRegistry.reserve({ runId, sessionId, participantId: 'agent', providerKey: runId, checkoutId: linkedCheckout.id,
      checkoutPath: linked, access: 'write', cancel() {} });
    try {
      const response = await create(request());
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ worktreeConflict: { kind: 'turn', blockingTurns: [{ sessionId }] } });
      expect(await readWorktreeRecords(getConfig().dataDir)).toEqual([]);
      expect(await git(source, 'branch', '--list', 'codeai/*')).toBe('');
    } finally { runRegistry.release(runId); }
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const original = store.savePreparedWorktreeSession.bind(store);
    const save = vi.spyOn(store, 'savePreparedWorktreeSession').mockImplementation(async (session) => { await wait; return original(session); });
    const pending = createManagedWorktree(request(), getConfig());
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    const executeTurn = vi.fn(async () => undefined);
    try {
      expect(runRegistry.acquireCheckoutRead(linked)).toBeUndefined();
      expect(runRegistry.acquireCheckoutWrite(linked)).toBeUndefined();
      expect(runRegistry.reserve({ runId, sessionId, participantId: 'agent', providerKey: runId, checkoutId: linkedCheckout.id,
        checkoutPath: linked, access: 'write', cancel() {} })).toMatchObject({ accepted: true });
      runRegistry.activate(runId, { execute: executeTurn, cancelQueued: async () => undefined });
      await Promise.resolve(); expect(executeTurn).not.toHaveBeenCalled();
    } finally { release(); await pending; runRegistry.finish(runId); }
    expect(executeTurn).toHaveBeenCalledOnce();
  });

  it.each(['refs', 'refs/heads'])('does not prove independence for a plain Git directory with redirected %s', async (redirect) => {
    const other = path.join(root, 'other'); await mkdir(other); await git(other, 'init', '-q');
    await git(other, 'config', 'user.name', 'Worktree fixture'); await git(other, 'config', 'user.email', 'test@example.invalid');
    await rm(path.join(other, '.git', redirect), { recursive: true, force: true });
    await symlink(path.join(source, '.git', redirect), path.join(other, '.git', redirect));
    await rm(path.join(other, '.git/objects'), { recursive: true, force: true });
    await symlink(path.join(source, '.git/objects'), path.join(other, '.git/objects'));
    const before = await git(source, 'rev-parse', 'HEAD');
    await writeFile(path.join(other, 'shared.txt'), 'shared metadata\n'); await git(other, 'add', '.'); await git(other, 'commit', '-qm', 'shared metadata fixture');
    expect(await git(source, 'rev-parse', 'HEAD')).not.toBe(before);
    vi.stubEnv('CODEAI_REPOSITORIES_ROOT', root);
    const runId = randomUUID(), sessionId = randomUUID();
    runRegistry.reserve({ runId, sessionId, participantId: 'agent', providerKey: runId, checkoutId: 'other', checkoutPath: other, access: 'write', cancel() {} });
    try {
      const response = await create(request());
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ worktreeConflict: { kind: 'turn', blockingTurns: [{ sessionId }] } });
      expect(await readWorktreeRecords(getConfig().dataDir)).toEqual([]);
    } finally { runRegistry.release(runId); }
  });

  it.each(['ready', 'changed'] as const)('uses fresh %s sibling linkage when a turn arrives during planning', async (state) => {
    await getCheckoutRegistry(source).list(); // An earlier advisory catalog must not freeze membership.
    const sibling = await createManagedWorktree(request(), getConfig());
    const [record] = await readWorktreeRecords(getConfig().dataDir);
    let release!: () => void, entered!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const planning = new Promise<void>((resolve) => { entered = resolve; });
    const host = store.host.bind(store);
    vi.spyOn(store, 'host').mockImplementationOnce(async () => { entered(); await barrier; return host(); });
    const pending = createManagedWorktree(request(), getConfig()).catch((error: unknown) => error);
    const runId = randomUUID();
    try {
      await planning;
      const competing = await create(request());
      expect(competing.status).toBe(409);
      expect(await competing.json()).toMatchObject({ worktreeConflict: { kind: 'creation' } });
      expect(runRegistry.reserve({ runId, sessionId: sibling.id, participantId: 'agent', providerKey: runId,
        checkoutId: record.checkoutId, checkoutPath: record.destination, access: 'write', cancel() {} }).accepted).toBe(true);
      if (state === 'changed') await writeFile(path.join(record.destination, '.git'), 'gitdir: /outside/private\n');
      release();
      if (state === 'ready') {
        expect(await pending).toHaveProperty('worktree');
        expect(await readWorktreeRecords(getConfig().dataDir)).toHaveLength(2);
      } else {
        expect(await pending).toMatchObject({ worktreeConflict: { kind: 'turn', blockingTurns: [{ sessionId: sibling.id }] } });
        expect(await readWorktreeRecords(getConfig().dataDir)).toHaveLength(1);
      }
    } finally { release(); await pending; runRegistry.release(runId); }
  });

  it('rejects a changed project binding inside prepared-session persistence before recording an intent', async () => {
    const project = await store.createProject('Project', [checkoutId]);
    const prepare = store.prepareWorktreeSession.bind(store);
    vi.spyOn(store, 'prepareWorktreeSession').mockImplementationOnce(async (...args) => {
      await store.updateProject(project.id, { expectedRevision: project.revision, repositories: [] });
      return prepare(...args);
    });
    await expect(createManagedWorktree(request({ checkoutId: undefined, projectId: project.id }), getConfig())).rejects.toThrow(/project changed/);
    expect(await readWorktreeRecords(getConfig().dataDir)).toEqual([]);
    expect(await store.listSessions()).toEqual([]);
    expect(await git(source, 'branch', '--list', 'codeai/*')).toBe('');
    expect(runRegistry.acquireMaintenance()).toBe('acquired'); runRegistry.releaseMaintenance();
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

  it.each([false, true])('recovers a completed creating-state worktree beside a source writer (Docker provisioned: %s)', async (provisioned) => {
    const input = request(); const originalWrite = sessionStorage.atomicWrite;
    const save = vi.spyOn(sessionStorage, 'atomicWrite').mockImplementation(async (...args) => {
      await originalWrite(...args);
      const record = args[1] as { state?: string; gitDirectory?: unknown };
      if (args[0].endsWith(`${input.creationRequestId}.json`) && record.state === 'creating' && record.gitDirectory) {
        throw Object.assign(new Error('interrupted before materialization'), { code: 'EIO' });
      }
    });
    await expect(createManagedWorktree(input, getConfig())).rejects.toThrow(/retained/); save.mockRestore();
    const [record] = await readWorktreeRecords(getConfig().dataDir);
    await git(record.destination, 'read-tree', '--reset', '-u', record.session.worktree!.baseCommit);
    let pinnedReads = 0;
    let failInspection = provisioned;
    if (provisioned) {
      await mkdir(path.join(getConfig().dataDir, 'docker'), { recursive: true });
      await writeFile(path.join(getConfig().dataDir, 'docker/profile.json'), '{}');
      vi.spyOn(DockerRuntime.prototype, 'reconcile').mockResolvedValue([]);
      vi.spyOn(gitReader, 'isolatedGitRead').mockImplementation(async (cwd, args, _config, _options, _mounts, beforeStart, pinned) => {
        if (cwd === record.destination) {
          expect(pinned).toMatchObject({ destination: record.originGit.path }); pinnedReads++;
          if (failInspection) { failInspection = false; throw new Error('helper temporarily unavailable'); }
        }
        await beforeStart?.();
        return git(cwd, ...args);
      });
    }
    const runId = randomUUID();
    runRegistry.reserve({ runId, sessionId: randomUUID(), participantId: 'agent', providerKey: runId,
      checkoutId, checkoutPath: source, access: 'write', execution: 'local', cancel() {} });
    runRegistry.activate(runId, { execute: async () => new Promise<void>(() => {}), cancelQueued: async () => {} });
    try {
      if (provisioned) {
        await expect(createManagedWorktree(input, getConfig())).rejects.toThrow('helper temporarily unavailable');
        expect((await readWorktreeRecords(getConfig().dataDir))[0].state).toBe('creating');
      }
      const recovered = await createManagedWorktree(input, getConfig());
      expect(recovered.id).toBe(record.session.id);
      expect((await readWorktreeRecords(getConfig().dataDir))[0].state).toBe('ready');
      expect(await readFile(path.join(record.destination, 'file.txt'), 'utf8')).toBe('committed\n');
      expect(runRegistry.list().active).toContainEqual(expect.objectContaining({ runId, state: 'running' }));
      if (provisioned) expect(pinnedReads).toBe(3);
    } finally { runRegistry.finish(runId); }
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

  it('retains the common Git lease after reconciliation cannot confirm helper termination', async () => {
    const unrelated = path.join(root, 'unrelated'); await mkdir(unrelated); await git(unrelated, 'init', '-q');
    vi.stubEnv('CODEAI_REPOSITORIES_ROOT', root);
    const input = request(); const originalWrite = sessionStorage.atomicWrite;
    const save = vi.spyOn(sessionStorage, 'atomicWrite').mockImplementation(async (...args) => {
      await originalWrite(...args);
      if (args[0].endsWith(`${input.creationRequestId}.json`) && (args[1] as { state: string }).state === 'creating') {
        throw Object.assign(new Error('fixture interruption before Git'), { code: 'EIO' });
      }
    });
    await expect(createManagedWorktree(input, getConfig())).rejects.toThrow(/retained/); save.mockRestore();
    const [record] = await readWorktreeRecords(getConfig().dataDir);
    await git(source, 'worktree', 'add', '--no-checkout', '-b', record.session.worktree!.branch, record.destination, record.session.worktree!.baseCommit);
    await git(record.destination, 'read-tree', '--reset', '-u', record.session.worktree!.baseCommit);
    await mkdir(path.join(getConfig().dataDir, 'docker')); await writeFile(path.join(getConfig().dataDir, 'docker/profile.json'), '{}');
    let confirm!: () => void;
    const stopped = new Promise<void>((resolve) => { confirm = resolve; });
    vi.spyOn(gitReader, 'isolatedGitRead').mockImplementation(async (cwd, args) => {
      if (cwd === record.destination) throw new DockerTerminationError(() => stopped);
      return git(cwd, ...args);
    });
    try {
      await reconcileWorktrees(getConfig());
      expect((await readWorktreeRecords(getConfig().dataDir))[0].state).toBe('creating');
      expect(runRegistry.acquireCheckoutRead(record.destination)).toBeUndefined();
      expect(runRegistry.acquireMaintenance()).toBe('live-runs');
      expect(runRegistry.acquireWorktreeCreation()).toMatchObject({ acquired: false, conflict: { kind: 'creation' } });
      const unrelatedUndo = runRegistry.acquireCheckoutWrite(path.join(root, 'unrelated'))!;
      expect(unrelatedUndo).toBeTypeOf('function'); unrelatedUndo();
      const writer = runRegistry.acquireCheckoutWrite(source);
      try { expect(writer).toBeUndefined(); } finally { writer?.(); }
    } finally { confirm(); }
    await vi.waitFor(() => {
      const writer = runRegistry.acquireCheckoutWrite(source);
      expect(writer).toBeDefined(); writer!();
    });
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

  it('reconciles an unrelated unfinished intent while Undo owns another source', async () => {
    const other = path.join(root, 'other'); await mkdir(other); await git(other, 'init', '-q');
    await git(other, 'config', 'user.name', 'Worktree fixture'); await git(other, 'config', 'user.email', 'test@example.invalid');
    await writeFile(path.join(other, 'file.txt'), 'other baseline'); await git(other, 'add', '.'); await git(other, 'commit', '-qm', 'other fixture');
    vi.stubEnv('CODEAI_REPOSITORIES_ROOT', root);
    const otherId = (await getCheckoutRegistry(root).refresh()).find((checkout) => checkout.realPath === other)!.id;
    const save = vi.spyOn(store, 'savePreparedWorktreeSession').mockRejectedValue(Object.assign(new Error('disk full'), { code: 'ENOSPC' }));
    await expect(createManagedWorktree(request(), getConfig())).rejects.toThrow(/retained/);
    await expect(createManagedWorktree(request({ checkoutId: otherId }), getConfig())).rejects.toThrow(/retained/);
    save.mockRestore();
    const undo = runRegistry.acquireCheckoutWrite(source)!;
    try {
      await reconcileWorktrees(getConfig());
      const records = await readWorktreeRecords(getConfig().dataDir);
      expect(records.find((record) => record.originPath === source)!.state).toBe('materialized');
      const recovered = records.find((record) => record.originPath === other)!;
      expect(recovered.state).toBe('ready');
      expect((await store.getSession(recovered.session.id)).repositories[0].checkoutId).toBe(recovered.checkoutId);
    } finally { undo(); }
    await reconcileWorktrees(getConfig());
    expect((await readWorktreeRecords(getConfig().dataDir)).every((record) => record.state === 'ready')).toBe(true);
  });

  it('keeps complete checkout catalogs when concurrent refreshes interleave managed validation', async () => {
    const checkoutIds: string[] = [checkoutId];
    // Creation uses one journal-mutation gate, so only catalog reads are concurrent here.
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

  it('retains Local creation and resolution after Docker provisioning even with Docker disabled', async () => {
    await createManagedWorktree(request(), getConfig()); const [record] = await readWorktreeRecords(getConfig().dataDir);
    await mkdir(path.join(getConfig().dataDir, 'docker')); await writeFile(path.join(getConfig().dataDir, 'docker/profile.json'), '{}');
    // Offline transport stand-in: only synthetic fixture Git runs here. Production preflight must
    // route these inspections to the isolated helper, never silently switch to host Git.
    const helper = vi.spyOn(gitReader, 'isolatedGitRead').mockImplementation(async (cwd, args) => git(cwd, ...args));
    expect(await worktreeCapability(getConfig())).toEqual({ available: true });
    await expect(createManagedWorktree(request(), getConfig())).resolves.toHaveProperty('worktree');
    await expect(getCheckoutRegistry(source).resolve(record.checkoutId)).resolves.toHaveProperty('worktree');
    expect(helper).toHaveBeenCalled();
  });

  it('creates Docker worktrees at format 11 and shares exact bindings across both executions', async () => {
    vi.spyOn(DockerRuntime.prototype, 'health').mockResolvedValue({ available: true, authenticated: 'unknown', supportedModes: ['ask', 'plan', 'agent'] });
    const input = request({ execution: 'docker' });
    const response = await create(input); expect(response.status).toBe(201);
    const session = (await response.json()).session;
    expect(session).toMatchObject({ version: 11, execution: 'docker', worktree: { originCheckoutId: checkoutId } });
    expect(durableSessionSchema.safeParse({ ...await store.getSession(session.id), version: 10 }).success).toBe(false);
    expect(publicSessionSchema.safeParse(session).success).toBe(true);
    expect((await (await create(input)).json()).session.id).toBe(session.id);
    for (const execution of ['local', 'docker']) {
      const continued = await create({ provider: 'claude', sourceSessionId: session.id, execution });
      expect(continued.status).toBe(201);
      expect((await continued.json()).session).toMatchObject({ execution, repositories: session.repositories, worktree: session.worktree });
    }
    const shared = await create({ provider: 'claude', checkoutId: session.repositories[0].checkoutId, execution: 'docker' });
    expect(shared.status).toBe(201); expect((await shared.json()).session.worktree).toEqual(session.worktree);
    const summaries = await getCheckoutRegistry(source).list();
    expect(worktreeChoice({ execution: 'docker', checkoutId, checkouts: summaries, capability: { available: true } }).available).toBe(true);
  });

  it('rejects Docker worktree creation from a protected source before leaving any intent or branch', async () => {
    vi.spyOn(DockerRuntime.prototype, 'health').mockResolvedValue({ available: true, authenticated: 'unknown', supportedModes: ['ask', 'plan', 'agent'] });
    vi.stubEnv('CODEAI_INSTALLATION_ROOT', source);
    const response = await create(request({ execution: 'docker' }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/installation/);
    expect(await readWorktreeRecords(getConfig().dataDir)).toEqual([]);
    expect(await git(source, 'branch', '--list', 'codeai/*')).toBe('');
    const local = await createManagedWorktree(request(), getConfig());
    const checkout = await getCheckoutRegistry(source).resolve(local.repositories[0].checkoutId);
    await expect(validateDockerCheckout(checkout.realPath, getConfig())).rejects.toThrow(/installation/);
    const summaries = await getCheckoutRegistry(source).list();
    const options = { checkoutId, checkouts: summaries, capability: { available: true } };
    expect(worktreeChoice({ ...options, execution: 'local' }).available).toBe(true);
    expect(worktreeChoice({ ...options, execution: 'docker' }).reason).toMatch(/installation/);
  });

  it('rechecks Docker source protection on an intent retry and restart reconciliation', async () => {
    vi.spyOn(DockerRuntime.prototype, 'health').mockResolvedValue({ available: true, authenticated: 'unknown', supportedModes: ['ask', 'plan', 'agent'] });
    const input = request({ execution: 'docker' });
    const original = store.prepareWorktreeSession.bind(store);
    const prepare = vi.spyOn(store, 'prepareWorktreeSession').mockImplementation(async (...args) => {
      await original(...args); throw Object.assign(new Error('fixture crash before mutation'), { code: 'EIO' });
    });
    await expect(createManagedWorktree(input, getConfig())).rejects.toThrow(/retained/);
    prepare.mockRestore();
    vi.stubEnv('CODEAI_INSTALLATION_ROOT', source);
    await expect(createManagedWorktree(input, getConfig())).rejects.toThrow(/installation/);
    await reconcileWorktrees(getConfig());
    const [record] = await readWorktreeRecords(getConfig().dataDir);
    expect(record.state).toBe('intent');
    await expect(lstat(record.destination)).rejects.toThrow();
    expect(await git(source, 'branch', '--list', 'codeai/*')).toBe('');
  });

  it.each(['filter', 'promisor', 'alternates', 'symlink', 'unborn', 'submodule', 'missing-object'])('refuses %s before mutation and never executes fixture filters or credential helpers', async (kind) => {
    expect((await getCheckoutRegistry(source).list())[0].worktreeCreation).toMatchObject({ available: true });
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
    { checkoutMode: 'unknown' }, { execution: 'unknown' }, { creationRequestId: undefined }, { checkoutId: undefined },
    { sourceSessionId: randomUUID() }, { path: '/outside' }, { branch: 'chosen' }, { flags: ['--force'] },
  ])('strictly rejects malformed worktree requests %j', async (invalid) => {
    const valid = request(); const response = await create({ ...valid, ...invalid }); expect(response.status).toBe(400);
    expect(await readWorktreeRecords(getConfig().dataDir)).toEqual([]);
  });
});
