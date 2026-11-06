import { mkdtemp, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { arenaSessionSummary, SessionStore } from '@/server/storage/sessionStore';
import type { DurableSession } from '@/shared/types';

let store: SessionStore;
const file = (session: DurableSession) => path.join(store.sessionsDirectory, `${session.id}.json`);
const reader = () => store as unknown as { readSessionFile(file: string): Promise<DurableSession> };

beforeEach(async () => {
  store = new SessionStore(await mkdtemp(path.join(os.tmpdir(), 'codeai-summary-')));
  await store.host();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await store.close();
});

describe('stat-validated session summaries', () => {
  it('shares unchanged reads across concurrent polls and retains only isolated compact projections', async () => {
    const project = await store.createProject('Project', ['checkout']);
    const active = await store.createSession({ provider: 'claude', projectId: project.id });
    const other = await store.createSession({ provider: 'codex' });
    const archived = await store.archiveSession(other.id, other.revision);
    const read = vi.spyOn(reader(), 'readSessionFile');

    const [first, second, archive] = await Promise.all([
      store.listSessionSummaries(), store.listSessionSummaries(), store.listSessionSummaries({ archived: true }),
    ]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(first).toEqual([{ ...arenaSessionSummary(active), repositories: active.repositories }]);
    expect(second).toEqual(first);
    expect(archive).toEqual([{ ...arenaSessionSummary(archived), repositories: archived.repositories }]);
    first[0].title = 'Changed by a caller';
    first[0].repositories[0].checkoutId = 'wrong';
    first[0].agents[0].displayName = 'wrong';
    expect(await store.listSessionSummaries()).toEqual(second);
    expect(await store.listSessionSummaries({ archived: true })).toEqual(archive);
    expect(read).toHaveBeenCalledTimes(2);
    expect(first[0]).not.toHaveProperty('messages');
    // Full-session reads still return complete canonical content.
    expect(await store.getSession(active.id)).toEqual(active);
  });

  it('refreshes only changed files after a durable edit, archive, restore and project removal', async () => {
    const project = await store.createProject('Project', ['checkout']);
    const active = await store.createSession({ provider: 'claude', projectId: project.id });
    const other = await store.createSession({ provider: 'codex' });
    await store.listSessionSummaries();
    const changed = await store.addAgent(active.id, 'codex', 'reviewer', crypto.randomUUID());
    const read = vi.spyOn(reader(), 'readSessionFile');
    expect(await store.listSessionSummaries()).toEqual(expect.arrayContaining([
      { ...arenaSessionSummary(changed), repositories: changed.repositories },
    ]));
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(file(active));
    const archived = await store.archiveSession(active.id, changed.revision);
    expect((await store.listSessionSummaries()).map(item => item.id)).toEqual([other.id]);
    expect((await store.listSessionSummaries({ archived: true })).map(item => item.id)).toEqual([active.id]);
    await store.deleteProject(project.id, project.revision);
    expect((await store.listSessionSummaries({ archived: true }))[0].projectId).toBeUndefined();
    const detached = await store.getArchivedSession(active.id);
    const restored = await store.restoreSession(active.id, detached.revision);
    expect(await store.listSessionSummaries({ archived: true })).toEqual([]);
    expect(await store.listSessionSummaries()).toEqual(expect.arrayContaining([
      { ...arenaSessionSummary(restored), repositories: restored.repositories },
    ]));
    expect(restored.revision).toBeGreaterThan(archived.revision);
  });

  it('notices same-size atomic replacements with preserved mtime, and removed files', async () => {
    const active = await store.createSession({ provider: 'claude' });
    await store.listSessionSummaries();
    const original = await stat(file(active));
    const replacement = `${file(active)}.replacement`;
    await writeFile(replacement, `${JSON.stringify({ ...active, title: active.title.replace(/./, 'X') }, null, 2)}\n`);
    await utimes(replacement, original.atime, original.mtime);
    expect((await stat(replacement)).size).toBe(original.size);
    await rename(replacement, file(active));
    expect((await store.listSessionSummaries())[0].title).toBe(active.title.replace(/./, 'X'));
    await unlink(file(active));
    expect(await store.listSessionSummaries()).toEqual([]);
  });

  it('omits unchanged newer formats, reports corruption, and retries failed reads', async () => {
    const active = await store.createSession({ provider: 'claude' });
    await writeFile(file(active), JSON.stringify({ ...active, version: 99 }));
    const read = vi.spyOn(reader(), 'readSessionFile');
    expect(await store.listSessionSummaries()).toEqual([]);
    expect(await store.listSessionSummaries()).toEqual([]);
    expect(read).toHaveBeenCalledTimes(1);
    await writeFile(file(active), '{');
    await expect(store.listSessionSummaries()).rejects.toMatchObject({ code: 'corrupt' });
    await writeFile(file(active), JSON.stringify(active));
    read.mockRejectedValueOnce(new Error('temporary I/O failure'));
    await expect(store.listSessionSummaries()).rejects.toThrow('temporary I/O failure');
    expect((await store.listSessionSummaries())[0].id).toBe(active.id);
  });

  it('tolerates a file moving after stat without retaining a missing-file result', async () => {
    const active = await store.createSession({ provider: 'claude' });
    const read = reader().readSessionFile.bind(store);
    let moved = false;
    vi.spyOn(reader(), 'readSessionFile').mockImplementation(async target => {
      if (!moved && target === file(active)) {
        moved = true;
        await store.archiveSession(active.id, active.revision);
      }
      return read(target);
    });
    expect(await store.listSessionSummaries()).toEqual([]);
    expect((await store.listSessionSummaries({ archived: true }))[0].id).toBe(active.id);
    const archived = await store.getArchivedSession(active.id);
    await store.restoreSession(active.id, archived.revision);
    expect((await store.listSessionSummaries())[0].id).toBe(active.id);
  });

  it('keeps the combined active/archive file bound even when summaries are warm', async () => {
    await store.createSession({ provider: 'claude' });
    await store.listSessionSummaries();
    await Promise.all(Array.from({ length: 1_000 }, (_, index) => writeFile(
      path.join(index % 2 ? store.sessionsDirectory : store.archivedSessionsDirectory, `${crypto.randomUUID()}.json`),
      '{}',
    )));
    await expect(store.listSessionSummaries()).rejects.toMatchObject({ code: 'corrupt' });
    await expect(store.listSessionSummaries({ archived: true })).rejects.toMatchObject({ code: 'corrupt' });
  });
});
