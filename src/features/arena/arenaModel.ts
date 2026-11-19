import type {
  ArenaMachineSnapshot, ArenaSessionSummary, DurableProject, PublicSession, RunDescriptor, RunDiscovery,
} from '@/shared/types';

export const DEVICE_ARENA_STORAGE_KEY = 'code-ai:device:v1:arena';
// Nine machines can each retain 1,000 sessions plus recent runs. Obsolete ids are pruned on read.
const MAX_ACKNOWLEDGED_ITEMS = 20_000;
const SAFE_ATTENTION_ID = /^[^\u0000-\u001f]{1,240}$/;

export type ArenaSessionState = 'idle' | 'ready' | 'running' | 'needs-you' | 'queued' | 'failed' | 'offline';
export const ARENA_READY_MS = 60 * 60 * 1_000;
export type ArenaAttentionKind = 'permission' | 'failed' | 'completed' | 'unavailable';

export interface DeviceArenaState {
  version: 1;
  acknowledgedIds: string[];
}

export interface ArenaSessionCard {
  session: ArenaSessionSummary;
  projectName: string;
  state: ArenaSessionState;
  activity: string;
  run?: RunDescriptor;
}

export interface ArenaProjectGroup {
  id: string;
  name: string;
  sessions: ArenaSessionCard[];
  updatedAt: string;
}

export const ARENA_ARCHIVE_PAGE_SIZE = 40;

interface ArenaArchiveGroup {
  date: string;
  sessions: { machine: ArenaMachineSnapshot; session: ArenaSessionSummary; projectName: string }[];
}

/** Archive chronology is global, independent of Active's project and attention ordering. */
export function groupArchivedArenaSessions(
  machines: readonly ArenaMachineSnapshot[],
  limit = ARENA_ARCHIVE_PAGE_SIZE,
): ArenaArchiveGroup[] {
  const entries = machines.flatMap(machine => {
    const projects = new Map(machine.projects.map(project => [project.id, project.name]));
    return machine.archivedSessions.map(session => ({ machine, session, projectName: projectNameFor(session, projects) }));
  });
  const archivedAt = (session: ArenaSessionSummary) => Date.parse(session.archivedAt || session.updatedAt);
  entries.sort((left, right) => archivedAt(right.session) - archivedAt(left.session));
  const groups = new Map<string, ArenaArchiveGroup>();
  for (const entry of entries.slice(0, limit)) {
    const date = new Date(archivedAt(entry.session)).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    const group = groups.get(date) || { date, sessions: [] };
    group.sessions.push(entry);
    groups.set(date, group);
  }
  return [...groups.values()];
}

/** An explicit move saves group positions. Session positions stay in memory. */
export type ArenaActiveOrder = Map<string, { index: number; sessions: Map<string, number> }>;

export function parseArenaProjectOrder(value: string | null): ArenaActiveOrder {
  const order: ArenaActiveOrder = new Map();
  try {
    const ids: unknown = JSON.parse(value ?? '[]');
    if (Array.isArray(ids)) {
      for (const id of ids) {
        if (typeof id === 'string' && id && !order.has(id)) order.set(id, { index: order.size, sessions: new Map() });
      }
    }
  } catch { /* optional device preference */ }
  return order;
}

export function moveArenaProject(order: ArenaActiveOrder, projectId: string, targetId: string): string[] | undefined {
  const source = order.get(projectId);
  const target = order.get(targetId);
  if (!source || !target || source === target) return;

  const ids = [...order.keys()].sort((left, right) => order.get(left)!.index - order.get(right)!.index);
  ids.splice(source.index, 1);
  ids.splice(target.index, 0, projectId);
  ids.forEach((id, index) => { order.get(id)!.index = index; });
  return ids;
}

