import {
  mkdir, mkdtemp, readFile, stat, unlink, writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  arenaSessionSummary, SessionStore, sessionStoreStatus, getSessionStore, publicSession, serverAgent,
} from '@/server/storage/sessionStore';
import { durableSessionSchema } from '@/shared/sessionSchema';
import {
  getArtifacts, hydrateSession, loadSelectedCheckoutId, saveSelectedCheckoutId, serializeSessionExport,
} from '@/features/conversation/sessionStore';
import type { AssistantMessage, DurableSession, UserMessage } from '@/shared/types';

const LEGACY_RECORDS_DIRECTORY = ['th', 'reads'].join('');
const LEGACY_CONTAINER_ID_KEY = ['th', 'readId'].join('');

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

async function directory(prefix = 'codeai-sessions-'): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

function durableFixture(id: string, hostId: string, title = 'Migrated session'): DurableSession {
  const now = '2026-08-29T10:00:00.000Z';
  const humanId = `${id}:human`;
  const agentId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const assistantId = crypto.randomUUID();
  const diagramId = crypto.randomUUID();
  const sketchId = crypto.randomUUID();
  return durableSessionSchema.parse({
    version: 3,
    revision: 9,
    id,
    title,
    repositories: [{ id: crypto.randomUUID(), hostId, checkoutId: 'checkout-a', role: 'primary' }],
    createdAt: now,
    updatedAt: now,
    participants: [
      { id: humanId, kind: 'human', displayName: 'You' },
      {
        id: agentId,
        kind: 'agent',
        displayName: 'Claude',
        provider: 'claude',
        role: 'coder',
        defaultMode: 'plan',
        session: { provider: 'claude', started: true, sessionId: 'provider-session', hostId },
        lastObservedMessageId: assistantId,
      },
    ],
    primaryAgentId: agentId,
    messages: [
      {
        id: userId,
        role: 'user',
        authorId: humanId,
        addressedParticipantId: agentId,
        text: 'Map it.',
        createdAt: now,
        status: 'sent',
        diagramAttachments: [],
        mode: 'ask',
      },
      {
        id: assistantId,
        role: 'assistant',
        authorId: agentId,
        createdAt: now,
        status: 'complete',
        rawMarkdown: 'Mapped.',
        blocks: [{
          kind: 'diagram',
          artifact: {
            id: diagramId,
            sessionId: id,
            messageId: assistantId,
            ordinal: 1,
            source: 'flowchart LR\n  A-->B',
            createdAt: now,
            status: 'ready',
            derivedFromDiagramIds: [],
            evidence: [],
          },
        }],
        mode: 'ask',
      },
    ],
    pinnedDiagramIds: [diagramId, sketchId],
    annotations: {
      [diagramId]: { version: 1, diagramId, marks: [], updatedAt: now },
      [sketchId]: { version: 1, diagramId: sketchId, marks: [], updatedAt: now },
    },
    sketches: [{ id: sketchId, sessionId: id, ordinal: 1, createdAt: now, viewBox: [0, 0, 1_600, 1_000] }],
  }) as DurableSession;
}

function legacyRecord(session: DurableSession): Record<string, unknown> {
  const legacy = structuredClone(session) as unknown as Record<string, unknown>;
  legacy.version = 1;
  legacy.attachments = legacy.repositories;
  delete legacy.repositories;
  delete legacy.projectId;
  legacy.sketches = (legacy.sketches as Array<Record<string, unknown>>).map((sketch) => {
    const result = { ...sketch, [LEGACY_CONTAINER_ID_KEY]: sketch.sessionId };
    delete result.sessionId;
    return result;
  });
  legacy.messages = (legacy.messages as Array<Record<string, unknown>>).map((message) => {
    if (message.role !== 'assistant') return message;
    return {
      ...message,
      blocks: (message.blocks as Array<Record<string, unknown>>).map((block) => {
        if (block.kind !== 'diagram') return block;
        const artifact = { ...(block.artifact as Record<string, unknown>) };
        artifact[LEGACY_CONTAINER_ID_KEY] = artifact.sessionId;
        delete artifact.sessionId;
        return { ...block, artifact };
      }),
    };
  });
  return legacy;
}

