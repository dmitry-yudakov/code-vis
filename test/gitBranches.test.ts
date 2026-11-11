import { execFile } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { listGitBranches, switchGitBranch } from '@/server/repository/gitBranches';
import { runRegistry } from '@/server/runs/runRegistry';
import { getConfig } from '@/server/config';
import { CheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { createManagedWorktree, readWorktreeRecords } from '@/server/repository/managedWorktrees';
import { getSessionStore } from '@/server/storage/sessionStore';
import { DOCKER_PROFILE } from '@/server/execution/dockerProfile';

const docker = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock('@/server/execution/dockerCommand', () => ({
  localDockerEndpoint: async () => 'unix:///fixture/docker.sock', dockerCommand: docker.command,
}));

const execute = promisify(execFile);
let scratch: string;
let repository: string;
const git = async (...args: string[]) => (await execute('git', args, { cwd: repository })).stdout.trim();
const write = (name: string, text: string) => writeFile(path.join(repository, name), text);
const switchTo = async (branch = 'feature') => switchGitBranch(repository, branch, (await listGitBranches(repository)).head);

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codeai-branches-')));
  repository = path.join(scratch, 'repo');
  await mkdir(repository);
  vi.stubEnv('CODEAI_DATA_DIR', path.join(scratch, 'data'));
  vi.stubEnv('CODEAI_DOCKER_ENABLED', 'false');
  vi.stubEnv('CODEAI_REPOSITORIES_ROOT', scratch);
  vi.stubEnv('HOME', scratch);
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  await git('init', '-q', '-b', 'main');
  await git('config', 'user.name', 'Fixture');
  await git('config', 'user.email', 'fixture@example.invalid');
  await write('file.txt', 'main\n');
  await git('add', '.');
  await git('commit', '-qm', 'initial');
  await git('switch', '-qc', 'feature');
  await write('file.txt', 'feature\n');
  await git('commit', '-qam', 'feature');
  await git('switch', '-q', 'main');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  docker.command.mockReset();
  await rm(scratch, { recursive: true, force: true });
});

it('lists local branches, switches HEAD and files, and releases checkout access', async () => {
  const list = await listGitBranches(repository);
  expect(list.current).toBe('main');
  expect(list.branches).toEqual([{ name: 'feature', occupied: false }, { name: 'main', occupied: true }]);
  await switchGitBranch(repository, 'feature', list.head);
  expect(await git('branch', '--show-current')).toBe('feature');
  expect(await readFile(path.join(repository, 'file.txt'), 'utf8')).toBe('feature\n');
  const release = runRegistry.acquireCheckoutWrite(repository);
  expect(release).toBeDefined(); release!();
});

it('preserves compatible local edits and untracked files', async () => {
  await write('unchanged.txt', 'base'); await git('add', '.'); await git('commit', '-qm', 'shared file');
  await git('switch', '-q', 'feature'); await git('cherry-pick', 'main'); await git('switch', '-q', 'main');
  await write('unchanged.txt', 'modified locally'); await git('add', 'unchanged.txt');
  await write('local.txt', 'keep me');
  await switchTo();
  expect(await readFile(path.join(repository, 'local.txt'), 'utf8')).toBe('keep me');
  expect(await readFile(path.join(repository, 'unchanged.txt'), 'utf8')).toBe('modified locally');
  expect(await git('diff', '--cached', '--name-only')).toBe('unchanged.txt');
});

it.each([false, true])('preserves conflicting edits (staged: %s)', async staged => {
  await write('file.txt', 'my work');
  if (staged) await git('add', 'file.txt');
  await expect(switchTo()).rejects.toThrow(/local changes|overwritten/i);
  expect(await git('branch', '--show-current')).toBe('main');
  expect(await readFile(path.join(repository, 'file.txt'), 'utf8')).toBe('my work');
});

it.each([false, true])('preserves untracked collisions (ignored: %s)', async ignored => {
  await git('switch', '-q', 'feature');
  await write('collision.txt', 'branch version');
  await git('add', 'collision.txt'); await git('commit', '-qm', 'collision');
  await git('switch', '-q', 'main');
  if (ignored) await write('.gitignore', 'collision.txt\n');
  await write('collision.txt', 'private local data');
  await expect(switchTo()).rejects.toThrow(/overwritten/i);
  expect(await readFile(path.join(repository, 'collision.txt'), 'utf8')).toBe('private local data');
});

