import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DockerUpdateResult, DockerUpdateStep, DockerVersions } from '@/server/execution/dockerUpgrade';
import type { DockerVersionsStatus } from '@/shared/types';

const mocks = vi.hoisted(() => ({ read: vi.fn(), plan: vi.fn(), run: vi.fn() }));
vi.mock('@/server/execution/dockerUpgrade', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/server/execution/dockerUpgrade')>(),
  readDockerVersions: mocks.read, planDockerUpdate: mocks.plan, runDockerUpdate: mocks.run,
}));

import { GET, POST } from '@/app/api/execution/docker/versions/route';
import { DockerUpdateRejected } from '@/server/execution/dockerUpgrade';
import { DOCKER_RELEASES_TTL_MS } from '@/server/execution/dockerReleases';
import { getDeviceAuthStore } from '@/server/devices/deviceAuthStore';

const ORIGIN = 'http://localhost:3023';
const globals = globalThis as Record<string, unknown>;
let dataDir: string;
let npm: Record<string, string | Error>;
let fetch: ReturnType<typeof vi.fn>;

function versions(overrides: Partial<DockerVersions> = {}): DockerVersions {
  return { image: `sha256:${'a'.repeat(64)}`, claude: '2.1.226', codex: '0.156.1', previous: { codex: '0.152.0' }, ...overrides };
}
const get = async (query = '') => {
  const response = await GET(new Request(`${ORIGIN}/api/execution/docker/versions${query}`));
  return { status: response.status, body: await response.json() as DockerVersionsStatus & { error?: string } };
};
const post = async (body: unknown, origin: string | null = ORIGIN) => {
  const response = await POST(new Request(`${ORIGIN}/api/execution/docker/versions`, {
    method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
  }));
  return { status: response.status, body: await response.json() as { operation?: DockerVersionsStatus['operation']; error?: string } };
};
/** A run the test finishes by hand, reporting steps as the real one does. */
function controlledRun() {
  let finish!: (result: DockerUpdateResult) => void;
  let step!: (value: DockerUpdateStep) => void;
  mocks.run.mockImplementation((_runtime: unknown, _plan: unknown, onStep: (value: DockerUpdateStep) => void) => {
    step = onStep;
    return new Promise<DockerUpdateResult>((resolve) => { finish = resolve; });
  });
  return { step: (value: DockerUpdateStep) => step(value), resolve: (result: DockerUpdateResult) => finish(result), finish: async (result: DockerUpdateResult) => { finish(result); await vi.waitFor(async () => expect((await get()).body.operation?.finishedAt).toBeDefined()); } };
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'codeai-docker-versions-'));
  vi.stubEnv('CODEAI_DATA_DIR', dataDir);
  vi.stubEnv('CODEAI_REMOTE_ACCESS', 'local');
  delete globals.__codeAiDockerReleases;
  delete globals.__codeAiDockerUpdates;
  npm = { '@anthropic-ai/claude-code': '2.1.280', '@openai/codex': '0.156.1' };
  fetch = vi.fn(async (url: string) => {
    const name = decodeURIComponent(new URL(url).pathname.split('/')[3]);
    const latest = npm[name];
    if (latest instanceof Error) throw latest;
    return new Response(JSON.stringify({ latest, next: '9.9.9' }));
  });
  vi.stubGlobal('fetch', fetch);
  mocks.read.mockImplementation(async () => versions());
  mocks.plan.mockImplementation(async (_runtime: unknown, provider: string, version: string) => ({ provider, version, image: versions().image, recorded: versions() }));
});
afterEach(async () => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetAllMocks();
  await rm(dataDir, { recursive: true, force: true });
});

