import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MachineAuthStore } from '@/server/machines/machineAuthStore';

const PEER = { id: '11111111-1111-4111-8111-111111111111', label: 'Home desktop' };

describe('execution machine authentication store', () => {
  let dataDir: string;
  let now: Date;
  let store: MachineAuthStore;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'codeai-machine-auth-'));
    now = new Date('2026-09-04T10:00:00.000Z');
    store = new MachineAuthStore(dataDir, { now: () => now });
  });

  it('hashes the challenge and credential, consumes the code once, and writes user-only state', async () => {
    const challenge = await store.issuePairingCode();
    expect(challenge.code).toMatch(/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/);
    let persisted = await readFile(store.recordPath, 'utf8');
    expect(persisted).not.toContain(challenge.code.replaceAll('-', ''));

    const paired = await store.pair(challenge.code.toLowerCase(), PEER);
    expect(await store.authenticate(paired.credential)).toMatchObject({ id: PEER.id, label: PEER.label });
    persisted = await readFile(store.recordPath, 'utf8');
    expect(persisted).not.toContain(paired.credential);
    expect(persisted).not.toContain(paired.credential.split('.')[1]);
    expect(JSON.parse(persisted).pairingChallenge).toBeUndefined();
    expect((await stat(store.recordPath)).mode & 0o777).toBe(0o600);
    await expect(store.pair(challenge.code, PEER)).rejects.toMatchObject({ code: 'invalid-code' });
  });

  it('expires and revokes credentials, bounds guesses, and fails closed on corrupt state', async () => {
    const first = await store.issuePairingCode();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(store.pair('AAAA-AAAA-AAAA-AAAA', PEER)).rejects.toMatchObject({ code: 'invalid-code' });
    }
    await expect(store.pair(first.code, PEER)).rejects.toMatchObject({ code: 'invalid-code' });

    const challenge = await store.issuePairingCode();
    const paired = await store.pair(challenge.code, PEER);
    expect(await store.listPeers()).toEqual([paired.peer]);
    expect(await store.revoke(paired.peer.connectionId)).toBe(true);
    expect(await store.authenticate(paired.credential)).toBeUndefined();
    expect(await store.revoke(paired.peer.connectionId)).toBe(false);

    const expiring = await store.pair((await store.issuePairingCode()).code, {
      id: '22222222-2222-4222-8222-222222222222', label: 'Other home',
    });
    now = new Date('2027-09-05T10:00:00.000Z');
    expect(await store.authenticate(expiring.credential)).toBeUndefined();

    await writeFile(store.recordPath, '{"version":1,"peers":"broken"}', 'utf8');
    await expect(store.authenticate(expiring.credential)).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('supports executor-local revocation by the attached home identity', async () => {
    const paired = await store.pair((await store.issuePairingCode()).code, PEER);
    expect(await store.revokeMachine(PEER.id)).toBe(true);
    expect(await store.authenticate(paired.credential)).toBeUndefined();
    expect(await store.revokeMachine(PEER.id)).toBe(false);
  });

  it('bounds attached peers and consumes an otherwise valid over-limit challenge', async () => {
    for (let index = 0; index < 8; index += 1) {
      const challenge = await store.issuePairingCode();
      await store.pair(challenge.code, { id: crypto.randomUUID(), label: `Home ${index + 1}` });
    }
    const overflow = await store.issuePairingCode();
    await expect(store.pair(overflow.code, { id: crypto.randomUUID(), label: 'Ninth home' }))
      .rejects.toMatchObject({ code: 'peer-limit' });
    await expect(store.pair(overflow.code, { id: crypto.randomUUID(), label: 'Retry' }))
      .rejects.toMatchObject({ code: 'invalid-code' });
  });
});
