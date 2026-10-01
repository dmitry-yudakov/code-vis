import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';

// The preceding image-aware build reads up to format 8. Its newer-format guard runs before parsing.
vi.mock('@/shared/sessionSchema', async (original) => ({
  ...await original<typeof import('@/shared/sessionSchema')>(), MAX_READABLE_SESSION_VERSION: 8,
}));
import { SessionStore } from '@/server/storage/sessionStore';

it('a format-8 reader hides Native sessions alone and preserves their bytes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-native-rollback-'));
  const store = new SessionStore(directory);
  try {
    const ordinary = await store.createSession({ provider: 'claude' });
    const native = await store.createSession({ provider: 'claude' });
    const file = path.join(directory, 'session-store-v2', 'sessions', `${native.id}.json`);
    const bytes = JSON.stringify({ ...native, version: 9, messages: [{ mode: 'full' }] });
    await writeFile(file, bytes);
    expect((await store.listSessions()).map((session) => session.id)).toEqual([ordinary.id]);
    expect(await store.newerFormatSessionCount()).toBe(1);
    await expect(store.getSession(native.id)).rejects.toMatchObject({ code: 'unsupported-format' });
    expect(await readFile(file, 'utf8')).toBe(bytes);
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
});