export function rememberArenaActiveOrder(order: ArenaActiveOrder, groups: readonly ArenaProjectGroup[]): void {
  for (const group of groups) {
    let position = order.get(group.id);
    if (!position) {
      position = { index: order.size, sessions: new Map() };
      order.set(group.id, position);
    }
    for (const card of group.sessions) {
      if (!position.sessions.has(card.session.id)) position.sessions.set(card.session.id, position.sessions.size);
    }
  }
}

export interface ArenaAttentionItem {
  id: string;
  kind: ArenaAttentionKind;
  sessionId: string;
  projectId?: string;
  projectName: string;
  sessionTitle: string;
  reason: string;
  createdAt: number;
  runId?: string;
  requestId?: string;
  read: boolean;
  machineId?: string;
  machineLabel?: string;
  machineOnline?: boolean;
}

export const EMPTY_DEVICE_ARENA_STATE: DeviceArenaState = { version: 1, acknowledgedIds: [] };

function hasFailedActivity(session: ArenaSessionSummary): boolean {
  return session.lastActivity?.status === 'failed';
}

function lastActivity(session: ArenaSessionSummary): string {
  const activity = session.lastActivity;
  if (!activity) return 'Ready for an instruction';
  if (activity.status === 'failed') return 'The last turn failed before completing';
  if (activity.status === 'cancelled') return 'The last turn was cancelled';
  if (activity.status === 'sending' || activity.status === 'sent') return 'Waiting for the agent';
  return 'Turn completed';
}

/** Allow the acceptance write/activation frame to settle before declaring a lost executor. */
function executionUnavailable(session: ArenaSessionSummary, discovery: RunDiscovery): boolean {
  const activity = session.lastActivity;
  return session.execution !== 'docker' && activity?.status === 'sending'
    && Date.now() - Date.parse(activity.createdAt) > 5_000
    && !discovery.active.some((run) => run.sessionId === session.id)
    && !discovery.recent.some((run) => run.sessionId === session.id && (run.finishedAt ?? 0) >= Date.parse(activity.createdAt));
}

function activeBySession(discovery: RunDiscovery): Map<string, RunDescriptor> {
  return new Map(discovery.active.map((run) => [run.sessionId, run]));
}

export function arenaSessionState(session: ArenaSessionSummary, run?: RunDescriptor, now = Date.now()): ArenaSessionState {
  if (run?.state === 'needs-you') return 'needs-you';
  if (run?.state === 'queued') return 'queued';
  if (run?.state === 'running') return 'running';
  if (hasFailedActivity(session)) return 'failed';
  if (session.lastActivity?.status === 'complete' && now - Date.parse(session.lastActivity.createdAt) < ARENA_READY_MS) return 'ready';
  return 'idle';
}

export function arenaSessionActivity(session: ArenaSessionSummary, run?: RunDescriptor): string {
  if (run?.status) return run.status;
  if (run?.state === 'needs-you') {
    const permission = run.pendingPermissions[0];
    return permission
      ? `Waiting for approval — ${permission.tool}${permission.detail ? `: ${permission.detail}` : ''}`
      : 'Waiting for your approval';
  }
  if (run?.state === 'queued') return `Queued · position ${run.queuePosition || 1}`;
  if (run?.state === 'running') return 'Agent turn is running';
  return lastActivity(session);
}

/** What waits on the user comes first; what merely happened recently follows. */
const ATTENTION_RANK: Record<ArenaSessionState, number> = {
  'needs-you': 0, failed: 1, running: 2, queued: 3, ready: 4, idle: 5, offline: 6,
};

