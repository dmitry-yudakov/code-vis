import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, mkdir, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AppConfig } from '@/server/config';
import { getConfig } from '@/server/config';
import { providerFolder, defaultProviderFolder } from '@/server/agents/providerFolder';
import { readBoundedTextFile } from '@/server/boundedTextFile';
import { runRegistry, type WorktreeAdmissionConflict, type WorktreeCreationLease } from '@/server/runs/runRegistry';
import type { WorktreeCreationConflict } from '@/shared/worktreeCreation';
import { atomicWrite, getSessionStore, SessionStoreError, type SessionStore } from '@/server/storage/sessionStore';
import { createSessionRequestSchema } from '@/shared/protocol';
import { durableSessionSchema } from '@/shared/sessionSchema';
import type { DurableSession, ServerCheckout, SessionWorktree, WorktreeCapability } from '@/shared/types';
import { GIT_READ_OPTIONS, gitReadEnvironment, isolatedGitRead, withGitReadLease } from './gitRead';
import { DockerTerminationError } from '@/server/execution/dockerRuntime';

const MAX_RECORDS = 1_000;
const MAX_RECORD_BYTES = 128 * 1024;
const UUID_FILE = /^[0-9a-f-]{36}\.json$/i;
const identitySchema = z.object({ path: z.string().max(4096), identity: z.string().max(100) }).strict();
const recordSchema = z.object({
  version: z.literal(1), request: createSessionRequestSchema,
  session: durableSessionSchema,
  originPath: z.string().max(4096), originGit: identitySchema,
  root: z.string().max(4096), parents: z.array(identitySchema).max(100),
  destination: z.string().max(4096), checkoutId: z.string().max(128),
  state: z.enum(['intent', 'creating', 'materialized', 'ready', 'unavailable']),
  gitDirectory: identitySchema.optional(), checkoutDirectory: identitySchema.optional(), reason: z.string().max(500).optional(),
}).strict().refine((record) => record.request.checkoutMode === 'worktree' && Boolean(record.request.creationRequestId)
  && record.session.worktree !== undefined && (record.session.version === 10 || record.session.version === 11)
  && record.session.repositories[0].checkoutId === record.checkoutId
  && record.session.worktree.branch === `codeai/session-${record.session.id}`
  && (record.state !== 'ready' || record.gitDirectory !== undefined && record.checkoutDirectory !== undefined), 'Invalid worktree intent identity.');
export type WorktreeRecord = z.infer<typeof recordSchema>;
type CreationRequest = z.infer<typeof createSessionRequestSchema>;

export const managedCheckoutId = (location: string) => createHash('sha256').update(location).digest('base64url').slice(0, 22);
function conflict(message: string): never { throw new SessionStoreError('conflict', message); }
export class WorktreeCreationBusyError extends SessionStoreError {
  constructor(message: string, public readonly worktreeConflict: WorktreeCreationConflict) { super('conflict', message); }
}

async function creationBusy(config: AppConfig, details: WorktreeAdmissionConflict, sourceCheckoutId?: string): Promise<never> {
  const host = await getSessionStore(config.dataDir, config.hostLabel).host();
  const reasons = {
    maintenance: 'this machine is performing maintenance', creation: 'another worktree is being created or recovered',
    turn: 'a turn is using this repository or a worktree sharing its Git metadata',
    recovery: 'Undo is using this repository or its Git metadata', 'git-read': 'a Git read is using this repository or its Git metadata',
  };
  throw new WorktreeCreationBusyError(`Worktree creation is blocked: ${reasons[details.kind]}. Wait for it to finish and retry.`,
    { ...details, machineId: host.id, ...(sourceCheckoutId ? { sourceCheckoutId } : {}) });
}