async function seedLegacyStore(
  dataDir: string,
  host: { id: string; label: string },
  sessions: DurableSession[],
): Promise<Map<string, string>> {
  const root = path.join(dataDir, 'conversation-store-v1');
  const records = path.join(root, LEGACY_RECORDS_DIRECTORY);
  await mkdir(records, { recursive: true });
  const contents = new Map<string, string>();
  const manifest = `${JSON.stringify({ version: 1, host }, null, 2)}\n`;
  await writeFile(path.join(root, 'manifest.json'), manifest);
  contents.set('manifest.json', manifest);
  for (const session of sessions) {
    const value = `${JSON.stringify(legacyRecord(session), null, 2)}\n`;
    const name = `${session.id}.json`;
    await writeFile(path.join(records, name), value);
    contents.set(name, value);
  }
  return contents;
}

function previousRecord(session: DurableSession): Record<string, unknown> {
  const previous = structuredClone(session) as unknown as Record<string, unknown>;
  previous.version = 2;
  previous.attachments = previous.repositories;
  delete previous.repositories;
  delete previous.projectId;
  return previous;
}

async function seedPreviousStore(
  dataDir: string,
  host: { id: string; label: string },
  sessions: DurableSession[],
): Promise<Map<string, string>> {
  const root = path.join(dataDir, 'session-store-v1');
  const records = path.join(root, 'sessions');
  await mkdir(records, { recursive: true });
  const contents = new Map<string, string>();
  const manifest = `${JSON.stringify({ version: 1, host }, null, 2)}\n`;
  await writeFile(path.join(root, 'manifest.json'), manifest);
  contents.set('manifest.json', manifest);
  for (const session of sessions) {
    const value = `${JSON.stringify(previousRecord(session), null, 2)}\n`;
    const name = `${session.id}.json`;
    await writeFile(path.join(records, name), value);
    contents.set(name, value);
  }
  return contents;
}

