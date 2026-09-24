import type { PendingPermission } from '@/features/agents/toolActivity';
import type { ImmersiveReportSummary } from '@/shared/immersiveReport';
import type { AgentMode, AgentProvider, ArenaMachineSnapshot, CheckoutSummary } from '@/shared/types';

export interface PermissionTarget extends PendingPermission {
  machineId: string;
  sessionId: string;
  runId: string;
  sessionTitle: string;
  machineLabel: string;
  agentLabel: string;
}

export function permissionKey(target: Pick<PermissionTarget, 'machineId' | 'sessionId' | 'runId' | 'requestId'>): string {
  return JSON.stringify([target.machineId, target.sessionId, target.runId, target.requestId]);
}

/**
 * Route an inbound permission request into the review once, when its key first resolves to a
 * pending request. The Arena poll rebuilds the permission array every two seconds; re-applying
 * would drop the reviewer back to the first page of a command they are still reading. A different
 * key applies again, and clearing the route re-arms the same key for a later visit.
 */
export function permissionRequestUpdate(applied: string | undefined, requestedKey: string | undefined, resolved: boolean): { applied?: string; apply: boolean } {
  if (!requestedKey) return { apply: false };
  if (!resolved) return { applied, apply: false };
  return { applied: requestedKey, apply: applied !== requestedKey };
}

export interface PermissionResult {
  pending: boolean;
  message: string;
  retryable?: boolean;
}

export interface SessionCreation {
  machineId: string;
  projectId?: string;
  provider: AgentProvider;
  mode: AgentMode;
}

/**
 * Where a deliberate capture went: pending in the session that was active when it was taken and
 * still is, pending in a session the user has since left, or only saved.
 */
export type ImmersiveReportPlacement = 'active' | 'attached' | 'saved';

/** The shared report owner as the headset sees it; present only in CodeAI's own project. */
export interface ImmersiveReportControls {
  projectId: string;
  reports: ImmersiveReportSummary[];
  loading: boolean;
  error?: string;
  /** Report ids pending for the active session's next message. */
  pendingIds: string[];
  /** False without an active session, or while the pending list is full. */
  canAttach: boolean;
  onRefresh(): void;
  onAttach(id: string): void;
  onRemove(id: string): void;
}

/** Build & restart as the headset sees it; present only where this server can do it (Story 64). */
export interface ImmersiveCodeAiControls {
  status: string;
  confirmation: string;
  confirming: boolean;
  canRequest: boolean;
  onAsk(): void;
  onConfirm(): void;
  onDismiss(): void;
}

export interface ImmersiveSessionControls {
  machines: ArenaMachineSnapshot[];
  machineId?: string;
  sessionId?: string;
  sessionTitle?: string;
  creating: boolean;
  status: string;
  permissions: PermissionTarget[];
  results: Record<string, PermissionResult>;
  online: boolean;
  checkouts: CheckoutSummary[];
  needsRepository: boolean;
  canAttach: boolean;
  canCancel: boolean;
  cancelKey?: string;
  /** False while the open session has a live turn, or its machine is offline. */
  canArchive: boolean;
  canRetry: boolean;
  requestedPermissionKey?: string;
  reports?: ImmersiveReportControls;
  codeai?: ImmersiveCodeAiControls;
  onCreate(input: SessionCreation): Promise<boolean>;
  onAttach(checkoutId: string): Promise<void>;
  onDecide(target: PermissionTarget, decision: 'allow' | 'deny'): void;
  onRefresh(): void;
  onCancel(): void;
  /** Archives the session open when the controls were built; resolves true once it is archived. */
  onArchive(): Promise<boolean>;
  onRetry(): void;
  onReturn?(): void;
  onRevoke(): void;
}

export const SESSION_ACTIONS = {
  tools: 'Session tools', back: 'Back', launcher: 'New session', machine: 'Machine', project: 'Project',
  provider: 'Provider', mode: 'Mode', create: 'Create session',
  checkout: 'Repository', attach: 'Attach primary', permissions: 'Permissions',
  previous: 'Previous request', next: 'Next request', older: 'Previous details', newer: 'More details',
  allow: 'Allow', deny: 'Deny', refresh: 'Refresh status', cancel: 'Cancel run', retry: 'Retry instruction', return: 'Return to prior session',
  archive: 'Archive session', 'confirm-archive': 'Confirm archive',
  revoke: 'Forget this device', 'confirm-revoke': 'Confirm forget',
  reports: 'Reports', 'previous-report': 'Previous report', 'next-report': 'Next report',
  'attach-report': 'Attach report', 'remove-report': 'Remove report',
  codeai: 'CodeAI', 'build-restart': 'Build & restart', 'confirm-build-restart': 'Confirm build & restart',
} as const;
export type SessionActionName = keyof typeof SESSION_ACTIONS;
export type SessionAction = `session:${SessionActionName}`;
