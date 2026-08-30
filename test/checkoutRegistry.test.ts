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
