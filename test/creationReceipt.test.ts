import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { SessionStore } from '@/server/storage/sessionStore';

it('serializes receipt lookup with Restore and rechecks accepted IDs before admitting another session', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codeai-receipt-race-'));
  let release!: () => void; let entered!: () => void; let gate = false;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const store = new SessionStore(root, { hostLabel: 'Receipt fixture', beforeRename: async (target) => {
    if (gate && target.includes('archived')) { entered(); await held; }
  } });
  try {
    const input = { provider: 'claude' as const, creationReceipt: { requestId: crypto.randomUUID(), fingerprint: 'a'.repeat(64) } };
    const session = await store.createSession(input);
    const archived = await store.archiveSession(session.id, session.revision);
    gate = true;
    const restoring = store.restoreSession(session.id, archived.revision);
    await started;
    let resolved = false;
    const receipt = store.findCreationReceipt(input.creationReceipt.requestId).then((saved) => { resolved = true; return saved; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolved).toBe(false);
    release(); await restoring;
    expect((await receipt)?.id).toBe(session.id);
    expect((await store.createSession(input)).id).toBe(session.id);
    expect(await store.listSessions()).toHaveLength(1);
    await expect(store.createSession({ ...input, creationReceipt: { ...input.creationReceipt, fingerprint: 'b'.repeat(64) } })).rejects.toThrow('different choices');
  } finally { release(); await store.close(); }
});
