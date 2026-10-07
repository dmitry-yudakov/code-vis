import { createHash } from 'node:crypto';
import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { CheckoutSummary, ServerCheckout } from '@/shared/types';
import { getConfig, type AppConfig } from '@/server/config';
import { readWorktreeRecords, reconcileWorktrees, resolveManagedWorktree, sourceWorktreeCapability, worktreeCapability } from './managedWorktrees';

const REPOSITORY_MARKERS = [
  '.git', 'package.json', 'tsconfig.json', 'jsconfig.json', 'yarn.lock', 'package-lock.json',
  'pnpm-lock.yaml', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml',
];
const IGNORED = new Set(['node_modules', 'dist', 'build', 'coverage', '.next', '.next-e2e', 'out', 'target']);

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function isRepository(directory: string): Promise<boolean> {
  const names = new Set((await readdir(directory).catch(() => [])).map((entry) => entry.toString()));
  return REPOSITORY_MARKERS.some((marker) => names.has(marker));
}

async function childDirectories(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !IGNORED.has(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function checkoutId(realPath: string): string {
  return createHash('sha256').update(realPath).digest('base64url').slice(0, 22);
}

export class CheckoutRegistry {
  constructor(
    private readonly configuredRoot: string,
    private readonly discoveryDepth = 1,
    private readonly config?: AppConfig,
  ) {
    if (!Number.isSafeInteger(discoveryDepth) || discoveryDepth < 1 || discoveryDepth > 10) {
      throw new Error('Repository discovery depth must be an integer between 1 and 10');
    }
  }

  async refresh(): Promise<ServerCheckout[]> {
    const root = await realpath(this.configuredRoot);
    if (!(await stat(root)).isDirectory()) throw new Error('Repositories root is not a directory');

    const candidates: Array<{ realPath: string; relativePath: string }> = [];
    if (await isRepository(root)) {
      candidates.push({ realPath: root, relativePath: '.' });
    }
    // A marker on the root must not hide already bound descendant checkouts.
    const immediateChildren = await childDirectories(root);
    const queue = immediateChildren.map((name) => ({ directory: path.join(root, name), depth: 1 }));
    while (queue.length) {
      const current = queue.shift()!;
      const candidate = await realpath(current.directory).catch(() => undefined);
      if (!candidate || !isContained(root, candidate)) continue;
      if (await isRepository(candidate)) {
        candidates.push({ realPath: candidate, relativePath: path.relative(root, candidate).split(path.sep).join('/') });
      }
      if (current.depth >= this.discoveryDepth) continue;
      const nested = await childDirectories(candidate).catch(() => []);
      queue.push(...nested.map((name) => ({ directory: path.join(candidate, name), depth: current.depth + 1 })));
    }
    if (!candidates.length) {
      for (const name of immediateChildren) {
        const candidate = await realpath(path.join(root, name)).catch(() => undefined);
        if (candidate && isContained(root, candidate)) candidates.push({ realPath: candidate, relativePath: name });
      }
    }

    const checkouts = new Map<string, ServerCheckout>();
    for (const candidate of candidates.sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
      if (this.config?.worktreesRoot && candidate.realPath !== this.config.worktreesRoot && isContained(this.config.worktreesRoot, candidate.realPath)) continue;
      const checkout: ServerCheckout = {
        id: checkoutId(candidate.realPath),
        name: candidate.relativePath === '.' ? path.basename(candidate.realPath) : candidate.relativePath,
        relativePath: candidate.relativePath,
        realPath: candidate.realPath,
      };
      checkouts.set(checkout.id, checkout);
    }
    if (this.config?.worktreesRoot) {
      for (const record of await readWorktreeRecords(this.config.dataDir)) {
        let checkout: ServerCheckout;
        try { checkout = await resolveManagedWorktree(record, this.config); }
        catch (error) {
          checkout = { id: record.checkoutId, realPath: record.destination,
            name: `Worktree · ${record.session.worktree!.branch}`, relativePath: `worktrees/${record.session.worktree!.id}`,
            worktree: record.session.worktree, unavailableReason: error instanceof Error ? error.message.slice(0, 500) : 'Managed worktree is unavailable.' };
        }
        checkouts.set(checkout.id, checkout);
      }
    }
    return [...checkouts.values()];
  }

  async list(): Promise<CheckoutSummary[]> {
    const checkouts = await this.refresh();
    const capability = this.config?.worktreesRoot ? await worktreeCapability(this.config, checkouts.filter((checkout) => !checkout.worktree)) : undefined;
    return Promise.all(checkouts.map(async ({ realPath, ...summary }) => ({ ...summary,
      ...(capability ? { worktreeCreation: await sourceWorktreeCapability({ realPath, ...summary }, capability, this.config) } : {}),
    })));
  }

  async resolveMany(ids: string[]): Promise<ServerCheckout[]> {
    if (this.config?.worktreesRoot) await reconcileWorktrees(this.config);
    const checkouts = new Map((await this.refresh()).map((checkout) => [checkout.id, checkout]));
    const rootRealPath = await realpath(this.configuredRoot);
    return Promise.all(ids.map(async (id) => {
      const checkout = checkouts.get(id);
      if (!checkout) throw new Error('Unknown checkout');
      if (checkout.worktree) {
        const record = (await readWorktreeRecords(this.config!.dataDir)).find((item) => item.checkoutId === id);
        if (!record) throw new Error('Managed checkout is no longer registered.');
        return resolveManagedWorktree(record, this.config!);
      }
      const current = await realpath(checkout.realPath);
      if (!isContained(rootRealPath, current) || current !== checkout.realPath) {
        throw new Error('Checkout no longer resolves within the configured repositories root');
      }
      return checkout;
    }));
  }

  async resolve(id: string): Promise<ServerCheckout> {
    return (await this.resolveMany([id]))[0];
  }
}

let singleton: CheckoutRegistry | undefined;
let singletonKey: string | undefined;

export function getCheckoutRegistry(root: string, discoveryDepth = 1): CheckoutRegistry {
  const config = getConfig();
  const key = `${root}\0${discoveryDepth}\0${config.dataDir}\0${config.worktreesRoot}`;
  if (!singleton || singletonKey !== key) {
    singleton = new CheckoutRegistry(root, discoveryDepth, config);
    singletonKey = key;
  }
  return singleton;
}
