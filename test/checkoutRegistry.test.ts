import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CheckoutRegistry } from '@/server/repository/checkoutRegistry';

describe('CheckoutRegistry', () => {
  it('discovers only immediate contained repositories and exposes no real paths', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codeai-repositories-'));
    await mkdir(path.join(root, 'alpha'));
    await writeFile(path.join(root, 'alpha', 'package.json'), '{}');
    await mkdir(path.join(root, '.hidden'));
    await writeFile(path.join(root, '.hidden', 'package.json'), '{}');
    await mkdir(path.join(root, 'node_modules'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'codeai-outside-'));
    await writeFile(path.join(outside, 'package.json'), '{}');
    await symlink(outside, path.join(root, 'escape'));
    const registry = new CheckoutRegistry(root);
    const checkouts = await registry.list();
    expect(checkouts).toHaveLength(1);
    expect(checkouts[0]).toMatchObject({ name: 'alpha', relativePath: 'alpha' });
    expect(checkouts[0]).not.toHaveProperty('realPath');
    const refresh = vi.spyOn(registry, 'refresh');
    await expect(registry.resolveMany(checkouts.map((checkout) => checkout.id))).resolves.toHaveLength(1);
    expect(refresh).toHaveBeenCalledOnce();
    await expect(registry.resolve('../alpha')).rejects.toThrow('Unknown checkout');
  });

  it('treats a marked root as a repository', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codeai-root-repository-'));
    await writeFile(path.join(root, 'Cargo.toml'), '[package]');
    const checkouts = await new CheckoutRegistry(root).list();
    expect(checkouts).toHaveLength(1);
    expect(checkouts[0].relativePath).toBe('.');
  });

  it('keeps nested checkout ids resolvable when the root gains a repository marker', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codeai-root-marker-'));
    const repository = path.join(root, 'trevor', 'trevor-web');
    await mkdir(repository, { recursive: true });
    await writeFile(path.join(repository, 'package.json'), '{}');
    const registry = new CheckoutRegistry(root, 2);
    const [checkout] = await registry.list();
    expect(checkout.relativePath).toBe('trevor/trevor-web');

    await mkdir(path.join(root, '.git'));

    for (const current of [registry, new CheckoutRegistry(root, 2)]) {
      const checkouts = await current.list();
      expect(checkouts.map((item) => item.relativePath)).toEqual(['.', 'trevor/trevor-web']);
      expect(checkouts.find((item) => item.id === checkout.id)).toEqual(checkout);
      await expect(current.resolve(checkout.id)).resolves.toMatchObject({ ...checkout, realPath: repository });
    }
  });

  it('bounds descendant discovery under a marked root and excludes hidden, generated and outside paths', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codeai-marked-depth-'));
    await writeFile(path.join(root, 'package.json'), '{}');
    for (const relativePath of ['packages/api', '.hidden', 'node_modules/dependency', 'dist/generated']) {
      const repository = path.join(root, relativePath);
      await mkdir(repository, { recursive: true });
      await writeFile(path.join(repository, 'package.json'), '{}');
    }
    const outside = await mkdtemp(path.join(os.tmpdir(), 'codeai-outside-'));
    await writeFile(path.join(outside, 'package.json'), '{}');
    await symlink(outside, path.join(root, 'escape'));

    const shallow = await new CheckoutRegistry(root, 1).list();
    expect(shallow.map((checkout) => checkout.relativePath)).toEqual(['.']);
    const registry = new CheckoutRegistry(root, 2);
    const deep = await registry.list();
    expect(deep.map((checkout) => checkout.relativePath)).toEqual(['.', 'packages/api']);
    await expect(registry.resolveMany(deep.map((checkout) => checkout.id))).resolves.toHaveLength(2);
    const [escaped] = await new CheckoutRegistry(outside).list();
    await expect(registry.resolve(escaped.id)).rejects.toThrow('Unknown checkout');
  });

  it('uses discovery depth for nested repositories and immediate children as fallback', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codeai-depth-'));
    await mkdir(path.join(root, 'packages', 'api'), { recursive: true });
    await writeFile(path.join(root, 'packages', 'api', 'package.json'), '{}');
    const shallow = await new CheckoutRegistry(root, 1).list();
    expect(shallow.map((checkout) => checkout.relativePath)).toEqual(['packages']);
    const deep = await new CheckoutRegistry(root, 2).list();
    expect(deep.map((checkout) => checkout.relativePath)).toEqual(['packages/api']);
    expect(deep[0].name).toBe('packages/api');
  });

  it('rejects an excessive discovery depth', () => {
    expect(() => new CheckoutRegistry('/tmp', 11)).toThrow('between 1 and 10');
  });
});
