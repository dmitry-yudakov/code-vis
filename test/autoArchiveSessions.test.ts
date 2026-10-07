import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConfig, type AppConfig } from '@/server/config';
import { autoArchiveSessions } from '@/server/storage/autoArchiveSessions';
import { getSessionStore, type SessionStore } from '@/server/storage/sessionStore';
import { runRegistry } from '@/server/runs/runRegistry';
import type { DurableSession } from '@/shared/types';

const recovery = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/server/execution/dockerRecovery', () => ({ recoverDockerExecution: recovery }));

const NOW = Date.parse('2026-10-02T12:00:00.000Z');
const AGE = 48 * 60 * 60 * 1_000;
let config: AppConfig;
let store: SessionStore;
const releaseRuns: Array<() => void> = [];

async function seed(age: number, execution: 'local' | 'docker' = 'local'): Promise<DurableSession> {
  const created = await store.createSession({ provider: 'claude' });
  const session = {
    ...created, execution,
    ...(execution === 'docker' ? { repositories: [{ id: crypto.randomUUID(), hostId: (await store.host()).id, checkoutId: 'checkout', role: 'primary' as const }] } : {}),
    createdAt: new Date(NOW - 2 * AGE).toISOString(), updatedAt: new Date(NOW - age).toISOString(),
  };
  await writeFile(path.join(store.sessionsDirectory, `${session.id}.json`), JSON.stringify(session));
  return session;
}

function reserve(sessionId: string) {
  const runId = crypto.randomUUID();
  const input = { runId, sessionId, participantId: 'agent', providerKey: runId, checkoutId: 'checkout', access: 'read' as const, cancel: () => undefined };
  const result = runRegistry.reserve(input);
  if (result.accepted) releaseRuns.push(() => { runRegistry.release(runId); runRegistry.finish(runId); });
  return { runId, result };
}

beforeEach(async () => {
  config = { ...getConfig(), dataDir: await mkdtemp(path.join(os.tmpdir(), 'codeai-auto-archive-')) };
  store = getSessionStore(config.dataDir);
  recovery.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const release of releaseRuns.splice(0)) release();
  await store.close();
});

