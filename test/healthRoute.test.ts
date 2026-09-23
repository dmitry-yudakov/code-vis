import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const docker = vi.hoisted(() => ({ interrupted: [] as string[] }));
vi.mock('@/server/execution/dockerRuntime', () => ({
  getDockerRuntime: () => ({
    health: async () => ({ available: false, authenticated: 'unknown', supportedModes: [], message: 'Docker is disabled.' }),
    reconcile: async () => docker.interrupted,
  }),
}));

import { GET } from '@/app/api/health/route';
import { SessionStore, getSessionStore } from '@/server/storage/sessionStore';

async function health(): Promise<{ newerFormatSessions: number; message?: string }> {
  const response = await GET(new Request('http://localhost:3023/api/health'));
  expect(response.status).toBe(200);
  return response.json();
}

async function writeNewerFormatSession(dataDir: string, storage: 'sessions' | 'archived-sessions'): Promise<string> {
  const id = crypto.randomUUID();
  await writeFile(path.join(dataDir, 'session-store-v2', storage, `${id}.json`), JSON.stringify({ version: 99, id }));
  return id;
}

describe('health and sessions written by a newer CodeAI', () => {
  let dataDir: string;
  let seeded: SessionStore;
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'codeai-health-'));
    docker.interrupted = [];
    vi.stubEnv('CODEAI_DATA_DIR', dataDir);
    vi.stubEnv('CODEAI_REMOTE_ACCESS', 'local');
    vi.stubEnv('CODEAI_REPOSITORIES_ROOT', process.cwd());
    vi.stubEnv('CODEAI_CLAUDE_BIN', path.resolve('test/fixtures/fake-claude.mjs'));
    vi.stubEnv('CODEAI_CODEX_BIN', path.resolve('test/fixtures/not-a-real-codex'));
    seeded = new SessionStore(dataDir, { hostLabel: 'Health host' });
  });
  afterEach(async () => {
    await getSessionStore(dataDir).close();
    vi.unstubAllEnvs();
  });

  it('offers Docker Codex the recorded worker’s own models, even without a local Codex', async () => {
    const image = `sha256:${'a'.repeat(64)}`;
    const codexModels = { models: [{ id: 'gpt-worker', label: 'GPT Worker', efforts: ['low'] }], efforts: ['low'] };
    await mkdir(path.join(dataDir, 'docker'), { recursive: true });
    await writeFile(path.join(dataDir, 'docker', 'profile.json'), JSON.stringify({ profile: 'codeai-docker-v1', image, engineId: 'engine' }));
    await writeFile(path.join(dataDir, 'docker', 'versions.json'), JSON.stringify({ image, claude: '2.1.280', codex: '0.156.1', previous: {}, codexModels }));
    const body = await health() as unknown as { providers: { codex: object }; executions: { docker: { providers: { codex: object } } } };
    expect(body.executions.docker.providers.codex).toMatchObject(codexModels);
    expect(body.providers.codex).not.toHaveProperty('models');
  });

  it('counts newer-format sessions in active and archived storage, and reports zero without them', async () => {
    await seeded.createSession({ provider: 'claude' });
    await seeded.close();
    expect((await health()).newerFormatSessions).toBe(0);
    await getSessionStore(dataDir).close();

    await writeNewerFormatSession(dataDir, 'sessions');
    await writeNewerFormatSession(dataDir, 'archived-sessions');
    expect((await health()).newerFormatSessions).toBe(2);
  });

  it('finishes Docker recovery for readable sessions and keeps a newer session recorded for its own build', async () => {
    const session = await seeded.createSession({ provider: 'claude' });
    const human = session.participants.find((participant) => participant.kind === 'human')!;
    const message = {
      id: crypto.randomUUID(), role: 'user' as const, authorId: human.id, addressedParticipantId: session.primaryAgentId,
      text: 'Interrupted', createdAt: new Date().toISOString(), status: 'sending' as const, diagramAttachments: [], mode: 'ask' as const,
    };
    await seeded.appendUserMessage(session.id, message);
    await seeded.close();
    const newerId = await writeNewerFormatSession(dataDir, 'sessions');
    const interruptedPath = path.join(dataDir, 'docker', 'interrupted.json');
    docker.interrupted = [session.id, newerId];
    await mkdir(path.dirname(interruptedPath), { recursive: true });
    await writeFile(interruptedPath, JSON.stringify(docker.interrupted));

    const report = await health();
    expect(report.message).toBeUndefined();
    expect(report.newerFormatSessions).toBe(1);
    expect((await getSessionStore(dataDir).getSession(session.id)).messages[0])
      .toMatchObject({ id: message.id, status: 'failed', delivery: 'possibly-sent' });
    expect(JSON.parse(await readFile(interruptedPath, 'utf8'))).toEqual([newerId]);
  });
});