it('rejects stale HEAD even if the branch name is unchanged', async () => {
  const list = await listGitBranches(repository);
  await git('commit', '--allow-empty', '-qm', 'new commit');
  await expect(switchGitBranch(repository, 'feature', list.head)).rejects.toThrow(/changed.*refresh/i);
  expect(await git('branch', '--show-current')).toBe('main');
});

it('allows a retry after a response is lost', async () => {
  const list = await listGitBranches(repository);
  await switchGitBranch(repository, 'feature', list.head);
  await expect(switchGitBranch(repository, 'feature', list.head)).resolves.toBe('feature');
});

it.each(['--force', '-', '@{-1}', 'HEAD', 'origin/feature', 'missing', 'main\nfeature'])('rejects a non-local target: %s', async branch => {
  await expect(switchTo(branch)).rejects.toThrow(/branch/i);
  expect(await git('branch', '--show-current')).toBe('main');
});

it('marks and refuses a branch checked out in another worktree', async () => {
  await git('worktree', 'add', '-q', path.join(scratch, 'other'), 'feature');
  expect((await listGitBranches(repository)).branches[0]).toEqual({ name: 'feature', occupied: true });
  await expect(switchTo()).rejects.toThrow(/worktree/i);
});

it('refuses unverified linked siblings even when switching an unoccupied branch', async () => {
  const sibling = path.join(scratch, 'ordinary-worktree');
  await git('worktree', 'add', '-qb', 'other', sibling);
  const head = (await listGitBranches(repository)).head;
  const release = runRegistry.acquireCheckoutWrite(sibling);
  try {
    await expect(switchGitBranch(repository, 'feature', head)).rejects.toThrow(/outside CodeAI management|using this checkout/);
    expect(await git('branch', '--show-current')).toBe('main');
  } finally { release!(); }
});

it('excludes redirected ordinary writers but allows proved independent writers', async () => {
  const other = path.join(scratch, 'other'); await mkdir(other);
  await writeFile(path.join(other, '.git'), `gitdir: ${path.join(repository, '.git')}\n`);
  const head = (await listGitBranches(repository)).head;
  const redirectedWriter = runRegistry.acquireCheckoutWrite(other);
  try { await expect(switchGitBranch(repository, 'feature', head)).rejects.toThrow(/using this checkout/); }
  finally { redirectedWriter!(); }
  await rm(path.join(other, '.git'));
  await execute('git', ['init', '-q', '-b', 'main', other]);
  const independentWriter = runRegistry.acquireCheckoutWrite(other);
  try { await expect(switchGitBranch(repository, 'feature', head)).resolves.toBe('feature'); }
  finally { independentWriter!(); }
});

it('switches with nested package and enclosing project markers without conflicting with its own lease', async () => {
  await mkdir(path.join(repository, 'package'));
  await write('package/package.json', '{}');
  await writeFile(path.join(scratch, 'package.json'), '{}');
  vi.stubEnv('CODEAI_REPOSITORIES_DEPTH', '2');
  await expect(switchTo()).resolves.toBe('feature');
});

it('switches away from detached HEAD and lists an unborn repository', async () => {
  await git('switch', '--detach', '-q');
  expect((await listGitBranches(repository)).current).toBeUndefined();
  await switchTo();
  repository = path.join(scratch, 'empty'); await mkdir(repository);
  await git('init', '-q', '-b', 'main');
  expect(await listGitBranches(repository)).toMatchObject({ current: 'main', branches: [] });
});

it('refuses while a checkout read or writer holds access, then succeeds', async () => {
  for (const release of [runRegistry.acquireCheckoutRead(repository)]) {
    await expect(switchTo()).rejects.toThrow(/busy|using this checkout/i); release!();
  }
  const head = (await listGitBranches(repository)).head;
  const release = runRegistry.acquireCheckoutWrite(repository);
  await expect(switchGitBranch(repository, 'feature', head)).rejects.toThrow(/busy|using this checkout/i);
  release!();
  await expect(switchTo()).resolves.toBe('feature');
});

it('does not run checkout hooks or global filters', async () => {
  const marker = path.join(scratch, 'ran');
  const script = `#!/bin/sh\ntouch '${marker}'\ncat\n`;
  await git('switch', '-q', 'feature'); await write('.gitattributes', 'file.txt filter=evil\n');
  await git('add', '.gitattributes'); await git('commit', '-qm', 'attributes'); await git('switch', '-q', 'main');
  await write('.git/hooks/post-checkout', script); await chmod(path.join(repository, '.git/hooks/post-checkout'), 0o755);
  await writeFile(path.join(scratch, '.gitconfig'), `[filter "evil"]\n smudge = touch '${marker}'\n`);
  await switchTo();
  expect(await access(marker).then(() => true, () => false)).toBe(false);
});

