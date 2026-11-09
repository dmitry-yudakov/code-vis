import { describe, expect, it } from 'vitest';
import {
  acknowledgeAttention, arenaSessionState, buildArenaInbox, buildMultiMachineInbox, EMPTY_DEVICE_ARENA_STATE,
  groupArenaSessions, parseDeviceArenaState, rememberArenaActiveOrder, unreadArenaAttention, viewedArenaCompletionIds, type ArenaActiveOrder,
} from '@/features/arena/arenaModel';
import type { ArenaMachineSnapshot, ArenaSessionSummary, AssistantMessage, DurableProject, RunDescriptor, RunDiscovery, UserMessage } from '@/shared/types';
import { createTurn, finishTurn } from '@/shared/turnActivity';

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
    execution: 'local',
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
  it('keeps successful replies Ready for one hour independently of metadata edits and unread state', () => {
    const finishedAt = Date.parse('2026-11-09T10:00:00Z');
    const completed = session(SESSION_A, new Date(finishedAt).toISOString());
    expect(arenaSessionState(completed, undefined, finishedAt + 60_000)).toBe('ready');
    expect(arenaSessionState(completed, undefined, finishedAt + 3_600_000 - 1)).toBe('ready');
    expect(arenaSessionState(completed, undefined, finishedAt + 3_600_000)).toBe('idle');
    expect(arenaSessionState({ ...completed, updatedAt: new Date(finishedAt + 20 * 3_600_000).toISOString() }, undefined, finishedAt + 20 * 3_600_000)).toBe('idle');
    expect(arenaSessionState(completed, run({ runId: 'live', sessionId: SESSION_A, state: 'running' }), finishedAt)).toBe('running');
    for (const status of ['cancelled', 'sending', 'sent', 'failed'] as const) {
      expect(arenaSessionState({ ...completed, lastActivity: { ...completed.lastActivity!, status } }, undefined, finishedAt)).toBe(status === 'failed' ? 'failed' : 'idle');
    }
    expect(arenaSessionState({ ...completed, lastActivity: undefined }, undefined, finishedAt)).toBe('idle');
    expect(arenaSessionState({ ...completed, lastActivity: { ...completed.lastActivity!, createdAt: 'invalid' } }, undefined, finishedAt)).toBe('idle');
  });

  it('keeps saved completion attention and its read identity after run expiry or a server restart', () => {
    const completed = session(SESSION_A, '2026-11-09T10:00:00Z');
    completed.lastActivity!.runId = 'completed-run';
    const recent = run({ runId: 'completed-run', sessionId: SESSION_A, state: 'finished', outcome: 'completed', finishedAt: Date.parse(completed.updatedAt) });
    const discovery = { active: [], recent: [recent] };
    const before = buildArenaInbox([], [completed], discovery, EMPTY_DEVICE_ARENA_STATE);
    const after = buildArenaInbox([], [completed], { active: [], recent: [] }, EMPTY_DEVICE_ARENA_STATE);
    expect(before).toHaveLength(1);
    expect(after).toMatchObject([{ id: before[0].id, kind: 'completed', read: false, createdAt: Date.parse(completed.lastActivity!.createdAt) }]);
    const state = acknowledgeAttention(EMPTY_DEVICE_ARENA_STATE, [before[0].id]);
    expect(buildArenaInbox([], [completed], { active: [], recent: [] }, state)[0].read).toBe(true);
    const next = { ...completed, lastActivity: { ...completed.lastActivity!, runId: 'next-run', messageId: crypto.randomUUID() } };
    expect(buildArenaInbox([], [next], { active: [], recent: [] }, state)[0].read).toBe(false);
    const legacy = { ...completed, lastActivity: { ...completed.lastActivity!, runId: undefined } };
    expect(buildArenaInbox([], [legacy], { active: [], recent: [] }, EMPTY_DEVICE_ARENA_STATE)).toMatchObject([{ kind: 'completed', id: `completion:${SESSION_A}:${legacy.lastActivity.messageId}` }]);
  });

  it('uses stable completion identity for older executors without conflating earlier turns', () => {
    const completed = session(SESSION_A, '2026-11-09T10:00:00Z');
    const at = Date.parse(completed.lastActivity!.createdAt);
    const recent = run({ runId: 'legacy-run', sessionId: SESSION_A, state: 'finished', outcome: 'completed', startedAt: at - 1_000, finishedAt: at + 10 });
    const before = buildArenaInbox([], [completed], { active: [], recent: [recent] }, EMPTY_DEVICE_ARENA_STATE);
    expect(before).toHaveLength(1);
    const state = acknowledgeAttention(EMPTY_DEVICE_ARENA_STATE, before.map(item => item.id));
    expect(buildArenaInbox([], [completed], { active: [], recent: [] }, state)[0]).toMatchObject({ id: before[0].id, read: true });
    const older = { ...recent, finishedAt: at - 1_000 };
    expect(buildArenaInbox([], [completed], { active: [], recent: [older] }, state)).toHaveLength(2);
    expect(buildArenaInbox([], [completed], { active: [], recent: [recent] }, acknowledgeAttention(EMPTY_DEVICE_ARENA_STATE, ['run:legacy-run']))[0].read).toBe(true);
  });

  it('marks all supported durable notices read and prunes obsolete markers without reviving retained ones', () => {
    const ids = Array.from({ length: 9_000 }, (_, i) => `machine:${i % 9}:run:${i}`);
    const all = acknowledgeAttention(EMPTY_DEVICE_ARENA_STATE, ids);
    expect(parseDeviceArenaState(JSON.stringify(all)).acknowledgedIds).toEqual(ids);
    const retained = new Set([...ids, 'run:new']);
    const busy = acknowledgeAttention(all, Array.from({ length: 11_000 }, (_, i) => `run:old-${i}`));
    const next = acknowledgeAttention(busy, ['run:new'], retained);
    expect(next.acknowledgedIds).toEqual([...ids, 'run:new']);
  });

  it('acknowledges only completions whose saved replies have loaded on the exact machine', () => {
    const completed = session(SESSION_A, '2026-11-09T10:00:00Z');
    completed.lastActivity!.runId = 'saved-run';
    const inbox = buildArenaInbox([], [completed], { active: [], recent: [] }, EMPTY_DEVICE_ARENA_STATE)
      .map(item => ({ ...item, id: `machine:home:${item.id}` }));
    const user: UserMessage = { id: crypto.randomUUID(), role: 'user', authorId: 'you', addressedParticipantId: AGENT, text: 'Work',
      createdAt: completed.updatedAt, status: 'sent', diagramAttachments: [] };
    user.turn = finishTurn(createTurn('saved-run', user.id, AGENT, user.createdAt), 'completed');
    const assistant: AssistantMessage = { id: completed.lastActivity!.messageId, role: 'assistant', authorId: AGENT,
      createdAt: completed.updatedAt, status: 'complete', rawMarkdown: 'Done', blocks: [] };
    const loaded = { id: completed.id, messages: [user, assistant] };
    expect(viewedArenaCompletionIds(inbox, 'home', { ...loaded, messages: [user] })).toEqual([]);
    expect(viewedArenaCompletionIds(inbox, 'remote', loaded)).toEqual([]);
    expect(viewedArenaCompletionIds(inbox, 'home', loaded)).toEqual([inbox[0].id]);
    expect(viewedArenaCompletionIds(inbox.map(item => ({ ...item, kind: 'permission' as const })), 'home', loaded)).toEqual([]);
    expect(viewedArenaCompletionIds(inbox, 'home', { ...loaded, messages: [user, { ...assistant, status: 'failed' }] })).toEqual([]);
  });

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

  it('puts what needs the user first within a project and between projects, then orders by recency', () => {
    const discovery: RunDiscovery = {
      active: [
        run({ runId: 'r1', sessionId: SESSION_A, state: 'needs-you' }),
        run({ runId: 'r2', sessionId: SESSION_C, state: 'running' }),
      ],
      recent: [],
    };
    const groups = groupArenaSessions(
      [
        project(PROJECT_A, 'Alpha', '2026-09-01T00:00:00.000Z'),
        project(PROJECT_B, 'Beta', '2026-09-02T00:00:00.000Z'),
      ],
      [
        session(SESSION_A, '2026-09-03T09:00:00.000Z', PROJECT_A),
        session(SESSION_C, '2026-09-03T11:00:00.000Z', PROJECT_A),
        session(SESSION_B, '2026-09-03T12:00:00.000Z', PROJECT_B),
        session('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '2026-09-03T08:00:00.000Z', PROJECT_B, 'failed'),
      ],
      discovery,
    );
    // Alpha holds the oldest session, but it is the one waiting on the user.
    expect(groups.map((group) => group.name)).toEqual(['Alpha', 'Beta']);
    expect(groups[0].sessions.map((card) => card.state)).toEqual(['needs-you', 'running']);
    expect(groups[1].sessions.map((card) => card.state)).toEqual(['failed', 'idle']);
  });

  it('optionally includes empty projects after session groups without changing archive/immersive grouping', () => {
    const projects = [
      project(PROJECT_A, 'Active', '2026-09-01T00:00:00.000Z'),
      project(PROJECT_B, 'Empty', '2026-11-04T00:00:00.000Z'),
    ];
    const sessions = [session(SESSION_A, '2026-09-03T09:00:00.000Z', PROJECT_A)];
    const discovery: RunDiscovery = { active: [], recent: [] };
    expect(groupArenaSessions(projects, sessions, discovery).map(group => group.name)).toEqual(['Active']);
    const groups = groupArenaSessions(projects, sessions, discovery, true, true, true);
    expect(groups.map(group => group.name)).toEqual(['Active', 'Empty']);
    expect(groups[1].sessions).toEqual([]);
    expect(groupArenaSessions(projects, [], discovery, true, true, true).map(group => group.name)).toEqual(['Empty', 'Active']);
  });

  it('retains initial Active positions while showing current titles, project names, activity and attention', () => {
    const projects = [project(PROJECT_A, 'Alpha', '2026-09-01'), project(PROJECT_B, 'Beta', '2026-09-02')];
    const sessions = [session(SESSION_A, '2026-09-03T10:00:00Z', PROJECT_A),
      session(SESSION_B, '2026-09-03T12:00:00Z', PROJECT_B), session(SESSION_C, '2026-09-03T11:00:00Z', PROJECT_A)];
    const order: ArenaActiveOrder = new Map();
    rememberArenaActiveOrder(order, groupArenaSessions(projects, sessions, { active: [], recent: [] }));
    const changed = sessions.map(item => item.id === SESSION_A ? { ...item, title: 'Updated title', updatedAt: '2026-11-08T12:00:00Z' } : item);
    const discovery: RunDiscovery = { active: [run({ runId: 'live', sessionId: SESSION_A, state: 'needs-you', status: 'Approve this command' })], recent: [] };
    projects[0] = { ...projects[0], name: 'Renamed Alpha' };
    // Remembering another snapshot only adds new positions; it cannot change existing ones.
    rememberArenaActiveOrder(order, groupArenaSessions(projects, changed, discovery));
    const groups = groupArenaSessions(projects, changed, discovery, true, true, true, order);
    expect(groups.map(group => group.name)).toEqual(['Beta', 'Renamed Alpha']);
    expect(groups[1].sessions.map(card => card.session.id)).toEqual([SESSION_C, SESSION_A]);
    expect(groups[1].sessions[1]).toMatchObject({ session: { title: 'Updated title' }, state: 'needs-you', activity: 'Approve this command' });
    expect(groupArenaSessions(projects, changed, discovery)[0].sessions[0].session.id).toBe(SESSION_A);
    const offline = groupArenaSessions(projects, changed, discovery, false, false, true, order);
    expect(offline.map(group => group.id)).toEqual([PROJECT_B, PROJECT_A]);
    expect(offline[1].sessions.map(card => card.state)).toEqual(['offline', 'offline']);
  });

  it('appends newly observed projects and sessions without moving empty projects or existing cards', () => {
    const projects = [project(PROJECT_A, 'Alpha', '2026-09-01'), project(PROJECT_B, 'Empty', '2026-09-02')];
    const discovery: RunDiscovery = { active: [], recent: [] };
    const sessions = [session(SESSION_A, '2026-09-03T10:00:00Z', PROJECT_A)];
    const order: ArenaActiveOrder = new Map();
    const group = () => groupArenaSessions(projects, sessions, discovery, true, true, true, order);
    rememberArenaActiveOrder(order, group());
    projects.push(project('new-project', 'Newest project', '2026-11-08'));
    sessions.push(session(SESSION_C, '2026-11-08T13:00:00Z', PROJECT_A), session(SESSION_B, '2026-11-08T14:00:00Z', PROJECT_B));
    rememberArenaActiveOrder(order, groupArenaSessions(projects, sessions, discovery, true, true, true));
    const groups = group();
    expect(groups.map(group => group.name)).toEqual(['Alpha', 'Empty', 'Newest project']);
    expect(groups[0].sessions.map(card => card.session.id)).toEqual([SESSION_A, SESSION_C]);
    expect(groups[1].sessions.map(card => card.session.id)).toEqual([SESSION_B]);
  });

  it('removes absent cards and restores their positions when they reappear, without retaining stale content', () => {
    const discovery: RunDiscovery = { active: [], recent: [] };
    const sessions = [session(SESSION_A, '2026-09-03T12:00:00Z'), session(SESSION_B, '2026-09-03T11:00:00Z')];
    const order: ArenaActiveOrder = new Map();
    rememberArenaActiveOrder(order, groupArenaSessions([], sessions, discovery));
    expect(groupArenaSessions([], [], discovery, true, true, true, order)).toEqual([]);
    const remaining = groupArenaSessions([], sessions.slice(1), discovery, true, true, true, order);
    rememberArenaActiveOrder(order, remaining);
    expect(remaining[0].sessions.map(card => card.session.id)).toEqual([SESSION_B]);
    const restored = { ...sessions[0], title: 'Restored', updatedAt: '2026-09-01T00:00:00Z' };
    const groups = groupArenaSessions([], [sessions[1], restored], discovery, true, true, true, order);
    expect(groups[0].sessions.map(card => card.session.id)).toEqual([SESSION_A, SESSION_B]);
    expect(groups[0].sessions[0].session.title).toBe('Restored');
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
      session(SESSION_B, '2026-09-03T11:00:00.000Z', PROJECT_B, 'failed'),
      session(SESSION_C, '2026-09-03T12:00:00.000Z'),
    ];
    sessions[0].lastActivity!.status = 'sending';
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
        run({ runId: 'completed-run', sessionId: SESSION_C, state: 'finished', finishedAt: Date.parse(sessions[2].updatedAt) + 1, outcome: 'completed' }),
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
      acknowledgedIds: [123, 'run:a', 'run:a', 'bad\nvalue', ...Array.from({ length: 20_100 }, (_, index) => `run:${index}`)],
    }));
    expect(parsed.acknowledgedIds).toHaveLength(20_000);
    expect(parsed.acknowledgedIds.at(-1)).toBe('run:20099');
  });

  it('marks cached machine cards offline and keeps Inbox routing bound to the owner', () => {
    const machine: ArenaMachineSnapshot = {
      machine: { id: PROJECT_B, label: 'Laptop', kind: 'remote', state: 'offline', lastSeenAt: '2026-09-03T12:00:00.000Z' },
      projects: [project(PROJECT_A, 'Alpha', '2026-09-01T00:00:00.000Z')],
      checkouts: [], recentCheckoutIds: [],
      providers: {
        claude: { available: false, authenticated: 'unknown', supportedModes: [] },
        codex: { available: false, authenticated: 'unknown', supportedModes: [] },
      },
      sessions: [session(SESSION_A, '2026-09-03T10:00:00.000Z', PROJECT_A, 'failed')],
      archivedSessions: [], runs: { active: [], recent: [] },
    };
    expect(groupArenaSessions(machine.projects, machine.sessions, machine.runs, false)[0].sessions[0])
      .toMatchObject({ state: 'offline', activity: 'Execution machine is offline' });
    const attention = buildMultiMachineInbox([machine], EMPTY_DEVICE_ARENA_STATE)[0];
    expect(attention).toMatchObject({
      id: `machine:${PROJECT_B}:failure:${SESSION_A}:${machine.sessions[0].lastActivity!.messageId}`,
      machineId: PROJECT_B,
      machineLabel: 'Laptop',
      machineOnline: false,
      read: false,
    });
    const acknowledged = acknowledgeAttention(EMPTY_DEVICE_ARENA_STATE, [attention.id]);
    expect(buildMultiMachineInbox([machine], acknowledged)[0].read).toBe(true);
  });
});


