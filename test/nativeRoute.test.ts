import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMode, DurableSession, SecurityLevel } from '@/shared/types';
const runs = vi.hoisted(() => [] as Array<{ mode: AgentMode; level: SecurityLevel }>);
const healthModes = vi.hoisted(() => [] as Array<AgentMode | undefined>);
const repository = vi.hoisted(() => ({ path: '' }));
vi.mock('@/server/repository/checkoutRegistry', () => ({ getCheckoutRegistry: () => ({
  resolve: async () => ({ id: 'checkout', name: 'fixture', relativePath: '.', realPath: repository.path }),
}) }));
vi.mock('@/server/agents/providerRegistry', () => ({ getProviderAdapters: (config: { securityLevel: SecurityLevel }, execution: string = 'local') => {
  const native = config.securityLevel === 'native' && execution === 'local';
  const adapter = (provider: string) => ({
    checkHealth: async (mode?: AgentMode) => { healthModes.push(mode); return { available: true, authenticated: true, supportedModes: native
      ? provider === 'claude' ? ['ask', 'plan', 'agent', 'edits', 'auto', 'full'] : ['ask', 'plan', 'agent', 'auto', 'full']
      : ['ask', 'plan', 'agent'] }; },
    createRunner: () => ({ run: async (input: { policy: { mode: AgentMode; level: SecurityLevel } }) => {
      runs.push({ mode: input.policy.mode, level: input.policy.level });
      return { finalText: 'Done.', sessionId: 'fixture-session', durationMs: 1, outputBytes: 5 };
    } }),
  });
  return { claude: adapter('claude'), codex: adapter('codex') };
} }));
import { POST } from '@/app/api/agent/message/route';
import { getSessionStore } from '@/server/storage/sessionStore';
import { durableSessionSchema } from '@/shared/sessionSchema';
const cached = globalThis as typeof globalThis & { __codeaiSecurityLevel?: SecurityLevel };
let dataDir: string;
let store: ReturnType<typeof getSessionStore>;
beforeEach(async () => {
  delete cached.__codeaiSecurityLevel; runs.length = 0; healthModes.length = 0;
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'codeai-native-route-'));
  repository.path = path.join(dataDir, 'checkout');
  await mkdir(repository.path); await writeFile(path.join(repository.path, 'package.json'), '{}');
  // Recovery scans stable, private fixture content rather than the concurrently tested app tree.
  const storeDirectory = path.join(dataDir, 'data');
  vi.stubEnv('CODEAI_DATA_DIR', storeDirectory); vi.stubEnv('CODEAI_SECURITY_LEVEL', 'native');
  store = getSessionStore(storeDirectory, 'fixture');
});
afterEach(async () => { await store.close(); await rm(dataDir, { recursive: true, force: true }); delete cached.__codeaiSecurityLevel; vi.unstubAllEnvs(); });
async function session(provider: 'claude' | 'codex' = 'claude', extra: { execution?: 'docker'; instructions?: 'isolated' } = {}) {
  const project = await store.createProject('Project', ['checkout']);
  return store.createSession({ projectId: project.id, provider, ...extra });
}
async function send(current: DurableSession, mode: unknown, extra = {}) {
  const response = await POST(new Request('http://localhost/api/agent/message', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: current.id, participantId: current.primaryAgentId, messageId: crypto.randomUUID(), text: 'Do it', diagramAttachments: [], mode, ...extra }),
  }));
  const body = await response.text(); return { status: response.status, body };
}
describe.sequential('Native messages and route boundaries', () => {
  it('upgrades on the first Native assistant message as well as a user message', async () => {
    const current = await session();
    const userId = crypto.randomUUID();
    await store.appendUserMessage(current.id, { id: userId, role: 'user', authorId: `${current.id}:human`,
      addressedParticipantId: current.primaryAgentId, text: 'Hello', createdAt: new Date().toISOString(),
      status: 'sending', diagramAttachments: [], mode: 'ask' });
    expect((await store.getSession(current.id)).version).toBe(4);
    const saved = await store.completeAssistantMessage(current.id, current.primaryAgentId, userId, {
      id: crypto.randomUUID(), role: 'assistant', authorId: current.primaryAgentId, createdAt: new Date().toISOString(),
      status: 'complete', rawMarkdown: 'Done', blocks: [], mode: 'agent', level: 'native',
    });
    expect(saved.version).toBe(9);
    expect(saved.messages.at(-1)?.level).toBe('native');
  });
  it.each(['agent', 'auto', 'edits', 'full'] as const)('records %s at format 9, with a level only where needed, and never downgrades', async (mode) => {
    const current = await session();
    expect((await send(current, mode)).status).toBe(200);
    const saved = await store.getSession(current.id);
    expect(saved.version).toBe(9);
    expect(saved.messages.map((message) => [message.role, message.mode, message.level])).toEqual([
      ['user', mode, mode === 'agent' || mode === 'auto' ? 'native' : undefined],
      ['assistant', mode, mode === 'agent' || mode === 'auto' ? 'native' : undefined],
    ]);
    expect(durableSessionSchema.safeParse(saved).success).toBe(true);
    expect(durableSessionSchema.safeParse({ ...saved, version: 8 }).success).toBe(false);
    const assistantOnly = { ...saved, version: 8, messages: saved.messages.filter((message) => message.role === 'assistant') };
    expect(durableSessionSchema.safeParse(assistantOnly).success).toBe(false);
    expect((await send(current, 'ask')).status).toBe(200);
    expect((await store.getSession(current.id)).version).toBe(9);
  });
  it('keeps ordinary read-only sessions at their old version and refuses a client-supplied level', async () => {
    const current = await session(); expect((await send(current, 'ask')).status).toBe(200);
    expect((await store.getSession(current.id)).version).toBe(4);
    expect((await send(current, 'full', { level: 'native' })).status).toBe(400);
    expect((await send(current, 'turbo')).status).toBe(400);
  });
  it('refuses extras in Guarded and Docker, and isolated Native Claude writing with the shared reason', async () => {
    const docker = await session('claude', { execution: 'docker' });
    for (const mode of ['edits', 'auto', 'full']) expect((await send(docker, mode)).status).toBe(409);
    const isolated = await session('claude', { instructions: 'isolated' });
    for (const mode of ['agent', 'edits', 'auto', 'full']) {
      const refused = await send(isolated, mode); expect(refused.status).toBe(409);
      expect(refused.body).toContain('This session runs without your global instructions, and Claude loads them itself in Native writing modes.');
    }
    expect((await send(isolated, 'ask')).status).toBe(200);
    delete cached.__codeaiSecurityLevel; vi.stubEnv('CODEAI_SECURITY_LEVEL', 'guarded');
    const guarded = await session();
    for (const mode of ['edits', 'full']) expect((await send(guarded, mode)).status).toBe(409);
  });
  it('does not apply Guarded Auto’s data-directory guard at Native', async () => {
    expect((await send(await session('codex'), 'auto')).status).toBe(200);
    expect(runs).toEqual([{ mode: 'auto', level: 'native' }]);
    expect(healthModes).toEqual(['auto']);
  });
  it('rejects levels on read-only messages and levels other than native', async () => {
    const current = await session(); await send(current, 'agent');
    const saved = await store.getSession(current.id);
    for (const patch of [{ mode: 'ask' }, { level: 'guarded' }, { mode: 'full' }]) {
      expect(durableSessionSchema.safeParse({ ...saved, messages: saved.messages.map((message) => ({ ...message, ...patch })) }).success).toBe(false);
    }
  });
});
