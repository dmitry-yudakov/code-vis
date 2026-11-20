import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import type { ExecutorSnapshot } from '@/shared/types';
const state = vi.hoisted(() => ({ publish: undefined as undefined | ((snapshot: ExecutorSnapshot) => void),
  releaseChoices: [] as Array<() => void>, stopped: false }));
vi.mock('@/server/workspace/workspaceFeed', () => ({ workspaceFeeds: () => ({ executor: {
  subscribe(receive: (snapshot: ExecutorSnapshot) => void) { state.publish = receive; return () => { state.stopped = true; }; },
} }) }));
vi.mock('@/server/agents/providerRegistry', () => ({ getProviderAdapters: () => {
  const checkHealth = () => new Promise(resolve => state.releaseChoices.push(() => resolve({ available: true, authenticated: true, supportedModes: ['ask'] })));
  return { claude: { checkHealth }, codex: { checkHealth } };
} }));
import { bridgeSubscription } from '@/server/integrations/mcp/bridge';
import { getConfig } from '@/server/config';
import { getSessionStore } from '@/server/storage/sessionStore';
import { provisionGrant } from '@/server/integrations/mcp/grants';

it('delivers completed headers during sustained invalidations while coalescing the next snapshot', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codeai-mcp-pressure-'));
  vi.stubEnv('CODEAI_DATA_DIR', path.join(root, 'data')); vi.stubEnv('CODEAI_REPOSITORIES_ROOT', path.join(root, 'repos'));
  vi.stubEnv('CODEAI_WORKTREES_ROOT', path.join(root, 'worktrees')); vi.stubEnv('CODEAI_REMOTE_ACCESS', 'local'); vi.stubEnv('CODEAI_MCP_ORIGIN', 'http://127.0.0.1:3023');
  const config = getConfig(); const store = getSessionStore(config.dataDir); const machine = await store.host();
  const grant = await provisionGrant(config, 'Pressure'); const connection = JSON.parse(await readFile(grant.connectionPath, 'utf8'));
  const request = new Request('http://127.0.0.1:3023/api/integrations/mcp', { headers: { Host: '127.0.0.1:3023', Origin: 'http://127.0.0.1:3023',
    Authorization: `CodeAI-MCP ${connection.credential}`, 'x-codeai-machine-id': machine.id, 'x-codeai-grant-id': connection.grantId } });
  const response = await bridgeSubscription(request); const reader = response.body!.getReader();
  const snapshot = { machine, projects: [], sessions: [], archivedSessions: [], providers: {}, runs: { active: [], recent: [] } } as unknown as ExecutorSnapshot;
  try {
    state.publish!(snapshot); const first = reader.read();
    expect(state.releaseChoices).toHaveLength(2);
    for (let i = 0; i < 100; i++) state.publish!({ ...snapshot, machine: { ...machine, label: `Changed ${i}` } });
    state.releaseChoices.splice(0).forEach(release => release());
    const frame = await Promise.race([first, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Workspace delivery starved behind newer snapshots')), 500))]);
    expect(new TextDecoder().decode(frame.value)).toContain(machine.label);
    expect(state.releaseChoices).toHaveLength(2);
    state.publish!({ ...snapshot, machine: { ...machine, label: 'Newest' } });
    const second = reader.read(); state.releaseChoices.splice(0).forEach(release => release());
    expect(new TextDecoder().decode((await second).value)).toContain('Changed 99');
    state.releaseChoices.splice(0).forEach(release => release());
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('Newest');
  } finally {
    await reader.cancel(); reader.releaseLock(); state.releaseChoices.splice(0).forEach(release => release());
    expect(state.stopped).toBe(true); await store.close(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true });
  }
});
