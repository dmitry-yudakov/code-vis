import { createHash } from 'node:crypto';
import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { CheckoutSummary, ServerCheckout } from '@/shared/types';

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
  private rootRealPath?: string;
  private checkouts = new Map<string, ServerCheckout>();

  constructor(
    private readonly configuredRoot: string,
    private readonly discoveryDepth = 1,
  ) {
    if (!Number.isSafeInteger(discoveryDepth) || discoveryDepth < 1 || discoveryDepth > 10) {
      throw new Error('Repository discovery depth must be an integer between 1 and 10');
    }
  }

  async refresh(): Promise<ServerCheckout[]> {
    const root = await realpath(this.configuredRoot);
    if (!(await stat(root)).isDirectory()) throw new Error('Repositories root is not a directory');
    this.rootRealPath = root;

    const candidates: Array<{ realPath: string; relativePath: string }> = [];
    if (await isRepository(root)) {
      candidates.push({ realPath: root, relativePath: '.' });
    } else {
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
    }

    this.checkouts.clear();
    for (const candidate of candidates.sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
      const checkout: ServerCheckout = {
        id: checkoutId(candidate.realPath),
        name: candidate.relativePath === '.' ? path.basename(candidate.realPath) : candidate.relativePath,
        relativePath: candidate.relativePath,
        realPath: candidate.realPath,
      };
      this.checkouts.set(checkout.id, checkout);
    }
    return [...this.checkouts.values()];
  }

  async list(): Promise<CheckoutSummary[]> {
    const checkouts = await this.refresh();
    return checkouts.map(({ id, name, relativePath }) => ({ id, name, relativePath }));
  }

  async resolveMany(ids: string[]): Promise<ServerCheckout[]> {
    await this.refresh();
    const rootRealPath = this.rootRealPath;
    if (!rootRealPath) throw new Error('Repositories root is unavailable');
    return Promise.all(ids.map(async (id) => {
      const checkout = this.checkouts.get(id);
      if (!checkout) throw new Error('Unknown checkout');
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
  const key = `${root}\0${discoveryDepth}`;
  if (!singleton || singletonKey !== key) {
    singleton = new CheckoutRegistry(root, discoveryDepth);
    singletonKey = key;
  }
  return singleton;
}
