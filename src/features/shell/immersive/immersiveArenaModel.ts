import {
  buildMultiMachineInbox, groupArenaSessions,
  type ArenaAttentionItem, type ArenaSessionState, type DeviceArenaState,
} from '@/features/arena/arenaModel';
import type { ArenaMachineSnapshot, ArenaSessionSummary } from '@/shared/types';
import type { ImmersiveSessionChoice } from '@/features/diagram/spatial/immersiveTypes';

export type ImmersiveArenaTab = 'sessions' | 'inbox' | 'archived';
export const IMMERSIVE_ARENA_PAGE_SIZE = 6;

export interface ImmersiveArenaRow {
  key: string;
  kind: 'session' | 'attention';
  machineId: string;
  sessionId: string;
  projectId?: string;
  title: string;
  detail: string;
  state: ArenaSessionState;
  actionable: boolean;
  unread: boolean;
  archived?: boolean;
  session?: ArenaSessionSummary;
  attention?: ArenaAttentionItem;
  runId?: string;
  requestId?: string;
  choice: ImmersiveSessionChoice;
}

function choice(machine: ArenaMachineSnapshot, item: ArenaSessionSummary): ImmersiveSessionChoice {
  return {
    machineId: machine.machine.id,
    projectId: item.projectId,
    sessionId: item.id,
    title: item.title,
    updatedAt: item.updatedAt,
    detail: `${machine.projects.find((project) => project.id === item.projectId)?.name || 'No project'} · ${machine.machine.label} · ${machine.machine.state === 'online' ? 'Online' : 'Offline'}`,
  };
}

function sessionRows(machines: readonly ArenaMachineSnapshot[], archived: boolean): ImmersiveArenaRow[] {
  return machines.flatMap((machine) => groupArenaSessions(
    machine.projects,
    archived ? machine.archivedSessions : machine.sessions,
    machine.runs,
    machine.machine.state === 'online',
  ).flatMap((group) => group.sessions.map((card) => ({
    key: `session:${machine.machine.id}:${card.session.id}`,
    kind: 'session' as const,
    machineId: machine.machine.id,
    sessionId: card.session.id,
    projectId: card.session.projectId,
    title: card.session.title,
    detail: `${group.name} · ${machine.machine.label} · ${card.activity}`,
    state: card.state,
    actionable: machine.machine.state === 'online',
    unread: card.state === 'needs-you' || card.state === 'failed',
    archived,
    session: card.session,
    choice: choice(machine, card.session),
  }))));
}

export function buildImmersiveArenaRows(
  machines: readonly ArenaMachineSnapshot[],
  deviceState: DeviceArenaState,
  tab: ImmersiveArenaTab,
): ImmersiveArenaRow[] {
  if (tab !== 'inbox') return sessionRows(machines, tab === 'archived');
  const byMachine = new Map(machines.map((machine) => [machine.machine.id, machine]));
  return buildMultiMachineInbox(machines, deviceState).flatMap((item) => {
    const machine = item.machineId ? byMachine.get(item.machineId) : undefined;
    const session = machine?.sessions.find((candidate) => candidate.id === item.sessionId && candidate.projectId === item.projectId);
    if (!machine || !session) return [];
    return [{
      key: `attention:${item.id}`,
      kind: 'attention' as const,
      machineId: machine.machine.id,
      sessionId: session.id,
      projectId: session.projectId,
      title: session.title,
      detail: `${item.kind === 'permission' ? 'Needs you' : item.kind === 'failed' ? 'Failed' : 'Completed'} · ${machine.machine.label} · ${item.reason}`,
      state: (machine.machine.state !== 'online' ? 'offline' : item.kind === 'permission' ? 'needs-you' : item.kind === 'failed' ? 'failed' : 'idle') as ArenaSessionState,
      actionable: machine.machine.state === 'online',
      unread: item.kind === 'permission' || !item.read,
      attention: item,
      runId: item.runId,
      requestId: item.requestId,
      choice: choice(machine, session),
    }];
  });
}

export function pageImmersiveArenaRows(rows: readonly ImmersiveArenaRow[], requestedPage: number) {
  const pageCount = Math.max(1, Math.ceil(rows.length / IMMERSIVE_ARENA_PAGE_SIZE));
  const page = Math.max(0, Math.min(pageCount - 1, requestedPage));
  return {
    rows: rows.slice(page * IMMERSIVE_ARENA_PAGE_SIZE, (page + 1) * IMMERSIVE_ARENA_PAGE_SIZE),
    page,
    pageCount,
  };
}
