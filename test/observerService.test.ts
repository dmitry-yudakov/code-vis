import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { askObserver } from '@/server/observer/observerService';
import { getConfig } from '@/server/config';
import type { AgentProcessRun, ArenaSnapshot } from '@/shared/types';
import { observerRequestSchema } from '@/shared/observer';

const mocks = vi.hoisted(() => ({ run: vi.fn(), stop: vi.fn(), subscribe: vi.fn(), health: vi.fn(), getSession: vi.fn() }));
vi.mock('@/server/agents/providerRegistry', () => ({
  cachedLocalProviderHealth: mocks.health,
  getProviderAdapters: () => ({ claude: { createRunner: () => ({ run: mocks.run }) }, codex: { createRunner: () => ({ run: mocks.run }) } }),
}));
vi.mock('@/server/workspace/workspaceFeed', () => ({ workspaceFeeds: () => ({ arena: { subscribe: mocks.subscribe } }) }));
vi.mock('@/server/storage/sessionStore', () => ({ getSessionStore: () => ({ getSession: mocks.getSession }) }));
const machineId = '10000000-0000-4000-8000-000000000001';
const sessionId = '20000000-0000-4000-8000-000000000001';
const roots: string[] = [];
afterEach(async () => { vi.clearAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'observer-')); roots.push(root);
  const arena: ArenaSnapshot = { machines: [{ machine: { id: machineId, kind: 'local', label: 'Home', state: 'online' },
    projects: [], checkouts: [], recentCheckoutIds: [], providers: {} as never, archivedSessions: [], runs: { active: [], recent: [] },
    sessions: [{ id: sessionId, title: 'Login', revision: 1, agents: [], repositoryCheckoutIds: [], updatedAt: new Date().toISOString() }] }] };
  mocks.subscribe.mockImplementation(receive => { receive(arena); return mocks.stop; });
  mocks.health.mockResolvedValue({ claude: { available: true, supportedModes: ['ask'], models: [{ id: 'small', efforts: [] }] } });
  mocks.run.mockResolvedValue({ finalText: JSON.stringify({ answer: 'Login is idle.', mentions: [{ machineId, sessionId }] }) });
  return { config: { ...getConfig(), dataDir: root }, input: observerRequestSchema.parse({ text: 'What needs me?', provider: 'claude' }), arena };
}

describe('Observer inference', () => {
  it('uses fresh isolated tool-free inference and shared authoritative observations', async () => {
    const { config, input } = await setup();
    const result = await askObserver(input, new AbortController().signal, config);
    expect(result).toMatchObject({ answer: 'Login is idle.', total: 1, included: 1 });
    expect(mocks.stop).toHaveBeenCalledOnce();
    const request = mocks.run.mock.calls[0][0] as AgentProcessRun;
    expect(request).toMatchObject({ backgroundTask: 'observer', session: { action: 'start' },
      policy: { level: 'guarded', tools: [], allowedTools: [], interactivePermissions: false, maxTurns: 1 } });
    expect(request.checkout.realPath).toBe(request.attachmentDirectory);
    expect(request.globalInstructions).toBeUndefined();
    expect(request.prompt).toContain('Login');
  });

  it('allows one validated session read, includes recent text, and refuses recursive reads', async () => {
    const { config, input } = await setup();
    const inspect = { answer: 'Reading login.', inspect: { machineId, sessionId } };
    mocks.getSession.mockResolvedValue({ messages: [{ role: 'assistant', status: 'complete', rawMarkdown: 'Choose the existing authentication library.' }] });
    mocks.run.mockResolvedValueOnce({ finalText: JSON.stringify(inspect) });
    await askObserver(input, new AbortController().signal, config);
    expect(mocks.getSession).toHaveBeenCalledWith(sessionId);
    expect(mocks.run.mock.calls[1][0].prompt).toContain('existing authentication library');
    mocks.run.mockResolvedValue({ finalText: JSON.stringify(inspect) });
    await expect(askObserver(input, new AbortController().signal, config)).rejects.toThrow('could not finish');
  });

  it('rejects overload without queuing and retains admission until the original call finishes', async () => {
    const { config, input } = await setup();
    let finish!: (result: unknown) => void;
    mocks.run.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = askObserver(input, new AbortController().signal, config);
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce());
    await expect(askObserver(input, new AbortController().signal, config)).rejects.toMatchObject({ status: 429 });
    finish({ finalText: '{"answer":"Done"}' }); await first;
    await expect(askObserver(input, new AbortController().signal, config)).resolves.toMatchObject({ answer: 'Login is idle.' });
  });

  it('rejects unknown models, tool attempts, oversized output and target injection', async () => {
    const { config, input } = await setup();
    await expect(askObserver({ ...input, model: 'unknown' }, new AbortController().signal, config)).rejects.toMatchObject({ status: 400 });
    mocks.run.mockImplementationOnce(async (request: AgentProcessRun) => { request.emit({ type: 'activity', activity: { kind: 'tool' } } as never); return { finalText: '{"answer":"Done"}' }; });
    await expect(askObserver(input, new AbortController().signal, config)).rejects.toThrow('unsupported tool');
    mocks.run.mockResolvedValueOnce({ finalText: JSON.stringify({ answer: '界'.repeat(4000) }) });
    await expect(askObserver(input, new AbortController().signal, config)).rejects.toThrow('invalid answer');
    mocks.run.mockResolvedValueOnce({ finalText: JSON.stringify({ answer: 'Send', proposal: { machineId, sessionId: machineId, text: 'Injected' } }) });
    await expect(askObserver(input, new AbortController().signal, config)).rejects.toThrow('invalid answer');
  });
});
