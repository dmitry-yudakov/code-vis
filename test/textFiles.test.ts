import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateTextFiles } from '@/shared/textFiles';
import { prepareTextFile } from '@/features/conversation/textFiles';
import { textFileRecords, writeTextFiles } from '@/server/storage/textFiles';
import { SessionStore } from '@/server/storage/sessionStore';
import { canonicalTranscript } from '@/server/conversation/transcript';
import { MAX_TEXT_FILE_BYTES, MAX_SESSION_TEXT_FILE_BYTES } from '@/shared/limits';
import { durableSessionSchema } from '@/shared/sessionSchema';
import type { UserMessage } from '@/shared/types';

describe('bounded text-file evidence', () => {
  it('prepares exact UTF-8 without truncation, including source files with no MIME type', async () => {
    validateTextFiles([{ name: 'bom.txt', text: '\uFEFFhello' }]);
    const file = new File(['hello 🌍\n'], 'source.ts');
    const prepared = await prepareTextFile(file);
    expect(prepared).toEqual({ name: 'source.ts', text: 'hello 🌍\n' });
    const [record] = textFileRecords([prepared]);
    expect(record).toMatchObject({ name: file.name, bytes: 11, text: prepared.text, digest: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-text-files-'));
    const manifest = await writeTextFiles(directory, [prepared]);
    expect(await readFile(path.join(directory, manifest[0].file), 'utf8')).toBe(prepared.text);
    expect(JSON.parse(await readFile(path.join(directory, 'file-attachments.json'), 'utf8'))).toEqual(manifest);
  });

  it.each([
    { name: '../escape', text: 'data' }, { name: 'a/b', text: 'data' }, { name: 'a\\b', text: 'data' },
    { name: 'a\nlog', text: 'data' }, { name: 'empty', text: '' }, { name: 'binary', text: 'x\0y' },
    { name: 'report.pdf', text: '%PDF-1.7\ncontent' }, { name: 'invalid', text: '\ud800' },
    { name: 'large', text: 'é'.repeat(MAX_TEXT_FILE_BYTES / 2 + 1) },
  ])('rejects invalid evidence before accepting it: $name', (file) => {
    expect(() => validateTextFiles([file])).toThrow();
  });

  it('rejects malformed UTF-8 and enforces source, count, and aggregate bounds', async () => {
    await expect(prepareTextFile(new File([new Uint8Array([0xff])], 'invalid.txt'))).rejects.toThrow();
    await expect(prepareTextFile(new File(['x'.repeat(MAX_TEXT_FILE_BYTES + 1)], 'huge.txt'))).rejects.toThrow();
    expect(() => validateTextFiles(Array.from({ length: 5 }, () => ({ name: 'file', text: 'x' })))).toThrow();
    expect(() => validateTextFiles(Array.from({ length: 3 }, () => ({ name: 'file', text: 'x'.repeat(MAX_TEXT_FILE_BYTES) })))).toThrow();
  });

  it('stores format-12 file evidence, includes it in bounded transcript input, and rejects altered replay', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codeai-text-store-'));
    const store = new SessionStore(root, { hostLabel: 'Text fixture' });
    try {
      const session = await store.createSession({ provider: 'claude', checkoutId: 'repo' });
      const message: UserMessage = { id: crypto.randomUUID(), role: 'user', authorId: session.participants[0].id,
        addressedParticipantId: session.primaryAgentId, text: 'Review this', createdAt: new Date().toISOString(),
        status: 'sending', diagramAttachments: [], fileAttachments: textFileRecords([{ name: 'a.ts', text: 'const value = 1;' }]) };
      const accepted = await store.appendUserMessage(session.id, message);
      expect(accepted.session.version).toBe(12);
      expect(durableSessionSchema.safeParse(accepted.session).success).toBe(true);
      expect(canonicalTranscript(accepted.session.messages)[0].text).toContain('const value = 1;');
      expect((await store.appendUserMessage(session.id, message)).appended).toBe(false);
      await expect(store.appendUserMessage(session.id, { ...message,
        fileAttachments: textFileRecords([{ name: 'a.ts', text: 'const value = 2;' }]) })).rejects.toThrow();
    } finally { await store.close(); }
  });

  it('enforces the per-session cap atomically and does not count duplicate acceptance twice', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'codeai-file-cap-'));
    const store = new SessionStore(root, { hostLabel: 'Cap fixture' });
    try {
      const session = await store.createSession({ provider: 'claude' });
      const files = textFileRecords(Array.from({ length: 2 }, (_, i) => ({ name: `file-${i}`, text: 'x'.repeat(MAX_TEXT_FILE_BYTES) })));
      const message = (): UserMessage => ({ id: crypto.randomUUID(), role: 'user', authorId: session.participants[0].id,
        addressedParticipantId: session.primaryAgentId, text: 'Review', createdAt: new Date().toISOString(),
        status: 'sending', diagramAttachments: [], fileAttachments: files });
      for (let i = 0; i < MAX_SESSION_TEXT_FILE_BYTES / (2 * MAX_TEXT_FILE_BYTES) - 1; i++) await store.appendUserMessage(session.id, message());
      const before = (await store.getSession(session.id)).messages.length;
      const final = message();
      let promoted = 0;
      const outcomes = await Promise.allSettled([store.appendUserMessage(session.id, final), store.appendUserMessage(session.id, message(), async () => { promoted++; })]);
      expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect((await store.appendUserMessage(session.id, final)).appended).toBe(false);
      expect((await store.getSession(session.id)).messages).toHaveLength(before + 1);
      expect(promoted).toBe(0);
    } finally { await store.close(); }
  }, 30_000);
});
