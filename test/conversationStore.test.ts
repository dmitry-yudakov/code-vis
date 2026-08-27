import {
  mkdtemp, readFile, stat, unlink, writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  ConversationStore, conversationStoreStatus, getConversationStore, publicConversation, serverAgent,
} from '@/server/storage/conversationStore';
import { durableConversationSchema } from '@/shared/conversationSchema';
import {
  hydrateConversation, loadSelectedProjectId, saveSelectedProjectId, serializeThreadExport,
} from '@/features/conversation/conversationStore';
import type { AssistantMessage, UserMessage } from '@/shared/types';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

async function directory(prefix = 'codeai-conversations-'): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

function userMessage(threadId: string, humanId: string, agentId: string, text = 'Explain this.'): UserMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    authorId: humanId,
    addressedParticipantId: agentId,
    text,
    createdAt: new Date().toISOString(),
    status: 'sending',
    diagramAttachments: [],
    mode: 'ask',
  };
}

describe('host-owned conversation store', () => {
  it('creates a fresh private store, keeps its host identity, and leaves legacy records unread', async () => {
    const dataDir = await directory();
    const legacyPath = path.join(dataDir, 'threads.json');
    const legacy = '{"version":3,"threads":[{"legacy":true}]}';
    await writeFile(legacyPath, legacy);

    const first = new ConversationStore(dataDir, { hostLabel: 'Laptop' });
    const created = await first.createConversation({ checkoutId: 'checkout-a', provider: 'codex' });
    const host = await first.host();
    expect(host.label).toBe('Laptop');
    expect(created).toMatchObject({ version: 1, revision: 0, attachments: [{ hostId: host.id, checkoutId: 'checkout-a', role: 'primary' }] });
    expect((await first.listConversations()).map((item) => item.id)).toEqual([created.id]);
    expect(await readFile(legacyPath, 'utf8')).toBe(legacy);

    const root = path.join(dataDir, 'conversation-store-v1');
    const threadPath = path.join(root, 'threads', `${created.id}.json`);
    expect((await stat(root)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(root, 'threads'))).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(root, 'manifest.json'))).mode & 0o777).toBe(0o600);
    expect((await stat(threadPath)).mode & 0o777).toBe(0o600);
    await first.close();

    const reopened = new ConversationStore(dataDir, { hostLabel: 'Environment changed' });
    expect(await reopened.host()).toEqual(host);
    expect(await reopened.getConversation(created.id)).toEqual(created);
    await reopened.close();
  });

  it('persists complete content with idempotent appends and atomic assistant/cursor completion', async () => {
    const dataDir = await directory();
    const store = new ConversationStore(dataDir, { hostLabel: 'Host' });
    let conversation = await store.createConversation({ checkoutId: 'checkout-a', provider: 'claude' });
    const human = conversation.participants.find((item) => item.kind === 'human')!;
    const agent = serverAgent(conversation, conversation.primaryAgentId)!;
    const user = userMessage(conversation.id, human.id, agent.id);

    const accepted = await store.appendUserMessage(conversation.id, user);
    conversation = accepted.conversation;
    expect(accepted.appended).toBe(true);
    expect(conversation.revision).toBe(1);
    const retried = await store.appendUserMessage(conversation.id, user);
    expect(retried).toMatchObject({ appended: false, conversation: { revision: 1 } });

    const assistant: AssistantMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      authorId: agent.id,
      createdAt: new Date().toISOString(),
      status: 'complete',
      rawMarkdown: 'Done.',
      blocks: [],
      mode: 'ask',
    };
    conversation = await store.completeAssistantMessage(conversation.id, agent.id, user.id, assistant);
    expect(conversation.revision).toBe(2);
    expect(conversation.messages).toMatchObject([{ status: 'sent' }, { id: assistant.id, rawMarkdown: 'Done.' }]);
    expect(serverAgent(conversation, agent.id)?.lastObservedMessageId).toBe(assistant.id);
    expect((await store.completeAssistantMessage(conversation.id, agent.id, user.id, assistant)).revision).toBe(2);

    await store.markSessionStarted(conversation.id, agent.id, 'claude', 'provider-session');
    const privateRecord = await store.getConversation(conversation.id);
    expect(serverAgent(privateRecord, agent.id)?.session).toMatchObject({
      started: true, sessionId: 'provider-session', hostId: (await store.host()).id,
    });
    const publicRecord = publicConversation(privateRecord);
    expect(JSON.stringify(publicRecord)).not.toMatch(/provider-session|lastObservedMessageId|creationRequestId/);
    expect(durableConversationSchema.parse(privateRecord)).toEqual(privateRecord);
    await store.close();
  });

  it('serializes operation-level writes, detects revision conflicts, and keeps retries independent', async () => {
    const dataDir = await directory();
    const store = new ConversationStore(dataDir);
    const created = await store.createConversation({ provider: 'claude' });
    const requestId = crypto.randomUUID();
    const [first, second] = await Promise.all([
      store.addAgent(created.id, 'codex', 'reviewer', requestId),
      store.addAgent(created.id, 'codex', 'reviewer', requestId),
    ]);
    expect(first.revision).toBe(1);
    expect(second.revision).toBe(1);
    expect(first.participants).toHaveLength(3);

    const added = first.participants.find((item) => item.kind === 'agent' && item.provider === 'codex')!;
    await expect(store.setPrimaryAgent(created.id, added.id, 0)).rejects.toMatchObject({ code: 'conflict' });
    const updated = await store.setPrimaryAgent(created.id, added.id, 1);
    expect(updated).toMatchObject({ revision: 2, primaryAgentId: added.id });

    const globalDirectory = await directory('codeai-global-store-');
    const singletonA = getConversationStore(globalDirectory);
    const singletonB = getConversationStore(globalDirectory);
    expect(singletonA).toBe(singletonB);
    vi.resetModules();
    const separatelyLoadedModule = await import('@/server/storage/conversationStore');
    expect(separatelyLoadedModule.getConversationStore(globalDirectory)).toBe(singletonA);
    expect(conversationStoreStatus(
      new separatelyLoadedModule.ConversationStoreError('conflict', 'stale bundle'),
    )).toBe(409);
    await singletonA.close();
    await store.close();
  });

  it('leaves the prior valid file intact when an atomic update fails before rename', async () => {
    const dataDir = await directory();
    let failThreadWrite = false;
    const store = new ConversationStore(dataDir, {
      beforeRename: (target) => {
        if (failThreadWrite && target.endsWith('.json') && target.includes(`${path.sep}threads${path.sep}`)) {
          throw new Error('injected rename failure');
        }
      },
    });
    const created = await store.createConversation({ provider: 'claude' });
    const filePath = path.join(dataDir, 'conversation-store-v1', 'threads', `${created.id}.json`);
    const before = await readFile(filePath, 'utf8');
    failThreadWrite = true;
    await expect(store.addAgent(created.id, 'codex', 'reviewer', crypto.randomUUID())).rejects.toThrow('injected');
    expect(await readFile(filePath, 'utf8')).toBe(before);
    expect((await store.getConversation(created.id)).revision).toBe(0);
    await store.close();
  });

  it('excludes a live second writer, recovers stale ownership, and protects the successor lock', async () => {
    const dataDir = await directory();
    const live = new ConversationStore(dataDir, { hostLabel: 'One', heartbeatMs: 60_000 });
    await live.host();
    const blocked = new ConversationStore(dataDir, { hostLabel: 'Two' });
    await expect(blocked.host()).rejects.toMatchObject({ code: 'locked' });

    const staleTime = new Date('2020-01-01T00:00:00.000Z');
    const futureTime = new Date('2021-01-01T00:00:00.000Z');
    await live.close();
    const stale = new ConversationStore(dataDir, { now: () => staleTime, heartbeatMs: 60_000 });
    await stale.host();
    const successor = new ConversationStore(dataDir, { now: () => futureTime, lockStaleMs: 1, heartbeatMs: 60_000 });
    await successor.host();
    await stale.close();
    expect(await readFile(path.join(dataDir, 'conversation-store-v1', 'writer.lock'), 'utf8')).toContain('2021-01-01');
    await successor.close();
  });

  it('fails closed when manifest identity is lost while thread files survive', async () => {
    const dataDir = await directory();
    const store = new ConversationStore(dataDir);
    const created = await store.createConversation({ provider: 'claude' });
    await store.close();
    const manifestPath = path.join(dataDir, 'conversation-store-v1', 'manifest.json');
    await unlink(manifestPath);

    const broken = new ConversationStore(dataDir);
    await expect(broken.getConversation(created.id)).rejects.toMatchObject({ code: 'corrupt' });
    await expect(readFile(manifestPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('accepts several humans, rejects none, and validates attachment uniqueness', async () => {
    const dataDir = await directory();
    const store = new ConversationStore(dataDir);
    const conversation = await store.createConversation({ checkoutId: 'checkout-a', provider: 'claude' });
    const twoHumans = structuredClone(conversation);
    twoHumans.participants.push({ id: 'second-human', kind: 'human', displayName: 'Colleague' });
    expect(durableConversationSchema.safeParse(twoHumans).success).toBe(true);
    const noHumans = structuredClone(conversation);
    noHumans.participants = noHumans.participants.filter((item) => item.kind !== 'human');
    expect(durableConversationSchema.safeParse(noHumans).success).toBe(false);
    const duplicateCheckout = structuredClone(conversation);
    duplicateCheckout.attachments.push({
      id: crypto.randomUUID(),
      hostId: duplicateCheckout.attachments[0].hostId,
      checkoutId: 'checkout-a',
      role: 'reference',
    });
    expect(durableConversationSchema.safeParse(duplicateCheckout).success).toBe(false);
    await store.close();
  });
});

describe('browser conversation helpers', () => {
  it('stores only the device checkout preference and never reads the legacy conversation key', () => {
    const storage = new MemoryStorage();
    storage.setItem('code-ai:web2:v1:checkout-a', '{"legacy":true}');
    expect(loadSelectedProjectId(storage)).toBeUndefined();
    saveSelectedProjectId('checkout-b', storage);
    expect(loadSelectedProjectId(storage)).toBe('checkout-b');
    expect(storage.getItem('code-ai:web2:v1:checkout-a')).toBe('{"legacy":true}');
  });

  it('hydrates server snapshots with ephemeral selection and exports no private state', async () => {
    const dataDir = await directory();
    const store = new ConversationStore(dataDir);
    const created = await store.createConversation({ provider: 'codex' });
    const snapshot = publicConversation(created);
    const hydrated = hydrateConversation(snapshot);
    expect(hydrated.addressedAgentId).toBe(snapshot.primaryAgentId);
    const exported = serializeThreadExport({ ...hydrated, defaultMode: 'agent' }, new Date().toISOString());
    expect(JSON.stringify(exported)).not.toMatch(/addressedAgentId|defaultMode.*agent-full|sessionId/);
    await store.close();
  });
});
