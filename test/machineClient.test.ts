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

function snapshot(providers: Record<string, unknown> = {}) {
  return {
    machine: { id: MACHINE_ID, label: 'Laptop' },
    projects: [], checkouts: [], recentCheckoutIds: [],
    providers: {
      claude: { available: true, authenticated: 'unknown', supportedModes: ['ask', 'plan', 'agent'] },
      codex: { available: false, authenticated: 'unknown', supportedModes: [] },
      ...providers,
    },
    sessions: [], archivedSessions: [], runs: { active: [], recent: [] },
  };
}

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

  it('accepts provider model choices within bounds, and snapshots from executors without them', async () => {
    const claude = {
      available: true, authenticated: 'unknown', supportedModes: ['ask', 'plan', 'agent'],
      models: [
        { id: 'opus', label: 'Opus', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
        { id: 'haiku', label: 'Haiku', efforts: [] },
      ],
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    };
    const codex = {
      available: true, authenticated: true, supportedModes: ['ask', 'plan'],
      models: Array.from({ length: 50 }, (_, index) => ({ id: `gpt-${index}.5`, label: 'L'.repeat(80), efforts: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] })),
      efforts: [],
    };
    for (const providers of [{}, { claude, codex }]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot(providers)))));
      await expect(fetchExecutorSnapshot(connection)).resolves.toMatchObject({ providers: { claude: { available: true } } });
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot({ claude, codex })))));
    expect((await fetchExecutorSnapshot(connection)).providers.claude.models?.map((model) => model.id)).toEqual(['opus', 'haiku']);
  });

  it.each([
    ['too many models', { models: Array.from({ length: 51 }, (_, index) => ({ id: `m${index}`, label: 'M', efforts: [] })) }],
    ['too many efforts', { efforts: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }],
    ['too many model efforts', { models: [{ id: 'm', label: 'M', efforts: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }] }],
    ['a flag-shaped model id', { models: [{ id: '--model', label: 'M', efforts: [] }] }],
    ['an oversized model id', { models: [{ id: 'm'.repeat(101), label: 'M', efforts: [] }] }],
    ['an oversized label', { models: [{ id: 'm', label: 'L'.repeat(81), efforts: [] }] }],
    ['an empty label', { models: [{ id: 'm', label: ' ', efforts: [] }] }],
    ['a malformed effort', { efforts: ['-high'] }],
    ['a non-string effort', { models: [{ id: 'm', label: 'M', efforts: [3] }] }],
    ['an unknown model field', { models: [{ id: 'm', label: 'M', efforts: [], flags: ['--yolo'] }] }],
    ['a models object', { models: { id: 'm' } }],
  ])('rejects a snapshot with %s', async (_label, choices) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot({
      claude: { available: true, authenticated: 'unknown', supportedModes: ['ask'], ...choices },
    })))));
    await expect(fetchExecutorSnapshot(connection)).rejects.toThrow('does not match the machine contract');
  });
});
