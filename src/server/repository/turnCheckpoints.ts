import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readdir, readlink, realpath, rename, symlink, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { atomicWrite } from '@/server/storage/sessionStore';
import { runRegistry } from '@/server/runs/runRegistry';
import { checkpointSummarySchema, type CheckpointSummary } from '@/shared/turnCheckpoint';
import { isNotRepositoryOutput, runGitRead } from './gitRead';

const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_LINK_BYTES = 4096;
const MAX_TREE_BYTES = 128 * 1024 * 1024;
// A 128 MiB backup needs about 171 MiB after base64; leave room for metadata. The aggregate
// storage budget may retain fewer than ten records when checkpoints are large.
const MAX_RECORD_BYTES = 192 * 1024 * 1024;
const MAX_STORAGE_BYTES = 512 * 1024 * 1024;
const MAX_RECORDS = 10;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const EXCLUDED_DIRECTORIES = new Set([
  '.git', '.codex', '.claude', '.aws', '.ssh', '.config', '.code-ai', '.cert',
  '.docker', '.kube', '.gnupg', '.azure', '.local',
]);
const GENERATED_DIRECTORIES = new Set(['node_modules', '.next', '.next-e2e', 'dist', 'build', 'coverage', 'target']);
const PRIVATE_FILES = new Set([
  'auth.json', 'credentials.json', '.credentials.json', 'tokens.json', 'secrets.json',
  '.npmrc', '.netrc', '.git-credentials', '.pypirc', '.boto', '.s3cfg', '.vault-token', '.htpasswd',
  'application_default_credentials.json', 'id_rsa', 'id_ed25519', 'id_dsa', 'id_ecdsa',
]);
const UUID = /^[0-9a-f-]{36}$/i;
const relativeFile = z.string().min(1).max(4096).refine((file) => safeRelative(file) && !excluded(file));
const fileSchema = z.object({
  kind: z.literal('file').default('file'),
  path: relativeFile, hash: z.string().regex(/^[a-f0-9]{64}$/), mode: z.number().int().min(0).max(0o7777),
  stamp: z.string().max(250), content: z.string().max(Math.ceil(MAX_FILE_BYTES / 3) * 4).optional(),
}).strict();
const linkSchema = fileSchema.omit({ content: true }).extend({
  kind: z.literal('symlink'),
  target: z.string().min(1).max(MAX_LINK_BYTES).refine((target) => !target.includes('\0')
    && Buffer.byteLength(target) <= MAX_LINK_BYTES && Buffer.from(target).toString('utf8') === target).optional(),
}).strict();
const entrySchema = z.union([fileSchema, linkSchema]);
const ignoredPathSchema = z.string().min(1).max(4096).refine((file) => safeRelative(file.replace(/\/$/, '')));
const snapshotSchema = z.object({
  git: z.string().nullable(), ignoredPaths: z.array(ignoredPathSchema).max(MAX_FILES),
  paths: z.array(relativeFile).max(MAX_FILES), files: z.array(entrySchema).max(MAX_FILES),
}).strict();
const recordSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]), id: z.string().uuid(), runId: z.string().uuid(), sessionId: z.string().uuid(), messageId: z.string().uuid(),
  checkoutId: z.string().min(1).max(128), checkoutPath: z.string().min(1).max(4096),
  createdAt: z.string().datetime(), state: z.enum(['capturing', 'ready', 'unavailable', 'restoring', 'undone']),
  reason: z.string().max(500).optional(), before: snapshotSchema, after: snapshotSchema.optional(),
}).strict();
type FileEntry = z.infer<typeof entrySchema>;
type Snapshot = z.infer<typeof snapshotSchema>;
type CheckpointRecord = z.infer<typeof recordSchema>;
const headerSchema = z.object({
  runId: z.string().uuid(), sessionId: z.string().uuid(), recordStamp: z.string().max(250), summary: checkpointSummarySchema,
}).strict();
type CheckpointHeader = z.infer<typeof headerSchema>;

export interface CheckpointIdentity {
  runId: string; sessionId: string; messageId: string; checkoutId: string; checkoutPath: string;
}