async function creationScopes(lease: WorktreeCreationLease, records: WorktreeRecord[], source: string,
  destination: string, config: AppConfig, sourceCheckoutId: string, ordinary?: ServerCheckout[]): Promise<void> {
  if (!ordinary) {
    const { getCheckoutRegistry } = await import('./checkoutRegistry');
    ordinary = (await getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth).refresh()).filter((checkout) => !checkout.worktree);
  }
  // Local sessions support user-created linked worktrees and redirected metadata too. Reuse the
  // bounded contained-metadata proof during creation; an arbitrary pointer never grants authority.
  const independent: string[] = []; const unproved: string[] = [];
  for (const checkout of ordinary) {
    try {
      await sourceMetadata(checkout);
      independent.push(checkout.realPath);
    } catch { unproved.push(checkout.realPath); }
  }
  const family = records.filter((record) => overlap(record.originPath, source) || overlap(record.originGit.path, path.join(source, '.git')));
  const admission = lease.acquireScopes([source, destination, ...family.map((record) => record.destination), ...unproved],
    { root: config.worktreesRoot, registered: records.map((record) => record.destination), independent });
  if (!admission.acquired) await creationBusy(config, admission.conflict, sourceCheckoutId);
}
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
const overlap = (a: string, b: string) => within(a, b) || within(b, a);
const identity = (info: Awaited<ReturnType<typeof lstat>>) => `${info.dev}:${info.ino}`;

/** Fixed offline invocations. No inherited Git configuration, transport, filters, or hooks. */
async function git(cwd: string, args: string[], allowedExitCodes: number[] = [], record?: WorktreeRecord, writeLease?: symbol): Promise<string> {
  const config = getConfig();
  const provisioned = await lstat(path.join(config.dataDir, 'docker', 'profile.json')).catch((error) => { if (missing(error)) return undefined; throw error; });
  // Mutations run only under the affected creation scopes after strict source preflight.
  // Every inspection after provisioning runs in the credential-free helper, including recovery.
  if (provisioned && args[0] !== 'worktree' && args[0] !== 'read-tree') {
    const release = runRegistry.acquireCheckoutRead(record?.originGit.path || cwd, writeLease);
    if (!release) conflict('The source checkout is being edited. Retry after that turn finishes.');
    return withGitReadLease(release, () => isolatedGitRead(cwd, ['-c', 'core.excludesFile=/dev/null', '-c', 'credential.helper=', '-c', 'protocol.allow=never', ...args], config, { allowedExitCodes, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 },
      record ? commonGitReadBind(record.originGit.path) : []));
  }
  return new Promise((resolve, reject) => execFile('git', [
    ...GIT_READ_OPTIONS, '-c', 'core.excludesFile=/dev/null', '-c', 'credential.helper=', '-c', 'protocol.allow=never',
    '-c', 'checkout.workers=1', '-c', 'worktree.guessRemote=false', ...args,
  ], {
    cwd, encoding: 'utf8', timeout: 15_000, maxBuffer: 8 * 1024 * 1024,
    env: { ...gitReadEnvironment(), GIT_NO_LAZY_FETCH: '1', GIT_CEILING_DIRECTORIES: path.dirname(cwd) },
  }, (error, stdout) => {
    if (!error || typeof error.code === 'number' && allowedExitCodes.includes(error.code)) resolve(stdout);
    else reject(new SessionStoreError('conflict', 'Offline Git worktree operation failed or exceeded its limits. Retained state can be retried or inspected with Git.'));
  }));
}

async function canonicalProtected(target: string): Promise<string> {
  let current = path.resolve(target); let suffix = '';
  for (;;) {
    try { return path.join(await realpath(/* turbopackIgnore: true */ current), suffix); }
    catch (error) {
      if (!missing(error) || path.dirname(current) === current) throw error;
      suffix = path.join(path.basename(current), suffix); current = path.dirname(current);
    }
  }
}

/** Prove every parent, including ancestors of a root which does not exist yet. */
async function parents(target: string): Promise<Array<z.infer<typeof identitySchema>>> {
  const result: Array<z.infer<typeof identitySchema>> = [];
  let current = path.resolve(target);
  for (;;) {
    const info = await lstat(current).catch((error) => { if (missing(error)) return undefined; throw error; });
    if (info) {
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(current) !== current) conflict('Worktree parents must be canonical directories without symbolic links.');
      result.push({ path: current, identity: identity(info) });
    }
    if (path.dirname(current) === current) break;
    current = path.dirname(current);
  }
  return result;
}