describe('Docker CLI versions in Arena', () => {
  it('offers npm’s latest above the recorded version and the previous version, never the recorded one', async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.providers).toEqual({
      claude: { version: '2.1.226', minimum: '2.1.226', latest: { version: '2.1.280', downgrade: false } },
      codex: { version: '0.156.1', minimum: '0.152.0', previous: { version: '0.152.0', downgrade: true } },
    });
    expect(body.releases).toEqual({ checkedAt: expect.any(String) });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://registry.npmjs.org/-/package/@anthropic-ai%2fclaude-code/dist-tags',
      'https://registry.npmjs.org/-/package/@openai%2fcodex/dist-tags',
    ]);
  });

  it('does not offer a latest or previous version below the minimum', async () => {
    npm['@anthropic-ai/claude-code'] = '2.1.100';
    mocks.read.mockResolvedValue(versions({ claude: '2.1.280', previous: { claude: '2.1.200' } }));
    expect((await get()).body.providers.claude).toEqual({ version: '2.1.280', minimum: '2.1.226' });
  });

  it('offers a previous version that npm’s latest already offers only once, as the update', async () => {
    mocks.read.mockResolvedValue(versions({ claude: '2.1.226', previous: { claude: '2.1.280' } }));
    expect((await get()).body.providers.claude).toEqual({ version: '2.1.226', minimum: '2.1.226', latest: { version: '2.1.280', downgrade: false } });
    npm['@anthropic-ai/claude-code'] = '2.1.290';
    expect((await get('?refresh=1')).body.providers.claude).toEqual({ version: '2.1.226', minimum: '2.1.226',
      latest: { version: '2.1.290', downgrade: false }, previous: { version: '2.1.280', downgrade: false } });
  });

  it('does not offer a latest below the recorded version: going lower is a rollback', async () => {
    mocks.read.mockResolvedValue(versions({ claude: '2.1.290' }));
    expect((await get()).body.providers.claude).toEqual({ version: '2.1.290', minimum: '2.1.226' });
  });

  it('keeps npm’s answer for one hour, and Check for updates asks again', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    await get();
    await get();
    expect(fetch).toHaveBeenCalledTimes(2);
    npm['@anthropic-ai/claude-code'] = '2.1.281';
    expect((await get('?refresh=1')).body.providers.claude.latest?.version).toBe('2.1.281');
    expect(fetch).toHaveBeenCalledTimes(4);
    now.mockReturnValue(1_000_000 + DOCKER_RELEASES_TTL_MS - 1);
    await get();
    expect(fetch).toHaveBeenCalledTimes(4);
    now.mockReturnValue(1_000_000 + DOCKER_RELEASES_TTL_MS + 1);
    await get();
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it.each([
    ['a network failure', new Error('offline')],
    ['a tag instead of a version', 'next'],
    ['a pre-release', '2.1.281-beta.1'],
  ])('reports %s as a failed lookup and changes nothing else', async (_, answer) => {
    npm['@openai/codex'] = answer;
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.releases).toEqual({ checkedAt: expect.any(String), failed: true });
    expect(body.providers).toEqual({
      claude: { version: '2.1.226', minimum: '2.1.226' },
      codex: { version: '0.156.1', minimum: '0.152.0', previous: { version: '0.152.0', downgrade: true } },
    });
  });

  it('explains an unprovisioned installation', async () => {
    mocks.read.mockRejectedValue(new DockerUpdateRejected('This installation is not provisioned for Docker.'));
    expect(await get()).toEqual({ status: 409, body: { error: 'This installation is not provisioned for Docker.' } });
  });
});

