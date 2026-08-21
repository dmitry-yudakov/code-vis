import { mkdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ProjectRegistry } from '@/server/projects/projectRegistry';

describe('ProjectRegistry', () => {
  it('discovers only immediate contained projects and exposes no real paths', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codeai-projects-'));
    await mkdir(path.join(root, 'alpha'));
    await writeFile(path.join(root, 'alpha', 'package.json'), '{}');
    await mkdir(path.join(root, '.hidden'));
    await writeFile(path.join(root, '.hidden', 'package.json'), '{}');
    await mkdir(path.join(root, 'node_modules'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'codeai-outside-'));
    await writeFile(path.join(outside, 'package.json'), '{}');
    await symlink(outside, path.join(root, 'escape'));
    const registry = new ProjectRegistry(root);
    const projects = await registry.list();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ name: 'alpha', relativePath: 'alpha' });
    expect(projects[0]).not.toHaveProperty('realPath');
    await expect(registry.resolve('../alpha')).rejects.toThrow('Unknown project');
  });

  it('treats a marked root as the project', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codeai-root-project-'));
    await writeFile(path.join(root, 'Cargo.toml'), '[package]');
    const projects = await new ProjectRegistry(root).list();
    expect(projects).toHaveLength(1);
    expect(projects[0].relativePath).toBe('.');
  });

  it('uses discovery depth for nested marked projects and immediate children as fallback', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codeai-depth-'));
    await mkdir(path.join(root, 'packages', 'api'), { recursive: true });
    await writeFile(path.join(root, 'packages', 'api', 'package.json'), '{}');

    const shallow = await new ProjectRegistry(root, 1).list();
    expect(shallow.map((project) => project.relativePath)).toEqual(['packages']);

    const deep = await new ProjectRegistry(root, 2).list();
    expect(deep.map((project) => project.relativePath)).toEqual(['packages/api']);
    expect(deep[0].name).toBe('packages/api');
  });

  it('rejects an excessive discovery depth', () => {
    expect(() => new ProjectRegistry('/tmp', 11)).toThrow('between 1 and 10');
  });
});