async function validateRoot(config: AppConfig, ordinary: ServerCheckout[] = [], create = false): Promise<Array<z.infer<typeof identitySchema>>> {
  const root = config.worktreesRoot;
  if (!root) conflict('This machine does not support managed worktrees.');
  await parents(root);
  const protectedPaths = [config.dataDir, config.installationRoot, process.cwd(),
    defaultProviderFolder('claude'), defaultProviderFolder('codex'), providerFolder('claude'), providerFolder('codex')];
  for (const protectedPath of protectedPaths) {
    if (overlap(root, await canonicalProtected(protectedPath))) conflict('Worktrees root must be separate from CodeAI, its data, and provider storage.');
  }
  for (const checkout of ordinary) {
    if (overlap(root, checkout.realPath)) conflict('Worktrees root must be separate from ordinary repository checkouts.');
  }
  if (create) await mkdir(root, { recursive: true, mode: 0o700 });
  const proof = await parents(root);
  await access(proof[0].path, constants.W_OK | constants.X_OK);
  return proof;
}

export async function worktreeCapability(config: AppConfig, ordinary: ServerCheckout[] = []): Promise<WorktreeCapability> {
  try {
    if (process.platform !== 'linux') conflict('Managed worktree creation currently requires Linux.');
    await validateRoot(config, ordinary);
    return { available: true };
  } catch (error) { return { available: false, message: error instanceof SessionStoreError ? error.message : 'Worktrees root is unavailable or unwritable.' }; }
}

async function containedMetadata(gitDirectory: string): Promise<void> {
  let visited = 0;
  const deadline = Date.now() + 15_000;
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (++visited > 100_000 || Date.now() > deadline) conflict('Git metadata exceeds the worktree preflight limit.');
      const location = path.join(directory, entry.name);
      if (entry.isSymbolicLink() || await realpath(location) !== location) conflict('Managed creation requires contained Git metadata without symbolic links.');
      if (entry.isDirectory()) await walk(location);
    }
  }
  await walk(gitDirectory);
}

/** Cheap structural eligibility; it never executes Git or walks the metadata contents. */
async function sourceGitDirectory(checkout: ServerCheckout) {
  if (checkout.worktree || await realpath(checkout.realPath) !== checkout.realPath) conflict('Choose an ordinary source checkout for a new worktree.');
  const gitPath = path.join(checkout.realPath, '.git');
  const info = await lstat(gitPath).catch(() => undefined);
  if (!info?.isDirectory() || info.isSymbolicLink()) conflict('Managed creation requires a normal contained .git directory; linked worktrees and non-Git folders are unavailable.');
  return { gitPath, info };
}

async function sourceMetadata(checkout: ServerCheckout) {
  const { gitPath, info } = await sourceGitDirectory(checkout);
  await containedMetadata(gitPath);
  for (const file of ['commondir', 'config.worktree', 'objects/info/alternates', 'objects/info/http-alternates', 'shallow']) {
    if (await lstat(path.join(/* turbopackIgnore: true */ gitPath, file)).catch(() => undefined)) conflict('Managed creation does not support external object storage, shallow clones, or external Git metadata.');
  }
  return { gitPath, info };
}

async function sourcePreflight(checkout: ServerCheckout, baseCommit?: string, full = false, writeLease?: symbol) {
  const release = runRegistry.acquireCheckoutRead(checkout.realPath, writeLease);
  if (!release) conflict('The source checkout is being edited. Retry after that turn finishes.');
  try { return await inspectSource(checkout, baseCommit, full, writeLease); }
  finally { release(); }
}

async function inspectSource(checkout: ServerCheckout, baseCommit?: string, full = false, writeLease?: symbol) {
  const { gitPath, info } = await sourceMetadata(checkout);
  const configuration = (await git(checkout.realPath, ['config', '--local', '--no-includes', '--null', '--list'], [], undefined, writeLease)).split('\0');
  for (const entry of configuration) {
    const [key, ...values] = entry.split('\n'); const value = values.join('\n');
    if (/^(?:include\.|includeif\.|filter\.|extensions\.(?!objectformat$)|remote\..*\.promisor$|core\.(?:worktree|sparsecheckout|sparsecheckoutcone)$)/i.test(key)
      || key === 'core.bare' && value !== 'false') conflict('Managed creation does not support checkout filters, partial/promisor clones, included configuration, or custom checkout storage.');
  }
  if ((await readdir(path.join(gitPath, 'objects', 'pack')).catch(() => [])).some((file) => file.endsWith('.promisor'))) conflict('Managed creation does not support promisor object storage.');
  const commit = baseCommit || (await git(checkout.realPath, ['rev-parse', '--verify', 'HEAD^{commit}'], [], undefined, writeLease)).trim();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit)) conflict('The source has no resolvable committed HEAD.');
  const tree = await git(checkout.realPath, ['ls-tree', '-r', '--full-tree', commit], [], undefined, writeLease);
  if (/^160000 /m.test(tree)) conflict('Managed creation does not support submodules.');
  if (full) await git(checkout.realPath, ['fsck', '--connectivity-only', '--no-reflogs', '--no-dangling', commit], [], undefined, writeLease);
  const branch = (await git(checkout.realPath, ['symbolic-ref', '--short', '-q', 'HEAD'], [1], undefined, writeLease)).trim() || 'Detached HEAD';
  return { commit, branch, originGit: { path: gitPath, identity: identity(info) } };
}

