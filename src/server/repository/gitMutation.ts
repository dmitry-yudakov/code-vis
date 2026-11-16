import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from '@/server/config';
import { runRegistry } from '@/server/runs/runRegistry';
import { configuration, unsupportedLocalGitKey, type GitConfiguration } from './gitLocalConfiguration';
import { runGitRead, withGitReadLease } from './gitRead';
import { containedMetadata, readWorktreeRecords, resolveManagedWorktree, sourceMetadata, validateManagedPath } from './managedWorktrees';
import { getCheckoutRegistry } from './checkoutRegistry';

/** Reuse the same checkout-family ownership and host-configuration proof for offline mutations. */
export async function withGitMutation<T>(cwd: string, mutate: (lease: symbol, local: GitConfiguration) => Promise<T>): Promise<T> {
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
      throw new Error('This repository has worktrees outside CodeAI management. Use a terminal for this Git operation.');
    }
    // A moved worktree retains its metadata name. Prove that each entry still points to the
    // exact destination we leased, rather than trusting the journal's old display path.
    for (const record of family) if (linked.includes(path.basename(record.gitDirectory?.path || ''))) {
      await resolveManagedWorktree(record, getConfig(), writer.token);
    }
    const local = configuration(await runGitRead(cwd, ['config', '--local', '--no-includes', '--list', '-z'], { checkoutWriteLease: writer.token }));
    if (unsupportedLocalGitKey(local) || local.get('core.bare')?.some(value => value !== 'false')) {
      throw new Error('This repository uses Git configuration that CodeAI cannot safely modify under. Use a terminal for this Git operation.');
    }
    const info = await lstat(metadata);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Linked Git metadata is unsupported. Use a terminal for this Git operation.');
    await containedMetadata(metadata);
    for (const file of ['commondir', 'config.worktree', 'objects/info/alternates', 'objects/info/http-alternates']) {
      if (await lstat(path.join(/* turbopackIgnore: true */ metadata, file)).catch(() => undefined)) {
        throw new Error('External Git metadata is unsupported. Use a terminal for this Git operation.');
      }
    }
    return mutate(writer.token, local);
  });
}
