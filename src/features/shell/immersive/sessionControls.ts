import type { PendingPermission } from '@/features/agents/toolActivity';
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

export interface ImmersiveSessionControls {
  machines: ArenaMachineSnapshot[];
  machineId?: string;
  sessionId?: string;
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
  canRetry: boolean;
  onCreate(input: SessionCreation): Promise<boolean>;
  onAttach(checkoutId: string): Promise<void>;
  onDecide(target: PermissionTarget, decision: 'allow' | 'deny'): void;
  onRefresh(): void;
  onCancel(): void;
  onRetry(): void;
  onRevoke(): void;
}

export const SESSION_ACTIONS = {
  tools: 'Session tools', back: 'Back', launcher: 'New session', machine: 'Machine', project: 'Project',
  provider: 'Provider', mode: 'Mode', create: 'Create session',
  checkout: 'Repository', attach: 'Attach primary', permissions: 'Permissions',
  previous: 'Previous request', next: 'Next request', older: 'Previous details', newer: 'More details',
  allow: 'Allow', deny: 'Deny', refresh: 'Refresh status', cancel: 'Cancel run', retry: 'Retry instruction',
  revoke: 'Forget this device', 'confirm-revoke': 'Confirm forget',
} as const;
export type SessionActionName = keyof typeof SESSION_ACTIONS;
export type SessionAction = `session:${SessionActionName}`;