/** Listing is advisory: full, fresh source preflight runs only before creation, never on Arena polls. */
export async function sourceWorktreeCapability(checkout: ServerCheckout, machine: WorktreeCapability, config = getConfig()): Promise<WorktreeCapability> {
  if (!machine.available) return machine;
  try {
    const { gitPath } = await sourceGitDirectory(checkout);
    const headFile = await readBoundedTextFile(path.join(gitPath, 'HEAD'), 4096, { exactly: true });
    if (!('text' in headFile)) conflict('The source Git HEAD is unavailable or changed.');
    const head = headFile.text.trim();
    const ref = /^ref: refs\/heads\/([^\s]+)$/.exec(head);
    const branch = ref ? ref[1] : /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head) ? 'Detached HEAD' : undefined;
    if (!branch) conflict('The source Git HEAD is invalid.');
    if (await lstat(path.join(config.dataDir, 'docker', 'profile.json')).catch((error) => { if (missing(error)) return undefined; throw error; })) {
      commonGitReadBind(path.join(checkout.realPath, '.git'));
    }
    const { validateDockerMountPath } = await import('@/server/execution/dockerProfile');
    try { await validateDockerMountPath(checkout.realPath, config); commonGitReadBind(path.join(checkout.realPath, '.git')); }
    catch (error) { return { available: true, branch, dockerUnavailableReason: error instanceof Error ? error.message.slice(0, 500) : 'Docker cannot mount this source.' }; }
    return { available: true, branch };
  }
  catch (error) { return { available: false, message: error instanceof SessionStoreError ? error.message : 'Source checkout is unavailable.' }; }
}

export async function readWorktreeRecords(dataDir: string): Promise<WorktreeRecord[]> {
  const directory = path.join(dataDir, 'worktrees');
  const names = await readdir(directory).catch((error) => { if (missing(error)) return []; throw error; });
  const files = names.filter((name) => UUID_FILE.test(name));
  if (files.length > MAX_RECORDS) conflict('Worktree journal exceeds the host session limit.');
  const records: WorktreeRecord[] = [];
  for (const name of files) {
    // No following a journal link; a damaged entry is isolated from other ready checkouts.
    let handle;
    try {
      handle = await open(path.join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_RECORD_BYTES) continue;
      const bytes = Buffer.alloc(MAX_RECORD_BYTES + 1); let length = 0;
      while (length < bytes.length) {
        const read = await handle.read(bytes, length, bytes.length - length, null);
        if (!read.bytesRead) break; length += read.bytesRead;
      }
      if (length > MAX_RECORD_BYTES) continue;
      const parsed = recordSchema.safeParse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))));
      if (parsed.success && parsed.data.request.creationRequestId === name.slice(0, -5)) records.push(parsed.data);
    } catch { /* an invalid entry grants no checkout authority */ }
    finally { await handle?.close(); }
  }
  return records;
}

/** Damaged intents still consume capacity, and a ready session is counted only once. */
export async function worktreeSessionReservations(dataDir: string, sessionFileNames: string[]): Promise<number> {
  const names = (await readdir(path.join(dataDir, 'worktrees')).catch((error) => { if (missing(error)) return []; throw error; })).filter((name) => UUID_FILE.test(name));
  const records = await readWorktreeRecords(dataDir);
  return names.length - records.filter((record) => sessionFileNames.includes(`${record.session.id}.json`)).length;
}

