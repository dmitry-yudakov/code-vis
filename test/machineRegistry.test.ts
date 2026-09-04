import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MachineRegistry } from '@/server/machines/machineRegistry';
import type { ExecutorSnapshot } from '@/shared/types';

const REMOTE = { id: '11111111-1111-4111-8111-111111111111', label: 'Laptop' };
const CREDENTIAL = `22222222-2222-4222-8222-222222222222.${'a'.repeat(43)}`;

function snapshot(machine = REMOTE): ExecutorSnapshot {
  return {
    machine,
    projects: [],
    checkouts: [],
    recentCheckoutIds: [],
    providers: {
      claude: { available: true, authenticated: true, supportedModes: ['ask', 'plan', 'agent'] },
      codex: { available: false, authenticated: 'unknown', supportedModes: [] },
    },
    sessions: [],
    archivedSessions: [],
    runs: { active: [], recent: [] },
  };
}

describe('home machine registry', () => {
  let dataDir: string;
  let registry: MachineRegistry;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'codeai-machine-registry-'));
    registry = new MachineRegistry(dataDir);
  });

  it('stores one exact HTTPS attachment atomically and caches only matching bounded snapshots', async () => {
    await registry.attach({
      machine: REMOTE,
      origin: 'https://laptop.test:3023',
      credential: CREDENTIAL,
      expiresAt: '2027-09-04T10:00:00.000Z',
      attachedAt: '2026-09-04T10:00:00.000Z',
    });
    expect(await registry.get(REMOTE.id)).toMatchObject({ machine: REMOTE, origin: 'https://laptop.test:3023' });
    expect((await stat(registry.recordPath)).mode & 0o777).toBe(0o600);

    await registry.observe(REMOTE.id, snapshot(), '2026-09-04T10:01:00.000Z');
    expect(await registry.get(REMOTE.id)).toMatchObject({
      lastSeenAt: '2026-09-04T10:01:00.000Z',
      cachedSnapshot: { machine: REMOTE },
    });
    await expect(registry.observe(REMOTE.id, snapshot({
      id: '33333333-3333-4333-8333-333333333333', label: 'Impostor',
    }))).rejects.toThrow('different machine identity');
    await expect(registry.attach({
      machine: REMOTE,
      origin: 'https://other.test',
      credential: CREDENTIAL,
      expiresAt: '2027-09-04T10:00:00.000Z',
    })).rejects.toMatchObject({ code: 'duplicate' });
  });

  it('removes attachments and fails closed on invalid origins and corruption', async () => {
    await expect(registry.attach({
      machine: REMOTE,
      origin: 'http://laptop.test',
      credential: CREDENTIAL,
      expiresAt: '2027-09-04T10:00:00.000Z',
    })).rejects.toThrow();
    await registry.attach({
      machine: REMOTE,
      origin: 'https://laptop.test',
      credential: CREDENTIAL,
      expiresAt: '2027-09-04T10:00:00.000Z',
    });
    expect((await registry.remove(REMOTE.id)).machine).toEqual(REMOTE);
    expect(await registry.list()).toEqual([]);

    await writeFile(registry.recordPath, '{"version":1,"machines":"broken"}', 'utf8');
    await expect(registry.list()).rejects.toMatchObject({ code: 'corrupt' });
    expect(await readFile(registry.recordPath, 'utf8')).not.toContain('cachedSnapshot');
  });

  it('bounds the home registry to eight explicit executors', async () => {
    for (let index = 0; index < 8; index += 1) {
      await registry.attach({
        machine: { id: crypto.randomUUID(), label: `Executor ${index + 1}` },
        origin: `https://executor-${index + 1}.test`,
        credential: CREDENTIAL,
        expiresAt: '2027-09-04T10:00:00.000Z',
      });
    }
    await expect(registry.attach({
      machine: { id: crypto.randomUUID(), label: 'Ninth executor' },
      origin: 'https://executor-9.test',
      credential: CREDENTIAL,
      expiresAt: '2027-09-04T10:00:00.000Z',
    })).rejects.toMatchObject({ code: 'limit' });
  });
});
