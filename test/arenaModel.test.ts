import { describe, expect, it } from 'vitest';
import {
  acknowledgeAttention, arenaSessionState, buildArenaInbox, EMPTY_DEVICE_ARENA_STATE,
  groupArenaSessions, parseDeviceArenaState, unreadArenaAttention,
} from '@/features/arena/arenaModel';
import type { ArenaSessionSummary, DurableProject, RunDescriptor, RunDiscovery } from '@/shared/types';

const PROJECT_A = '11111111-1111-4111-8111-111111111111';
const PROJECT_B = '22222222-2222-4222-8222-222222222222';
const SESSION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const AGENT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function project(id: string, name: string, updatedAt: string): DurableProject {
  return { version: 1, revision: 0, id, name, repositories: [], createdAt: updatedAt, updatedAt };
}

function session(id: string, updatedAt: string, projectId?: string, status: 'complete' | 'failed' = 'complete'): ArenaSessionSummary {
  return {
    id,
    revision: 0,
    title: `Session ${id[0].toUpperCase()}`,
    ...(projectId ? { projectId } : {}),
    repositoryCheckoutIds: [],
    agents: [{ id: AGENT, displayName: 'Claude', provider: 'claude', role: 'coder' }],
    updatedAt,
    lastActivity: {
      messageId: crypto.randomUUID(),
      createdAt: updatedAt,
      status,
    },
  };
}

function run(input: Partial<RunDescriptor> & Pick<RunDescriptor, 'runId' | 'sessionId' | 'state'>): RunDescriptor {
  return {
    participantId: AGENT,
    enqueuedAt: 100,
    pendingPermissionCount: 0,
    pendingPermissions: [],
    ...input,
  };
}

describe('Arena presentation model', () => {
  it('gives active lifecycle precedence and otherwise preserves failed versus idle session semantics', () => {
    const failed = session(SESSION_A, '2026-09-03T10:00:00.000Z', PROJECT_A, 'failed');
    expect(arenaSessionState(failed)).toBe('failed');
    expect(arenaSessionState(failed, run({ runId: 'run-a', sessionId: SESSION_A, state: 'running' }))).toBe('running');
    expect(arenaSessionState(failed, run({ runId: 'run-a', sessionId: SESSION_A, state: 'queued' }))).toBe('queued');
    expect(arenaSessionState(failed, run({ runId: 'run-a', sessionId: SESSION_A, state: 'needs-you' }))).toBe('needs-you');
    expect(arenaSessionState(session(SESSION_B, '2026-09-03T11:00:00.000Z'))).toBe('idle');
  });

  it('groups every session by canonical project and orders groups/cards by activity recency', () => {
    const discovery: RunDiscovery = { active: [], recent: [] };
    const groups = groupArenaSessions(
      [
        project(PROJECT_A, 'Alpha', '2026-09-01T00:00:00.000Z'),
        project(PROJECT_B, 'Beta', '2026-09-02T00:00:00.000Z'),
      ],
      [
        session(SESSION_A, '2026-09-03T10:00:00.000Z', PROJECT_A),
        session(SESSION_B, '2026-09-03T12:00:00.000Z', PROJECT_B),
        session(SESSION_C, '2026-09-03T11:00:00.000Z', PROJECT_A),
      ],
      discovery,
    );
    expect(groups.map((group) => group.name)).toEqual(['Beta', 'Alpha']);
    expect(groups[1].sessions.map((card) => card.session.id)).toEqual([SESSION_C, SESSION_A]);
  });

  it('orders archived cards by archive time even when later metadata changed updatedAt', () => {
    const olderArchive = {
      ...session(SESSION_A, '2026-09-03T15:00:00.000Z', PROJECT_A),
      archivedAt: '2026-09-03T10:00:00.000Z',
    };
    const newerArchive = {
      ...session(SESSION_B, '2026-09-03T12:00:00.000Z', PROJECT_A),
      archivedAt: '2026-09-03T11:00:00.000Z',
    };
    const groups = groupArenaSessions(
      [project(PROJECT_A, 'Alpha', '2026-09-01T00:00:00.000Z')],
      [olderArchive, newerArchive],
      { active: [], recent: [] },
    );
    expect(groups[0].sessions.map((card) => card.session.id)).toEqual([SESSION_B, SESSION_A]);
  });

  it('orders permissions before failures before completions and never lets read state hide live approval', () => {
    const sessions = [
      session(SESSION_A, '2026-09-03T10:00:00.000Z', PROJECT_A),
      session(SESSION_B, '2026-09-03T11:00:00.000Z', PROJECT_B),
      session(SESSION_C, '2026-09-03T12:00:00.000Z'),
    ];
    const discovery: RunDiscovery = {
      active: [run({
        runId: 'permission-run',
        sessionId: SESSION_A,
        state: 'needs-you',
        startedAt: 300,
        pendingPermissionCount: 1,
        pendingPermissions: [{ requestId: 'request-a', participantId: AGENT, tool: 'Edit', detail: 'src/a.ts' }],
      })],
      recent: [
        run({ runId: 'failed-run', sessionId: SESSION_B, state: 'finished', finishedAt: 500, outcome: 'failed', status: 'Tests failed' }),
        run({ runId: 'completed-run', sessionId: SESSION_C, state: 'finished', finishedAt: 600, outcome: 'completed' }),
      ],
    };
    let state = acknowledgeAttention(EMPTY_DEVICE_ARENA_STATE, [
      'permission:permission-run:request-a',
      'run:completed-run',
    ]);
    const inbox = buildArenaInbox(
      [project(PROJECT_A, 'Alpha', '2026-09-01T00:00:00.000Z'), project(PROJECT_B, 'Beta', '2026-09-01T00:00:00.000Z')],
      sessions,
      discovery,
      state,
    );
    expect(inbox.map((item) => item.kind)).toEqual(['permission', 'failed', 'completed']);
    expect(inbox[0]).toMatchObject({ reason: 'Edit: src/a.ts', read: false, runId: 'permission-run', requestId: 'request-a' });
    expect(inbox[2].read).toBe(true);
    expect(unreadArenaAttention(inbox).map((item) => item.kind)).toEqual(['permission', 'failed']);

    state = acknowledgeAttention(state, ['run:failed-run']);
    expect(unreadArenaAttention(buildArenaInbox([], sessions, discovery, state)).map((item) => item.kind)).toEqual(['permission']);
  });

  it('parses only bounded valid device attention ids and safely rejects malformed storage', () => {
    expect(parseDeviceArenaState('{broken')).toEqual(EMPTY_DEVICE_ARENA_STATE);
    expect(parseDeviceArenaState(JSON.stringify({ version: 2, acknowledgedIds: ['run:a'] })))
      .toEqual(EMPTY_DEVICE_ARENA_STATE);
    const parsed = parseDeviceArenaState(JSON.stringify({
      version: 1,
      acknowledgedIds: [123, 'run:a', 'run:a', 'bad\nvalue', ...Array.from({ length: 600 }, (_, index) => `run:${index}`)],
    }));
    expect(parsed.acknowledgedIds).toHaveLength(500);
    expect(parsed.acknowledgedIds.at(-1)).toBe('run:599');
  });
});