describe('lost Local execution after restart', () => {
  it('shows Needs you and an Inbox item only on a fresh online snapshot without an active or recent result', () => {
    const sending = { ...session(SESSION_A, '2026-09-03T10:00:00.000Z'), lastActivity: { messageId: 'lost', createdAt: '2026-09-03T10:00:00.000Z', status: 'sending' as const } };
    const discovery = { active: [], recent: [] };
    expect(groupArenaSessions([], [sending], discovery)[0].sessions[0]).toMatchObject({ state: 'needs-you', activity: 'Execution status unavailable' });
    const items = buildArenaInbox([], [sending], discovery, EMPTY_DEVICE_ARENA_STATE, { id: 'home', label: 'Home', online: true });
    expect(items).toMatchObject([{ kind: 'unavailable', reason: 'Execution status unavailable' }]);
    expect(groupArenaSessions([], [sending], discovery, false)[0].sessions[0].state).not.toBe('needs-you');
    expect(buildArenaInbox([], [sending], discovery, EMPTY_DEVICE_ARENA_STATE, { id: 'home', label: 'Home', online: false })).toEqual([]);
    expect(buildArenaInbox([], [sending], { active: [run({ runId: 'live', sessionId: SESSION_A, state: 'queued' })], recent: [] }, EMPTY_DEVICE_ARENA_STATE)).toEqual([]);
    expect(buildArenaInbox([], [{ ...sending, execution: 'docker' }], discovery, EMPTY_DEVICE_ARENA_STATE)).toEqual([]);
    expect(sending.lastActivity.status).toBe('sending');
  });
});