describe('starting a Docker CLI update from Arena', () => {
  it.each([
    [{ provider: 'claude', target: 'latest', version: '2.1.280' }],
    [{ provider: 'claude', target: '2.1.280' }],
    [{ provider: 'claude', version: '2.1.280' }],
    [{ provider: 'claude' }],
    [{ provider: 'gemini', target: 'latest' }],
    ['not json'],
  ])('accepts only a provider and latest or previous: %j is 400', async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it.each([
    ['latest', 'codex', 'There is no newer Codex release to update to.'],
    ['previous', 'claude', 'Claude has no previous version to roll back to.'],
  ])('answers 400 when %s has nothing to resolve for %s', async (target, provider, error) => {
    await get();
    expect(await post({ provider, target })).toEqual({ status: 400, body: { error } });
    expect(mocks.plan).not.toHaveBeenCalled();
  });

  it('answers 400 for latest when npm could not be asked', async () => {
    npm['@anthropic-ai/claude-code'] = new Error('offline');
    await get();
    expect(await post({ provider: 'claude', target: 'latest' })).toEqual({ status: 400, body: { error: 'Couldn’t check for updates.' } });
  });

  it('starts latest only from the answer Arena showed, never from a new lookup', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    expect(await post({ provider: 'claude', target: 'latest' })).toEqual({ status: 400, body: { error: 'Check for updates again first.' } });
    expect(fetch).not.toHaveBeenCalled();
    await get();
    now.mockReturnValue(1_000_000 + DOCKER_RELEASES_TTL_MS + 1);
    expect(await post({ provider: 'claude', target: 'latest' })).toEqual({ status: 400, body: { error: 'Check for updates again first.' } });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mocks.plan).not.toHaveBeenCalled();
  });

  it('passes on what planning refuses', async () => {
    await get();
    mocks.plan.mockRejectedValue(new DockerUpdateRejected('The local Docker engine identity changed.'));
    expect(await post({ provider: 'claude', target: 'latest' })).toEqual({ status: 400, body: { error: 'The local Docker engine identity changed.' } });
    // A refusal releases the machine's single operation.
    mocks.plan.mockImplementation(async (_runtime: unknown, provider: string, version: string) => ({ provider, version, recorded: versions() }));
    controlledRun();
    expect((await post({ provider: 'claude', target: 'latest' })).status).toBe(202);
  });

  it('resolves the version on the server, reports progress across a reload, and refuses a second operation', async () => {
    await get();
    const run = controlledRun();
    const started = await post({ provider: 'claude', target: 'latest' });
    expect(started.status).toBe(202);
    expect(started.body.operation).toMatchObject({ provider: 'claude', version: '2.1.280', state: 'building' });
    expect(mocks.plan).toHaveBeenCalledWith(expect.anything(), 'claude', '2.1.280');
    expect(await post({ provider: 'codex', target: 'previous' })).toMatchObject({ status: 409 });
    run.step('checking');
    // A reloaded Arena asks again and finds the same operation.
    expect((await get()).body.operation).toMatchObject({ id: started.body.operation!.id, state: 'checking' });
    run.step('switching');
    expect((await get()).body.operation?.state).toBe('switching');
    await run.finish({ outcome: 'switched', provider: 'claude', version: '2.1.280', replaced: '2.1.226' });
    expect((await get()).body.operation).toMatchObject({
      id: started.body.operation!.id, state: 'switched', message: 'Claude 2.1.280 replaced 2.1.226. New turns use it.',
    });
    // Finished: the next one may start, and rolls back to the version the record names.
    controlledRun();
    expect((await post({ provider: 'codex', target: 'previous' })).status).toBe(202);
    expect(mocks.plan).toHaveBeenLastCalledWith(expect.anything(), 'codex', '0.152.0');
  });

  it.each([
    [{ outcome: 'failed', check: 'claude-flags', message: 'claude --help does not document --effort, which CodeAI requires.' } as const,
      { state: 'failed', check: 'claude-flags', message: 'claude --help does not document --effort, which CodeAI requires.' }],
    [{ outcome: 'in-use', message: 'Claude is in use by a turn. Try again when it finishes.' } as const,
      { state: 'in-use', message: 'Claude is in use by a turn. Try again when it finishes.' }],
  ])('reports the %j outcome', async (result, operation) => {
    await get();
    const run = controlledRun();
    await post({ provider: 'claude', target: 'latest' });
    await run.finish(result);
    expect((await get()).body.operation).toMatchObject(operation);
  });

  it('never pairs an outcome with versions read before it', async () => {
    await get();
    const run = controlledRun();
    await post({ provider: 'claude', target: 'latest' });
    run.step('switching');
    // The switch finishes while this read of the (older) records is still under way.
    mocks.read.mockImplementationOnce(async () => {
      run.resolve({ outcome: 'switched', provider: 'claude', version: '2.1.280', replaced: '2.1.226' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      return versions();
    });
    const racing = (await get()).body;
    expect(racing.providers.claude.version).toBe('2.1.226');
    expect(racing.operation?.state).toBe('switching');
    mocks.read.mockResolvedValue(versions({ claude: '2.1.280', previous: { claude: '2.1.226' } }));
    expect((await get()).body).toMatchObject({ providers: { claude: { version: '2.1.280' } }, operation: { state: 'switched' } });
  });

  it('adds a downgrade’s warning to the switched message', async () => {
    const warning = 'Codex 0.152.0 is older than the recorded 0.156.1. The newer CLI may already have migrated Codex’s shared Docker home.';
    mocks.plan.mockImplementation(async (_runtime: unknown, provider: string, version: string) => ({ provider, version, recorded: versions(), warning }));
    const run = controlledRun();
    await post({ provider: 'codex', target: 'previous' });
    await run.finish({ outcome: 'switched', provider: 'codex', version: '0.152.0', replaced: '0.156.1' });
    expect((await get()).body.operation?.message).toBe(`Codex 0.152.0 replaced 0.156.1. New turns use it. ${warning}`);
  });

  it('reports an unexpected failure and frees the machine', async () => {
    await get();
    mocks.run.mockRejectedValue(new Error(`EACCES: permission denied, open '${dataDir}/docker/profile.json'`));
    await post({ provider: 'claude', target: 'latest' });
    await vi.waitFor(async () => expect((await get()).body.operation).toMatchObject({
      state: 'failed', message: 'The update failed. Check Docker and the CodeAI Docker setup guide.', finishedAt: expect.any(String),
    }));
    controlledRun();
    expect((await post({ provider: 'claude', target: 'latest' })).status).toBe(202);
  });
});

describe('Docker CLI update authorization', () => {
  it.each(['https://attacker.test', null])('refuses a mutation from origin %s', async (origin) => {
    expect((await post({ provider: 'claude', target: 'latest' }, origin)).status).toBe(403);
    expect(mocks.plan).not.toHaveBeenCalled();
  });

  it('refuses an unpaired device in paired mode, and requires the exact origin of a paired one', async () => {
    vi.stubEnv('CODEAI_REMOTE_ACCESS', 'paired');
    vi.stubEnv('CODEAI_PUBLIC_ORIGIN', 'https://codeai.test');
    (globalThis as typeof globalThis & { __codeaiInternalTlsMarker?: string }).__codeaiInternalTlsMarker = 'docker-versions-test';
    const store = getDeviceAuthStore(dataDir);
    const { credential } = await store.pair((await store.issuePairingCode()).code, 'Laptop');
    const request = (method: 'GET' | 'POST', options: { cookie?: boolean; origin?: string } = {}) => new Request('https://codeai.test/api/execution/docker/versions', {
      method, ...(method === 'POST' ? { body: JSON.stringify({ provider: 'claude', target: 'latest' }) } : {}),
      headers: {
        'x-codeai-internal-transport': 'docker-versions-test', 'Content-Type': 'application/json',
        ...(options.origin ? { Origin: options.origin } : {}),
        ...(options.cookie === false ? {} : { Cookie: `__Host-codeai-device=${credential}` }),
      },
    });
    expect((await GET(request('GET', { cookie: false }))).status).toBe(401);
    expect((await POST(request('POST', { cookie: false, origin: 'https://codeai.test' }))).status).toBe(401);
    expect((await POST(request('POST', { origin: 'https://other.test' }))).status).toBe(403);
    expect(mocks.plan).not.toHaveBeenCalled();
    expect((await GET(request('GET'))).status).toBe(200);
    controlledRun();
    expect((await POST(request('POST', { origin: 'https://codeai.test' }))).status).toBe(202);
  });
});