function userMessage(sessionId: string, humanId: string, agentId: string, text = 'Explain this.'): UserMessage {
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

describe('host-owned session store', () => {
  it('projects a bounded Arena summary without transcript artifacts or private provider handles', () => {
    const session = durableFixture(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    );
    session.messages[1] = {
      ...session.messages[1],
      rawMarkdown: `Latest result\n\n${'private detail '.repeat(40)}`,
    } as AssistantMessage;
    const summary = arenaSessionSummary(session);
    expect(summary).toMatchObject({
      id: session.id,
      repositoryCheckoutIds: ['checkout-a'],
      agents: [{ displayName: 'Claude', provider: 'claude', role: 'coder' }],
      lastActivity: { status: 'complete' },
    });
    expect(JSON.stringify(summary)).not.toContain('Latest result private detail');
    expect(JSON.stringify(summary)).not.toContain('provider-session');
    expect(JSON.stringify(summary)).not.toContain('flowchart');
    expect(JSON.stringify(summary)).not.toContain('lastObservedMessageId');
  });

  it('creates a fresh private store, keeps its host identity, and leaves older prototype records unread', async () => {
    const dataDir = await directory();
    const legacyPath = path.join(dataDir, 'sessions.json');
    const legacy = '{"version":3,"sessions":[{"legacy":true}]}';
    await writeFile(legacyPath, legacy);

    const first = new SessionStore(dataDir, { hostLabel: 'Laptop' });
    const project = await first.createProject('Demo', ['checkout-a']);
    const created = await first.createSession({ projectId: project.id, provider: 'codex' });
    const host = await first.host();
    expect(host.label).toBe('Laptop');
    expect(created).toMatchObject({
      version: 3,
      revision: 0,
      projectId: project.id,
      repositories: [{ hostId: host.id, checkoutId: 'checkout-a', role: 'primary' }],
    });
    expect((await first.listSessions()).map((item) => item.id)).toEqual([created.id]);
    expect(await readFile(legacyPath, 'utf8')).toBe(legacy);

    const root = path.join(dataDir, 'session-store-v2');
    const sessionPath = path.join(root, 'sessions', `${created.id}.json`);
    expect((await stat(root)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(root, 'sessions'))).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(root, 'projects'))).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(root, 'manifest.json'))).mode & 0o777).toBe(0o600);
    expect((await stat(sessionPath)).mode & 0o777).toBe(0o600);
    await first.close();

    const reopened = new SessionStore(dataDir, { hostLabel: 'Environment changed' });
    expect(await reopened.host()).toEqual(host);
    expect(await reopened.getSession(created.id)).toEqual(created);
    await reopened.close();
  });

  it('copies a valid legacy store once with every durable field and host identity intact', async () => {
    const dataDir = await directory();
    const host = { id: crypto.randomUUID(), label: 'Original host' };
    const expected = durableFixture('11111111-1111-4111-8111-111111111111', host.id);
    const original = await seedLegacyStore(dataDir, host, [expected]);
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const first = new SessionStore(dataDir, { hostLabel: 'Changed label' });
    expect(await first.host()).toEqual(host);
    expect(await first.getSession(expected.id)).toEqual(expected);
    await first.close();

    const legacyRoot = path.join(dataDir, 'conversation-store-v1');
    expect(await readFile(path.join(legacyRoot, 'manifest.json'), 'utf8')).toBe(original.get('manifest.json'));
    expect(await readFile(path.join(legacyRoot, LEGACY_RECORDS_DIRECTORY, `${expected.id}.json`), 'utf8'))
      .toBe(original.get(`${expected.id}.json`));

    const reopened = new SessionStore(dataDir);
    expect(await reopened.getSession(expected.id)).toEqual(expected);
    await reopened.close();
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it('copies session-store-v1 to v2 once, preserving ids, revisions, content, and the rollback store', async () => {
    const dataDir = await directory();
    const host = { id: crypto.randomUUID(), label: 'Existing host' };
    const expected = durableFixture('33333333-3333-4333-8333-333333333333', host.id);
    const original = await seedPreviousStore(dataDir, host, [expected]);

    const store = new SessionStore(dataDir);
    expect(await store.host()).toEqual(host);
    expect(await store.getSession(expected.id)).toEqual(expected);
    expect(await store.listProjects()).toEqual([]);
    await store.close();

    const previousRoot = path.join(dataDir, 'session-store-v1');
    expect(await readFile(path.join(previousRoot, 'manifest.json'), 'utf8')).toBe(original.get('manifest.json'));
    expect(await readFile(path.join(previousRoot, 'sessions', `${expected.id}.json`), 'utf8'))
      .toBe(original.get(`${expected.id}.json`));
  });

  it('manages durable projects and revisioned session repositories without deleting sessions', async () => {
    const dataDir = await directory();
    const store = new SessionStore(dataDir, { hostLabel: 'Host' });
    let project = await store.createProject('Workspace', ['checkout-a', 'checkout-b']);
    const created = await store.createSession({ projectId: project.id, provider: 'claude' });
    expect(created.repositories).toEqual(project.repositories);
    expect((await store.listSessions({ projectId: project.id })).map((item) => item.id)).toEqual([created.id]);

    project = await store.updateProject(project.id, { expectedRevision: 0, name: 'Renamed workspace' });
    expect(project).toMatchObject({ revision: 1, name: 'Renamed workspace' });
    await expect(store.updateProject(project.id, { expectedRevision: 0, name: 'Stale' }))
      .rejects.toMatchObject({ code: 'conflict' });

    const unknown = {
      id: crypto.randomUUID(),
      hostId: (await store.host()).id,
      checkoutId: 'checkout-c',
      role: 'primary' as const,
    };
    const repositories = [unknown, { ...created.repositories[1], role: 'reference' as const }];
    const updated = await store.setSessionRepositories(created.id, repositories, created.revision);
    expect(updated).toMatchObject({ revision: 1, repositories });
    project = await store.getProject(project.id);
    expect(project.repositories.some((repository) => repository.checkoutId === 'checkout-c')).toBe(true);

    project = await store.updateProject(project.id, {
      expectedRevision: project.revision,
      repositories: project.repositories.filter((repository) => repository.checkoutId !== 'checkout-c'),
    });
    const unchanged = await store.setSessionRepositories(updated.id, repositories, updated.revision);
    expect(unchanged).toMatchObject({ revision: updated.revision, repositories });
    project = await store.getProject(project.id);
    expect(project.repositories.some((repository) => repository.checkoutId === 'checkout-c')).toBe(true);

    await expect(store.setSessionRepositories(created.id, [], created.revision))
      .rejects.toMatchObject({ code: 'conflict' });

    const result = await store.deleteProject(project.id, project.revision);
    expect(result).toEqual({ detachedSessionCount: 1 });
    const loose = await store.getSession(created.id);
    expect(loose.projectId).toBeUndefined();
    expect(loose.repositories).toEqual(repositories);
    expect((await store.listSessions({ loose: true })).map((item) => item.id)).toContain(created.id);
    await store.close();
  });

  it('aborts an invalid legacy upgrade by name without leaving a partial v2 store', async () => {
    const dataDir = await directory();
    const host = { id: crypto.randomUUID(), label: 'Original host' };
    const valid = durableFixture('11111111-1111-4111-8111-111111111111', host.id);
    const invalid = durableFixture('22222222-2222-4222-8222-222222222222', host.id, 'Invalid');
    const original = await seedLegacyStore(dataDir, host, [valid, invalid]);
    const invalidPath = path.join(dataDir, 'conversation-store-v1', LEGACY_RECORDS_DIRECTORY, `${invalid.id}.json`);
    const broken = JSON.parse(await readFile(invalidPath, 'utf8')) as Record<string, unknown>;
    broken.title = '';
    const brokenContents = `${JSON.stringify(broken, null, 2)}\n`;
    await writeFile(invalidPath, brokenContents);

    const store = new SessionStore(dataDir);
    await expect(store.host()).rejects.toThrow(`${invalid.id}.json`);
    await expect(stat(path.join(dataDir, 'session-store-v2'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(dataDir, 'conversation-store-v1', 'manifest.json'), 'utf8'))
      .toBe(original.get('manifest.json'));
    expect(await readFile(invalidPath, 'utf8')).toBe(brokenContents);
  });

  it('persists complete content with idempotent appends and atomic assistant/cursor completion', async () => {
    const dataDir = await directory();
    const store = new SessionStore(dataDir, { hostLabel: 'Host' });
    let session = await store.createSession({ provider: 'claude' });
    const human = session.participants.find((item) => item.kind === 'human')!;
    const agent = serverAgent(session, session.primaryAgentId)!;
    const user = userMessage(session.id, human.id, agent.id);

    const accepted = await store.appendUserMessage(session.id, user);
    session = accepted.session;
    expect(accepted.appended).toBe(true);
    expect(session.revision).toBe(1);
    const retried = await store.appendUserMessage(session.id, user);
    expect(retried).toMatchObject({ appended: false, session: { revision: 1 } });

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
    session = await store.completeAssistantMessage(session.id, agent.id, user.id, assistant);
    expect(session.revision).toBe(2);
    expect(session.messages).toMatchObject([{ status: 'sent' }, { id: assistant.id, rawMarkdown: 'Done.' }]);
    expect(serverAgent(session, agent.id)?.lastObservedMessageId).toBe(assistant.id);
    expect((await store.completeAssistantMessage(session.id, agent.id, user.id, assistant)).revision).toBe(2);

    await store.markProviderSessionStarted(session.id, agent.id, 'claude', 'provider-session');
    const privateRecord = await store.getSession(session.id);
    expect(serverAgent(privateRecord, agent.id)?.session).toMatchObject({
      started: true, sessionId: 'provider-session', hostId: (await store.host()).id,
    });
    const publicRecord = publicSession(privateRecord);
    expect(JSON.stringify(publicRecord)).not.toMatch(/provider-session|lastObservedMessageId|creationRequestId/);
    expect(durableSessionSchema.parse(privateRecord)).toEqual(privateRecord);
    await store.close();
  });

  it('serializes operation-level writes, detects revision conflicts, and keeps retries independent', async () => {
    const dataDir = await directory();
    const store = new SessionStore(dataDir);
    const created = await store.createSession({ provider: 'claude' });
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
    const singletonA = getSessionStore(globalDirectory);
    const singletonB = getSessionStore(globalDirectory);
    expect(singletonA).toBe(singletonB);
    vi.resetModules();
    const separatelyLoadedModule = await import('@/server/storage/sessionStore');
    expect(separatelyLoadedModule.getSessionStore(globalDirectory)).toBe(singletonA);
    expect(sessionStoreStatus(
      new separatelyLoadedModule.SessionStoreError('conflict', 'stale bundle'),
    )).toBe(409);
    await singletonA.close();
    await store.close();
  });

  it('leaves the prior valid file intact when an atomic update fails before rename', async () => {
    const dataDir = await directory();
    let failSessionWrite = false;
    const store = new SessionStore(dataDir, {
      beforeRename: (target) => {
        if (failSessionWrite && target.endsWith('.json') && target.includes(`${path.sep}sessions${path.sep}`)) {
          throw new Error('injected rename failure');
        }
      },
    });
    const created = await store.createSession({ provider: 'claude' });
    const filePath = path.join(dataDir, 'session-store-v2', 'sessions', `${created.id}.json`);
    const before = await readFile(filePath, 'utf8');
    failSessionWrite = true;
    await expect(store.addAgent(created.id, 'codex', 'reviewer', crypto.randomUUID())).rejects.toThrow('injected');
    expect(await readFile(filePath, 'utf8')).toBe(before);
    expect((await store.getSession(created.id)).revision).toBe(0);
    await store.close();
  });

  it('excludes a live second writer, recovers stale ownership, and protects the successor lock', async () => {
    const dataDir = await directory();
    const live = new SessionStore(dataDir, { hostLabel: 'One', heartbeatMs: 60_000 });
    await live.host();
    const blocked = new SessionStore(dataDir, { hostLabel: 'Two' });
    await expect(blocked.host()).rejects.toMatchObject({ code: 'locked' });

    const staleTime = new Date('2020-01-01T00:00:00.000Z');
    const futureTime = new Date('2021-01-01T00:00:00.000Z');
    await live.close();
    const stale = new SessionStore(dataDir, { now: () => staleTime, heartbeatMs: 60_000 });
    await stale.host();
    const successor = new SessionStore(dataDir, { now: () => futureTime, lockStaleMs: 1, heartbeatMs: 60_000 });
    await successor.host();
    await stale.close();
    expect(await readFile(path.join(dataDir, 'session-store-v2', 'writer.lock'), 'utf8')).toContain('2021-01-01');
    await successor.close();
  });

  it('fails closed when manifest identity is lost while session files survive', async () => {
    const dataDir = await directory();
    const store = new SessionStore(dataDir);
    const created = await store.createSession({ provider: 'claude' });
    await store.close();
    const manifestPath = path.join(dataDir, 'session-store-v2', 'manifest.json');
    await unlink(manifestPath);

    const broken = new SessionStore(dataDir);
    await expect(broken.getSession(created.id)).rejects.toMatchObject({ code: 'corrupt' });
    await expect(readFile(manifestPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('accepts several humans, rejects none, and validates repository uniqueness', async () => {
    const dataDir = await directory();
    const store = new SessionStore(dataDir);
    const project = await store.createProject('Demo', ['checkout-a']);
    const session = await store.createSession({ projectId: project.id, provider: 'claude' });
    const twoHumans = structuredClone(session);
    twoHumans.participants.push({ id: 'second-human', kind: 'human', displayName: 'Colleague' });
    expect(durableSessionSchema.safeParse(twoHumans).success).toBe(true);
    const noHumans = structuredClone(session);
    noHumans.participants = noHumans.participants.filter((item) => item.kind !== 'human');
    expect(durableSessionSchema.safeParse(noHumans).success).toBe(false);
    const duplicateCheckout = structuredClone(session);
    duplicateCheckout.repositories.push({
      id: crypto.randomUUID(),
      hostId: duplicateCheckout.repositories[0].hostId,
      checkoutId: 'checkout-a',
      role: 'reference',
    });
    expect(durableSessionSchema.safeParse(duplicateCheckout).success).toBe(false);
    await store.close();
  });
});

describe('browser session helpers', () => {
  it('stores only the device checkout preference and never reads the legacy browser key', () => {
    const storage = new MemoryStorage();
    storage.setItem('code-ai:web2:v1:checkout-a', '{"legacy":true}');
    expect(loadSelectedCheckoutId(storage)).toBeUndefined();
    saveSelectedCheckoutId('checkout-b', storage);
    expect(loadSelectedCheckoutId(storage)).toBe('checkout-b');
    expect(storage.getItem('code-ai:web2:v1:checkout-a')).toBe('{"legacy":true}');
  });

  it('hydrates server snapshots with ephemeral selection and exports no private state', async () => {
    const dataDir = await directory();
    const store = new SessionStore(dataDir);
    const created = await store.createSession({ provider: 'codex' });
    const snapshot = publicSession(created);
    const hydrated = hydrateSession(snapshot);
    expect(hydrated.addressedAgentId).toBe(snapshot.primaryAgentId);
    const exported = serializeSessionExport({ ...hydrated, defaultMode: 'agent' }, new Date().toISOString());
    expect(exported).toMatchObject({ version: 4, session: { id: created.id } });
    expect(JSON.stringify(exported)).not.toMatch(/addressedAgentId|defaultMode.*agent-full|sessionId/);
    await store.close();
  });

  it('keeps fresher in-memory selection ahead of an older device snapshot on refresh', async () => {
    const dataDir = await directory();
    const store = new SessionStore(dataDir);
    const created = await store.createSession({ provider: 'claude' });
    const withReviewer = await store.addAgent(created.id, 'codex', 'reviewer', crypto.randomUUID());
    const fixture = durableFixture(created.id, crypto.randomUUID());
    fixture.participants.push(withReviewer.participants.find((participant) => (
      participant.kind === 'agent' && participant.id !== withReviewer.primaryAgentId
    ))!);
    const snapshot = publicSession(fixture);
    const diagramId = getArtifacts(snapshot)[0].id;
    const sketchId = snapshot.sketches[0].id;
    const reviewerId = snapshot.participants.find((participant) => (
      participant.kind === 'agent' && participant.id !== snapshot.primaryAgentId
    ))!.id;
    const prior = {
      ...hydrateSession(snapshot),
      activeDiagramId: sketchId,
      addressedAgentId: reviewerId,
      defaultMode: 'agent' as const,
    };
    const hydrated = hydrateSession(snapshot, prior, {
      activeDiagramId: diagramId,
      addressedAgentId: snapshot.primaryAgentId,
      defaultMode: 'ask',
    });
    expect(hydrated).toMatchObject({
      activeDiagramId: sketchId,
      addressedAgentId: reviewerId,
      defaultMode: 'agent',
    });
    await store.close();
  });
});
