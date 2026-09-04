import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DeviceAuthStore } from '@/server/devices/deviceAuthStore';

describe('personal device authentication store', () => {
  let dataDir: string;
  let now: Date;
  let store: DeviceAuthStore;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'codeai-device-auth-'));
    now = new Date('2026-09-04T10:00:00.000Z');
    store = new DeviceAuthStore(dataDir, { now: () => now });
  });

  it('stores only digests, consumes a high-entropy code once, and writes user-only state', async () => {
    const challenge = await store.issuePairingCode();
    expect(challenge.code).toMatch(/^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/);
    expect(challenge.expiresAt).toBe('2026-09-04T10:10:00.000Z');
    let persisted = await readFile(store.recordPath, 'utf8');
    expect(persisted).not.toContain(challenge.code);
    expect(persisted).not.toContain(challenge.code.replaceAll('-', ''));

    const paired = await store.pair(challenge.code.toLowerCase(), 'Kitchen tablet');
    expect(paired.device).toMatchObject({ label: 'Kitchen tablet', current: true });
    expect(await store.authenticate(paired.credential)).toMatchObject({ id: paired.device.id });
    persisted = await readFile(store.recordPath, 'utf8');
    expect(persisted).not.toContain(paired.credential);
    expect(persisted).not.toContain(paired.credential.split('.')[1]);
    expect(JSON.parse(persisted).pairingChallenge).toBeUndefined();
    expect((await stat(store.recordPath)).mode & 0o777).toBe(0o600);

    await expect(store.pair(challenge.code, 'Replay')).rejects.toMatchObject({ code: 'invalid-code' });
  });

  it('expires challenges and credentials and bounds online guessing attempts', async () => {
    let challenge = await store.issuePairingCode();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(store.pair('AAAA-AAAA-AAAA-AAAA', 'Guess')).rejects.toMatchObject({ code: 'invalid-code' });
    }
    await expect(store.pair('BBBB-BBBB-BBBB-BBBB', 'Last guess')).rejects.toMatchObject({ code: 'invalid-code' });
    await expect(store.pair(challenge.code, 'Too late')).rejects.toMatchObject({ code: 'invalid-code' });

    challenge = await store.issuePairingCode();
    now = new Date('2026-09-04T10:11:00.000Z');
    await expect(store.pair(challenge.code, 'Expired')).rejects.toMatchObject({ code: 'invalid-code' });

    now = new Date('2026-09-04T11:00:00.000Z');
    challenge = await store.issuePairingCode();
    const paired = await store.pair(challenge.code, 'Laptop');
    now = new Date('2027-09-05T11:00:00.000Z');
    expect(await store.authenticate(paired.credential)).toBeUndefined();
    expect(await store.list(paired.device.id)).toEqual([]);
  });

  it('lists bounded public summaries, revokes immediately, and fails closed on corruption', async () => {
    const firstChallenge = await store.issuePairingCode();
    const first = await store.pair(firstChallenge.code, 'Laptop');
    now = new Date('2026-09-04T10:01:00.000Z');
    const secondChallenge = await store.issuePairingCode();
    const second = await store.pair(secondChallenge.code, 'Headset');
    const summaries = await store.list(first.device.id);
    expect(summaries).toEqual([
      expect.objectContaining({ id: second.device.id, label: 'Headset', current: false }),
      expect.objectContaining({ id: first.device.id, label: 'Laptop', current: true }),
    ]);
    expect(JSON.stringify(summaries)).not.toMatch(/digest|salt|credential/i);
    expect(await store.revoke(second.device.id)).toBe(true);
    expect(await store.authenticate(second.credential)).toBeUndefined();
    expect(await store.revoke(second.device.id)).toBe(false);

    await writeFile(store.recordPath, '{"version":1,"devices":"not-an-array"}', 'utf8');
    await expect(store.authenticate(first.credential)).rejects.toMatchObject({ code: 'corrupt' });
  });
});
