import { describe, expect, it } from 'vitest';
import {
  buildImmersiveArenaRows, IMMERSIVE_ARENA_PAGE_SIZE, pageImmersiveArenaRows,
} from '@/features/shell/immersive/immersiveArenaModel';
import { EMPTY_DEVICE_ARENA_STATE } from '@/features/arena/arenaModel';
import type { ArenaMachineSnapshot, ArenaSessionSummary } from '@/shared/types';

const SESSION = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';

function session(title: string, suffix = ''): ArenaSessionSummary {
  return {
    id: SESSION + suffix,
    revision: 0,
    title,
    repositoryCheckoutIds: [],
    agents: [{ id: AGENT, displayName: 'Claude', provider: 'claude', role: 'coder' }],
    updatedAt: '2026-09-20T10:00:00.000Z',
  };
}

function machine(id: string, title: string, online = true): ArenaMachineSnapshot {
  const item = session(title);
  return {
    machine: { id, label: title, kind: id === 'home' ? 'local' : 'remote', state: online ? 'online' : 'offline' },
    projects: [], checkouts: [], recentCheckoutIds: [],
    providers: {
      claude: { available: online, authenticated: online, supportedModes: online ? ['agent'] : [] },
      codex: { available: false, authenticated: 'unknown', supportedModes: [] },
    },
    sessions: [item], archivedSessions: [], runs: { active: [], recent: [] },
  };
}

describe('immersive Arena summaries', () => {
  it('keeps duplicate session ids machine-qualified and cached offline summaries non-actionable', () => {
    const rows = buildImmersiveArenaRows([
      machine('home', 'Home session'),
      machine('remote', 'Remote session', false),
    ], EMPTY_DEVICE_ARENA_STATE, 'sessions');
    expect(rows.map((row) => row.key)).toEqual([
      `session:home:${SESSION}`,
      `session:remote:${SESSION}`,
    ]);
    expect(rows[0]).toMatchObject({ machineId: 'home', title: 'Home session', state: 'idle', actionable: true });
    expect(rows[1]).toMatchObject({ machineId: 'remote', title: 'Remote session', state: 'offline', actionable: false });
  });

  it('routes Inbox permissions to the exact machine, run, request and session owner', () => {
    const home = machine('home', 'Home session');
    const remote = machine('remote', 'Remote session');
    remote.runs.active = [{
      runId: 'remote-run', sessionId: SESSION, participantId: AGENT, state: 'needs-you', enqueuedAt: 1,
      pendingPermissionCount: 1,
      pendingPermissions: [{ requestId: 'remote-request', participantId: AGENT, tool: 'Edit', detail: 'src/remote.ts' }],
    }];
    const [row] = buildImmersiveArenaRows([home, remote], EMPTY_DEVICE_ARENA_STATE, 'inbox');
    expect(row).toMatchObject({
      key: 'attention:machine:remote:permission:remote-run:remote-request',
      machineId: 'remote', sessionId: SESSION, runId: 'remote-run', requestId: 'remote-request',
      state: 'needs-you', actionable: true, unread: true,
    });
  });

  it('bounds one visible page while keeping every summary reachable', () => {
    const home = machine('home', 'Session 0');
    home.sessions = Array.from({ length: 14 }, (_, index) => ({
      ...session(`Session ${index}`, `-${index}`),
      updatedAt: new Date(Date.parse('2026-09-20T10:00:00.000Z') - index * 1_000).toISOString(),
    }));
    const rows = buildImmersiveArenaRows([home], EMPTY_DEVICE_ARENA_STATE, 'sessions');
    const first = pageImmersiveArenaRows(rows, 0);
    const last = pageImmersiveArenaRows(rows, 99);
    expect(first.rows).toHaveLength(IMMERSIVE_ARENA_PAGE_SIZE);
    expect(first).toMatchObject({ page: 0, pageCount: 3 });
    expect(last).toMatchObject({ page: 2, pageCount: 3 });
    expect([...first.rows, ...pageImmersiveArenaRows(rows, 1).rows, ...last.rows]).toHaveLength(14);
  });

  it('keeps archived rows restorable and distinct from active rows', () => {
    const home = machine('home', 'Active');
    home.archivedSessions = [{ ...session('Archived'), archivedAt: '2026-09-20T11:00:00.000Z' }];
    expect(buildImmersiveArenaRows([home], EMPTY_DEVICE_ARENA_STATE, 'archived')[0])
      .toMatchObject({ kind: 'session', archived: true, actionable: true, title: 'Archived' });
    expect(buildImmersiveArenaRows([home], EMPTY_DEVICE_ARENA_STATE, 'sessions'))
      .toHaveLength(1);
  });
});
