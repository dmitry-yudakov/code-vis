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
import { PATCH } from '@/app/api/execution/docker/route';

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
  });
  afterEach(() => vi.unstubAllEnvs());

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
