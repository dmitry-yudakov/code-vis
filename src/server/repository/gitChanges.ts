import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { GitConfiguration } from './gitLocalConfiguration';
import { GIT_READ_OPTIONS, gitReadEnvironment, runGitRead } from './gitRead';
import { parseGitStatus } from './gitRepository';
import { readGitIndexState } from './gitIndex';
import { withGitMutation } from './gitMutation';

function hostGit(cwd: string, args: string[], input = '', identity?: { name: string; email: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('git', [...GIT_READ_OPTIONS, '-c', 'credential.helper=', '-c', 'protocol.allow=never', ...args], {
      cwd, env: { ...gitReadEnvironment(), GIT_NO_LAZY_FETCH: '1', GIT_CEILING_DIRECTORIES: path.dirname(cwd),
        ...(identity ? { GIT_AUTHOR_NAME: identity.name, GIT_AUTHOR_EMAIL: identity.email, GIT_COMMITTER_NAME: identity.name, GIT_COMMITTER_EMAIL: identity.email } : {}) },
      encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024, windowsHide: true,
    }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      reject(new Error(/index.lock|another git process/i.test(stderr)
        ? 'Another Git operation holds the index. Retry after it finishes.'
        : /nothing to commit|no changes added/i.test(stderr) ? 'No staged changes to commit.'
          : 'Git could not finish this operation. Refresh Changes and inspect this checkout in a terminal if it still fails.'));
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(input);
  });
}

async function checkState(cwd: string, expected: string, lease: symbol) {
  if (await readGitIndexState(cwd, lease) !== expected) throw new Error('The branch or staged changes changed. Refresh Changes and retry.');
}

export async function changeGitIndex(cwd: string, action: 'stage' | 'unstage', paths: string[], expectedState: string): Promise<void> {
  if (!paths.length || paths.length > 1000) throw new Error('Choose between 1 and 1,000 changed files.');
  return withGitMutation(cwd, async lease => {
    await checkState(cwd, expectedState, lease);
    const tree = parseGitStatus(await runGitRead(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'], { checkoutWriteLease: lease }));
    const selected = [...new Set(paths)].map(filePath => {
      const file = tree.files.find(item => item.path === filePath);
      if (!file || (action === 'unstage' && !file.staged)) throw new Error('A selected file is no longer in this change list. Refresh Changes and retry.');
      return file;
    });
    const targets = [...new Set(selected.flatMap(file => [file.path, ...(action === 'unstage' && file.previousPath ? [file.previousPath] : [])]))];
    const head = (await runGitRead(cwd, ['rev-parse', '--verify', '-q', 'HEAD'], { allowedExitCodes: [1], checkoutWriteLease: lease })).trim();
    await hostGit(cwd, action === 'stage' ? ['add', '-A', '--', ...targets]
      : head ? ['restore', '--staged', '--source=HEAD', '--', ...targets] : ['rm', '--quiet', '--cached', '-f', '--ignore-unmatch', '--', ...targets]);
  });
}

/** Read only identity from the owner's global config, without discovering checkout-controlled config. */
async function commitIdentity(cwd: string, local: GitConfiguration): Promise<{ name: string; email: string }> {
  const value = async (key: string): Promise<string> => {
    const own = local.get(key)?.at(-1);
    if (own) return own;
    return new Promise(resolve => {
      const env = { ...gitReadEnvironment(), HOME: os.homedir(), GIT_CONFIG_GLOBAL: undefined, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
      execFile('git', ['--git-dir=/dev/null', 'config', '--global', '--includes', '--get', key], {
        cwd, env, encoding: 'utf8', timeout: 8_000, maxBuffer: 4096,
      }, (error, stdout) => resolve(error ? '' : stdout.trim()));
    });
  };
  const name = await value('user.name'); const email = await value('user.email');
  if (!name || !email) throw new Error('Set Git user.name and user.email on this machine, then retry the commit.');
  return { name, email };
}

export async function commitGitIndex(cwd: string, message: string, expectedState: string): Promise<string> {
  if (!message.trim() || message.length > 16_000 || message.includes('\0')) throw new Error('Enter a commit message of at most 16,000 characters.');
  return withGitMutation(cwd, async (lease, local) => {
    await checkState(cwd, expectedState, lease);
    const read = (args: string[], allowedExitCodes?: number[]) => runGitRead(cwd, args, { checkoutWriteLease: lease, allowedExitCodes });
    const head = (await read(['symbolic-ref', '-q', 'HEAD'], [1])).trim();
    if (!head.startsWith('refs/heads/')) throw new Error('Switch to a local branch before committing.');
    const unmerged = await read(['ls-files', '--unmerged', '-z']);
    if (unmerged) throw new Error('Resolve and stage conflicted files before committing.');
    // Do not implicitly finish an in-progress merge/rebase/cherry-pick with a normal commit.
    const operation = await read(['rev-parse', '--git-path', 'MERGE_HEAD']);
    const metadata = path.dirname(path.resolve(cwd, operation.trim()));
    for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer']) {
      if (await lstat(path.join(/* turbopackIgnore: true */ metadata, marker)).catch(() => undefined)) throw new Error('Finish or abort the current merge, rebase or cherry-pick in a terminal before committing.');
    }
    if (!(await read(['diff', '--cached', '--name-only', '-z']))) throw new Error('No staged changes to commit.');
    const identity = await commitIdentity(cwd, local);
    await hostGit(cwd, ['commit', '--quiet', '--no-gpg-sign', '--cleanup=whitespace', '--file=-'], message, identity);
    return (await read(['rev-parse', '--verify', 'HEAD'])).trim();
  });
}
