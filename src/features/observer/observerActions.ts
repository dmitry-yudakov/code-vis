import type { ObserverAction } from '@/shared/observer';
import type { ArenaMachineSnapshot, PublicSession, RunDiscovery, RunPermissionSummary } from '@/shared/types';
import { machineApiPath } from '@/features/machines/routes';

type SessionAction = Exclude<ObserverAction, { kind: 'build-and-restart' }>;
export interface ObserverActionPreview {
  action: SessionAction;
  title: string;
  permission?: RunPermissionSummary;
  original?: { id: string; text: string };
}

async function read<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The target is unavailable. Refresh and ask again.');
  return data;
}

function target(action: SessionAction, machines: ArenaMachineSnapshot[]) {
  const machine = machines.find(m => m.machine.id === action.machineId);
  const session = machine?.sessions.find(s => s.id === action.sessionId);
  if (!machine || !session || session.archivedAt || machine.machine.state !== 'online' || machine.snapshotFresh === false) {
    throw new Error('Refresh the overview before acting. The target is unavailable.');
  }
  return { machine, session };
}

async function current(action: SessionAction, localMachineId: string) {
  const api = (path: string) => machineApiPath(path, action.machineId, localMachineId);
  const [runs, saved] = await Promise.all([
    read<RunDiscovery>(api(`/api/agent/runs?sessionId=${action.sessionId}`)),
    read<{ session: PublicSession }>(api(`/api/sessions/${action.sessionId}`)),
  ]);
  if (saved.session?.id !== action.sessionId || saved.session.archivedAt) throw new Error('The session changed. Ask again.');
  const run = runs.active.find(r => r.runId === action.runId && r.sessionId === action.sessionId);
  return { api, run, session: saved.session };
}

function queuedMessage(session: PublicSession, runId: string) {
  return session.messages.find(m => m.role === 'user' && m.turn?.runId === runId);
}

/** Canonical permission summaries are displayed in full; model excerpts never authorize an action. */
export async function previewObserverAction(action: SessionAction, machines: ArenaMachineSnapshot[], localMachineId: string): Promise<ObserverActionPreview> {
  const { machine, session } = target(action, machines);
  const fresh = await current(action, localMachineId);
  if (!fresh.run) throw new Error('That turn is no longer active. Ask again.');
  const preview: ObserverActionPreview = { action,
    title: `${machine.machine.label} · ${machine.projects.find(p => p.id === session.projectId)?.name ?? 'No project'} · ${fresh.session.title}` };
  if (action.kind === 'permission') {
    const permission = fresh.run.pendingPermissions.find(p => p.requestId === action.requestId);
    if (!permission) throw new Error('That approval was already resolved. Ask again.');
    preview.permission = permission;
  } else if (action.kind === 'edit-queued') {
    const message = queuedMessage(fresh.session, action.runId);
    if (fresh.run.state !== 'queued' || !message || message.role !== 'user' || message.turn?.lifecycle !== 'queued') {
      throw new Error('Only a message whose turn is still queued can be corrected.');
    }
    preview.original = { id: message.id, text: message.text };
  }
  return preview;
}

export function observerActionLabel(preview: ObserverActionPreview): string {
  return preview.action.kind === 'permission' ? (preview.action.decision === 'allow' ? 'Approve request' : 'Deny request')
    : preview.action.kind === 'edit-queued' ? 'Save correction' : 'Cancel turn';
}

function actionReadback(preview: ObserverActionPreview): string {
  const action = preview.action;
  const detail = action.kind === 'permission' ? `${preview.permission?.tool}. ${preview.permission?.detail}`
    : action.kind === 'edit-queued' ? action.text : 'Stop this running or queued turn. Changes already made are kept.';
  const phrase = action.kind === 'permission' ? (action.decision === 'allow' ? 'Approve it' : 'Deny it')
    : action.kind === 'edit-queued' ? 'Save correction' : 'Confirm cancel turn';
  return `${preview.title}. ${observerActionLabel(preview)}. ${detail} Say ${phrase} to confirm, or Cancel.`;
}

export function observerActionSpeech(preview: ObserverActionPreview): string {
  const speech = actionReadback(preview);
  return speech.length <= 1200 ? speech : `${preview.title}. Review the full ${observerActionLabel(preview).toLowerCase()} preview and use its confirmation button. This action is too long to confirm by voice.`;
}

export function observerActionVoiceAllowed(preview: ObserverActionPreview): boolean {
  return actionReadback(preview).length <= 1200;
}

/** Retry only the pinned identity. A resolved permission or replaced run never selects another. */
export async function executeObserverAction(preview: ObserverActionPreview, machines: ArenaMachineSnapshot[], localMachineId: string): Promise<string> {
  const { action } = preview;
  target(action, machines);
  const { api, run, session } = await current(action, localMachineId);
  const message = action.kind === 'edit-queued' ? queuedMessage(session, action.runId) : undefined;
  // Reconcile even after the original turn finished following a lost edit response.
  if (action.kind === 'edit-queued' && message?.role === 'user' && message.id === preview.original?.id && message.text === action.text) return 'Correction saved.';
  if (!run) throw new Error('That turn is no longer active. Open the session to check the outcome.');
  let path: string;
  let body: Record<string, unknown>;
  if (action.kind === 'permission') {
    const permission = run.pendingPermissions.find(p => p.requestId === action.requestId);
    if (!permission || permission.tool !== preview.permission?.tool || permission.detail !== preview.permission?.detail
      || permission.participantId !== preview.permission?.participantId) throw new Error('That approval changed or was resolved. Ask again; no other request was approved.');
    path = '/api/agent/permission';
    body = { runId: action.runId, requestId: action.requestId, decision: action.decision };
  } else if (action.kind === 'edit-queued') {
    if (message?.role !== 'user' || message.id !== preview.original?.id) throw new Error('The queued message changed. Ask again.');
    if (run.state !== 'queued' || message.turn?.lifecycle !== 'queued' || message.text !== preview.original.text) throw new Error('The queued message changed or started. Ask again before correcting it.');
    path = '/api/agent/queued-message';
    body = { runId: action.runId, text: action.text, expectedText: preview.original.text };
  } else {
    path = '/api/agent/cancel'; body = { runId: action.runId };
  }
  let response: Response;
  let data: { ok?: boolean; error?: string };
  try {
    response = await fetch(api(path), { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    data = await response.json();
  } catch {
    throw new Error('Action outcome is unknown. Open the session to check its state before retrying this exact preview.');
  }
  if (!response.ok || data.ok !== true) throw new Error(data.error || 'The action could not be confirmed. Open the session to check its state.');
  return action.kind === 'permission' ? (action.decision === 'allow' ? 'Request approved.' : 'Request denied.')
    : action.kind === 'edit-queued' ? 'Correction saved.' : 'Turn cancellation requested. Changes already made are kept.';
}