export class CheckpointError extends Error {
  constructor(message: string, public readonly status = 409) { super(message); this.name = 'CheckpointError'; }
}

function safeRelative(file: string): boolean {
  return !path.isAbsolute(file) && !file.includes('\\') && !file.includes('\0')
    && file.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}
function excluded(file: string): boolean {
  return file.split('/').some((part) => EXCLUDED_DIRECTORIES.has(part) || PRIVATE_FILES.has(part)
    || (part.startsWith('.env') && part !== '.env.example') || /\.(?:pem|key|p12|pfx|crt|cer|der)$/i.test(part));
}
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
function stamp(info: Awaited<ReturnType<typeof lstat>>): string {
  return [info.dev, info.ino, info.size, info.mode, info.mtimeMs, info.ctimeMs].join(':');
}
function metadata(file: FileEntry) {
  if (file.kind === 'symlink') { const { target: _target, ...result } = file; return result; }
  const { content: _content, ...result } = file; return result;
}
function sameSnapshot(left: Snapshot, right: Snapshot): boolean {
  return left.git === right.git && JSON.stringify(left.ignoredPaths) === JSON.stringify(right.ignoredPaths)
    && JSON.stringify(left.paths) === JSON.stringify(right.paths)
    && JSON.stringify(left.files.map(metadata)) === JSON.stringify(right.files.map(metadata));
}
function changedFiles(record: CheckpointRecord): string[] {
  const before = new Map(record.before.files.map((file) => [file.path, file]));
  const after = new Map(record.after?.files.map((file) => [file.path, file]));
  return [...new Set([...before.keys(), ...after.keys()])].sort().filter((file) => {
    const a = before.get(file); const b = after.get(file);
    return a?.kind !== b?.kind || a?.hash !== b?.hash || a?.mode !== b?.mode;
  });
}
function contains(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/** Reads file contents or exact link text without following the final link. The kernel's name is
 * proved before reading bytes, so a swapped parent cannot redirect a read outside the checkout.
 * Hard links are refused for the same reason. Linux is required for this exact-handle proof. */
async function readFileEntry(root: string, file: string, includeContent: boolean): Promise<FileEntry | undefined> {
  if (!safeRelative(file) || excluded(file)) throw new CheckpointError('An unsafe checkpoint path was refused.');
  const target = path.join(root, file);
  const initial = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (!initial) return undefined;
  if (initial.isSymbolicLink()) {
    // Pin the parent without creating anything. Read the link text, never its target, and prove
    // the parent before/after so a swapped ancestor cannot redirect even this metadata read.
    const parent = path.dirname(target);
    const directory = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      if (await readlink(`/proc/self/fd/${directory.fd}`) !== parent) throw new CheckpointError('A checkout path changed while saving recovery.');
      const anchored = `/proc/self/fd/${directory.fd}/${path.basename(file)}`;
      const info = await lstat(anchored);
      if (!info.isSymbolicLink() || stamp(info) !== stamp(initial)) throw new CheckpointError('The checkout changed while saving recovery. Retry once editing stops.');
      if (info.nlink !== 1) throw new CheckpointError('Checkpoint requires symbolic links without hard links.');
      const bytes = await readlink(anchored, { encoding: 'buffer' });
      const linkTarget = bytes.toString('utf8');
      if (bytes.length > MAX_LINK_BYTES || !Buffer.from(linkTarget).equals(bytes)) throw new CheckpointError('Checkpoint symbolic-link targets must be UTF-8 and fit within 4 KiB.');
      if (bytes.length !== info.size || stamp(info) !== stamp(await lstat(anchored))
        || await readlink(`/proc/self/fd/${directory.fd}`) !== parent) {
        throw new CheckpointError('The checkout changed while saving recovery. Retry once editing stops.');
      }
      return { kind: 'symlink', path: file, hash: hash(bytes), mode: info.mode & 0o7777, stamp: stamp(info),
        ...(includeContent ? { target: linkTarget } : {}) };
    } finally { await directory.close(); }
  }
  let handle;
  try { handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new CheckpointError('Checkpoint entry could not be opened safely. Retry once editing stops.');
  }
  try {
    if (await readlink(`/proc/self/fd/${handle.fd}`) !== target) throw new CheckpointError('A checkout path changed while saving recovery.');
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1) throw new CheckpointError('Checkpoint requires regular files without hard links or nested repositories.');
    if (info.size > MAX_FILE_BYTES) throw new CheckpointError(`Checkpoint file ${JSON.stringify(file)} exceeds the ${MAX_FILE_BYTES / (1024 * 1024)} MiB limit.`);
    const buffer = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break; length += bytesRead;
    }
    if (length !== info.size || stamp(info) !== stamp(await handle.stat()) || stamp(info) !== stamp(await lstat(target))) {
      throw new CheckpointError('The checkout changed while saving recovery. Retry once editing stops.');
    }
    const content = buffer.subarray(0, length);
    return { kind: 'file', path: file, hash: hash(content), mode: info.mode & 0o7777, stamp: stamp(info), ...(includeContent ? { content: content.toString('base64') } : {}) };
  } finally { await handle.close(); }
}