export function groupArenaSessions(
  projects: readonly DurableProject[],
  sessions: readonly ArenaSessionSummary[],
  discovery: RunDiscovery,
  machineOnline = true,
  fresh = true,
  includeEmptyProjects = false,
  order?: ArenaActiveOrder,
  now = Date.now(),
): ArenaProjectGroup[] {
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const active = activeBySession(discovery);
  const grouped = new Map<string, ArenaProjectGroup>();

  const lifecycleAt = (session: ArenaSessionSummary) => session.archivedAt || session.updatedAt;
  for (const session of [...sessions].sort((left, right) => lifecycleAt(right).localeCompare(lifecycleAt(left)))) {
    const groupId = session.projectId || 'none';
    const projectName = session.projectId ? projectNames.get(session.projectId) || 'Unknown project' : 'No project';
    const run = active.get(session.id);
    const group = grouped.get(groupId) || {
      id: groupId,
      name: projectName,
      sessions: [],
      updatedAt: lifecycleAt(session),
    };
    group.sessions.push({
      session,
      projectName,
      state: machineOnline ? fresh && executionUnavailable(session, discovery) ? 'needs-you' : arenaSessionState(session, run, now) : 'offline',
      activity: machineOnline ? fresh && executionUnavailable(session, discovery) ? 'Execution status unavailable' : arenaSessionActivity(session, run) : 'Execution machine is offline',
      ...(run ? { run } : {}),
    });
    if (lifecycleAt(session) > group.updatedAt) group.updatedAt = lifecycleAt(session);
    grouped.set(groupId, group);
  }

  if (includeEmptyProjects) {
    for (const project of projects) {
      if (!grouped.has(project.id)) grouped.set(project.id, {
        id: project.id, name: project.name, sessions: [], updatedAt: project.updatedAt,
      });
    }
  }

  // Sessions arrived newest first, so a stable sort by attention keeps recency within each state.
  const groups = [...grouped.values()];
  for (const group of groups) group.sessions.sort((left, right) => ATTENTION_RANK[left.state] - ATTENTION_RANK[right.state]);
  const rank = (group: ArenaProjectGroup) => group.sessions.length ? ATTENTION_RANK[group.sessions[0].state] : 7;
  groups.sort((left, right) => (
    rank(left) - rank(right)
    || right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name)
  ));
  if (order) {
    for (const group of groups) {
      const positions = order.get(group.id)?.sessions;
      if (positions) group.sessions.sort((left, right) => (
        (positions.get(left.session.id) ?? positions.size) - (positions.get(right.session.id) ?? positions.size)
      ));
    }
    groups.sort((left, right) => (order.get(left.id)?.index ?? order.size) - (order.get(right.id)?.index ?? order.size));
  }
  return groups;
}

export function parseDeviceArenaState(value: string | null): DeviceArenaState {
  if (!value) return EMPTY_DEVICE_ARENA_STATE;
  try {
    const candidate = JSON.parse(value) as { version?: unknown; acknowledgedIds?: unknown };
    if (candidate.version !== 1 || !Array.isArray(candidate.acknowledgedIds)) {
      return EMPTY_DEVICE_ARENA_STATE;
    }
    const acknowledgedIds = [...new Set(candidate.acknowledgedIds.flatMap((item) => (
      typeof item === 'string' && SAFE_ATTENTION_ID.test(item) ? [item] : []
    )))].slice(-MAX_ACKNOWLEDGED_ITEMS);
    return { version: 1, acknowledgedIds };
  } catch {
    return EMPTY_DEVICE_ARENA_STATE;
  }
}

export function acknowledgeAttention(
  state: DeviceArenaState,
  itemIds: readonly string[],
  retainedIds?: ReadonlySet<string>,
): DeviceArenaState {
  const valid = itemIds.filter((id) => SAFE_ATTENTION_ID.test(id));
  if (!valid.length) return state;
  return {
    version: 1,
    acknowledgedIds: [...new Set([...state.acknowledgedIds.filter(id => !retainedIds || retainedIds.has(id)), ...valid])].slice(-MAX_ACKNOWLEDGED_ITEMS),
  };
}

function projectNameFor(session: ArenaSessionSummary, projects: Map<string, string>): string {
  return session.projectId ? projects.get(session.projectId) || 'Unknown project' : 'No project';
}

