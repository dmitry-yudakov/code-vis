import { execFile } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOCKER_PROFILE } from '@/server/execution/dockerProfile';

const mocks = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock('@/server/execution/dockerCommand', () => ({
  localDockerEndpoint: async () => 'unix:///fixture/docker.sock',
  dockerCommand: mocks.command,
}));

import { getConfig } from '@/server/config';
import { pushCurrentBranch, pushFailureMessage, withPushOffer } from '@/server/repository/gitPush';
import { readWorkingTree } from '@/server/repository/gitRepository';
import { createManagedWorktree, readWorktreeRecords } from '@/server/repository/managedWorktrees';
import { CheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { getSessionStore } from '@/server/storage/sessionStore';
import { runRegistry } from '@/server/runs/runRegistry';

const execute = promisify(execFile);
const directories: string[] = [];
let scratch: string;
let dataDir: string;
let home: string;
let repository: string;
let remote: string;

const exists = (file: string) => access(file).then(() => true, () => false);
const git = async (...args: string[]) => (await execute('git', args, { cwd: repository })).stdout.trim();
const remoteRef = async (ref: string) => (await execute('git', ['--git-dir', remote, 'rev-parse', '--verify', '-q', ref])
  .then(({ stdout }) => stdout.trim(), () => undefined));
const commit = async (name: string) => {
  await writeFile(path.join(repository, name), `${name}\n`);
  await git('add', name);
  await git('commit', '-qm', name);
  return git('rev-parse', 'HEAD');
};
/** A file whose existence proves that Git ran what a repository's configuration named. */
const marker = () => path.join(scratch, 'ran');
const runs = async (body: string) => {
  const file = path.join(scratch, `script-${crypto.randomUUID()}`);
  await writeFile(file, `#!/bin/sh\ntouch ${marker()}\n${body}\n`);
  await chmod(file, 0o755);
  return file;
};

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codeai-push-')));
  directories.push(scratch);
  dataDir = path.join(scratch, 'data');
  home = path.join(scratch, 'home');
  repository = path.join(scratch, 'repository');
  remote = path.join(scratch, 'remote.git');
  await Promise.all([mkdir(dataDir), mkdir(home), mkdir(repository)]);
  vi.stubEnv('CODEAI_DATA_DIR', dataDir);
  vi.stubEnv('CODEAI_DOCKER_ENABLED', 'false');
  vi.stubEnv('HOME', home);
  vi.stubEnv('XDG_CONFIG_HOME', '');
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  // Real Git over the production transport: this stands in for ssh on the far side of the wire.
  const ssh = path.join(home, 'fake-ssh');
  await writeFile(ssh, [
    '#!/bin/sh',
    `env > ${path.join(scratch, 'ssh-env')}`,
    `touch ${path.join(scratch, 'ssh-started')}`,
    `while [ -e ${path.join(scratch, 'ssh-hold')} ]; do sleep 0.02; done`,
    `touch ${path.join(scratch, 'ssh-released')}`,
    `if [ -e ${path.join(scratch, 'ssh-master')} ]; then sleep 8 </dev/null >/dev/null & fi`,
    'for argument; do last=$argument; done',
    'exec sh -c "$last"',
  ].join('\n'));
  await chmod(ssh, 0o755);
  await writeFile(path.join(home, '.gitconfig'), [
    '[user]', '\tname = Fixture', '\temail = fixture@example.invalid',
    '[commit]', '\tgpgsign = false',
    '[core]', `\tsshCommand = ${ssh}`,
  ].join('\n'));
  await execute('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  await git('init', '-q', '-b', 'main');
  await git('remote', 'add', 'origin', `ssh://fixture${remote}`);
  await commit('first.txt');
  await git('push', '-q', '-u', 'origin', 'main');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('pushing the current branch', () => {
  it('sends the branch to its upstream', async () => {
    const head = await commit('second.txt');
    await expect(pushCurrentBranch(repository, 'origin/main')).resolves.toBe('origin/main');
    expect(await remoteRef('refs/heads/main')).toBe(head);
    expect(await git('rev-parse', 'origin/main')).toBe(head);
  });

  it('sends only this branch', async () => {
    await git('branch', 'other');
    const head = await commit('second.txt');
    await pushCurrentBranch(repository, 'origin/main');
    expect(await remoteRef('refs/heads/main')).toBe(head);
    expect(await remoteRef('refs/heads/other')).toBeUndefined();
  });

  it('publishes a branch without an upstream and records one', async () => {
    await git('switch', '-q', '-c', 'feature/thing');
    const head = await commit('second.txt');
    await expect(pushCurrentBranch(repository, 'origin/feature/thing')).resolves.toBe('origin/feature/thing');
    expect(await remoteRef('refs/heads/feature/thing')).toBe(head);
    expect(await git('rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/feature/thing');
  });

  it('publishes to the only remote, and refuses to guess between several', async () => {
    await git('remote', 'rename', 'origin', 'upstream');
    await git('switch', '-q', '-c', 'feature');
    await expect(pushCurrentBranch(repository, 'upstream/feature')).resolves.toBe('upstream/feature');
    await git('switch', '-q', '-c', 'feature-2');
    await git('remote', 'add', 'fork', `ssh://fixture${remote}`);
    await expect(pushCurrentBranch(repository, 'upstream/feature-2')).rejects.toThrow(/refresh/i);
    await expect(pushCurrentBranch(repository, 'fork/feature-2')).rejects.toThrow(/refresh/i);
  });

  it('publishes a feature cut from origin/main instead of pushing into main', async () => {
    await git('switch', '-q', '-c', 'feature', '--track', 'origin/main');
    const main = await remoteRef('refs/heads/main');
    const head = await commit('second.txt');
    await expect(pushCurrentBranch(repository, 'origin/main')).rejects.toThrow(/refresh/i);
    await expect(pushCurrentBranch(repository, 'origin/feature')).resolves.toBe('origin/feature');
    expect(await remoteRef('refs/heads/main')).toBe(main);
    expect(await remoteRef('refs/heads/feature')).toBe(head);
    expect(await git('rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/feature');
  });

  it('refuses a branch with several upstreams', async () => {
    await git('config', '--local', '--add', 'branch.main.merge', 'refs/heads/other');
    await commit('second.txt');
    await expect(pushCurrentBranch(repository, 'origin/main')).rejects.toThrow(/refresh/i);
  });

  describe.each([
    ['branch.main.pushRemote', ['config', '--local', 'branch.main.pushRemote', 'fork']],
    ['a local remote.pushDefault', ['config', '--local', 'remote.pushDefault', 'fork']],
    ['a global remote.pushDefault', ['config', '--global', 'remote.pushDefault', 'fork']],
  ])('%s', (_label, setting) => {
    it('wins over the upstream and leaves the upstream alone', async () => {
      const fork = path.join(scratch, 'fork.git');
      await execute('git', ['init', '-q', '--bare', '-b', 'main', fork]);
      await git('remote', 'add', 'fork', `ssh://fixture${fork}`);
      await git(...setting);
      const main = await remoteRef('refs/heads/main');
      const head = await commit('second.txt');
      await expect(pushCurrentBranch(repository, 'origin/main')).rejects.toThrow(/refresh/i);
      await expect(pushCurrentBranch(repository, 'fork/main')).resolves.toBe('fork/main');
      expect(await remoteRef('refs/heads/main')).toBe(main);
      expect((await execute('git', ['--git-dir', fork, 'rev-parse', 'refs/heads/main'])).stdout.trim()).toBe(head);
      expect(await git('rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/main');
    });
  });

  it('refuses a target other than the one shown, and a detached HEAD', async () => {
    const head = await commit('second.txt');
    await expect(pushCurrentBranch(repository, 'origin/other')).rejects.toThrow(/refresh/i);
    await git('checkout', '-q', '--detach');
    await expect(pushCurrentBranch(repository, 'origin/main')).rejects.toThrow(/refresh/i);
    expect(await remoteRef('refs/heads/main')).not.toBe(head);
  });

  it('never forces: a non-fast-forward leaves the remote unchanged and says to pull', async () => {
    const original = await git('rev-parse', 'HEAD');
    const remoteHead = await commit('remote-side.txt');
    await git('push', '-q', 'origin', 'main');
    await git('reset', '-q', '--hard', original);
    await commit('local-side.txt');
    await expect(pushCurrentBranch(repository, 'origin/main')).rejects.toThrow('Pull them first');
    expect(await remoteRef('refs/heads/main')).toBe(remoteHead);
  });

  it('sends no tag, whatever the global configuration follows', async () => {
    await git('config', '--global', 'push.followTags', 'true');
    await commit('second.txt');
    await git('tag', '-a', 'v1', '-m', 'v1');
    await pushCurrentBranch(repository, 'origin/main');
    expect(await remoteRef('refs/tags/v1')).toBeUndefined();
  });

  it('pushes past an initialized submodule without entering it, whatever the global configuration recurses', async () => {
    const module = path.join(scratch, 'module.git');
    await execute('git', ['init', '-q', '--bare', '-b', 'main', module]);
    const seed = path.join(scratch, 'seed');
    await execute('git', ['clone', '-q', module, seed]);
    await execute('git', ['-C', seed, 'commit', '-q', '--allow-empty', '-m', 'module']);
    await execute('git', ['-C', seed, 'push', '-q', 'origin', 'HEAD:main']);
    await git('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', module, 'sub');
    await execute('git', ['-C', path.join(repository, 'sub'), 'commit', '-q', '--allow-empty', '-m', 'unpushed']);
    await git('add', 'sub');
    await git('commit', '-qm', 'submodule');
    await git('config', '--global', 'push.recurseSubmodules', 'on-demand');
    await rm(path.join(scratch, 'ssh-started'));
    const before = (await execute('git', ['--git-dir', module, 'rev-parse', 'main'])).stdout.trim();
    const head = await git('rev-parse', 'HEAD');
    await expect(pushCurrentBranch(repository, 'origin/main')).resolves.toBe('origin/main');
    expect(await remoteRef('refs/heads/main')).toBe(head);
    expect((await execute('git', ['--git-dir', module, 'rev-parse', 'main'])).stdout.trim()).toBe(before);
  });
});

describe('a repository configuration a worker could have written', () => {
  it.each([
    ['core.sshCommand', 'core.sshCommand'],
    ['core.gitProxy', 'core.gitProxy'],
    ['credential.helper', 'credential.helper'],
    ['credential.https://example.invalid.helper', 'credential.https://example.invalid.helper'],
    ['remote.origin.receivepack', 'remote.origin.receivepack'],
    ['remote.origin.vcs', 'remote.origin.vcs'],
    ['url.https://example.invalid/.insteadOf', 'url.https://example.invalid/.insteadOf'],
    ['http.proxy', 'http.proxy'],
    ['include.path', 'include.path'],
    ['alias.push', 'alias.push'],
    ['extensions.worktreeConfig', 'extensions.worktreeConfig'],
  ])('refuses %s, names it, and runs nothing', async (key) => {
    const script = await runs('exit 1');
    await git('config', '--local', key, key === 'extensions.worktreeConfig' ? 'true' : key === 'include.path' ? path.join(scratch, 'absent') : script);
    const head = await commit('second.txt');
    await expect(pushCurrentBranch(repository, 'origin/main')).rejects.toThrow(key.toLowerCase());
    await expect(pushCurrentBranch(repository, 'origin/main')).rejects.toThrow(/terminal/i);
    expect(await exists(marker())).toBe(false);
    expect(await remoteRef('refs/heads/main')).not.toBe(head);
  });

  it('accepts the keys real repositories carry', async () => {
    await git('config', '--local', 'branch.main.vscode-merge-base', 'origin/main');
    await git('config', '--local', 'branch.main.github-pr-base-branch', 'owner#repo#main');
    await git('config', '--local', 'remote.origin.gh-resolved', 'base');
    await git('config', '--local', 'core.hooksPath', '.husky-none');
    await git('config', '--local', 'user.name', 'Someone');
    await git('config', '--local', 'pull.rebase', 'true');
    await git('config', '--local', 'fetch.prune', 'true');
    const head = await commit('second.txt');
    await expect(pushCurrentBranch(repository, 'origin/main')).resolves.toBe('origin/main');
    expect(await remoteRef('refs/heads/main')).toBe(head);
  });

  it('refuses oversized host configuration output without parsing a partial destination', async () => {
    const head = await commit('second.txt');
    const file = path.join(repository, '.git', 'config');
    await writeFile(file, `${await readFile(file, 'utf8')}\n[core]\n${' filemode = true\n'.repeat(10_000)}`);
    await expect(pushCurrentBranch(repository, 'origin/main')).rejects.toThrow(/inspection limit/);
    expect(await remoteRef('refs/heads/main')).not.toBe(head);
    const writer = runRegistry.acquireCheckoutWrite(repository);
    expect(writer).toBeDefined();
    writer!();
  });

  it.each([
    ['a local path', () => path.join(repository, 'planted.git')],
    ['a file URL', () => `file://${path.join(repository, 'planted.git')}`],
    ['plain HTTP', () => 'http://127.0.0.1:9/repository.git'],
    ['the ext transport', () => `ext::sh -c touch% ${marker()}`],
  ])('refuses %s as a remote without running its hooks', async (_label, url) => {
    const planted = path.join(repository, 'planted.git');
    await execute('git', ['init', '-q', '--bare', planted]);
    await writeFile(path.join(planted, 'hooks', 'pre-receive'), `#!/bin/sh\ntouch ${marker()}\n`);
    await chmod(path.join(planted, 'hooks', 'pre-receive'), 0o755);
    await git('config', '--local', 'remote.origin.url', url());
    await commit('second.txt');
    await expect(pushCurrentBranch(repository, 'origin/main')).rejects.toThrow(/HTTPS and SSH/);
    expect(await exists(marker())).toBe(false);
  });

  it('does not follow an upstream that is not a remote', async () => {
    await git('branch', 'local-base');
    await git('config', '--local', 'branch.main.remote', '.');
    await git('config', '--local', 'branch.main.merge', 'refs/heads/local-base');
    const before = await git('rev-parse', 'local-base');
    const head = await commit('second.txt');
    await expect(pushCurrentBranch(repository, './/local-base')).rejects.toThrow(/refresh/i);
    await expect(pushCurrentBranch(repository, 'origin/main')).resolves.toBe('origin/main');
    expect(await git('rev-parse', 'local-base')).toBe(before);
    expect(await remoteRef('refs/heads/main')).toBe(head);
  });

  it('does not adopt a checkout folder as a bare repository', async () => {
    const folder = path.join(scratch, 'not-a-repository');
    await execute('git', ['clone', '-q', '--bare', remote, folder]);
    await execute('git', ['--git-dir', folder, 'config', 'remote.origin.url', `ssh://fixture${remote}`]);
    await execute('git', ['--git-dir', folder, 'symbolic-ref', 'HEAD', 'refs/heads/moved']);
    await execute('git', ['--git-dir', folder, 'update-ref', 'refs/heads/moved', 'refs/heads/main']);
    await expect(pushCurrentBranch(folder, 'origin/moved')).rejects.toThrow(/Git configuration/);
    expect(await remoteRef('refs/heads/moved')).toBeUndefined();
  });

  it.each([
    ['alternates', async (other: string) => writeFile(path.join(repository, '.git', 'objects', 'info', 'alternates'), `${path.join(other, '.git', 'objects')}\n`)],
    ['HTTP alternates', async (other: string) => writeFile(path.join(repository, '.git', 'objects', 'info', 'http-alternates'), `${path.join(other, '.git', 'objects')}\n`)],
    ['commondir', async (other: string) => writeFile(path.join(repository, '.git', 'commondir'), `${path.join(other, '.git')}\n`)],
    ['a symbolic link to objects', async (other: string) => {
      await rm(path.join(repository, '.git', 'objects'), { recursive: true });
      await symlink(path.join(other, '.git', 'objects'), path.join(repository, '.git', 'objects'));
    }],
  ])('does not send another repository through %s', async (_label, plant) => {
    const other = path.join(scratch, 'other');
    await execute('git', ['init', '-q', '-b', 'main', other]);
    await writeFile(path.join(other, 'secret.txt'), 'secret\n');
    await execute('git', ['-C', other, 'add', '.']);
    await execute('git', ['-C', other, 'commit', '-qm', 'secret']);
    const stolen = (await execute('git', ['-C', other, 'rev-parse', 'HEAD'])).stdout.trim();
    const attacker = path.join(scratch, 'attacker.git');
    await execute('git', ['init', '-q', '--bare', '-b', 'main', attacker]);
    await git('config', '--local', 'remote.origin.url', `ssh://fixture${attacker}`);
    await plant(other);
    await writeFile(path.join(repository, '.git', 'refs', 'heads', 'main'), `${stolen}\n`);
    await expect(pushCurrentBranch(repository, 'origin/main')).rejects.toThrow(/links its Git metadata/);
    await expect(execute('git', ['--git-dir', attacker, 'cat-file', '-e', stolen])).rejects.toThrow();
  });

  it('keeps URL user info out of a refusal that names a key', async () => {
    await git('config', '--local', 'url.https://user:p@ss-secret@example.invalid/.insteadOf', 'https://example.invalid/');
    await expect(pushCurrentBranch(repository, 'origin/main')).rejects.toThrow(/insteadof/);
    await expect(pushCurrentBranch(repository, 'origin/main')).rejects.not.toThrow(/secret/);
  });
});

describe('hooks', () => {
  const planted = (directory: string, name: string, mode = 0o755) => {
    const file = path.join(directory, name);
    return mkdir(directory, { recursive: true }).then(() => writeFile(file, `#!/bin/sh\ntouch ${marker()}\n`))
      .then(() => chmod(file, mode));
  };

  it('refuses an executable pre-push hook rather than bypass it', async () => {
    await planted(path.join(repository, '.git', 'hooks'), 'pre-push');
    await commit('second.txt');
    await expect(pushCurrentBranch(repository, 'origin/main')).rejects.toThrow(/pre-push hook/);
    expect(await exists(marker())).toBe(false);
  });

  it('finds the hook through a local core.hooksPath', async () => {
    await planted(path.join(repository, '.husky'), 'pre-push');
    await git('config', '--local', 'core.hooksPath', '.husky');
    await commit('second.txt');
    await expect(pushCurrentBranch(repository, 'origin/main')).rejects.toThrow(/pre-push hook/);
  });

  it('finds the hook through a global core.hooksPath', async () => {
    await planted(path.join(home, 'hooks'), 'pre-push');
    await git('config', '--global', 'core.hooksPath', path.join(home, 'hooks'));
    await commit('second.txt');
    await expect(pushCurrentBranch(repository, 'origin/main')).rejects.toThrow(/pre-push hook/);
  });

  it('pushes past a pre-push file Git would not run, and runs no other hook', async () => {
    const hooks = path.join(repository, '.git', 'hooks');
    await planted(hooks, 'pre-push', 0o644);
    await planted(hooks, 'reference-transaction');
    const head = await commit('second.txt');
    await rm(marker(), { force: true });
    await expect(pushCurrentBranch(repository, 'origin/main')).resolves.toBe('origin/main');
    expect(await remoteRef('refs/heads/main')).toBe(head);
    expect(await exists(marker())).toBe(false);
  });
});

describe('the user\'s own setup', () => {
  it('never runs a git or helper from where a turn can write', async () => {
    const installation = path.join(scratch, 'installation');
    const repositories = path.join(scratch, 'repositories');
    const worktrees = path.join(scratch, 'worktrees');
    vi.stubEnv('CODEAI_INSTALLATION_ROOT', installation);
    vi.stubEnv('CODEAI_REPOSITORIES_ROOT', repositories);
    vi.stubEnv('CODEAI_WORKTREES_ROOT', worktrees);
    const planted = [path.join(installation, 'node_modules', '.bin'), path.join(repositories, 'bin'), path.join(worktrees, 'bin'), path.join(repository, 'node_modules', '.bin'), path.join(repository, 'bin'), path.join(os.tmpdir(), `codeai-push-${crypto.randomUUID()}`), path.join(home, 'project', 'node_modules', '.bin')];
    directories.push(planted[5]);
    for (const directory of planted) {
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, 'git'), `#!/bin/sh\ntouch ${marker()}\nexec /usr/bin/git "$@"\n`);
      await chmod(path.join(directory, 'git'), 0o755);
    }
    vi.stubEnv('PATH', `relative/bin::${planted.join(':')}:${process.env.PATH}`);
    const head = await commit('second.txt');
    await rm(marker(), { force: true });
    await pushCurrentBranch(repository, 'origin/main');
    expect(await exists(marker())).toBe(false);
    expect(await remoteRef('refs/heads/main')).toBe(head);
    const environment = await readFile(path.join(scratch, 'ssh-env'), 'utf8');
    const reachable = environment.split('\n').find((line) => line.startsWith('PATH='))!;
    for (const directory of planted) expect(reachable).not.toContain(directory);
  });

  it('keeps a home bin directory when the repositories root holds the home directory', async () => {
    vi.stubEnv('CODEAI_REPOSITORIES_ROOT', scratch);
    vi.stubEnv('PATH', `${path.join(home, '.local', 'bin')}:${process.env.PATH}`);
    await commit('second.txt');
    await pushCurrentBranch(repository, 'origin/main');
    expect(await readFile(path.join(scratch, 'ssh-env'), 'utf8')).toContain(path.join(home, '.local', 'bin'));
  });

  it('does not trust a user bin symlink into the checkout', async () => {
    const bin = path.join(repository, 'bin');
    await mkdir(bin);
    await writeFile(path.join(bin, 'git'), `#!/bin/sh\ntouch ${marker()}\nexec /usr/bin/git "$@"\n`);
    await chmod(path.join(bin, 'git'), 0o755);
    await mkdir(path.join(home, '.local'));
    await symlink(bin, path.join(home, '.local', 'bin'));
    await commit('second.txt');
    vi.stubEnv('PATH', `${path.join(home, '.local', 'bin')}:${process.env.PATH}`);
    await pushCurrentBranch(repository, 'origin/main');
    expect(await exists(marker())).toBe(false);
  });

  it('reaches Git, and the rest of the server environment does not', async () => {
    vi.stubEnv('SSH_AUTH_SOCK', '/run/fixture-agent.sock');
    vi.stubEnv('PATH', `/fixture/user/bin:${process.env.PATH}`);
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.example.invalid');
    vi.stubEnv('ANTHROPIC_API_KEY', 'server-secret');
    vi.stubEnv('CODEAI_PAIRING_FIXTURE', 'server-secret');
    await commit('second.txt');
    await pushCurrentBranch(repository, 'origin/main');
    const environment = await readFile(path.join(scratch, 'ssh-env'), 'utf8');
    expect(environment).toContain('SSH_AUTH_SOCK=/run/fixture-agent.sock');
    expect(environment).toContain('/fixture/user/bin');
    expect(environment).not.toContain('server-secret');
    expect(environment).toContain('HTTPS_PROXY=http://proxy.example.invalid');
  });

  it('runs in a session of its own, with no controlling terminal for ssh to prompt on', async () => {
    const ssh = path.join(home, 'session-ssh');
    const recorded = path.join(scratch, 'ssh-session');
    await writeFile(ssh, `#!/bin/sh\nps -o sid=,tty= -p $$ > ${recorded}\nfor argument; do last=$argument; done\nexec sh -c "$last"\n`);
    await chmod(ssh, 0o755);
    await git('config', '--global', 'core.sshCommand', ssh);
    await commit('second.txt');
    await pushCurrentBranch(repository, 'origin/main');
    const [session, terminal] = (await readFile(recorded, 'utf8')).trim().split(/\s+/);
    const own = (await execute('ps', ['-o', 'sid=', '-p', String(process.pid)])).stdout.trim();
    expect(session).not.toBe(own);
    expect(terminal).toBe('?');
  });

  it('does not wait for an ssh master that outlives Git and keeps stderr open', async () => {
    await writeFile(path.join(scratch, 'ssh-master'), '');
    await commit('second.txt');
    const started = Date.now();
    await expect(pushCurrentBranch(repository, 'origin/main')).resolves.toBe('origin/main');
    expect(Date.now() - started).toBeLessThan(4_000);
  });

  it.each([
    'https://user:ghp_secret@example.invalid/x.git/', 'https://ghp_secret@example.invalid/x.git/',
    'https://user:p@ss_ghp_secret@example.invalid/x.git/',
  ])('removes URL user info from what it reports: %s', (url) => {
    const message = pushFailureMessage(`fatal: unable to access '${url}': boom`);
    expect(message).toContain('example.invalid');
    expect(message).not.toContain('ghp_secret');
  });

  it('keeps the remote\'s reason, and the end of a long one', () => {
    const message = pushFailureMessage(`${'remote: banner\n'.repeat(200)}remote: error: GH006: Protected branch update failed\n`);
    expect(message).toContain('GH006');
    expect(message.length).toBeLessThanOrEqual(500);
  });
});

describe('exclusive checkout access', () => {
  function liveRun(checkoutPath: string, access: 'read' | 'write' = 'write') {
    const runId = crypto.randomUUID();
    expect(runRegistry.reserve({ runId, sessionId: crypto.randomUUID(), participantId: crypto.randomUUID(),
      providerKey: runId, checkoutId: 'fixture', checkoutPath, execution: 'local', access, cancel() {} }).accepted).toBe(true);
    runRegistry.activate(runId, { execute: () => new Promise(() => {}), cancelQueued: async () => {} });
    return () => { runRegistry.finish(runId); };
  }

  it('refuses while a turn runs on the checkout, then pushes after it', async () => {
    const head = await commit('second.txt');
    const finish = liveRun(repository);
    try {
      await expect(pushCurrentBranch(repository, 'origin/main')).rejects.toThrow(/turn/i);
      expect(await remoteRef('refs/heads/main')).not.toBe(head);
    } finally { finish(); }
    await expect(pushCurrentBranch(repository, 'origin/main')).resolves.toBe('origin/main');
  });

  it('excludes writers from before the gate until Git exits', async () => {
    await commit('second.txt');
    const hold = path.join(scratch, 'ssh-hold');
    await writeFile(hold, '');
    await rm(path.join(scratch, 'ssh-started'));
    const pending = pushCurrentBranch(repository, 'origin/main');
    await vi.waitFor(async () => expect(await exists(path.join(scratch, 'ssh-started'))).toBe(true), { timeout: 5_000 });
    expect(runRegistry.acquireCheckoutWrite(repository)).toBeUndefined();
    await rm(hold);
    await pending;
    const writer = runRegistry.acquireCheckoutWrite(repository);
    expect(writer).toBeDefined();
    writer!();
  });

  it('holds a queued writing turn until Git exits, then starts it', async () => {
    await commit('second.txt');
    const hold = path.join(scratch, 'ssh-hold');
    await writeFile(hold, '');
    await rm(path.join(scratch, 'ssh-started'));
    const pending = pushCurrentBranch(repository, 'origin/main');
    await vi.waitFor(async () => expect(await exists(path.join(scratch, 'ssh-started'))).toBe(true), { timeout: 5_000 });
    let started = false;
    const runId = crypto.randomUUID();
    expect(runRegistry.reserve({ runId, sessionId: crypto.randomUUID(), participantId: crypto.randomUUID(),
      providerKey: runId, checkoutId: 'fixture', checkoutPath: repository, execution: 'local', access: 'write', cancel() {} }).accepted).toBe(true);
    runRegistry.activate(runId, { execute: async () => { started = true; }, cancelQueued: async () => {} });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(started).toBe(false);
    await rm(hold);
    await pending;
    await vi.waitFor(() => expect(started).toBe(true));
    runRegistry.finish(runId);
  });

  it('gives up at its limit, stops the transport, and releases the checkout', async () => {
    await commit('second.txt');
    const hold = path.join(scratch, 'ssh-hold');
    await writeFile(hold, '');
    await expect(pushCurrentBranch(repository, 'origin/main', 300)).rejects.toThrow(/timed out/i);
    await rm(path.join(scratch, 'ssh-released'));
    await rm(hold);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await exists(path.join(scratch, 'ssh-released'))).toBe(false);
    expect(await remoteRef('refs/heads/main')).not.toBe(await git('rev-parse', 'HEAD'));
    const writer = runRegistry.acquireCheckoutWrite(repository);
    expect(writer).toBeDefined();
    writer!();
  });

  it('releases the checkout after a refusal', async () => {
    await git('config', '--local', 'core.sshCommand', 'false');
    await expect(pushCurrentBranch(repository, 'origin/main')).rejects.toThrow(/core\.sshcommand/);
    const writer = runRegistry.acquireCheckoutWrite(repository);
    expect(writer).toBeDefined();
    writer!();
  });

  describe('of a managed worktree', () => {
    async function managed() {
      const worktreesRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codeai-push-worktrees-')));
      directories.push(worktreesRoot);
      vi.stubEnv('CODEAI_REPOSITORIES_ROOT', repository);
      vi.stubEnv('CODEAI_WORKTREES_ROOT', worktreesRoot);
      const checkoutId = (await new CheckoutRegistry(repository).list())[0].id;
      await createManagedWorktree({ provider: 'claude', checkoutId, checkoutMode: 'worktree', creationRequestId: crypto.randomUUID() }, getConfig());
      const [record] = await readWorktreeRecords(dataDir);
      return record;
    }

    it('pushes its own branch', async () => {
      const record = await managed();
      try {
        const branch = (await execute('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: record.destination })).stdout.trim();
        await expect(pushCurrentBranch(record.destination, `origin/${branch}`)).resolves.toBe(`origin/${branch}`);
        expect(await remoteRef(`refs/heads/${branch}`)).toBeDefined();
      } finally { await getSessionStore(dataDir).close(); }
    });

    it('keeps a writer off its source until Git exits, without blocking status reads', async () => {
      const record = await managed();
      try {
        const branch = (await execute('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: record.destination })).stdout.trim();
        await rm(path.join(scratch, 'ssh-started'));
        const hold = path.join(scratch, 'ssh-hold');
        await writeFile(hold, '');
        const pending = pushCurrentBranch(record.destination, `origin/${branch}`);
        await vi.waitFor(async () => expect(await exists(path.join(scratch, 'ssh-started'))).toBe(true), { timeout: 5_000 });
        expect(runRegistry.acquireCheckoutWrite(repository)).toBeUndefined();
        expect(runRegistry.acquireCheckoutWrite(record.destination)).toBeUndefined();
        const read = runRegistry.acquireCheckoutRead(record.destination);
        expect(read).toBeDefined();
        read!();
        await rm(hold);
        await pending;
        const writer = runRegistry.acquireCheckoutWrite(repository);
        expect(writer).toBeDefined();
        writer!();
      } finally { await getSessionStore(dataDir).close(); }
    });

    it('refuses while a turn writes to its source, whose configuration it reads', async () => {
      const record = await managed();
      const finish = liveRun(repository);
      try {
        const branch = (await execute('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: record.destination })).stdout.trim();
        await expect(pushCurrentBranch(record.destination, `origin/${branch}`)).rejects.toThrow(/turn/i);
        expect(await remoteRef(`refs/heads/${branch}`)).toBeUndefined();
      } finally { finish(); await getSessionStore(dataDir).close(); }
    });

    it('refuses source and sibling pushes while a Local managed worktree can write the shared configuration', async () => {
      const record = await managed();
      await createManagedWorktree({ provider: 'claude', checkoutId: record.session.worktree!.originCheckoutId,
        checkoutMode: 'worktree', creationRequestId: crypto.randomUUID() }, getConfig());
      const sibling = (await readWorktreeRecords(dataDir)).find(item => item.destination !== record.destination)!;
      const finish = liveRun(record.destination);
      try {
        await expect(pushCurrentBranch(repository, 'origin/main')).rejects.toThrow(/turn/i);
        await expect(pushCurrentBranch(sibling.destination, 'origin/unused')).rejects.toThrow(/turn/i);
      } finally { finish(); await getSessionStore(dataDir).close(); }
    });

    it('reads the gate through the helper under its own leases once provisioned', async () => {
      const record = await managed();
      await mkdir(path.join(dataDir, 'docker'));
      await writeFile(path.join(dataDir, 'docker', 'profile.json'), JSON.stringify({
        profile: DOCKER_PROFILE, image: `sha256:${'a'.repeat(64)}`, engineId: 'engine-original',
      }));
      mocks.command.mockImplementation(async (input: string[]) => {
        if (input[2] === 'info') return 'engine-original';
        if (input[3] === 'ls') return '';
        throw new Error('Capture helper without starting Docker');
      });
      try {
        await expect(pushCurrentBranch(record.destination, 'origin/unused')).rejects.toThrow();
        const launch = mocks.command.mock.calls.find(([input]) => input[2] === 'create')?.[0];
        expect(launch).toBeDefined();
        expect(launch.join(' ')).toContain('--network none');
        expect(launch.filter((argument: string) => argument.startsWith('type=bind'))).toEqual([
          `type=bind,src=${record.destination},dst=/workspace,readonly`,
          `type=bind,src=${record.originGit.path},dst=${record.originGit.path},readonly`,
        ]);
      } finally { await getSessionStore(dataDir).close(); }
    });
  });

  it('runs no host Git for the gate once provisioned, and refuses when the helper cannot read', async () => {
    await mkdir(path.join(dataDir, 'docker'));
    await writeFile(path.join(dataDir, 'docker', 'profile.json'), JSON.stringify({
      profile: DOCKER_PROFILE, image: `sha256:${'a'.repeat(64)}`, engineId: 'engine-original',
    }));
    mocks.command.mockImplementation(async (input: string[]) => {
      if (input[2] === 'info') return 'engine-original';
      if (input[3] === 'ls') return '';
      throw new Error('Capture helper without starting Docker');
    });
    const head = await commit('second.txt');
    await rm(path.join(scratch, 'ssh-env'));
    await expect(pushCurrentBranch(repository, 'origin/main')).rejects.toThrow();
    expect(mocks.command.mock.calls.some(([input]) => input[2] === 'create')).toBe(true);
    expect(await exists(path.join(scratch, 'ssh-env'))).toBe(false);
    expect(await remoteRef('refs/heads/main')).not.toBe(head);
  });
});


describe('what Changes offers', () => {
  const offer = async () => withPushOffer(repository, await readWorkingTree(repository));

  it('nothing when up to date, a push when ahead', async () => {
    await expect(offer()).resolves.not.toHaveProperty('pushTarget');
    await commit('second.txt');
    await expect(offer()).resolves.toMatchObject({ ahead: 1, pushTarget: 'origin/main', publishes: false });
  });

  it('a publish without an upstream, and exactly what the push then accepts', async () => {
    await git('switch', '-q', '-c', 'feature');
    const tree = await offer();
    expect(tree).toMatchObject({ pushTarget: 'origin/feature', publishes: true });
    await expect(pushCurrentBranch(repository, tree.pushTarget!)).resolves.toBe('origin/feature');
  });

  it('names the branch\'s own push, not the fetch-mapped upstream', async () => {
    await git('switch', '-q', '-c', 'feature', '--track', 'origin/main');
    await commit('second.txt');
    await expect(offer()).resolves.toMatchObject({ upstream: 'origin/main', ahead: 1, pushTarget: 'origin/feature', publishes: true });
  });

  it.each(['local', 'global'])('offers the %s push default, including when the fetch upstream is up to date', async scope => {
    const fork = path.join(scratch, 'fork.git');
    await execute('git', ['init', '-q', '--bare', '-b', 'main', fork]);
    await git('remote', 'add', 'fork', `ssh://fixture${fork}`);
    await git('config', `--${scope}`, 'remote.pushDefault', 'fork');
    expect(await offer()).toMatchObject({ pushTarget: 'fork/main', publishes: false });
    await pushCurrentBranch(repository, 'fork/main');
    expect(await offer()).not.toHaveProperty('pushTarget');
    await commit('second.txt');
    expect(await offer()).toMatchObject({ pushTarget: 'fork/main' });
    await pushCurrentBranch(repository, 'fork/main');
    expect(await offer()).not.toHaveProperty('pushTarget');
  });

  it('cannot be made to name one branch and send another', async () => {
    await git('config', '--local', 'branch.main.merge', 'refs/heads/protected');
    await git('config', '--local', '--replace-all', 'remote.origin.fetch', '+refs/heads/protected:refs/remotes/origin/main');
    const protectedHead = await remoteRef('refs/heads/protected');
    await commit('second.txt');
    const tree = await offer();
    expect(tree.pushTarget).toBe('origin/main');
    await pushCurrentBranch(repository, tree.pushTarget!);
    expect(await remoteRef('refs/heads/protected')).toBe(protectedHead);
  });

  it('nothing with no remote, several without origin, a detached HEAD, or no commits', async () => {
    await git('switch', '-q', '-c', 'feature');
    await git('remote', 'rename', 'origin', 'first');
    await git('remote', 'add', 'second', `ssh://fixture${remote}`);
    await expect(offer()).resolves.not.toHaveProperty('pushTarget');
    await git('remote', 'add', 'origin', `ssh://fixture${remote}`);
    await expect(offer()).resolves.toMatchObject({ pushTarget: 'origin/feature' });
    await git('checkout', '-q', '--detach');
    await expect(offer()).resolves.not.toHaveProperty('pushTarget');
    await git('switch', '-q', '--orphan', 'unborn');
    await expect(offer()).resolves.not.toHaveProperty('pushTarget');
    await git('remote', 'remove', 'origin');
    await git('remote', 'remove', 'first');
    await git('remote', 'remove', 'second');
    await git('switch', '-q', '-c', 'no-remote', 'main');
    await expect(offer()).resolves.not.toHaveProperty('pushTarget');
  });

  it('keeps the status when the configuration cannot be read', async () => {
    await git('switch', '-q', '-c', 'feature');
    const tree = await readWorkingTree(repository);
    await rm(path.join(repository, '.git', 'config'));
    await expect(withPushOffer(repository, tree)).resolves.toEqual(tree);
  });

  it('adds nothing for a non-repository', async () => {
    const tree = { isRepository: false, files: [] };
    await expect(withPushOffer(repository, tree)).resolves.toBe(tree);
  });
});
