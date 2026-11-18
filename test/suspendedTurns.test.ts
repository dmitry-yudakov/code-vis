import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SuspendedTurns, type SuspendedTurn } from '@/server/lifecycle/suspendedTurns';
import { agentMessageRequestSchema } from '@/shared/protocol';

describe('private suspended request journal', () => {
  it('roundtrips a valid large marked/image request using the same write and read byte contract', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codeai-suspended-journal-'));
    try {
      const journal = new SuspendedTurns(root);
      const request = agentMessageRequestSchema.parse({
        sessionId: crypto.randomUUID(), messageId: crypto.randomUUID(), participantId: 'agent', text: 'Continue this drawing',
        diagramAttachments: [{ diagramId: crypto.randomUUID(), kind: 'sketch', source: '', viewport: { viewBox: [0, 0, 100, 100] },
          marks: Array.from({ length: 10 }, () => ({ id: crypto.randomUUID(), origin: 'user', color: '#000000', kind: 'pen',
            createdAt: new Date().toISOString(), points: Array.from({ length: 5000 }, () => ({ x: 1, y: 2, pressure: 0.5 })) })) }],
        imageAttachments: Array.from({ length: 3 }, () => ({ dataUrl: `data:image/png;base64,${'A'.repeat(1024 * 1024)}` })),
      });
      const record: SuspendedTurn = { version: 1, runId: crypto.randomUUID(), hostId: crypto.randomUUID(),
        checkoutPath: '/repository', execution: 'local', state: 'ready', acceptedAt: new Date().toISOString(), request,
        progress: { attempt: 1, spentMs: 1000, usedTurns: 1, continuation: true } };
      expect(Buffer.byteLength(JSON.stringify(record))).toBeLessThan(6_100_000);
      expect(Buffer.byteLength(JSON.stringify(record, null, 2))).toBeGreaterThan(6_100_000);
      await journal.save(record);
      const persisted = await readFile(path.join(journal.directory, `${record.runId}.json`));
      expect(persisted.length).toBeLessThan(6_100_000);
      expect(await journal.get(record.runId)).toEqual(record);
      expect(await journal.list()).toEqual([record]);
      await journal.remove(record.runId);
      expect(await journal.list()).toEqual([]);
      expect(await journal.get(record.runId)).toBeUndefined();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