async function inventory(root: string, checkoutWriteLease?: symbol): Promise<{ paths: string[]; ignoredPaths: string[]; git: string | null }> {
  const gitRead = (args: string[], allowedExitCodes?: number[]) => runGitRead(root, args, { checkoutWriteLease, allowedExitCodes });
  try {
    const tracked = await gitRead(['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
    // Collapse ignored directories such as node_modules: remember their names, never their bytes.
    // Otherwise removing an ignore rule could make Undo delete pre-existing ignored work.
    const ignoredPaths = (await gitRead(['ls-files', '-z', '--cached', '--others', '--ignored', '--exclude-standard', '--directory'])).split('\0').filter(Boolean).sort();
    if (ignoredPaths.length > MAX_FILES) throw new CheckpointError('Checkpoint exceeds the 10,000 ignored-path inventory limit.');
    const ignored = new Set(ignoredPaths);
    const index = await gitRead(['ls-files', '--stage', '-v', '-z']);
    if (/(?:^|\0). 160000 /.test(index)) throw new CheckpointError('Checkpoint does not support Git submodules.');
    const head = await gitRead(['rev-parse', '--verify', 'HEAD'], [128]);
    const branch = await gitRead(['symbolic-ref', '-q', 'HEAD'], [1]);
    const debug = await gitRead(['ls-files', '--debug', '-z']);
    // NUL terminates each path; the following prefix is Git's fixed debug metadata. Keep only
    // semantic flags (including intent-to-add), not stat-cache stamps refreshed by `git status`.
    const flags = debug.split('\0').slice(1).map((entry) => {
      const value = /^  ctime: [^\n]*\n  mtime: [^\n]*\n  dev: [^\n]*\n  uid: [^\n]*\n  size: [0-9]+\tflags: ([0-9a-f]+)\n/.exec(entry)?.[1];
      if (value === undefined) throw new CheckpointError('Git index flags could not be read safely.');
      return value;
    });
    // Only IDs and index entries, never Git configuration, credentials, filters or blob contents.
    const gitRoot = await lstat(path.join(root, '.git'));
    return { paths: tracked.split('\0').filter((file) => file && !ignored.has(file)), ignoredPaths,
      git: hash(`${gitRoot.dev}:${gitRoot.ino}\n${head}\n${branch}\n${index}\n${flags.join(',')}`) };
  } catch (error) {
    if (!isNotRepositoryOutput((error as { stderr?: string }).stderr)) throw error;
    const paths: string[] = []; let visited = 0;
      async function walk(directory: string) {
      if (await realpath(directory) !== directory) throw new CheckpointError('A checkout directory changed.');
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (++visited > MAX_FILES) throw new CheckpointError('Checkpoint exceeds the 10,000 file/directory limit.');
        const file = path.relative(root, path.join(directory, entry.name));
        if (excluded(file) || file.split('/').some((part) => GENERATED_DIRECTORIES.has(part))) continue;
        if (entry.isDirectory()) {
          if (await lstat(path.join(directory, entry.name, '.git')).catch(() => undefined)) throw new CheckpointError('Checkpoint does not support nested repositories.');
          await walk(path.join(directory, entry.name));
        } else paths.push(file);
      }
    }
    await walk(root); return { paths, ignoredPaths: [], git: null };
  }
}

async function snapshot(root: string, includeContent: boolean, originalPaths: string[] = [], checkoutWriteLease?: symbol, initialIgnoredPaths?: string[]): Promise<Snapshot> {
  if (process.platform !== 'linux') throw new CheckpointError('Turn checkpoints currently require Linux for safe file recovery.');
  if (await realpath(root) !== root) throw new CheckpointError('The checkout path changed.');
  const listed = await inventory(root, checkoutWriteLease);
  const ignoredPaths = initialIgnoredPaths ?? listed.ignoredPaths;
  const paths = [...new Set([...listed.paths, ...originalPaths])].filter((file) => !excluded(file)
    && !ignoredPaths.some((ignored) => ignored.endsWith('/') ? file.startsWith(ignored) : file === ignored)).sort();
  if (paths.length > MAX_FILES) throw new CheckpointError('Checkpoint exceeds the 10,000 file limit.');
  const directories = new Set<string>(); const files: FileEntry[] = []; let total = 0;
  for (const file of paths) {
    if (file.endsWith('/')) throw new CheckpointError('Checkpoint does not support nested repositories.');
    if (!safeRelative(file)) throw new CheckpointError('An unsafe checkout filename was refused.');
    // Do not cross a nested repository or a parent symlink, even when Git lists its files.
    for (let directory = path.dirname(path.join(root, file)); directory !== root; directory = path.dirname(directory)) {
      if (directories.has(directory)) break;
      if (await realpath(directory).catch(() => directory) !== directory) throw new CheckpointError('A checkout directory is a symbolic link.');
      if (await lstat(path.join(directory, '.git')).catch(() => undefined)) throw new CheckpointError('Checkpoint does not support nested repositories.');
      directories.add(directory);
    }
    const entry = await readFileEntry(root, file, includeContent);
    if (entry) {
      total += Number(entry.stamp.split(':')[2]);
      if (total > MAX_TREE_BYTES) throw new CheckpointError(`Checkpoint exceeds the ${MAX_TREE_BYTES / (1024 * 1024)} MiB checkout limit. Ignore generated files before sending a writing turn.`);
      files.push(entry);
    }
  }
  return { git: listed.git, ignoredPaths, paths, files };
}

/** One bounded, private JSON record per writing turn. Operations serialize on this machine's
 * store, while the run scheduler owns checkout access. No Git write or Docker bind is involved. */
export class TurnCheckpoints {
  private queue = Promise.resolve();
  private readonly directory: string;
  private readonly now: () => number;
  constructor(private readonly dataDirectory: string, options: { now?: () => number } = {}) {
    this.directory = path.join(dataDirectory, 'turn-checkpoints'); this.now = options.now ?? Date.now;
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation); this.queue = result.then(() => undefined, () => undefined); return result;
  }
  private file(id: string): string {
    if (!UUID.test(id)) throw new CheckpointError('Invalid checkpoint identity.', 400);
    return path.join(this.directory, `${id}.json`);
  }
  private async readJson(file: string, maxBytes: number): Promise<unknown> {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > maxBytes || info.nlink !== 1) throw new CheckpointError('Recovery record is unreadable.');
      const buffer = Buffer.alloc(info.size + 1);
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const chunk = await handle.read(buffer, bytesRead, buffer.length - bytesRead, null);
        if (!chunk.bytesRead) break; bytesRead += chunk.bytesRead;
      }
      if (bytesRead !== info.size) throw new CheckpointError('Recovery record changed.');
      return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
    } finally { await handle.close(); }
  }
  private async read(id: string): Promise<CheckpointRecord> {
    const record = recordSchema.parse(await this.readJson(this.file(id), MAX_RECORD_BYTES));
    if (record.id !== id || !path.isAbsolute(record.checkoutPath)
      || new Set(record.before.files.map((file) => file.path)).size !== record.before.files.length
      || (record.after && new Set(record.after.files.map((file) => file.path)).size !== record.after.files.length)) throw new CheckpointError('Recovery record is invalid.');
    return record;
  }
  private async records(): Promise<CheckpointHeader[]> {
    const names = await readdir(this.directory).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
    const ids = names.filter((name) => UUID.test(name.slice(0, -5)) && name.endsWith('.json'));
    if (ids.length > MAX_RECORDS) throw new CheckpointError('Recovery storage exceeds its record limit.');
    const records: CheckpointHeader[] = [];
    for (const name of ids) {
      const id = name.slice(0, -5);
      let header: CheckpointHeader | undefined;
      try {
        header = headerSchema.parse(await this.readJson(`${this.file(id)}.summary`, 4096));
        if (header.summary.id !== id) throw new CheckpointError('Recovery summary is invalid.');
      } catch (error) {
        // A crash between the durable backup and its tiny status index must fail closed. This
        // fallback is needed only once; ordinary status reads never load checkpoint file bytes.
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      // Atomic replacement changes file identity. A stale ready summary after an interrupted
      // restoring/undone write is never trusted; reread the backup once and repair its status.
      if (!header || header.recordStamp !== stamp(await lstat(this.file(id)))) header = await this.saveHeader(await this.read(id));
      records.push(header);
    }
    return records.sort((a, b) => b.summary.createdAt.localeCompare(a.summary.createdAt));
  }
  private async save(record: CheckpointRecord): Promise<void> {
    // Parsing normalizes legacy regular entries; persist that upgraded shape as version 2.
    record.version = 2;
    recordSchema.parse(record);
    if (Buffer.byteLength(JSON.stringify(record, null, 2)) + 1 > MAX_RECORD_BYTES) throw new CheckpointError('Checkpoint record exceeds its storage limit.');
    await atomicWrite(this.file(record.id), record);
    await this.saveHeader(record);
  }
  private async saveHeader(record: CheckpointRecord): Promise<CheckpointHeader> {
    const header = { runId: record.runId, sessionId: record.sessionId,
      recordStamp: stamp(await lstat(this.file(record.id))), summary: this.summary(record) };
    await atomicWrite(`${this.file(record.id)}.summary`, header); return header;
  }
  private summary(record: CheckpointRecord): CheckpointSummary {
    const expired = this.now() - Date.parse(record.createdAt) > RETENTION_MS;
    const interrupted = record.state === 'capturing' || record.state === 'restoring';
    return {
      id: record.id, messageId: record.messageId, createdAt: record.createdAt,
      expiresAt: new Date(Date.parse(record.createdAt) + RETENTION_MS).toISOString(),
      state: expired || interrupted ? 'unavailable' : record.state as CheckpointSummary['state'],
      reason: expired ? 'This checkpoint expired after seven days.' : record.state === 'capturing'
        ? 'Undo is unavailable until the turn ends and its recovery fingerprint is saved. A process restart cannot infer which later changes belong to it.'
        : record.state === 'restoring' ? 'Undo was interrupted. Files may be partly restored; the original checkpoint is retained for manual recovery.' : record.reason,
      changedFiles: record.after ? changedFiles(record).length : 0,
    };
  }
  async latest(sessionId: string): Promise<CheckpointSummary | undefined> {
    return this.serialize(async () => {
      const record = (await this.records()).find((item) => item.sessionId === sessionId);
      if (!record) return undefined;
      return this.now() > Date.parse(record.summary.expiresAt)
        ? { ...record.summary, state: 'unavailable', reason: 'This checkpoint expired after seven days.' } : record.summary;
    });
  }
  async identity(id: string): Promise<CheckpointIdentity> {
    const record = await this.read(id);
    return { runId: record.runId, sessionId: record.sessionId, messageId: record.messageId, checkoutId: record.checkoutId, checkoutPath: record.checkoutPath };
  }
  async capture(identity: CheckpointIdentity): Promise<string> {
    return this.serialize(async () => {
      await mkdir(this.dataDirectory, { recursive: true, mode: 0o700 });
      if (contains(identity.checkoutPath, await realpath(this.dataDirectory))) throw new CheckpointError('Recovery storage must be outside the checkout. Move CODEAI_DATA_DIR before sending a writing turn.');
      await mkdir(this.directory, { recursive: true, mode: 0o700 }); await chmod(this.directory, 0o700);
      if (await realpath(this.directory) !== path.join(await realpath(this.dataDirectory), 'turn-checkpoints')) throw new CheckpointError('Recovery storage is a symbolic link.');
      // Only a dead process can leave these atomic-write temporaries: this owner's writes are
      // serialized and the session store admits one server process for the data directory.
      for (const name of await readdir(this.directory)) {
        if (/^\.[0-9a-f-]{36}\.json(?:\.summary)?-[0-9a-f-]{36}\.tmp$/i.test(name)) await unlink(path.join(this.directory, name));
      }
      const before = await snapshot(identity.checkoutPath, true);
      if (!sameSnapshot(before, await snapshot(identity.checkoutPath, false, before.paths, undefined, before.ignoredPaths))) throw new CheckpointError('The checkout changed during capture. Retry once editing stops.');
      const record: CheckpointRecord = { version: 2, id: randomUUID(), ...identity, createdAt: new Date(this.now()).toISOString(), state: 'capturing', before };
      const existing = await this.records();
      const activeRunIds = new Set(runRegistry.currentRuns.map((run) => run.runId));
      // Reserve active backups first; keep completed records newest first within what remains.
      existing.sort((a, b) => Number(activeRunIds.has(b.runId)) - Number(activeRunIds.has(a.runId)));
      let total = Buffer.byteLength(JSON.stringify(record, null, 2)) + MAX_FILES * 400; // Reserve terminal metadata space now.
      const kept: CheckpointHeader[] = [];
      for (const item of existing) {
        const size = (await lstat(this.file(item.summary.id))).size;
        const active = activeRunIds.has(item.runId);
        if (!active && (this.now() - Date.parse(item.summary.createdAt) > RETENTION_MS || kept.length >= MAX_RECORDS - 1 || total + size > MAX_STORAGE_BYTES)) {
          await unlink(this.file(item.summary.id)); await unlink(`${this.file(item.summary.id)}.summary`).catch(() => undefined);
        }
        else { kept.push(item); total += size; }
      }
      if (kept.length >= MAX_RECORDS || total > MAX_STORAGE_BYTES) throw new CheckpointError('Active checkpoints fill the recovery storage budget. Wait for a writing turn to finish.');
      await this.save(record); return record.id;
    });
  }
  async finish(id: string): Promise<void> {
    return this.serialize(async () => {
      const record = await this.read(id);
      try {
        record.after = await snapshot(record.checkoutPath, false, record.before.paths, undefined, record.before.ignoredPaths);
        record.state = record.before.git !== record.after.git ? 'unavailable' : changedFiles(record).length ? 'ready' : 'unavailable';
        record.reason = record.before.git !== record.after.git ? 'Git HEAD or index changed during this turn. Undo does not restore Git history or staging.'
          : record.state === 'unavailable' ? 'This turn made no eligible file changes.' : undefined;
      } catch {
        record.state = 'unavailable'; record.reason = 'The terminal recovery fingerprint could not be saved. The original checkpoint is retained for manual recovery.';
      }
      await this.save(record);
    });
  }
  async undo(id: string, checkoutWriteLease?: symbol): Promise<CheckpointSummary> {
    return this.serialize(async () => {
      const record = await this.read(id); const summary = this.summary(record);
      if (summary.state !== 'ready' || !record.after) throw new CheckpointError(record.state === 'undone' ? 'This turn was already undone.' : summary.reason || 'Undo is no longer available for this turn.');
      const originalPaths = [...record.before.paths, ...record.after.paths];
      if (!sameSnapshot(record.after, await snapshot(record.checkoutPath, false, originalPaths, checkoutWriteLease, record.before.ignoredPaths))) throw new CheckpointError('The checkout or Git index has newer changes. Undo refused to overwrite them.');
      // Validate all backup bytes before the first mutation, including bounds and checksums.
      let total = 0;
      for (const file of record.before.files) {
        if ((file.kind === 'file' ? file.content : file.target) === undefined) throw new CheckpointError('Recovery content is missing.');
        const bytes = file.kind === 'symlink' ? Buffer.from(file.target!) : Buffer.from(file.content!, 'base64'); total += bytes.length;
        if (bytes.length > (file.kind === 'symlink' ? MAX_LINK_BYTES : MAX_FILE_BYTES)
          || total > MAX_TREE_BYTES || hash(bytes) !== file.hash) throw new CheckpointError('Recovery content is invalid.');
      }
      const before = new Map(record.before.files.map((file) => [file.path, file]));
      const after = new Map(record.after.files.map((file) => [file.path, file]));
      record.state = 'restoring'; await this.save(record);
      try {
        for (const file of changedFiles(record)) {
          const target = path.join(record.checkoutPath, file);
          const expected = after.get(file);
          const current = await readFileEntry(record.checkoutPath, file, false);
          if (JSON.stringify(current) !== JSON.stringify(expected)) throw new CheckpointError('A file changed during Undo.');
          // Open and pin the canonical parent directory. Renames/unlinks then address that handle,
          // never a path whose parents a provider or outside editor could replace with a link.
          const parent = path.dirname(target);
          const directory = await openRestoreParent(record.checkoutPath, file);
          try {
            if (await readlink(`/proc/self/fd/${directory.fd}`) !== parent) throw new CheckpointError('A directory changed during Undo.');
            const anchored = `/proc/self/fd/${directory.fd}/${path.basename(file)}`;
            const original = before.get(file);
            if (!original) {
              if (JSON.stringify(await readFileEntry(record.checkoutPath, file, false)) !== JSON.stringify(expected)
                || await readlink(`/proc/self/fd/${directory.fd}`) !== parent) throw new CheckpointError('A file changed during Undo.');
              await unlink(anchored);
            }
            else {
              const temporary = `/proc/self/fd/${directory.fd}/.codeai-undo-${randomUUID()}`;
              try {
                if (original.kind === 'symlink') await symlink(original.target!, temporary);
                else {
                  const handle = await open(temporary, 'wx', original.mode);
                  try { await handle.writeFile(Buffer.from(original.content!, 'base64')); await handle.chmod(original.mode); await handle.sync(); }
                  finally { await handle.close(); }
                }
                if (JSON.stringify(await readFileEntry(record.checkoutPath, file, false)) !== JSON.stringify(expected)
                  || await readlink(`/proc/self/fd/${directory.fd}`) !== parent) throw new CheckpointError('A file changed during Undo.');
                await rename(temporary, anchored);
              } finally { await unlink(temporary).catch(() => undefined); }
            }
            await directory.sync();
          } finally { await directory.close(); }
        }
        record.state = 'undone'; record.reason = 'Checkout files restored. The conversation and provider history remain.';
        await this.save(record); return this.summary(record);
      } catch {
        // Keep the durable restoring marker and original bytes. A force retry could erase edits
        // made after a partial restore, so only manual recovery is offered.
        throw new CheckpointError('Undo stopped. Files may be partly restored; the original checkpoint is retained for manual recovery.', 503);
      }
    });
  }
}

