import { afterEach, describe, expect, it, vi } from 'vitest';
import { boundedResponseText, fetchExecutorSnapshot } from '@/server/machines/machineClient';
import type { MachineConnection } from '@/server/machines/machineRegistry';

const MACHINE_ID = '11111111-1111-4111-8111-111111111111';
const CREDENTIAL = `22222222-2222-4222-8222-222222222222.${'a'.repeat(43)}`;
const connection: MachineConnection = {
  machine: { id: MACHINE_ID, label: 'Laptop' },
  origin: 'https://laptop.test',
  credential: CREDENTIAL,
  expiresAt: '2099-01-01T00:00:00.000Z',
  attachedAt: '2026-09-04T10:00:00.000Z',
};

describe('execution machine client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('bounds streamed responses even without a Content-Length header', async () => {
    await expect(boundedResponseText(new Response('12345'), 4)).rejects.toThrow('too large');
  });

  it('rejects a valid projection whose machine identity differs from the attachment', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      machine: { id: '33333333-3333-4333-8333-333333333333', label: 'Impostor' },
      projects: [], checkouts: [], recentCheckoutIds: [],
      providers: {
        claude: { available: false, authenticated: 'unknown', supportedModes: [] },
        codex: { available: false, authenticated: 'unknown', supportedModes: [] },
      },
      sessions: [], archivedSessions: [], runs: { active: [], recent: [] },
    }))));
    await expect(fetchExecutorSnapshot(connection)).rejects.toThrow('different machine identity');
  });
});
