import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { serverAgent, ThreadRegistry } from '@/lib/server/threadRegistry';

describe('ThreadRegistry', () => {
  it('persists minimal project-bound session metadata with private permissions', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'web2-threads-'));
    const registry = new ThreadRegistry(directory);
    const thread = await registry.create('project-a', 'codex');
    await expect(registry.get(thread.id, 'project-b')).rejects.toThrow('project-bound');
    const providerSessionId = 'codex-thread-123';
    await registry.markSessionStarted(thread.id, thread.primaryAgentId, 'codex', providerSessionId);
    const persisted = await registry.get(thread.id);
    const agent = persisted.participants.find((participant) => participant.id === thread.primaryAgentId);
    expect(agent).toMatchObject({
      kind: 'agent', provider: 'codex', session: { provider: 'codex', sessionId: providerSessionId, started: true },
    });
    const file = JSON.parse(await readFile(path.join(directory, 'threads.json'), 'utf8'));
    expect(file.version).toBe(3);
    expect(Object.keys(file.threads[0]).sort()).toEqual(['createdAt', 'id', 'participants', 'primaryAgentId', 'projectId', 'updatedAt']);
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
    const agent = migrated.participants.find((participant) => participant.id === migrated.primaryAgentId);
    expect(agent).toMatchObject({
      kind: 'agent', provider: 'claude', role: 'coder', defaultMode: 'ask',
      session: { provider: 'claude', sessionId: id, started: true },
    });
  });

  it('creates a non-default role with its server-owned mode preset', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'web2-threads-role-'));
    const thread = await new ThreadRegistry(directory).create('project-a', 'claude', 'reviewer');
    expect(serverAgent(thread, thread.primaryAgentId)).toMatchObject({ role: 'reviewer', defaultMode: 'ask' });
  });

  it('guards provider/session identity when marking a participant session started', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'web2-threads-session-'));
    const registry = new ThreadRegistry(directory);
    const thread = await registry.create('project-a', 'claude');
    await expect(registry.markSessionStarted(thread.id, thread.primaryAgentId, 'codex', 'wrong')).rejects.toThrow('wrong provider');
    await registry.markSessionStarted(thread.id, thread.primaryAgentId, 'claude', 'session-a');
    await expect(registry.markSessionStarted(thread.id, thread.primaryAgentId, 'claude', 'session-b')).rejects.toThrow('unexpected');
  });

  it('suffixes repeated display names and enforces the eight-agent cap', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'web2-threads-cap-'));
    const registry = new ThreadRegistry(directory);
    const thread = await registry.create('project-a', 'claude');
    const first = await registry.addAgent(thread.id, 'project-a', 'claude', 'reviewer', crypto.randomUUID());
    const second = await registry.addAgent(thread.id, 'project-a', 'claude', 'reviewer', crypto.randomUUID());
    expect(first.displayName).toBe('Claude Reviewer');
    expect(second.displayName).toBe('Claude Reviewer 2');
    for (let index = 0; index < 5; index += 1) {
      await registry.addAgent(thread.id, 'project-a', 'codex', 'tester', crypto.randomUUID());
    }
    await expect(registry.addAgent(thread.id, 'project-a', 'codex', 'tester', crypto.randomUUID())).rejects.toThrow('at most 8');
  });

  it.each([
    ['dangling primary agent', (thread: Record<string, unknown>) => { thread.primaryAgentId = 'missing'; }],
    ['duplicate display names', (thread: Record<string, unknown>) => {
      const participants = thread.participants as Array<Record<string, unknown>>;
      participants[1].displayName = participants[0].displayName;
    }],
    ['two human participants', (thread: Record<string, unknown>) => {
      (thread.participants as unknown[]).push({ id: 'human-2', kind: 'human', displayName: 'Other' });
    }],
  ])('rejects invalid v3 registry data with %s', async (_label, mutate) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'web2-threads-invalid-'));
    const registry = new ThreadRegistry(directory);
    const created = await registry.create('project-a', 'claude');
    const filePath = path.join(directory, 'threads.json');
    const file = JSON.parse(await readFile(filePath, 'utf8'));
    mutate(file.threads[0]);
    await writeFile(filePath, JSON.stringify(file));
    await expect(registry.get(created.id)).rejects.toThrow('unsupported or invalid');
  });
});
