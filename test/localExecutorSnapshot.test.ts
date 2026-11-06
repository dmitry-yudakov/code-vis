import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConfig } from '@/server/config';
import { localExecutorSnapshot } from '@/server/machines/localExecutorSnapshot';
import { arenaSessionSummary, getSessionStore, type SessionStore } from '@/server/storage/sessionStore';
import type { DurableSession } from '@/shared/types';

vi.mock('@/server/agents/providerRegistry', () => ({
  cachedLocalProviderHealth: async () => ({
    claude: { available: true, authenticated: 'unknown', supportedModes: ['ask'] },
    codex: { available: true, authenticated: 'unknown', supportedModes: ['ask'] },
  }),
}));
vi.mock('@/server/repository/checkoutRegistry', () => ({
  getCheckoutRegistry: () => ({ list: async () => [{ id: 'checkout', name: 'Checkout', relativePath: '.' }] }),
}));
vi.mock('@/server/repository/managedWorktrees', async importOriginal => ({
  ...await importOriginal<typeof import('@/server/repository/managedWorktrees')>(),
  worktreeCapability: async () => ({ available: false }),
}));
vi.mock('@/server/execution/dockerRecovery', () => ({ recoverDockerExecution: async () => undefined }));

let store: SessionStore;

beforeEach(async () => {
  vi.stubEnv('CODEAI_DATA_DIR', await mkdtemp(path.join(os.tmpdir(), 'codeai-arena-poll-')));
  vi.stubEnv('CODEAI_REMOTE_ACCESS', 'local');
  store = getSessionStore(getConfig().dataDir);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await store.close();
});

describe('executor snapshot polling', () => {
  it('polls unchanged active and archived cards without reading histories, and delivers the next edit', async () => {
    const project = await store.createProject('Project', ['checkout']);
    const created = await store.createSession({ provider: 'claude', projectId: project.id });
    const active = (await store.appendUserMessage(created.id, {
      id: crypto.randomUUID(), role: 'user', authorId: created.participants.find(item => item.kind === 'human')!.id,
      addressedParticipantId: created.primaryAgentId, text: 'Keep the full saved prompt out of polling.',
      createdAt: created.createdAt, status: 'sent', diagramAttachments: [], mode: 'ask',
    })).session;
    const other = await store.createSession({ provider: 'codex' });
    const archived = await store.archiveSession(other.id, other.revision);
    const reader = store as unknown as { readSessionFile(file: string): Promise<DurableSession> };
    const read = vi.spyOn(reader, 'readSessionFile');
    const first = await localExecutorSnapshot();
    expect(first.sessions).toEqual([arenaSessionSummary(active)]);
    expect(first.archivedSessions).toEqual([arenaSessionSummary(archived)]);
    expect(first.recentCheckoutIds).toEqual(['checkout']);
    expect(read).toHaveBeenCalledTimes(2);
    read.mockClear();
    const polled = await Promise.all(Array.from({ length: 4 }, () => localExecutorSnapshot()));
    expect(polled).toEqual(Array(4).fill(first));
    expect(read).not.toHaveBeenCalled();
    const edited = await store.addAgent(active.id, 'codex', 'reviewer', crypto.randomUUID());
    read.mockClear();
    const next = await localExecutorSnapshot();
    expect(next.sessions).toEqual([arenaSessionSummary(edited)]);
    expect(next.archivedSessions).toEqual(first.archivedSessions);
    expect(read).toHaveBeenCalledTimes(1);
    // Both projections exclude private bindings and provider continuation, including on cache hits.
    expect(next.sessions[0]).not.toHaveProperty('repositories');
    expect(next.sessions[0]).not.toHaveProperty('participants');
  });
});
