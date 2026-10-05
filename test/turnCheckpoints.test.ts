import { execFile as callbackExecFile } from 'node:child_process';
import { constants } from 'node:fs';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, link, writeFile, rename, chmod, lstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ dataDir: '', restoreRenames: 0, failRestoreAt: 0, failRecordSave: false, failSummarySave: false }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return { ...fs, rename: async (source: string, target: string) => {
    if (target.startsWith('/proc/self/fd/') && ++state.restoreRenames === state.failRestoreAt) throw new Error('Synthetic restore I/O failure');
    if (state.failRecordSave && target.endsWith('.json') && target.includes('turn-checkpoints')) throw new Error('Synthetic durable write failure');
    if (state.failSummarySave && target.endsWith('.summary')) throw new Error('Synthetic summary write failure');
    return fs.rename(source, target);
  } };
});
vi.mock('@/server/config', () => ({ getConfig: () => ({ dataDir: state.dataDir, maxConcurrentRuns: 2 }) }));
vi.mock('@/server/execution/dockerRecovery', () => ({ recoverDockerExecution: async () => undefined }));

import { TurnCheckpoints } from '@/server/repository/turnCheckpoints';
import { RunRegistry } from '@/server/runs/runRegistry';

const execFile = promisify(callbackExecFile);
let root: string;
let checkout: string;
let checkpoints: TurnCheckpoints;
let now: number;
const sessionId = crypto.randomUUID();
const identity = () => ({ runId: crypto.randomUUID(), sessionId, messageId: crypto.randomUUID(), checkoutId: 'checkout', checkoutPath: checkout });
const git = async (...args: string[]) => (await execFile('git', args, { cwd: checkout, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0' } })).stdout;
const bytes = (file: string) => readFile(path.join(checkout, file), 'utf8');

beforeEach(async () => {
  state.restoreRenames = 0; state.failRestoreAt = 0; state.failRecordSave = false; state.failSummarySave = false;
  root = await mkdtemp(path.join(os.tmpdir(), 'codeai-checkpoints-'));
  checkout = path.join(root, 'checkout');
  state.dataDir = path.join(root, 'data');
  await mkdir(checkout); await mkdir(state.dataDir);
  await git('init', '-q');
  await git('config', 'user.name', 'Checkpoint test');
  await git('config', 'user.email', 'checkpoint@example.invalid');
  await writeFile(path.join(checkout, 'a.txt'), 'committed a');
  await writeFile(path.join(checkout, 'b.txt'), 'committed b');
  await git('add', '.'); await git('commit', '-qm', 'fixture');
  now = Date.now();
  checkpoints = new TurnCheckpoints(state.dataDir, { now: () => now });
});
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

describe('turn checkpoints in a real checkout', () => {
  it('captures without touching index or files, then restores staged, unstaged, deleted and untracked work', async () => {
    await writeFile(path.join(checkout, 'a.txt'), 'staged a'); await git('add', 'a.txt');
    await writeFile(path.join(checkout, 'a.txt'), 'unstaged a');
    await rm(path.join(checkout, 'b.txt'));
    await writeFile(path.join(checkout, 'local.txt'), 'human untracked');
    await chmod(path.join(checkout, 'local.txt'), 0o755);
    const index = await readFile(path.join(checkout, '.git/index'));
    const status = await git('status', '--porcelain');
    const id = await checkpoints.capture(identity());
    expect(await git('status', '--porcelain')).toBe(status);
    expect(await readFile(path.join(checkout, '.git/index'))).toEqual(index);
    await writeFile(path.join(checkout, 'a.txt'), 'agent a');
    await rm(path.join(checkout, 'local.txt'));
    await writeFile(path.join(checkout, 'b.txt'), 'agent b');
    await writeFile(path.join(checkout, 'new.txt'), 'agent new');
    await checkpoints.finish(id);
    expect((await checkpoints.latest(sessionId))?.state).toBe('ready');
    await checkpoints.undo(id);
    expect(await bytes('a.txt')).toBe('unstaged a');
    expect(await bytes('local.txt')).toBe('human untracked');
    await expect(bytes('b.txt')).rejects.toThrow();
    await expect(bytes('new.txt')).rejects.toThrow();
    expect(await readFile(path.join(checkout, '.git/index'))).toEqual(index);
    expect(await git('status', '--porcelain')).toBe(status);
    expect((await checkpoints.latest(sessionId))?.state).toBe('undone');
    await expect(checkpoints.undo(id)).rejects.toThrow(/already|available/i);
  });

  it('does not save or restore ignored and private files, even when tracked, and never follows excluded links', async () => {
    await writeFile(path.join(checkout, '.gitignore'), 'ignored.txt\n');
    await writeFile(path.join(checkout, 'ignored.txt'), 'ignored original');
    await writeFile(path.join(checkout, '.env.local'), 'private original');
    await git('add', '-f', 'ignored.txt', '.env.local');
    await mkdir(path.join(checkout, '.codex'));
    await symlink(path.join(checkout, '.env.local'), path.join(checkout, '.codex/auth.json'));
    const id = await checkpoints.capture(identity());
    const record = await readFile(path.join(state.dataDir, 'turn-checkpoints', `${id}.json`), 'utf8');
    expect(record).not.toContain(Buffer.from('private original').toString('base64'));
    expect(record).not.toContain(Buffer.from('ignored original').toString('base64'));
    await writeFile(path.join(checkout, 'a.txt'), 'agent');
    await writeFile(path.join(checkout, 'ignored.txt'), 'ignored later');
    await writeFile(path.join(checkout, '.env.local'), 'private later');
    await checkpoints.finish(id); await checkpoints.undo(id);
    expect(await bytes('ignored.txt')).toBe('ignored later');
    expect(await bytes('.env.local')).toBe('private later');
  });

  it('keeps originally covered files recoverable when the turn changes ignore rules', async () => {
    await writeFile(path.join(checkout, 'local.txt'), 'human');
    const id = await checkpoints.capture(identity());
    await writeFile(path.join(checkout, '.gitignore'), 'local.txt\n');
    await writeFile(path.join(checkout, 'local.txt'), 'agent');
    await checkpoints.finish(id); await checkpoints.undo(id);
    expect(await bytes('local.txt')).toBe('human');
    await expect(bytes('.gitignore')).rejects.toThrow();
  });

  it('never deletes or restores pre-existing ignored files or directories when a turn unignores them', async () => {
    await writeFile(path.join(checkout, '.gitignore'), 'ignored.txt\nignored-dir/\n');
    await writeFile(path.join(checkout, 'ignored.txt'), 'human ignored');
    await mkdir(path.join(checkout, 'ignored-dir')); await writeFile(path.join(checkout, 'ignored-dir/work.txt'), 'human ignored folder');
    const id = await checkpoints.capture(identity());
    await writeFile(path.join(checkout, '.gitignore'), '');
    await writeFile(path.join(checkout, 'ignored.txt'), 'later ignored edit');
    await checkpoints.finish(id); await checkpoints.undo(id);
    expect(await bytes('ignored.txt')).toBe('later ignored edit');
    expect(await bytes('ignored-dir/work.txt')).toBe('human ignored folder');
    expect(await bytes('.gitignore')).toBe('ignored.txt\nignored-dir/\n');
  });

  it('keeps pre-existing tracked deletions deleted even when the turn recreates and ignores them', async () => {
    await rm(path.join(checkout, 'b.txt'));
    const status = await git('status', '--porcelain');
    const id = await checkpoints.capture(identity());
    await writeFile(path.join(checkout, '.gitignore'), 'b.txt\n'); await writeFile(path.join(checkout, 'b.txt'), 'provider recreated');
    await checkpoints.finish(id); await checkpoints.undo(id);
    await expect(bytes('b.txt')).rejects.toThrow();
    expect(await git('status', '--porcelain')).toBe(status);
  });

  it('backs up tracked source directories named build instead of assuming they are generated', async () => {
    await mkdir(path.join(checkout, 'build')); await writeFile(path.join(checkout, 'build/source.ts'), 'human source');
    await git('add', 'build');
    const id = await checkpoints.capture(identity());
    await writeFile(path.join(checkout, 'build/source.ts'), 'agent source'); await checkpoints.finish(id); await checkpoints.undo(id);
    expect(await bytes('build/source.ts')).toBe('human source');
  });

  it.each(['human', 'other-session', 'reverted'])('refuses %s edits after the turn without touching any file', async (actor) => {
    const id = await checkpoints.capture(identity());
    await writeFile(path.join(checkout, 'a.txt'), 'agent');
    await checkpoints.finish(id);
    await writeFile(path.join(checkout, 'b.txt'), actor);
    if (actor === 'reverted') await writeFile(path.join(checkout, 'b.txt'), 'committed b');
    await expect(checkpoints.undo(id)).rejects.toThrow(/changed|newer/i);
    expect(await bytes('a.txt')).toBe('agent');
    expect(await bytes('b.txt')).toBe(actor === 'reverted' ? 'committed b' : actor);
  });

  it.each(['add', 'commit'])('disables Undo after git %s during a turn', async (operation) => {
    const id = await checkpoints.capture(identity());
    await writeFile(path.join(checkout, 'a.txt'), 'agent'); await git('add', 'a.txt');
    if (operation === 'commit') await git('commit', '-qm', 'agent commit');
    await checkpoints.finish(id);
    expect((await checkpoints.latest(sessionId))?.reason).toMatch(/HEAD|index/i);
    await expect(checkpoints.undo(id)).rejects.toThrow();
    expect(await bytes('a.txt')).toBe('agent');
  });

  it.each(['branch', 'index-flags'])('detects a %s change even when HEAD and staged blob IDs stay the same', async (operation) => {
    const id = await checkpoints.capture(identity());
    await writeFile(path.join(checkout, 'a.txt'), 'agent');
    if (operation === 'branch') await git('checkout', '-qb', 'another-branch');
    else await git('update-index', '--assume-unchanged', 'b.txt');
    await checkpoints.finish(id);
    expect((await checkpoints.latest(sessionId))?.state).toBe('unavailable');
  });

  it('detects intent-to-add becoming staged, even for an empty file', async () => {
    await writeFile(path.join(checkout, 'empty.txt'), ''); await git('add', '-N', 'empty.txt');
    const id = await checkpoints.capture(identity());
    await writeFile(path.join(checkout, 'a.txt'), 'agent'); await git('add', 'empty.txt');
    await checkpoints.finish(id);
    expect((await checkpoints.latest(sessionId))?.state).toBe('unavailable');
    await expect(checkpoints.undo(id)).rejects.toThrow(/index/);
  });

  it.each([0o1755, 0o4755, 0o2755])('preserves all permission bits including %o, even when only the mode changes', async (mode) => {
    await chmod(path.join(checkout, 'a.txt'), mode);
    const id = await checkpoints.capture(identity());
    await chmod(path.join(checkout, 'a.txt'), 0o644); await checkpoints.finish(id); await checkpoints.undo(id);
    expect((await lstat(path.join(checkout, 'a.txt'))).mode & 0o7777).toBe(mode);
  });

  it('excludes known credential directories and filenames even when tracked', async () => {
    for (const directory of ['.docker', '.kube', '.gnupg', '.azure']) {
      await mkdir(path.join(checkout, directory)); await writeFile(path.join(checkout, directory, 'config'), 'synthetic credential');
    }
    await writeFile(path.join(checkout, '.pypirc'), 'synthetic credential');
    await writeFile(path.join(checkout, 'application_default_credentials.json'), 'synthetic credential');
    await git('add', '-f', '.docker', '.kube', '.gnupg', '.azure', '.pypirc', 'application_default_credentials.json');
    const id = await checkpoints.capture(identity());
    expect(await readFile(path.join(state.dataDir, 'turn-checkpoints', `${id}.json`), 'utf8')).not.toContain(Buffer.from('synthetic credential').toString('base64'));
  });

  it('refuses later index edits and symlink replacements', async () => {
    const id = await checkpoints.capture(identity());
    await writeFile(path.join(checkout, 'a.txt'), 'agent'); await checkpoints.finish(id);
    await git('add', 'a.txt');
    await expect(checkpoints.undo(id)).rejects.toThrow(/Git|index|changed/i);
    await git('reset', '-q', 'HEAD', 'a.txt');
    await rm(path.join(checkout, 'a.txt'));
    await symlink(path.join(root, 'private'), path.join(checkout, 'a.txt'));
    await writeFile(path.join(root, 'private'), 'outside');
    await expect(checkpoints.undo(id)).rejects.toThrow();
    expect(await readFile(path.join(root, 'private'), 'utf8')).toBe('outside');
  });

  it.each(['hardlink', 'nested'])('fails capture on a nonexcluded %s', async (kind) => {
    if (kind === 'hardlink') await link(path.join(checkout, 'a.txt'), path.join(checkout, 'unsafe'));
    if (kind === 'nested') { await mkdir(path.join(checkout, 'nested')); await execFile('git', ['init', '-q'], { cwd: path.join(checkout, 'nested') }); }
    await expect(checkpoints.capture(identity())).rejects.toThrow(/link|nested|regular/i);
  });

  it.each([true, false])('captures repository instruction and directory links without reading their targets (Git: %s)', async (useGit) => {
    await mkdir(path.join(checkout, '.agents'));
    await mkdir(path.join(checkout, '.github/skills'), { recursive: true });
    await mkdir(path.join(checkout, 'client/ios/App/App'), { recursive: true });
    await writeFile(path.join(checkout, 'AGENTS.md'), 'fixture instructions');
    const links = {
      '.agents/skills': '../.github/skills',
      'CLAUDE.md': 'AGENTS.md',
      'client/ios/App/App/GoogleService-Info.plist': 'GoogleService-Info_prod.plist',
      'private-link': '.env.local',
      'external-directory': root,
      'external-file': path.join(root, 'private'),
    };
    await writeFile(path.join(checkout, '.env.local'), 'excluded target bytes');
    await writeFile(path.join(root, 'private'), 'external target bytes');
    for (const [file, target] of Object.entries(links)) await symlink(target, path.join(checkout, file));
    if (useGit) await git('add', '.agents/skills', 'CLAUDE.md', 'client/ios/App/App/GoogleService-Info.plist');
    else await rm(path.join(checkout, '.git'), { recursive: true });
    const id = await checkpoints.capture(identity());
    const text = await readFile(path.join(state.dataDir, 'turn-checkpoints', `${id}.json`), 'utf8');
    const record = JSON.parse(text);
    for (const [file, target] of Object.entries(links)) {
      expect(record.before.files.find((entry: { path: string }) => entry.path === file)).toMatchObject({ kind: 'symlink', target });
      expect(await readlink(path.join(checkout, file))).toBe(target);
    }
    expect(text).not.toContain(Buffer.from('excluded target bytes').toString('base64'));
    expect(text).not.toContain(Buffer.from('external target bytes').toString('base64'));
    await writeFile(path.join(checkout, 'a.txt'), 'agent');
    await writeFile(path.join(root, 'private'), 'later external edit');
    await checkpoints.finish(id); await checkpoints.undo(id);
    expect(await bytes('a.txt')).toBe('committed a');
    expect(await readFile(path.join(root, 'private'), 'utf8')).toBe('later external edit');
  });

  it.each(['retarget', 'delete', 'replace-with-file'])('restores the exact link target after %s without following it', async (operation) => {
    const file = path.join(checkout, 'pointer');
    const original = '../missing-ünicode';
    await symlink(original, file);
    const id = await checkpoints.capture(identity());
    await rm(file);
    if (operation === 'retarget') await symlink(path.join(root, 'private'), file);
    if (operation === 'replace-with-file') { await writeFile(file, original); await chmod(file, 0o777); }
    await writeFile(path.join(root, 'private'), 'external work');
    await checkpoints.finish(id);
    expect((await checkpoints.latest(sessionId))?.changedFiles).toBe(1);
    await checkpoints.undo(id);
    expect((await lstat(file)).isSymbolicLink()).toBe(true);
    expect(await readlink(file)).toBe(original);
    expect(await readFile(path.join(root, 'private'), 'utf8')).toBe('external work');
  });

  it('restores a regular file replaced by a link even when content hash and mode match', async () => {
    const file = path.join(checkout, 'a.txt');
    await writeFile(file, '../missing'); await chmod(file, 0o777);
    const id = await checkpoints.capture(identity());
    await rm(file); await symlink('../missing', file);
    await checkpoints.finish(id);
    expect((await checkpoints.latest(sessionId))?.changedFiles).toBe(1);
    await checkpoints.undo(id);
    expect((await lstat(file)).isFile()).toBe(true);
    expect(await bytes('a.txt')).toBe('../missing');
    expect((await lstat(file)).mode & 0o7777).toBe(0o777);
  });

  it('removes links created during the turn and never deletes their targets', async () => {
    const id = await checkpoints.capture(identity());
    const file = path.join(checkout, 'new-link');
    await writeFile(path.join(root, 'private'), 'outside'); await symlink(path.join(root, 'private'), file);
    await checkpoints.finish(id); await checkpoints.undo(id);
    await expect(lstat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(root, 'private'), 'utf8')).toBe('outside');
  });

  it.each(['retarget', 'recreate'])('refuses a later link %s without restoring other files', async (operation) => {
    const file = path.join(checkout, 'pointer');
    await symlink('original', file);
    const id = await checkpoints.capture(identity());
    await writeFile(path.join(checkout, 'a.txt'), 'agent'); await checkpoints.finish(id);
    await rename(file, path.join(root, 'old-link'));
    const target = operation === 'retarget' ? 'later' : 'original';
    await symlink(target, file);
    await expect(checkpoints.undo(id)).rejects.toThrow(/changed|newer/);
    expect(await bytes('a.txt')).toBe('agent'); expect(await readlink(file)).toBe(target);
  });

  it('validates saved link target checksums before restoring anything', async () => {
    const file = path.join(checkout, 'pointer');
    await symlink('original', file);
    const id = await checkpoints.capture(identity());
    await rm(file); await symlink('agent', file); await writeFile(path.join(checkout, 'a.txt'), 'agent');
    await checkpoints.finish(id);
    const recordFile = path.join(state.dataDir, 'turn-checkpoints', `${id}.json`);
    const record = JSON.parse(await readFile(recordFile, 'utf8'));
    record.before.files.find((entry: { path: string }) => entry.path === 'pointer').target = 'tampered';
    await writeFile(recordFile, JSON.stringify(record));
    await expect(checkpoints.undo(id)).rejects.toThrow(/content is invalid/);
    expect(await bytes('a.txt')).toBe('agent'); expect(await readlink(file)).toBe('agent');
  });

  it('keeps a bounded checkpoint recoverable with thousands of long link targets', async () => {
    const target = 't'.repeat(4000);
    await Promise.all(Array.from({ length: 7000 }, (_, index) => symlink(target, path.join(checkout, `pointer-${index}`))));
    const id = await checkpoints.capture(identity());
    await writeFile(path.join(checkout, 'a.txt'), 'agent');
    await checkpoints.finish(id);
    expect((await checkpoints.latest(sessionId))?.state).toBe('ready');
    const record = JSON.parse(await readFile(path.join(state.dataDir, 'turn-checkpoints', `${id}.json`), 'utf8'));
    expect(record.before.files.find((file: { kind: string }) => file.kind === 'symlink').target).toBe(target);
    expect(record.after.files.filter((file: { kind: string }) => file.kind === 'symlink')
      .every((file: { target?: string }) => file.target === undefined)).toBe(true);
  }, 30_000);

  it.each(['capturing', 'ready'])('recovers existing version 1 regular-file checkpoints saved as %s', async (stage) => {
    const id = await checkpoints.capture(identity());
    await writeFile(path.join(checkout, 'a.txt'), 'agent');
    if (stage === 'ready') await checkpoints.finish(id);
    const recordFile = path.join(state.dataDir, 'turn-checkpoints', `${id}.json`);
    const record = JSON.parse(await readFile(recordFile, 'utf8'));
    record.version = 1;
    for (const snapshot of [record.before, record.after].filter(Boolean)) for (const file of snapshot.files) delete file.kind;
    await writeFile(recordFile, JSON.stringify(record));
    if (stage === 'capturing') await new TurnCheckpoints(state.dataDir).finish(id);
    await new TurnCheckpoints(state.dataDir).undo(id);
    expect(await bytes('a.txt')).toBe('committed a');
    expect(JSON.parse(await readFile(recordFile, 'utf8')).version).toBe(2);
  });

  it.each(['link', 'parent'])('refuses a %s replacement during link capture', async (replacement) => {
    const parent = path.join(checkout, 'links'); await mkdir(parent);
    const file = path.join(parent, 'pointer'); await symlink('../a.txt', file);
    const outside = path.join(root, 'outside'); await mkdir(outside);
    await symlink('private-target', path.join(outside, 'pointer'));
    const fs = await import('node:fs/promises'); const actualReadlink = fs.readlink;
    let swapped = false;
    vi.spyOn(fs, 'readlink').mockImplementation(async (target, options) => {
      const value = await actualReadlink(target, options);
      if (!swapped && Buffer.isBuffer(value)) {
        swapped = true;
        if (replacement === 'link') { await rm(file); await symlink('replacement', file); }
        else { await rename(parent, path.join(root, 'old-parent')); await symlink(outside, parent); }
      }
      return value;
    });
    await expect(checkpoints.capture(identity())).rejects.toThrow(/changed/);
    expect(swapped).toBe(true); expect(await checkpoints.latest(sessionId)).toBeUndefined();
    expect(await actualReadlink(path.join(outside, 'pointer'))).toBe('private-target');
  });

  it('refuses deleting a new link retargeted while opening its restore parent', async () => {
    const id = await checkpoints.capture(identity());
    const file = path.join(checkout, 'new-link'); await symlink('agent-target', file); await checkpoints.finish(id);
    const fs = await import('node:fs/promises'); const actualOpen = fs.open;
    let parentOpens = 0;
    vi.spyOn(fs, 'open').mockImplementation(async (target, flags, mode) => {
      const handle = await actualOpen(target, flags, mode);
      // Two link reads precede the parent handle used for deletion. Change the link at that
      // boundary to reproduce an outside editor racing the last validation before unlink.
      if (target === checkout && flags === (constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
        && ++parentOpens === 3) { await rename(file, path.join(root, 'old-link')); await symlink('later-target', file); }
      return handle;
    });
    await expect(checkpoints.undo(id)).rejects.toThrow(/changed|partly restored/);
    expect(await readlink(file)).toBe('later-target');
  });

  it('refuses hardlinked symlinks and targets that do not round-trip as UTF-8', async () => {
    const file = path.join(checkout, 'pointer');
    await symlink(Buffer.from([0xff]), file);
    await expect(checkpoints.capture(identity())).rejects.toThrow(/UTF-8/);
    await rm(file); await symlink('original', file); await link(file, path.join(checkout, 'hardlink'));
    await expect(checkpoints.capture(identity())).rejects.toThrow(/hard links/);
  });

  it.each(['nul', 'oversize', 'surrogate', 'missing'])('refuses a saved link target containing %s before restoring files', async (invalid) => {
    const file = path.join(checkout, 'pointer'); await symlink('original', file);
    const id = await checkpoints.capture(identity());
    await writeFile(path.join(checkout, 'a.txt'), 'agent'); await checkpoints.finish(id);
    const recordFile = path.join(state.dataDir, 'turn-checkpoints', `${id}.json`);
    const record = JSON.parse(await readFile(recordFile, 'utf8'));
    const target = invalid === 'missing' ? undefined : invalid === 'nul' ? 'before\0after' : invalid === 'oversize' ? 'ü'.repeat(2049) : '\ud800';
    record.before.files.find((entry: { path: string }) => entry.path === 'pointer').target = target;
    await writeFile(recordFile, JSON.stringify(record));
    await expect(checkpoints.undo(id)).rejects.toThrow();
    expect(await bytes('a.txt')).toBe('agent'); expect(await readlink(file)).toBe('original');
  });

  it('retains the original link backup and disables retry if link restoration fails', async () => {
    const file = path.join(checkout, 'pointer'); await symlink('original', file);
    const id = await checkpoints.capture(identity());
    await rm(file); await symlink('agent', file); await checkpoints.finish(id); state.failRestoreAt = 1;
    await expect(checkpoints.undo(id)).rejects.toThrow(/partly restored/);
    expect(await readlink(file)).toBe('agent');
    await expect(checkpoints.undo(id)).rejects.toThrow(/interrupted/);
    const record = JSON.parse(await readFile(path.join(state.dataDir, 'turn-checkpoints', `${id}.json`), 'utf8'));
    expect(record.before.files.find((entry: { path: string }) => entry.path === 'pointer').target).toBe('original');
    expect((await readdir(checkout)).filter((name) => name.startsWith('.codeai-undo-'))).toEqual([]);
  });

  it('disables Undo when a populated directory is replaced by a link without reading the target', async () => {
    const parent = path.join(checkout, 'folder'); await mkdir(parent);
    await writeFile(path.join(parent, 'work.txt'), 'human');
    const outside = path.join(root, 'outside'); await mkdir(outside);
    await writeFile(path.join(outside, 'work.txt'), 'external');
    const id = await checkpoints.capture(identity());
    await rm(parent, { recursive: true }); await symlink(outside, parent); await checkpoints.finish(id);
    expect((await checkpoints.latest(sessionId))?.state).toBe('unavailable');
    await expect(checkpoints.undo(id)).rejects.toThrow(/fingerprint/);
    expect(await readFile(path.join(outside, 'work.txt'), 'utf8')).toBe('external');
  });

  it('fails closed on size limits and data storage inside the checkout', async () => {
    await writeFile(path.join(checkout, 'large.bin'), Buffer.alloc(4 * 1024 * 1024 + 1));
    await expect(checkpoints.capture(identity())).rejects.toThrow(/limit|MiB/i);
    await expect(new TurnCheckpoints(path.join(checkout, 'data')).capture(identity())).rejects.toThrow(/outside/i);
  });

  it('enforces the total file-byte budget before saving a checkpoint', async () => {
    const content = Buffer.alloc(4 * 1024 * 1024);
    await Promise.all(Array.from({ length: 9 }, (_, index) => writeFile(path.join(checkout, `large-${index}.bin`), content)));
    await expect(checkpoints.capture(identity())).rejects.toThrow(/32 MiB/);
    expect(await checkpoints.latest(sessionId)).toBeUndefined();
  });

  it('bounds the complete inventory including already deleted tracked files', async () => {
    const object = (await git('rev-parse', 'HEAD:a.txt')).trim();
    const entries = Array.from({ length: 10_001 }, (_, index) => `100644 ${object}\tmissing-${index}.txt\n`).join('');
    await new Promise<void>((resolve, reject) => {
      const child = callbackExecFile('git', ['update-index', '--index-info'], { cwd: checkout,
        env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
      }, (error) => error ? reject(error) : resolve());
      child.stdin!.end(entries);
    });
    await expect(checkpoints.capture(identity())).rejects.toThrow(/10,000 file limit/);
  });

  it('retains recovery on a new owner, disables interrupted captures, and expires after seven days', async () => {
    const id = await checkpoints.capture(identity());
    await writeFile(path.join(checkout, 'a.txt'), 'agent');
    expect((await new TurnCheckpoints(state.dataDir).latest(sessionId))?.state).toBe('unavailable');
    await checkpoints.finish(id);
    expect((await new TurnCheckpoints(state.dataDir).latest(sessionId))?.state).toBe('ready');
    now += 7 * 24 * 60 * 60 * 1000 + 1;
    expect((await checkpoints.latest(sessionId))?.reason).toMatch(/expired/i);
    await expect(checkpoints.undo(id)).rejects.toThrow(/expired/i);
  });

  it('disables recovery if the terminal scan fails and retains the original backup', async () => {
    const id = await checkpoints.capture(identity());
    await rename(checkout, `${checkout}-moved`);
    await checkpoints.finish(id);
    expect((await checkpoints.latest(sessionId))?.state).toBe('unavailable');
    expect(await readFile(path.join(state.dataDir, 'turn-checkpoints', `${id}.json`), 'utf8')).toContain(Buffer.from('committed a').toString('base64'));
  });

  it('retains the backup and disables automatic retries after a partial restore I/O failure', async () => {
    const id = await checkpoints.capture(identity());
    await writeFile(path.join(checkout, 'a.txt'), 'agent a'); await writeFile(path.join(checkout, 'b.txt'), 'agent b');
    await checkpoints.finish(id); state.failRestoreAt = 2;
    await expect(checkpoints.undo(id)).rejects.toThrow(/partly restored/);
    expect(await bytes('a.txt')).toBe('committed a'); expect(await bytes('b.txt')).toBe('agent b');
    expect((await new TurnCheckpoints(state.dataDir).latest(sessionId))?.reason).toMatch(/partly restored/);
    await expect(checkpoints.undo(id)).rejects.toThrow(/interrupted/);
    expect(await readFile(path.join(state.dataDir, 'turn-checkpoints', `${id}.json`), 'utf8')).toContain(Buffer.from('committed b').toString('base64'));
  });

  it('does not advertise recovery if the terminal durable write fails', async () => {
    const id = await checkpoints.capture(identity());
    await writeFile(path.join(checkout, 'a.txt'), 'agent'); state.failRecordSave = true;
    await expect(checkpoints.finish(id)).rejects.toThrow('Synthetic durable write failure');
    expect((await checkpoints.latest(sessionId))?.state).toBe('unavailable');
    expect(await readFile(path.join(state.dataDir, 'turn-checkpoints', `${id}.json`), 'utf8')).toContain(Buffer.from('committed a').toString('base64'));
  });

  it('repairs a stale ready summary after a crash between the restoring record and its status write', async () => {
    const id = await checkpoints.capture(identity());
    await writeFile(path.join(checkout, 'a.txt'), 'agent'); await checkpoints.finish(id);
    state.failSummarySave = true;
    await expect(checkpoints.undo(id)).rejects.toThrow('Synthetic summary write failure');
    state.failSummarySave = false;
    const summary = await new TurnCheckpoints(state.dataDir).latest(sessionId);
    expect(summary?.state).toBe('unavailable'); expect(summary?.reason).toMatch(/interrupted/);
    expect(await bytes('a.txt')).toBe('agent');
  });

  it('validates backup checksums and relative paths before any restore', async () => {
    const id = await checkpoints.capture(identity());
    await writeFile(path.join(checkout, 'a.txt'), 'agent'); await checkpoints.finish(id);
    const file = path.join(state.dataDir, 'turn-checkpoints', `${id}.json`);
    const raw = JSON.parse(await readFile(file, 'utf8'));
    raw.before.files[0].content = Buffer.from('tampered').toString('base64');
    await writeFile(file, JSON.stringify(raw));
    await expect(checkpoints.undo(id)).rejects.toThrow(/content is invalid/);
    raw.before.files[0].path = '../outside'; await writeFile(file, JSON.stringify(raw));
    await expect(checkpoints.undo(id)).rejects.toThrow();
    expect(await bytes('a.txt')).toBe('agent');
  });

  it('recreates removed parent directories and refuses parent links introduced later', async () => {
    await mkdir(path.join(checkout, 'folder')); await writeFile(path.join(checkout, 'folder/old.txt'), 'human');
    const id = await checkpoints.capture(identity());
    await rm(path.join(checkout, 'folder'), { recursive: true }); await checkpoints.finish(id);
    await checkpoints.undo(id); expect(await bytes('folder/old.txt')).toBe('human');
    const next = await checkpoints.capture(identity());
    await writeFile(path.join(checkout, 'folder/old.txt'), 'agent'); await checkpoints.finish(next);
    await rm(path.join(checkout, 'folder'), { recursive: true });
    await symlink(root, path.join(checkout, 'folder'));
    await expect(checkpoints.undo(next)).rejects.toThrow(/symbolic link/);
  });

  it('prunes finished checkpoints at ten records', async () => {
    for (let index = 0; index < 12; index++) {
      now++;
      const id = await checkpoints.capture(identity()); await checkpoints.finish(id);
    }
    const { readdir } = await import('node:fs/promises');
    expect((await readdir(path.join(state.dataDir, 'turn-checkpoints'))).filter((file) => file.endsWith('.json'))).toHaveLength(10);
  });

  it('works in an unborn repository and a non-Git project', async () => {
    await rm(path.join(checkout, '.git'), { recursive: true });
    for (const initialize of [true, false]) {
      if (initialize) await git('init', '-q');
      else await rm(path.join(checkout, '.git'), { recursive: true });
      const id = await checkpoints.capture(identity());
      await writeFile(path.join(checkout, 'a.txt'), 'agent'); await checkpoints.finish(id); await checkpoints.undo(id);
      expect(await bytes('a.txt')).toBe('committed a');
    }
  });
});

describe('checkout recovery access', () => {
  it('shares the scheduler with runs, reads and maintenance, including overlapping paths', async () => {
    const registry = new RunRegistry();
    const release = registry.acquireCheckoutWrite(checkout);
    expect(release).toBeTypeOf('function');
    expect(registry.acquireCheckoutWrite(checkout)).toBeUndefined();
    expect(registry.acquireCheckoutRead(checkout)).toBeUndefined();
    expect(registry.acquireMaintenance()).toBe('live-runs');
    let ran = false;
    const runId = crypto.randomUUID();
    registry.reserve({ runId, sessionId, participantId: 'agent', providerKey: 'provider', checkoutId: 'nested', checkoutPath: path.join(checkout, 'nested'), access: 'write', cancel() {} });
    registry.activate(runId, { async execute() { ran = true; }, async cancelQueued() {} });
    await Promise.resolve(); expect(ran).toBe(false);
    release!(); await registry.wait(runId); expect(ran).toBe(true);
    const readRelease = registry.acquireCheckoutRead(checkout)!;
    expect(registry.acquireCheckoutWrite(checkout)).toBeUndefined(); readRelease();
    expect(registry.acquireMaintenance()).toBe('acquired');
    expect(registry.acquireCheckoutWrite(checkout)).toBeUndefined();
  });
});
