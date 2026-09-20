import type { ArenaMachineSnapshot, ArenaSessionSummary } from '@/shared/types';
import type { DeviceArenaState, ArenaAttentionItem } from '@/features/arena/arenaModel';
import type { ImmersiveSessionChoice } from '@/features/diagram/spatial/immersiveTypes';

export const ARENA_ACTIONS = {
  sessions: 'Active sessions', inbox: 'Inbox', archived: 'Archived sessions',
  previous: 'Previous summary', next: 'Next summary', open: 'Open session', inspect: 'Inspect request',
  new: 'New session', archive: 'Archive', 'confirm-archive': 'Confirm archive', restore: 'Restore', acknowledge: 'Mark read', refresh: 'Refresh',
} as const;

export type ArenaActionName = keyof typeof ARENA_ACTIONS;
export type ArenaAction = `arena:${ArenaActionName}`;

export interface ImmersiveArenaControls {
  machines: ArenaMachineSnapshot[];
  deviceState: DeviceArenaState;
  active?: Pick<ImmersiveSessionChoice, 'machineId' | 'projectId' | 'sessionId'>;
  onOpen(choice: ImmersiveSessionChoice): void;
  onInspect(item: ArenaAttentionItem): void;
  onArchive(machineId: string, session: ArenaSessionSummary): Promise<boolean>;
  onRestore(machineId: string, session: ArenaSessionSummary): Promise<boolean>;
  onAcknowledge(itemIds: string[]): void;
  onRefresh(): Promise<void>;
}