/** Create missing parents through pinned directory handles, never recursive path traversal. */
async function openRestoreParent(root: string, file: string) {
  let directory = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  let canonical = root;
  try {
    for (const part of file.split('/').slice(0, -1)) {
      if (await readlink(`/proc/self/fd/${directory.fd}`) !== canonical) throw new CheckpointError('A directory changed during Undo.');
      const anchored = `/proc/self/fd/${directory.fd}/${part}`;
      const next = await open(anchored, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        await mkdir(anchored); return open(anchored, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      });
      await directory.close(); directory = next; canonical = path.join(canonical, part);
    }
    if (await readlink(`/proc/self/fd/${directory.fd}`) !== canonical) throw new CheckpointError('A directory changed during Undo.');
    return directory;
  } catch (error) { await directory.close(); throw error; }
}

type CheckpointGlobal = typeof globalThis & { __codeAiTurnCheckpoints?: Map<string, TurnCheckpoints> };
export function getTurnCheckpoints(dataDirectory: string): TurnCheckpoints {
  const stores = ((globalThis as CheckpointGlobal).__codeAiTurnCheckpoints ??= new Map());
  let store = stores.get(dataDirectory);
  if (!store) { store = new TurnCheckpoints(dataDirectory); stores.set(dataDirectory, store); }
  return store;
}