it('switches a managed worktree without changing its source and excludes source/sibling writers', async () => {
  const worktrees = path.join(scratch, 'worktrees'); await mkdir(worktrees);
  vi.stubEnv('CODEAI_REPOSITORIES_ROOT', repository);
  vi.stubEnv('CODEAI_WORKTREES_ROOT', worktrees);
  const dataDir = getConfig().dataDir;
  try {
    const checkoutId = (await new CheckoutRegistry(repository).list())[0].id;
    for (let index = 0; index < 2; index++) await createManagedWorktree({ provider: 'claude', checkoutId,
      checkoutMode: 'worktree', creationRequestId: crypto.randomUUID() }, getConfig());
    const [record, sibling] = await readWorktreeRecords(dataDir);
    const head = (await listGitBranches(record.destination)).head;
    for (const location of [repository, sibling.destination]) {
      const release = runRegistry.acquireCheckoutWrite(location);
      expect(release).toBeDefined();
      try { await expect(switchGitBranch(record.destination, 'feature', head)).rejects.toThrow(/using this checkout|being edited/i); }
      finally { release!(); }
    }
    await expect(switchGitBranch(record.destination, 'feature', head)).resolves.toBe('feature');
    expect(await git('branch', '--show-current')).toBe('main');
    expect(await readFile(path.join(record.destination, 'file.txt'), 'utf8')).toBe('feature\n');
    const release = runRegistry.acquireCheckoutWrite(record.destination);
    await expect(switchTo()).rejects.toThrow(/using this checkout/i);
    release!();
    await git('branch', 'available');
    const moved = path.join(scratch, 'moved');
    await git('worktree', 'move', record.destination, moved);
    const movedWriter = runRegistry.acquireCheckoutWrite(moved);
    try { await expect(switchTo('available')).rejects.toThrow(/missing|moved|changed/i); }
    finally { movedWriter!(); }
    expect(await git('branch', '--show-current')).toBe('main');
  } finally { await getSessionStore(dataDir).close(); }
});

it('reports branch-list overflow instead of silently omitting local branches', async () => {
  const oid = await git('rev-parse', 'HEAD');
  await Promise.all(Array.from({ length: 999 }, (_, index) => write(`.git/refs/heads/branch-${index}`, `${oid}\n`)));
  await expect(listGitBranches(repository)).rejects.toThrow(/1,000/);
});

it('inspects provisioned repositories through the credential-free helper and fails closed', async () => {
  const head = (await listGitBranches(repository)).head;
  const profile = path.join(getConfig().dataDir, 'docker'); await mkdir(profile, { recursive: true });
  await writeFile(path.join(profile, 'profile.json'), JSON.stringify({
    profile: DOCKER_PROFILE, image: `sha256:${'a'.repeat(64)}`, engineId: 'engine-original',
  }));
  docker.command.mockImplementation(async (input: string[]) => {
    if (input[2] === 'info') return 'engine-original';
    if (input[3] === 'ls') return '';
    throw new Error('Helper unavailable');
  });
  await expect(switchGitBranch(repository, 'feature', head)).rejects.toThrow();
  const launch = docker.command.mock.calls.find(([input]) => input[2] === 'create')?.[0] as string[];
  expect(launch.join(' ')).toContain('--network none');
  expect(launch.filter(argument => argument.startsWith('type=bind'))).toEqual([`type=bind,src=${repository},dst=/workspace,readonly`]);
  expect(await git('branch', '--show-current')).toBe('main');
  const release = runRegistry.acquireCheckoutWrite(repository); expect(release).toBeDefined(); release!();
});

it.each(['filter.evil.smudge', 'include.path', 'core.worktree', 'core.sshCommand', 'extensions.worktreeConfig'])('rejects unsafe local configuration: %s', async key => {
  const head = (await listGitBranches(repository)).head;
  await git('config', key, key.startsWith('extensions.') ? 'true' : '/nonexistent');
  await expect(switchGitBranch(repository, 'feature', head)).rejects.toThrow(/configuration/i);
  const release = runRegistry.acquireCheckoutWrite(repository); expect(release).toBeDefined(); release!();
});