describe('48-hour conversation auto archive', () => {
  it('archives only past the inactivity boundary, preserving complete content and leaving reads inert', async () => {
    const old = await seed(AGE + 1);
    const boundary = await seed(AGE);
    const recent = await seed(AGE - 1);
    await store.getSession(old.id);
    await autoArchiveSessions(config, NOW);
    expect((await store.listSessions()).map((session) => session.id).sort()).toEqual([boundary.id, recent.id].sort());
    const archived = await store.getArchivedSession(old.id);
    expect(archived).toEqual({ ...old, archivedAt: expect.any(String), updatedAt: archived.archivedAt, revision: old.revision + 1 });
    await store.close();
    const restored = await store.restoreSession(old.id, archived.revision);
    expect(restored.messages).toEqual(old.messages);
    await autoArchiveSessions(config, Date.parse(restored.updatedAt) + AGE);
    expect(await store.getSession(old.id)).toEqual(restored);
    await autoArchiveSessions(config, Date.parse(restored.updatedAt) + AGE + 1);
    expect((await store.getArchivedSession(old.id)).revision).toBe(restored.revision + 1);
  });

  it('does not archive reserved, queued, running or permission-blocked turns', async () => {
    const sessions = await Promise.all([seed(AGE + 1), seed(AGE + 1), seed(AGE + 1), seed(AGE + 1)]);
    const reserved = reserve(sessions[0].id);
    const running = reserve(sessions[1].id);
    const waiting = reserve(sessions[2].id);
    const queued = reserve(sessions[3].id);
    for (const run of [running, waiting, queued]) runRegistry.activate(run.runId, { execute: () => new Promise<void>(() => undefined), cancelQueued: async () => undefined });
    await Promise.resolve();
    runRegistry.record(waiting.runId, { type: 'permission-request', runId: waiting.runId, requestId: 'permission', participantId: 'agent', tool: 'shell', detail: 'fixture' });
    expect(runRegistry.list().active.map((run) => run.state)).toEqual(['running', 'needs-you', 'queued']);
    await autoArchiveSessions(config, NOW);
    expect(await store.listArchivedSessions()).toEqual([]);
    expect(await store.getSession(sessions[0].id)).toBeDefined();
    runRegistry.release(reserved.runId);
    await autoArchiveSessions(config, NOW);
    expect((await store.listArchivedSessions()).map((session) => session.id)).toEqual([sessions[0].id]);
  });

  it('refuses same-session admission while archiving, while unrelated turns continue', async () => {
    const old = await seed(AGE + 1);
    const archive = store.archiveSession.bind(store);
    vi.spyOn(store, 'archiveSession').mockImplementation(async (id, revision) => {
      expect(reserve(id).result).toEqual({ accepted: false, reason: 'session-archiving' });
      expect(reserve(crypto.randomUUID()).result.accepted).toBe(true);
      return archive(id, revision);
    });
    await autoArchiveSessions(config, NOW);
    expect(await store.getArchivedSession(old.id)).toBeDefined();
    expect(reserve(old.id).result.accepted).toBe(true);
  });

  it('lets a newer saved change win and tolerates concurrent sweeps', async () => {
    const old = await seed(AGE + 1);
    const list = store.listSessions.bind(store);
    let changed = false;
    vi.spyOn(store, 'listSessions').mockImplementation(async () => {
      const candidates = await list();
      if (!changed) {
        changed = true;
        await store.addAgent(old.id, 'codex', 'reviewer', crypto.randomUUID());
      }
      return candidates;
    });
    await Promise.all([autoArchiveSessions(config, NOW), autoArchiveSessions(config, NOW)]);
    expect((await store.getSession(old.id)).revision).toBe(old.revision + 1);
    vi.restoreAllMocks();
    const another = await seed(AGE + 1);
    await Promise.all([autoArchiveSessions(config, NOW), autoArchiveSessions(config, NOW)]);
    expect((await store.listArchivedSessions()).map((session) => session.id)).toEqual([another.id]);
  });

  it('releases archive admission after a storage error and retries next time', async () => {
    const old = await seed(AGE + 1);
    vi.spyOn(store, 'archiveSession').mockRejectedValueOnce(new Error('disk full'));
    await expect(autoArchiveSessions(config, NOW)).rejects.toThrow('disk full');
    const admitted = reserve(old.id);
    expect(admitted.result.accepted).toBe(true);
    runRegistry.release(admitted.runId);
    await autoArchiveSessions(config, NOW);
    expect(await store.getArchivedSession(old.id)).toBeDefined();
  });

  it('shares an in-flight sweep across concurrent collection requests', async () => {
    const old = await seed(AGE + 1);
    const list = vi.spyOn(store, 'listSessions');
    const archive = store.archiveSession.bind(store);
    let resume!: () => void;
    const held = new Promise<void>((resolve) => { resume = resolve; });
    const moving = vi.spyOn(store, 'archiveSession').mockImplementation(async (id, revision) => {
      await held;
      return archive(id, revision);
    });
    const first = autoArchiveSessions(config, NOW);
    await vi.waitFor(() => expect(moving).toHaveBeenCalledOnce());
    const second = autoArchiveSessions(config, NOW);
    expect(second).toBe(first);
    expect(list).toHaveBeenCalledOnce();
    resume();
    await Promise.all([first, second]);
    expect(await store.getArchivedSession(old.id)).toBeDefined();
  });

  it('tolerates a manual archive between listing a filename and reading it, without counting a newer format', async () => {
    const old = await seed(AGE + 1);
    // Pause the directory reader at the file-read boundary, then perform a real durable move.
    const reader = store as unknown as { readSessionFile(file: string): Promise<DurableSession> };
    const read = reader.readSessionFile.bind(store);
    let moved = false;
    vi.spyOn(reader, 'readSessionFile').mockImplementation(async (file) => {
      if (!moved && file === path.join(store.sessionsDirectory, `${old.id}.json`)) {
        moved = true;
        await store.archiveSession(old.id, old.revision);
      }
      return read(file);
    });
    expect(await store.listSessions()).toEqual([]);
    expect(await store.newerFormatSessionCount()).toBe(0);
    expect(await store.getArchivedSession(old.id)).toBeDefined();
  });

  it('keeps Docker records active during unresolved recovery while archiving Local records', async () => {
    const local = await seed(AGE + 1);
    const docker = await seed(AGE + 1, 'docker');
    recovery.mockRejectedValueOnce(new Error('daemon offline'));
    await autoArchiveSessions(config, NOW);
    expect(await store.getArchivedSession(local.id)).toBeDefined();
    expect(await store.getSession(docker.id)).toEqual(docker);
    await autoArchiveSessions(config, NOW);
    expect(await store.getArchivedSession(docker.id)).toBeDefined();
  });

  it('does not rewrite or move records from a newer session format', async () => {
    const session = await seed(AGE + 1);
    const file = path.join(store.sessionsDirectory, `${session.id}.json`);
    const contents = JSON.stringify({ ...session, version: 12, future: 'opaque' });
    await writeFile(file, contents);
    await autoArchiveSessions(config, NOW);
    expect(await readFile(file, 'utf8')).toBe(contents);
    expect(await store.listArchivedSessions()).toEqual([]);
  });
});
