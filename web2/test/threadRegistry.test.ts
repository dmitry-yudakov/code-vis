import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ThreadRegistry } from '@/lib/server/threadRegistry';

describe('ThreadRegistry', () => {
  it('persists minimal project-bound session metadata with private permissions', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'web2-threads-'));
    const registry = new ThreadRegistry(directory);
    const thread = await registry.create('project-a', 'codex');
    await expect(registry.get(thread.id, 'project-b')).rejects.toThrow('project-bound');
    const providerSessionId = 'codex-thread-123';
    await registry.markSessionStarted(thread.id, 'codex', providerSessionId);
    expect((await registry.get(thread.id)).agent).toEqual({
      provider: 'codex', sessionId: providerSessionId, started: true,
    });
    const file = JSON.parse(await readFile(path.join(directory, 'threads.json'), 'utf8'));
    expect(file.version).toBe(2);
    expect(Object.keys(file.threads[0]).sort()).toEqual(['agent', 'createdAt', 'id', 'projectId', 'updatedAt']);
    expect((await stat(path.join(directory, 'threads.json'))).mode & 0o777).toBe(0o600);
  });

  it('migrates legacy Claude session metadata without changing either id', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'web2-threads-legacy-'));
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await writeFile(path.join(directory, 'threads.json'), JSON.stringify({
      version: 1,
      threads: [{ id, projectId: 'project-a', createdAt: now, updatedAt: now, claudeSessionStarted: true }],
    }));
    const migrated = await new ThreadRegistry(directory).get(id);
    expect(migrated.id).toBe(id);
    expect(migrated.agent).toEqual({ provider: 'claude', sessionId: id, started: true });
  });
});