async function writeRecord(config: AppConfig, record: WorktreeRecord) {
  recordSchema.parse(record);
  const directory = path.join(config.dataDir, 'worktrees');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await atomicWrite(path.join(directory, `${record.request.creationRequestId}.json`), record);
}

async function validatePlacement(record: WorktreeRecord, config: AppConfig) {
  if (config.worktreesRoot !== record.root || record.destination !== path.join(record.root, record.session.worktree!.id)
    || record.checkoutId !== managedCheckoutId(record.destination) || record.session.worktree!.originCheckoutId !== managedCheckoutId(record.originPath)
    || record.originGit.path !== path.join(record.originPath, '.git')) conflict('The recorded worktree root or destination changed. Restore its original location.');
  const capability = await worktreeCapability(config);
  if (!capability.available) conflict(capability.message!);
  for (const parent of record.parents) {
    const current = await lstat(parent.path);
    if (!current.isDirectory() || current.isSymbolicLink() || identity(current) !== parent.identity || await realpath(parent.path) !== parent.path) conflict('A recorded worktree parent changed. Restore its original location.');
  }
  if (await realpath(record.originPath) !== record.originPath || identity(await lstat(record.originGit.path)) !== record.originGit.identity) conflict('The source repository or its Git metadata moved or changed.');
}

/** Verify both directions of Git's recorded linkage, never just its stored display branch. */
async function linkage(record: WorktreeRecord, config: AppConfig, writeLease?: symbol) {
  await validatePlacement(record, config);
  const source = { id: record.session.worktree!.originCheckoutId, realPath: record.originPath, name: 'source', relativePath: '.' };
  // Resolving a registered worktree needs structural proof, not Git executing against shared
  // metadata. Before provisioning, preserve the stricter host-Git configuration preflight.
  await sourceMetadata(source);
  if (!await lstat(path.join(config.dataDir, 'docker', 'profile.json')).catch((error) => { if (missing(error)) return undefined; throw error; })) {
    await sourcePreflight(source, record.session.worktree!.baseCommit, false, writeLease);
  }
  if (await realpath(record.destination) !== record.destination) conflict('The managed worktree is missing or moved. History remains available.');
  if (record.checkoutDirectory && identity(await lstat(record.destination)) !== record.checkoutDirectory.identity) conflict('The managed worktree directory was replaced. Restore its original location.');
  const dotGit = path.join(record.destination, '.git');
  const info = await lstat(dotGit);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) conflict('Managed worktree Git linkage changed.');
  const readLink = async (file: string) => {
    const result = await readBoundedTextFile(file, 4096, { exactly: true });
    if (!('text' in result)) conflict('Managed worktree Git linkage is unavailable or changed.');
    return result.text;
  };
  const link = await readLink(dotGit);
  const gitDirectory = /^gitdir: (.+)\n?$/.exec(link)?.[1];
  const expected = path.join(record.originGit.path, 'worktrees', record.session.worktree!.id);
  if (gitDirectory !== expected || await realpath(expected) !== expected) conflict('Managed worktree Git linkage changed.');
  await parents(expected);
  const gitInfo = await lstat(expected);
  if (record.gitDirectory && (record.gitDirectory.path !== expected || record.gitDirectory.identity !== identity(gitInfo))) conflict('Managed worktree metadata was replaced.');
  if ((await readLink(path.join(expected, 'gitdir'))).trim() !== dotGit
    || (await readLink(path.join(expected, 'commondir'))).trim() !== '../..') conflict('Managed worktree reverse linkage changed.');
  const head = (await readLink(path.join(expected, 'HEAD'))).trim();
  if (!head.startsWith('ref: refs/heads/') && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head)) conflict('Managed worktree HEAD is invalid.');
  const branch = head.startsWith('ref: refs/heads/') ? head.slice('ref: refs/heads/'.length) : 'Detached HEAD';
  return { branch, gitDirectory: { path: expected, identity: identity(gitInfo) } };
}

