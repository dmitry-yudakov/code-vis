import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ThreadRegistry } from '@/lib/server/threadRegistry';

describe('ThreadRegistry', () => {
  it('persists minimal project-bound session metadata with private permissions', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'web2-threads-'));
    const registry = new ThreadRegistry(directory);
    const thread = await registry.create('project-a');
    await expect(registry.get(thread.id, 'project-b')).rejects.toThrow('project-bound');
    await registry.markSessionStarted(thread.id, thread.id);
    expect((await registry.get(thread.id)).claudeSessionStarted).toBe(true);
    const file = JSON.parse(await readFile(path.join(directory, 'threads.json'), 'utf8'));
    expect(Object.keys(file.threads[0]).sort()).toEqual(['claudeSessionStarted', 'createdAt', 'id', 'projectId', 'updatedAt']);
    expect((await stat(path.join(directory, 'threads.json'))).mode & 0o777).toBe(0o600);
  });
});
