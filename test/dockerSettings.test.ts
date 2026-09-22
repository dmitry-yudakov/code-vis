import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@/server/config';

vi.mock('@/server/execution/dockerRuntime', () => ({
  getDockerRuntime: (config: AppConfig) => ({
    health: async () => ({
      available: false, authenticated: 'unknown', supportedModes: [],
      message: config.dockerEnabled ? 'Docker needs provisioning.' : 'Docker is disabled.',
    }),
  }),
}));

import { getConfig } from '@/server/config';
import { dockerSettingsPath, savedDockerEnabled } from '@/server/execution/dockerSettings';
import { dockerProviderHealth, getProviderAdapters } from '@/server/agents/providerRegistry';
import { PATCH } from '@/app/api/execution/docker/route';
import type { ProviderHealth } from '@/shared/types';

const FAKE_CLAUDE = path.resolve('test/fixtures/fake-claude.mjs');
const FAKE_CODEX = path.resolve('test/fixtures/fake-codex.mjs');
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

function request(body: unknown, origin: string | null = 'http://localhost:3023'): Request {
  return new Request('http://localhost:3023/api/execution/docker', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify(body),
  });
}

describe('Docker UI settings', () => {
  let dataDir: string;
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'codeai-docker-settings-'));
    vi.stubEnv('CODEAI_DATA_DIR', dataDir);
    vi.stubEnv('CODEAI_REMOTE_ACCESS', 'local');
    vi.stubEnv('CODEAI_DOCKER_ENABLED', '');
    vi.stubEnv('CODEAI_WEB2_DOCKER_ENABLED', '');
    // Docker offers the local providers' choices, so keep those checks on the offline fixtures.
    vi.stubEnv('CODEAI_CLAUDE_BIN', FAKE_CLAUDE);
    vi.stubEnv('CODEAI_CODEX_BIN', FAKE_CODEX);
    vi.stubEnv('CODEAI_REPOSITORIES_ROOT', process.cwd());
  });
  afterEach(() => vi.unstubAllEnvs());

  it('offers each provider the same model choices as Local on this machine', async () => {
    const engine: ProviderHealth = { available: true, authenticated: 'unknown', supportedModes: ['ask', 'plan', 'agent'] };
    const local = await getProviderAdapters(getConfig()).codex.checkHealth();
    expect(local.models?.length).toBeGreaterThan(0);
    expect(dockerProviderHealth(getConfig(), engine, local).codex).toEqual({ ...engine, models: local.models, efforts: local.efforts });
    expect(dockerProviderHealth(getConfig(), engine, { available: false, authenticated: 'unknown', supportedModes: [] }).codex).toEqual(engine);

    const response = await PATCH(request({ enabled: true }));
    const { providers } = await response.json() as { providers: Record<'claude' | 'codex', ProviderHealth> };
    expect(providers.claude).toMatchObject({ available: false, message: 'Docker needs provisioning.', efforts: CLAUDE_EFFORTS });
    expect(providers.claude.models?.map((model) => model.id)).toEqual(['fable', 'opus', 'sonnet', 'haiku']);
    expect(providers.codex).toMatchObject({ available: false, models: local.models, efforts: local.efforts });

    const docker = getProviderAdapters(getConfig(), 'docker', { sessionId: 'session', participantId: 'participant' });
    await expect(docker.codex.checkHealth()).resolves.toEqual(providers.codex);
    await expect(docker.claude.checkHealth()).resolves.toEqual(providers.claude);

    // Without a working local Codex, Docker Codex offers Default only.
    vi.stubEnv('CODEAI_CODEX_BIN', path.resolve('test/fixtures/not-a-real-codex'));
    const withoutLocalCodex = await (await PATCH(request({ enabled: true }))).json() as { providers: Record<'claude' | 'codex', ProviderHealth> };
    expect(withoutLocalCodex.providers.codex).not.toHaveProperty('models');
    expect(withoutLocalCodex.providers.codex).not.toHaveProperty('efforts');
    expect(withoutLocalCodex.providers.claude.efforts).toEqual(CLAUDE_EFFORTS);

    // Docker Claude's choices come from the pinned worker, not from a local Claude.
    vi.stubEnv('CODEAI_CLAUDE_BIN', path.resolve('test/fixtures/not-a-real-claude'));
    const withoutLocalClaude = getProviderAdapters(getConfig(), 'docker', { sessionId: 'session', participantId: 'participant' });
    await expect(withoutLocalClaude.claude.checkHealth()).resolves.toEqual(providers.claude);
  });

  it('inherits environment flags only until a private saved choice exists, and updates without restarting', async () => {
    expect(getConfig().dockerEnabled).toBe(false);
    vi.stubEnv('CODEAI_WEB2_DOCKER_ENABLED', 'yes');
    expect(getConfig().dockerEnabled).toBe(true);
    vi.stubEnv('CODEAI_DOCKER_ENABLED', 'false');
    expect(getConfig().dockerEnabled).toBe(false);

    const enabled = await PATCH(request({ enabled: true }));
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toMatchObject({ enabled: true, providers: { claude: { available: false } } });
    expect(getConfig().dockerEnabled).toBe(true);
    expect(JSON.parse(await readFile(dockerSettingsPath(dataDir), 'utf8'))).toEqual({ enabled: true });
    expect((await stat(dockerSettingsPath(dataDir))).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(dockerSettingsPath(dataDir)))).mode & 0o777).toBe(0o700);

    vi.stubEnv('CODEAI_DOCKER_ENABLED', 'true');
    expect((await PATCH(request({ enabled: false }))).status).toBe(200);
    expect(getConfig().dockerEnabled).toBe(false);
    expect(savedDockerEnabled(dataDir)).toBe(false);
    // A different machine data directory must not inherit this machine's saved preference.
    vi.stubEnv('CODEAI_DATA_DIR', path.join(dataDir, 'other'));
    expect(getConfig().dockerEnabled).toBe(true);
  });

  it.each([{}, { enabled: 'true' }, { enabled: true, image: 'custom' }, { enabled: true, mounts: ['/'] }, null])(
    'rejects unsupported input %j without creating settings', async (body) => {
      expect((await PATCH(request(body))).status).toBe(400);
      expect(savedDockerEnabled(dataDir)).toBeUndefined();
    },
  );

  it.each(['https://attacker.test', null])('rejects an untrusted or missing origin %s', async (origin) => {
    expect((await PATCH(request({ enabled: true }, origin))).status).toBe(403);
    expect(savedDockerEnabled(dataDir)).toBeUndefined();
  });

  it('uses the browser Host when Next.js normalizes the internal request hostname', async () => {
    const input = request({ enabled: true }, 'http://127.0.0.1:3023');
    input.headers.set('Host', '127.0.0.1:3023');
    expect((await PATCH(input)).status).toBe(200);
    expect(savedDockerEnabled(dataDir)).toBe(true);
    const mismatch = request({ enabled: false });
    mismatch.headers.set('Host', 'other.test:3023');
    expect((await PATCH(mismatch)).status).toBe(403);
    expect(savedDockerEnabled(dataDir)).toBe(true);
  });

  it.each(['not json', '{"enabled":"true"}', '{"enabled":true,"image":"custom"}'])(
    'disables Docker for malformed saved settings and allows repair: %s', async (source) => {
      vi.stubEnv('CODEAI_DOCKER_ENABLED', 'true');
      await mkdir(path.dirname(dockerSettingsPath(dataDir)));
      await writeFile(dockerSettingsPath(dataDir), source);
      expect(getConfig().dockerEnabled).toBe(false);
      expect((await PATCH(request({ enabled: true }))).status).toBe(200);
      expect(getConfig().dockerEnabled).toBe(true);
    },
  );

  it('reports failed writes without exposing private paths or claiming enablement', async () => {
    await writeFile(path.join(dataDir, 'docker'), 'not a directory');
    const response = await PATCH(request({ enabled: true }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(dataDir);
    expect(getConfig().dockerEnabled).toBe(false);
  });
});