export async function resolveManagedWorktree(record: WorktreeRecord, config: AppConfig): Promise<ServerCheckout> {
  if (record.state !== 'ready') conflict(record.reason || 'Worktree creation is unfinished. Retry its original creation request.');
  try {
    const { branch } = await linkage(record, config);
    return { id: record.checkoutId, realPath: record.destination, name: `Worktree · ${branch}`,
      relativePath: `worktrees/${record.session.worktree!.id}`, worktree: record.session.worktree as SessionWorktree, branch };
  } catch (error) {
    if (error instanceof SessionStoreError) throw error;
    return conflict('The managed worktree or its source is missing, moved, or changed. History remains available. Restore its recorded location to resume.');
  }
}

/** Git reads/checkpoint recovery can start from an already resolved path; recheck its allowlist. */
export async function validateManagedPath(location: string, config = getConfig()): Promise<WorktreeRecord | undefined> {
  if (!config.worktreesRoot) return;
  const records = await readWorktreeRecords(config.dataDir);
  const record = records.find((item) => item.destination === location);
  if (record) { await resolveManagedWorktree(record, config); return record; }
  else if (within(config.worktreesRoot, location)) conflict('Unregistered managed checkout is unavailable.');
}

/** The journal, never a checkout-controlled .git pointer, authorizes additional Docker binds.
 * Preserve absolute Git linkage without changing files or mounting a repository parent.
 */
export async function managedGitMounts(record: WorktreeRecord, config: AppConfig, writable = false): Promise<{ args: string[]; identity: string }> {
  await resolveManagedWorktree(record, config);
  const common = record.originGit.path;
  const mounts = commonGitReadBind(common);
  const identities = [record.originGit.identity];
  if (writable) {
    // Root metadata stays read-only: the source index/HEAD/configuration and other worktree
    // indices cannot be changed. Objects, branch refs and their logs are shared Git state.
    const directories = [record.gitDirectory!.path, ...['objects', 'refs', 'logs'].map((name) => path.join(/* turbopackIgnore: true */ common, name))];
    for (const directory of directories) {
      const info = await lstat(directory).catch((error) => { if (missing(error)) return undefined; throw error; });
      if (!info && directory === path.join(common, 'logs')) continue;
      if (!info?.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) conflict('Managed Git mount source changed.');
      mounts.push('--mount', `type=bind,src=${directory},dst=${directory}`);
      identities.push(`${directory}:${identity(info)}`);
    }
  }
  return { args: mounts, identity: identities.join('\0') };
}

function commonGitReadBind(common: string): string[] {
  const reserved = ['/workspace', '/context', '/home/agent', '/user', '/opt/codeai', '/usr', '/bin', '/sbin', '/etc', '/proc', '/sys', '/dev', '/tmp/personal-git-ignore'];
  if (/[,\r\n\0]/.test(common) || reserved.some((target) => overlap(common, target))) conflict('Managed Git metadata conflicts with a Docker container path.');
  return ['--mount', `type=bind,src=${common},dst=${common},readonly`];
}

/** An ordinary-source writer can rename metadata; hold this through helper/worker termination.
 * Linked workers can coexist: their read-only common root cannot rename these mounted roots.
 */
export async function acquireManagedGitRead(location: string, config: AppConfig): Promise<() => void> {
  const record = (await readWorktreeRecords(config.dataDir)).find((item) => item.destination === location);
  if (!record) return () => {};
  const release = runRegistry.acquireCheckoutRead(record.originGit.path);
  if (!release) conflict('The source checkout is being edited. Retry this worktree operation after that turn finishes.');
  return release;
}