/** Permissions are live obligations; terminal items are quiet, device-readable attention. */
export function buildArenaInbox(
  projects: readonly DurableProject[],
  sessions: readonly ArenaSessionSummary[],
  discovery: RunDiscovery,
  deviceState: DeviceArenaState,
  machine?: { id: string; label: string; online: boolean; fresh?: boolean },
): ArenaAttentionItem[] {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const projectsById = new Map(projects.map((project) => [project.id, project.name]));
  const acknowledged = new Set(deviceState.acknowledgedIds);
  const items: ArenaAttentionItem[] = [];

  for (const run of discovery.active) {
    const session = sessionsById.get(run.sessionId);
    if (!session) continue;
    for (const permission of run.pendingPermissions) {
      items.push({
        id: `permission:${run.runId}:${permission.requestId}`,
        kind: 'permission',
        sessionId: session.id,
        ...(session.projectId ? { projectId: session.projectId } : {}),
        projectName: projectNameFor(session, projectsById),
        sessionTitle: session.title,
        reason: `${permission.tool}${permission.detail ? `: ${permission.detail}` : ''}`,
        createdAt: run.startedAt || run.enqueuedAt,
        runId: run.runId,
        requestId: permission.requestId,
        read: false,
        ...(machine ? { machineId: machine.id, machineLabel: machine.label, machineOnline: machine.online } : {}),
      });
    }
  }

  const recentFailureSessions = new Set<string>();
  const recentCompletionSessions = new Set<string>();
  for (const run of discovery.recent) {
    if (run.outcome !== 'completed' && run.outcome !== 'failed') continue;
    const session = sessionsById.get(run.sessionId);
    if (!session) continue;
    if (run.outcome === 'failed') recentFailureSessions.add(session.id);
    const completion = session.lastActivity?.status === 'complete' ? session.lastActivity : undefined;
    // Older executors lack saved run ids. Match the reply to its execution interval and use its
    // message identity both before and after the live registry expires.
    const legacyCompletion = run.outcome === 'completed' && completion && !completion.runId
      && Date.parse(completion.createdAt) >= (run.startedAt ?? run.enqueuedAt)
      && Date.parse(completion.createdAt) <= (run.finishedAt ?? 0);
    if (run.outcome === 'completed' && (completion?.runId === run.runId || legacyCompletion)) recentCompletionSessions.add(session.id);
    const id = legacyCompletion ? `completion:${session.id}:${completion.messageId}` : `run:${run.runId}`;
    items.push({
      id,
      kind: run.outcome,
      sessionId: session.id,
      ...(session.projectId ? { projectId: session.projectId } : {}),
      projectName: projectNameFor(session, projectsById),
      sessionTitle: session.title,
      reason: run.outcome === 'failed' ? run.status || 'The turn failed' : 'Turn completed',
      createdAt: run.finishedAt || run.startedAt || run.enqueuedAt,
      runId: run.runId,
      read: acknowledged.has(id) || acknowledged.has(`run:${run.runId}`),
      ...(machine ? { machineId: machine.id, machineLabel: machine.label, machineOnline: machine.online } : {}),
    });
  }

  // Successful replies survive the live registry's five-minute window and process restarts too.
  for (const session of sessions) {
    const completion = session.lastActivity?.status === 'complete' ? session.lastActivity : undefined;
    if (!completion || recentCompletionSessions.has(session.id)) continue;
    const id = completion.runId ? `run:${completion.runId}` : `completion:${session.id}:${completion.messageId}`;
    items.push({
      id, kind: 'completed', sessionId: session.id,
      ...(session.projectId ? { projectId: session.projectId } : {}),
      projectName: projectNameFor(session, projectsById), sessionTitle: session.title,
      reason: 'Turn completed', createdAt: Date.parse(completion.createdAt) || 0,
      ...(completion.runId ? { runId: completion.runId } : {}),
      read: acknowledged.has(id),
      ...(machine ? { machineId: machine.id, machineLabel: machine.label, machineOnline: machine.online } : {}),
    });
  }

  // A canonical failure outlives the run registry's short replay window.
  for (const session of sessions) {
    const failure = session.lastActivity?.status === 'failed' ? session.lastActivity : undefined;
    if (!failure || recentFailureSessions.has(session.id)) continue;
    const id = `failure:${session.id}:${failure.messageId}`;
    items.push({
      id,
      kind: 'failed',
      sessionId: session.id,
      ...(session.projectId ? { projectId: session.projectId } : {}),
      projectName: projectNameFor(session, projectsById),
      sessionTitle: session.title,
      reason: 'The last turn failed',
      createdAt: Date.parse(failure.createdAt) || Date.parse(session.updatedAt) || 0,
      read: acknowledged.has(id),
      ...(machine ? { machineId: machine.id, machineLabel: machine.label, machineOnline: machine.online } : {}),
    });
  }

  if (machine?.online !== false && machine?.fresh !== false) for (const session of sessions) {
    if (!executionUnavailable(session, discovery)) continue;
    const id = `unavailable:${session.id}:${session.lastActivity!.messageId}`;
    items.push({ id, kind: 'unavailable', sessionId: session.id, projectId: session.projectId,
      projectName: projectNameFor(session, projectsById), sessionTitle: session.title, reason: 'Execution status unavailable',
      createdAt: Date.parse(session.lastActivity!.createdAt), read: acknowledged.has(id),
      ...(machine ? { machineId: machine.id, machineLabel: machine.label, machineOnline: machine.online } : {}) });
  }
  const priority: Record<ArenaAttentionKind, number> = { permission: 0, unavailable: 1, failed: 2, completed: 3 };
  return items.sort((left, right) => (
    priority[left.kind] - priority[right.kind] || right.createdAt - left.createdAt
  ));
}

