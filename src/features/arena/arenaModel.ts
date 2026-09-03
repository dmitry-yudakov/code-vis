import type {
  ArenaSessionSummary, DurableProject, RunDescriptor, RunDiscovery,
} from '@/shared/types';

export const DEVICE_ARENA_STORAGE_KEY = 'code-ai:device:v1:arena';
const MAX_ACKNOWLEDGED_ITEMS = 500;
const SAFE_ATTENTION_ID = /^[^\u0000-\u001f]{1,240}$/;

export type ArenaSessionState = 'idle' | 'running' | 'needs-you' | 'queued' | 'failed';
export type ArenaAttentionKind = 'permission' | 'failed' | 'completed';

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

function activeBySession(discovery: RunDiscovery): Map<string, RunDescriptor> {
  return new Map(discovery.active.map((run) => [run.sessionId, run]));
}

export function arenaSessionState(session: ArenaSessionSummary, run?: RunDescriptor): ArenaSessionState {
  if (run?.state === 'needs-you') return 'needs-you';
  if (run?.state === 'queued') return 'queued';
  if (run?.state === 'running') return 'running';
  return hasFailedActivity(session) ? 'failed' : 'idle';
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

export function groupArenaSessions(
  projects: readonly DurableProject[],
  sessions: readonly ArenaSessionSummary[],
  discovery: RunDiscovery,
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
      state: arenaSessionState(session, run),
      activity: arenaSessionActivity(session, run),
      ...(run ? { run } : {}),
    });
    if (lifecycleAt(session) > group.updatedAt) group.updatedAt = lifecycleAt(session);
    grouped.set(groupId, group);
  }

  return [...grouped.values()].sort((left, right) => (
    right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name)
  ));
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
): DeviceArenaState {
  const valid = itemIds.filter((id) => SAFE_ATTENTION_ID.test(id));
  if (!valid.length) return state;
  return {
    version: 1,
    acknowledgedIds: [...new Set([...state.acknowledgedIds, ...valid])].slice(-MAX_ACKNOWLEDGED_ITEMS),
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
      });
    }
  }

  const recentFailureSessions = new Set<string>();
  for (const run of discovery.recent) {
    if (run.outcome !== 'completed' && run.outcome !== 'failed') continue;
    const session = sessionsById.get(run.sessionId);
    if (!session) continue;
    if (run.outcome === 'failed') recentFailureSessions.add(session.id);
    const id = `run:${run.runId}`;
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
      read: acknowledged.has(id),
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
    });
  }

  const priority: Record<ArenaAttentionKind, number> = { permission: 0, failed: 1, completed: 2 };
  return items.sort((left, right) => (
    priority[left.kind] - priority[right.kind] || right.createdAt - left.createdAt
  ));
}

export function unreadArenaAttention(items: readonly ArenaAttentionItem[]): ArenaAttentionItem[] {
  return items.filter((item) => item.kind === 'permission' || !item.read);
}