async function finish(record: WorktreeRecord, config: AppConfig, store: SessionStore, writeLease: symbol): Promise<DurableSession> {
  if (record.state === 'unavailable') conflict(record.reason || 'Partial worktree creation is ambiguous. Inspect the retained Git state.');
  await validatePlacement(record, config);
  if (record.request.execution === 'docker' && (record.state === 'intent' || record.state === 'creating')) {
    await dockerCreationPreflight(record.originPath, config);
  }
  if (record.state === 'intent') {
    const source = { id: record.session.worktree!.originCheckoutId, name: 'source', relativePath: '.', realPath: record.originPath };
    await sourcePreflight(source, record.session.worktree!.baseCommit, true, writeLease);
    if (await lstat(record.destination).catch((error) => { if (missing(error)) return undefined; throw error; })) conflict('The worktree destination already exists; creation refused.');
    // Persist before the first mutation. A crash in this state is inspected, never overwritten.
    record.state = 'creating'; await writeRecord(config, record);
    await git(record.originPath, ['worktree', 'add', '--no-checkout', '-b', record.session.worktree!.branch, record.destination, record.session.worktree!.baseCommit]);
    const linked = await linkage(record, config, writeLease);
    record.gitDirectory = linked.gitDirectory;
    record.checkoutDirectory = { path: record.destination, identity: identity(await lstat(record.destination)) };
    await writeRecord(config, record);
    await git(record.destination, ['read-tree', '--reset', '-u', record.session.worktree!.baseCommit]);
    record.gitDirectory = (await linkage(record, config, writeLease)).gitDirectory;
    record.state = 'materialized'; await writeRecord(config, record);
  } else if (record.state === 'creating') {
    const source = { id: record.session.worktree!.originCheckoutId, name: 'source', relativePath: '.', realPath: record.originPath };
    await sourcePreflight(source, record.session.worktree!.baseCommit, true, writeLease);
    const destinationExists = await lstat(record.destination).catch((error) => { if (missing(error)) return undefined; throw error; });
    const metadataExists = await lstat(path.join(record.originGit.path, 'worktrees', record.session.worktree!.id)).catch((error) => { if (missing(error)) return undefined; throw error; });
    const branchExists = (await git(record.originPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${record.session.worktree!.branch}`], [1], undefined, writeLease)).trim();
    if (!destinationExists && !metadataExists && !branchExists) {
      record.state = 'intent'; await writeRecord(config, record);
      return finish(record, config, store, writeLease);
    }
    // Only an entirely completed, clean baseline is unambiguous. Never reset partial/user work.
    try {
      const linked = await linkage(record, config, writeLease);
      if ((await git(record.destination, ['rev-parse', 'HEAD'], [], record, writeLease)).trim() !== record.session.worktree!.baseCommit
        || linked.branch !== record.session.worktree!.branch
        || (await git(record.destination, ['status', '--porcelain', '--untracked-files=all'], [], record, writeLease)).trim()) throw new Error('partial');
      record.gitDirectory = linked.gitDirectory;
      record.checkoutDirectory = { path: record.destination, identity: identity(await lstat(record.destination)) };
      record.state = 'materialized'; await writeRecord(config, record);
    } catch (error) {
      if (error instanceof DockerTerminationError) throw error;
      record.state = 'unavailable'; record.reason = 'Partial worktree creation is ambiguous. Worktree and branch are retained; inspect them with Git before recovery.';
      await writeRecord(config, record); conflict(record.reason);
    }
  }
  await linkage(record, config, writeLease);
  const session = await store.savePreparedWorktreeSession(record.session as DurableSession);
  record.state = 'ready'; delete record.reason; await writeRecord(config, record);
  return session;
}

async function dockerCreationPreflight(source: string, config: AppConfig): Promise<void> {
  const { getDockerRuntime } = await import('@/server/execution/dockerRuntime');
  const { validateDockerCheckout } = await import('@/server/execution/dockerProfile');
  const health = await getDockerRuntime(config).health();
  if (!health.available) conflict(health.message || 'Docker execution is unavailable.');
  commonGitReadBind(path.join(source, '.git'));
  try { await validateDockerCheckout(source, config); }
  catch (error) { conflict(error instanceof Error ? error.message : 'Docker cannot mount this source.'); }
}

export async function createManagedWorktree(request: CreationRequest, config: AppConfig): Promise<DurableSession> {
  const admission = runRegistry.acquireWorktreeCreation();
  if (!admission.acquired) return creationBusy(config, admission.conflict);
  const lease = admission.lease;
  return withGitReadLease(lease.release, async () => {
    try {
      const { recoverDockerExecution } = await import('@/server/execution/dockerRecovery');
      await recoverDockerExecution(config);
      const store = getSessionStore(config.dataDir, config.hostLabel);
      await store.host(); // the store writer lock owns this machine's journal too
      const records = await readWorktreeRecords(config.dataDir);
      const prior = records.find((record) => record.request.creationRequestId === request.creationRequestId);
      if (prior) {
        if (JSON.stringify(prior.request) !== JSON.stringify(request)) conflict('Creation request id was already used with different choices.');
        await creationScopes(lease, records, prior.originPath, prior.destination, config, prior.session.worktree!.originCheckoutId);
        return await finish(prior, config, store, lease.token);
      }
      if (await lstat(path.join(config.dataDir, 'worktrees', `${request.creationRequestId}.json`)).catch(() => undefined)) conflict('This creation journal is damaged; its retained state requires inspection.');
      const { getCheckoutRegistry } = await import('./checkoutRegistry');
      const registry = getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth);
      const ordinary = (await registry.refresh()).filter((checkout) => !checkout.worktree);
      const capability = await worktreeCapability(config, ordinary);
      if (!capability.available) conflict(capability.message!);
      const project = request.projectId ? await store.getProject(request.projectId) : undefined;
      const host = await store.host();
      if (project && (project.repositories.length !== 1 || project.repositories[0].role !== 'primary' || project.repositories[0].hostId !== host.id)) {
        throw new Error('Worktree creation requires exactly one primary repository on this machine.');
      }
      const source = ordinary.find((checkout) => checkout.id === (request.checkoutId || project!.repositories[0].checkoutId));
      if (!source) conflict('Choose an available ordinary source checkout on this machine.');
      const id = randomUUID(); const sessionId = randomUUID();
      const destination = path.join(config.worktreesRoot, id);
      await creationScopes(lease, records, source.realPath, destination, config, source.id, ordinary);
      if (await lstat(path.join(config.dataDir, 'docker', 'profile.json')).catch((error) => { if (missing(error)) return undefined; throw error; })) {
        commonGitReadBind(path.join(source.realPath, '.git'));
      }
      if (request.execution === 'docker') await dockerCreationPreflight(source.realPath, config);
      const baseline = await sourcePreflight(source, undefined, true, lease.token);
      const rootProof = await validateRoot(config, ordinary, true);
      const worktree: SessionWorktree = { id, originCheckoutId: source.id, baseCommit: baseline.commit, branch: `codeai/session-${sessionId}` };
      let record!: WorktreeRecord;
      await store.prepareWorktreeSession({ ...request, id: sessionId, checkoutId: managedCheckoutId(destination), worktree,
        ...(project ? { expectedProjectRevision: project.revision, repositories: [{ ...project.repositories[0], checkoutId: managedCheckoutId(destination) }] } : {}) }, async (session) => {
        record = { version: 1, request, session, originPath: source.realPath, originGit: baseline.originGit,
          root: config.worktreesRoot, parents: rootProof, destination, checkoutId: managedCheckoutId(destination), state: 'intent' };
        await writeRecord(config, record);
      });
      return await finish(record, config, store, lease.token);
    } catch (error) {
      if (error instanceof SessionStoreError) throw error;
      if ((error as NodeJS.ErrnoException)?.code) conflict('Worktree creation could not finish. Its recorded intent and any created worktree are retained. Check storage and retry the same request.');
      throw error;
    }
  });
}

/** Called before checkout admission after a restart. Failed entries do not hold a global lease. */
export async function reconcileWorktrees(config: AppConfig): Promise<void> {
  const records = await readWorktreeRecords(config.dataDir);
  if (!records.some((record) => record.state !== 'ready' && record.state !== 'unavailable')) return;
  for (const candidate of records) {
    if (candidate.state === 'ready' || candidate.state === 'unavailable') continue;
    const admission = runRegistry.acquireWorktreeCreation();
    if (!admission.acquired) return;
    try {
      await withGitReadLease(admission.lease.release, async () => {
        // Refresh membership only after reserving journal mutation; an earlier creation may have
        // added a sibling, and Local turns do not otherwise lease the source's common metadata.
        const current = await readWorktreeRecords(config.dataDir);
        const record = current.find((item) => item.request.creationRequestId === candidate.request.creationRequestId);
        if (!record || record.state === 'ready' || record.state === 'unavailable') return;
        await creationScopes(admission.lease, current, record.originPath, record.destination, config, record.session.worktree!.originCheckoutId);
        const { recoverDockerExecution } = await import('@/server/execution/dockerRecovery');
        await recoverDockerExecution(config);
        await finish(record, config, getSessionStore(config.dataDir, config.hostLabel), admission.lease.token);
      });
    } catch { /* Retained intent/cleanup remains protected; unrelated ready checkouts can run. */ }
  }
}
