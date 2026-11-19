import { execFile } from 'node:child_process';
import path from 'node:path';
import type { GitBranches } from '@/shared/types';
import { GIT_READ_OPTIONS, gitReadEnvironment, runGitRead } from './gitRead';
import { withGitMutation } from './gitMutation';

const MAX_BRANCHES = 1000;

export async function listGitBranches(cwd: string, checkoutWriteLease?: symbol): Promise<GitBranches> {
  const read = (args: string[], allowedExitCodes?: number[]) => runGitRead(cwd, args, { checkoutWriteLease, allowedExitCodes, maxBuffer: 1024 * 1024 });
  const ref = (await read(['symbolic-ref', '-q', 'HEAD'], [1])).trim();
  const commit = (await read(['rev-parse', '--verify', '-q', 'HEAD'], [1])).trim();
  const output = await read(['for-each-ref', `--count=${MAX_BRANCHES + 1}`, '--sort=refname', '--format=%(refname)%00%(if)%(worktreepath)%(then)1%(else)0%(end)', 'refs/heads/']);
  const branches = output.split('\n').filter(Boolean).map(line => {
    const [ref, worktree] = line.split('\0');
    return { name: ref.slice('refs/heads/'.length), occupied: worktree === '1' };
  });
  if (branches.length > MAX_BRANCHES) throw new Error('This repository has more than 1,000 local branches. Switch from a terminal.');
  return { head: `${ref}:${commit}`, current: ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : undefined, branches };
}

/** Host mutation only after credential-free inspection, with no checkout helpers or network. */
function switchOnHost(cwd: string, branch: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('git', [
      ...GIT_READ_OPTIONS, '-c', 'core.excludesFile=/dev/null', '-c', 'credential.helper=',
      '-c', 'protocol.allow=never', '-c', 'checkout.workers=1',
      'switch', '--no-guess', '--no-overwrite-ignore', '--no-recurse-submodules', '--', branch,
    ], {
      cwd, env: { ...gitReadEnvironment(), GIT_NO_LAZY_FETCH: '1', GIT_CEILING_DIRECTORIES: path.dirname(cwd) },
      encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024, windowsHide: true,
    }, (error, _stdout, stderr) => {
      if (!error) return resolve();
      // Expose recovery guidance, never raw process arguments, filesystem paths or config values.
      const message = /overwritten|local changes/i.test(stderr)
        ? 'Local changes or untracked files would be overwritten. Commit, stash or move them, then retry.'
        : /already used by worktree|already checked out/i.test(stderr)
          ? 'This branch is checked out in another worktree. Choose another branch.'
          : /middle of|unmerged|resolve your current index/i.test(stderr)
            ? 'Finish or abort the current merge, rebase or cherry-pick before switching branches.'
            : 'Could not switch branches. Refresh and retry; inspect this checkout in a terminal if it still fails.';
      reject(new Error(message));
    });
  });
}

export async function switchGitBranch(cwd: string, branch: string, expectedHead: string): Promise<string> {
  // No revision expressions, previous-branch shorthand or command-line options.
  if (!branch || branch.length > 512 || branch.startsWith('-') || /[\s\x00-\x1f\x7f~^:?*\[\\]|@\{|\.\./.test(branch)) {
    throw new Error('Choose an existing local branch.');
  }
  return withGitMutation(cwd, 'switch', async lease => {
    const snapshot = await listGitBranches(cwd, lease);
    const target = snapshot.branches.find(item => item.name === branch);
    if (!target) throw new Error('This local branch is no longer available. Refresh the branch list.');
    if (snapshot.current === branch) return branch; // A lost response can be retried safely.
    if (snapshot.head !== expectedHead) throw new Error('The current branch or commit changed. Refresh the branch list and retry.');
    if (target.occupied) throw new Error('This branch is checked out in another worktree. Choose another branch.');
    await switchOnHost(cwd, branch);
    return branch;
  });
}
