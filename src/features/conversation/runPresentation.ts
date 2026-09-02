import {
  MAX_TOOL_ACTIVITY_ENTRIES, permissionLabel, toolActivityLabel,
  type PendingPermission, type ToolActivityEntry,
} from '@/features/agents/toolActivity';
import type { AgentEvent, AgentMode, ChatMessage, RunState, UserMessage } from '@/shared/types';

export interface RunPresentation {
  runId?: string;
  sessionId: string;
  participantId: string;
  mode: AgentMode;
  state: Exclude<RunState, 'finished'>;
  queuePosition?: number;
  status: string;
  preview: string;
  toolActivity: ToolActivityEntry[];
  runFailed: boolean;
  permissions: PendingPermission[];
  pendingPermissionCount?: number;
  decidingPermission?: string;
}

export interface SessionRunOutcome {
  runId?: string;
  message: string;
  missingProviderSession: boolean;
  continueMode?: AgentMode;
}

export type SessionRunOutcomes = Record<string, SessionRunOutcome>;

/** The stream endpoint reports how many leading events are historical replay. */
export function isReplayedStreamEvent(eventIndex: number, replayEventCount: number): boolean {
  return eventIndex < replayEventCount;
}

/** Recovery resolves the accepted turn from the canonical transcript, where its actual mode lives. */
export function latestRunUserMessage(
  messages: readonly ChatMessage[],
  participantId: string,
): UserMessage | undefined {
  return messages.findLast((message): message is UserMessage => (
    message.role === 'user' && message.addressedParticipantId === participantId
  ));
}

/** Historical terminal replay restores attention without duplicating an unread already persisted. */
export function unreadAfterRunAttention(unread: number, replayed: boolean): number {
  return replayed ? Math.max(unread, 1) : unread + 1;
}

export function runOutcomeFromError(
  event: Extract<AgentEvent, { type: 'error' }>,
  mode: AgentMode,
): SessionRunOutcome {
  return {
    runId: event.runId,
    message: event.message,
    missingProviderSession: event.code === 'missing-session',
    ...(event.code === 'max-turns' ? { continueMode: mode } : {}),
  };
}

/** Immutable update used by AppShell so one session cannot clear another session's outcome. */
export function withSessionRunOutcome(
  outcomes: SessionRunOutcomes,
  sessionId: string,
  outcome?: SessionRunOutcome,
): SessionRunOutcomes {
  if (outcome) return { ...outcomes, [sessionId]: outcome };
  if (!(sessionId in outcomes)) return outcomes;
  const next = { ...outcomes };
  delete next[sessionId];
  return next;
}

/** Pure, run-scoped presentation update. AppShell owns canonical-session side effects separately. */
export function applyRunEvent(
  run: RunPresentation,
  event: AgentEvent,
  toolActivityKey?: number,
): RunPresentation {
  const identified = { ...run, runId: event.runId };
  if (event.type === 'run-started') {
    return {
      ...identified,
      participantId: event.participantId,
      state: 'running',
      queuePosition: undefined,
    };
  }
  if (event.type === 'status') {
    const queued = event.phase === 'queued';
    return {
      ...identified,
      state: queued ? 'queued' : run.state === 'needs-you' ? 'needs-you' : 'running',
      queuePosition: queued ? Number(event.label.match(/position (\d+)/)?.[1]) || undefined : undefined,
      status: event.label,
    };
  }
  if (event.type === 'tool-activity') {
    const entry = { tool: event.tool, detail: event.detail, denied: event.denied };
    return {
      ...identified,
      status: toolActivityLabel(entry),
      toolActivity: [
        ...run.toolActivity,
        { ...entry, key: toolActivityKey ?? run.toolActivity.length },
      ].slice(-MAX_TOOL_ACTIVITY_ENTRIES),
    };
  }
  if (event.type === 'permission-request') {
    const request: PendingPermission = {
      requestId: event.requestId,
      participantId: event.participantId,
      tool: event.tool,
      detail: event.detail,
    };
    const permissions = run.permissions.some((item) => item.requestId === request.requestId)
      ? run.permissions
      : [...run.permissions, request];
    return {
      ...identified,
      state: 'needs-you',
      permissions,
      pendingPermissionCount: permissions.length,
      status: `Waiting for your approval — ${permissionLabel(request)}`,
    };
  }
  if (event.type === 'permission-resolved') {
    const permissions = run.permissions.filter((item) => item.requestId !== event.requestId);
    return {
      ...identified,
      state: permissions.length ? 'needs-you' : 'running',
      permissions,
      pendingPermissionCount: permissions.length,
      status: permissions.length ? run.status : 'Continuing agent turn',
    };
  }
  if (event.type === 'assistant-delta') {
    return { ...identified, preview: run.preview + event.delta };
  }
  if (event.type === 'assistant-message') {
    return { ...identified, preview: '' };
  }
  if (event.type === 'error') {
    return { ...identified, runFailed: true, status: event.message };
  }
  return identified;
}
