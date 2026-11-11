import { execFile } from 'node:child_process';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from '@/server/config';
import { runRegistry } from '@/server/runs/runRegistry';
import type { GitBranches } from '@/shared/types';
import { configuration, unsupportedLocalGitKey } from './gitLocalConfiguration';
import { GIT_READ_OPTIONS, gitReadEnvironment, runGitRead, withGitReadLease } from './gitRead';
import { containedMetadata, readWorktreeRecords, resolveManagedWorktree, sourceMetadata, validateManagedPath } from './managedWorktrees';
import { getCheckoutRegistry } from './checkoutRegistry';

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
  const managed = await validateManagedPath(cwd);
  const source = managed?.originPath || cwd;
  const writer = runRegistry.acquireCheckoutWrite(cwd);
  if (!writer) throw new Error('An agent turn or another Git operation is using this checkout. Retry after it finishes.');
  const releases: (() => void)[] = [writer];
  const held = new Set([cwd]);
  return withGitReadLease(() => { for (const release of releases.reverse()) release(); }, async () => {
    const hold = (location: string) => {
      // Registry markers can describe a package inside the checkout, or an enclosing project.
      // Existing admission already excludes their overlapping writers; do not conflict with ourselves.
      if ([...held].some(root => location === root || location.startsWith(`${root}${path.sep}`) || root.startsWith(`${location}${path.sep}`))) return;
      const exclusive = runRegistry.acquireCheckoutWrite(location);
      if (!exclusive) throw new Error('An agent turn or another Git operation is using this checkout. Retry after it finishes.');
      try { releases.push(runRegistry.acquireCheckoutRead(location, exclusive.token)!); held.add(location); }
      finally { exclusive(); }
    };
    hold(source);
    const family = (await readWorktreeRecords(getConfig().dataDir)).filter(record => record.originPath === source);
    for (const record of family) hold(record.destination);
    // A discovered Local checkout can redirect .git without a reverse worktree entry. As with
    // worktree creation, only a proved independent repository may keep a concurrent writer.
    const config = getConfig();
    for (const checkout of await getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth).refresh()) {
      if (checkout.worktree || held.has(checkout.realPath)) continue;
      try { await sourceMetadata(checkout); }
      catch { hold(checkout.realPath); }
    }
    const metadata = path.join(source, '.git');
    const linked: string[] = await readdir(path.join(metadata, 'worktrees')).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    // Ordinary linked worktrees can run Local agents too. Their shared-configuration writers
    // have no durable lease identity, so they cannot participate in this host-mutation proof.
    if (linked.some(name => !family.some(record => record.gitDirectory?.path === path.join(metadata, 'worktrees', name)))) {
      throw new Error('This repository has worktrees outside CodeAI management. Switch from a terminal.');
    }
    // A moved worktree retains its metadata name. Prove that each entry still points to the
    // exact destination we leased, rather than trusting the journal's old display path.
    for (const record of family) if (linked.includes(path.basename(record.gitDirectory?.path || ''))) {
      await resolveManagedWorktree(record, getConfig(), writer.token);
    }
    const local = configuration(await runGitRead(cwd, ['config', '--local', '--no-includes', '--list', '-z'], { checkoutWriteLease: writer.token }));
    if (unsupportedLocalGitKey(local) || local.get('core.bare')?.some(value => value !== 'false')) {
      throw new Error('This repository uses Git configuration that CodeAI cannot safely switch under. Switch from a terminal.');
    }
    const info = await lstat(metadata);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Linked Git metadata is unsupported. Switch from a terminal.');
    await containedMetadata(metadata);
    for (const file of ['commondir', 'config.worktree', 'objects/info/alternates', 'objects/info/http-alternates']) {
      if (await lstat(path.join(/* turbopackIgnore: true */ metadata, file)).catch(() => undefined)) {
        throw new Error('External Git metadata is unsupported. Switch from a terminal.');
      }
    }
    const snapshot = await listGitBranches(cwd, writer.token);
    const target = snapshot.branches.find(item => item.name === branch);
    if (!target) throw new Error('This local branch is no longer available. Refresh the branch list.');
    if (snapshot.current === branch) return branch; // A lost response can be retried safely.
    if (snapshot.head !== expectedHead) throw new Error('The current branch or commit changed. Refresh the branch list and retry.');
    if (target.occupied) throw new Error('This branch is checked out in another worktree. Choose another branch.');
    await switchOnHost(cwd, branch);
    return branch;
  });
}