export function buildMultiMachineInbox(
  machines: readonly ArenaMachineSnapshot[],
  deviceState: DeviceArenaState,
): ArenaAttentionItem[] {
  const acknowledged = new Set(deviceState.acknowledgedIds);
  const items = machines.flatMap((entry) => buildArenaInbox(
    entry.projects,
    entry.sessions,
    entry.runs,
    EMPTY_DEVICE_ARENA_STATE,
    { id: entry.machine.id, label: entry.machine.label, online: entry.machine.state === 'online', fresh: entry.snapshotFresh },
  ).map((item) => {
    const id = `machine:${entry.machine.id}:${item.id}`;
    // Preserve local read markers written before the Arena became machine-qualified.
    const read = item.kind !== 'permission' && (
      acknowledged.has(id) || (item.runId && acknowledged.has(`machine:${entry.machine.id}:run:${item.runId}`))
      || (entry.machine.kind === 'local' && (acknowledged.has(item.id) || Boolean(item.runId && acknowledged.has(`run:${item.runId}`))))
    );
    return { ...item, id, read };
  }));
  const priority: Record<ArenaAttentionKind, number> = { permission: 0, unavailable: 1, failed: 2, completed: 3 };
  return items.sort((left, right) => (
    priority[left.kind] - priority[right.kind] || right.createdAt - left.createdAt
  ));
}

export function unreadArenaAttention(items: readonly ArenaAttentionItem[]): ArenaAttentionItem[] {
  return items.filter((item) => item.kind === 'permission' || !item.read);
}

/** Only acknowledge successful replies actually loaded in the visible conversation. */
export function viewedArenaCompletionIds(items: readonly ArenaAttentionItem[], machineId: string, session: Pick<PublicSession, 'id' | 'messages'>): string[] {
  const viewed = new Set<string>();
  let runId: string | undefined;
  for (const message of session.messages) {
    if (message.role === 'user') runId = message.turn?.runId;
    else if (message.status === 'complete') {
      viewed.add(`machine:${machineId}:completion:${session.id}:${message.id}`);
      if (runId) viewed.add(`machine:${machineId}:run:${runId}`);
    }
  }
  return items.filter(item => item.kind === 'completed' && !item.read && viewed.has(item.id)).map(item => item.id);
}
