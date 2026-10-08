import type { AgentExecution, AgentProvider, GlobalInstructionsChoice, ModelSelection, PublicSession } from '@/shared/types';
import type { LaunchMode } from '@/shared/agentModes';
import type { PreparedCodeAiContext } from '@/shared/codeAiSession';
import type { TextFile } from '@/shared/textFiles';
import { validateTextFiles } from '@/shared/textFiles';
import { machineApiPath } from '@/features/machines/routes';
import { IMAGE_ONLY_INSTRUCTION } from '@/features/conversation/imageAttachments';
import { launchInstructions } from '@/features/shell/devicePreferences';
import { REPORT_ONLY_INSTRUCTION } from '@/features/reports/reportModel';

export interface LaunchSettings {
  machineId: string;
  projectId?: string;
  checkoutId?: string;
  execution: AgentExecution;
  checkoutMode: 'current' | 'worktree';
  provider: AgentProvider;
  mode: LaunchMode;
  /** Remember the device choice; filter unsupported choices only at the wire/UI boundary. */
  instructions?: GlobalInstructionsChoice;
  modelSelection: ModelSelection;
  codeai?: PreparedCodeAiContext;
}
export interface LaunchContent {
  text: string;
  images: Array<{ dataUrl: string }>;
  files: TextFile[];
  reportIds: string[];
}
export interface LaunchAttempt {
  settings: LaunchSettings;
  content: LaunchContent;
  creationRequestId: string;
  messageId: string;
  session?: PublicSession;
  messageAttempted?: boolean;
}
export const FILE_ONLY_INSTRUCTION = 'Read the attached text files and explain what matters for this repository.';
export const MIXED_EVIDENCE_INSTRUCTION = 'Review the attached evidence and explain what matters for this repository.';
export function launchText(content: LaunchContent): string {
  if (content.text.trim()) return content.text.trim();
  const kinds = Number(Boolean(content.images.length)) + Number(Boolean(content.files.length)) + Number(Boolean(content.reportIds.length));
  return kinds > 1 ? MIXED_EVIDENCE_INSTRUCTION : content.images.length ? IMAGE_ONLY_INSTRUCTION
    : content.files.length ? FILE_ONLY_INSTRUCTION : content.reportIds.length ? REPORT_ONLY_INSTRUCTION : '';
}
export class LaunchFailure extends Error {
  constructor(message: string, public readonly editable: boolean, public readonly uncertain = false,
    public readonly worktreeConflict?: unknown) { super(message); }
}
export interface LaunchResult { session: PublicSession; started: boolean; runId?: string }

/** Explicit captured target throughout. Never reads or selects the open conversation. */
export async function launchSession(attempt: LaunchAttempt, localMachineId: string,
  request: typeof fetch = fetch, onCreated?: (session: PublicSession) => void): Promise<LaunchResult> {
  const { settings, content } = attempt;
  const instructions = launchInstructions(settings.instructions, settings.execution, settings.provider);
  validateTextFiles(content.files);
  const payloadBytes = new TextEncoder().encode(JSON.stringify({ ...content, text: launchText(content), settings,
    sessionId: '00000000-0000-0000-0000-000000000000', participantId: '00000000-0000-0000-0000-000000000000', messageId: attempt.messageId })).length;
  if (payloadBytes > 5_999_000) throw new LaunchFailure('The complete message is too large. Remove evidence before starting.', true);

  const api = (path: string) => machineApiPath(path, settings.machineId, localMachineId);
  if (!attempt.session) {
    let response: Response;
    try {
      response = await request(settings.codeai ? '/api/codeai-session' : api('/api/sessions'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings.codeai ? {
          action: 'create', preparedContext: settings.codeai, provider: settings.provider, instructions,
          checkoutMode: settings.checkoutMode, creationRequestId: attempt.creationRequestId,
        } : { projectId: settings.projectId, checkoutId: settings.projectId ? undefined : settings.checkoutId,
          provider: settings.provider, instructions, execution: settings.execution,
          checkoutMode: settings.checkoutMode, creationRequestId: attempt.creationRequestId }),
      });
    } catch { throw new LaunchFailure('Creation status is unknown. Retry keeps this exact request.', false, true); }
    const data = await response.json().catch(() => ({})) as { session?: PublicSession; error?: string; creationState?: string; worktreeConflict?: unknown };
    if (response.status === 400 && data.creationState === undefined && !settings.codeai && settings.checkoutMode === 'current'
      && data.error === 'Choose valid session settings. Worktree creation requires one source repository and a creation request UUID.') {
      throw new LaunchFailure('This executor does not support durable session creation. Update CodeAI on that machine before starting this session.', true);
    }
    if (!response.ok || !data.session) throw new LaunchFailure(data.error || 'Could not create the session.', data.creationState === 'none', data.creationState !== 'none', data.worktreeConflict);
    attempt.session = data.session;
    onCreated?.(data.session);
  }
  const session = attempt.session;
  if (session.archivedAt) throw new LaunchFailure('This session is archived. Open it in Archived to restore it, or clear setup.', true);
  const text = launchText(content);
  if (!text) return { session, started: false };
  if (!session.repositories.some((binding) => binding.role === 'primary')) {
    throw new LaunchFailure('The session was created. Choose a repository in it before sending an instruction.', true);
  }
  const reconcile = async (): Promise<PublicSession | undefined> => {
    const response = await request(api(`/api/sessions/${encodeURIComponent(session.id)}`), { cache: 'no-store' });
    const data = await response.json() as { session?: PublicSession };
    if (!response.ok || !data.session) throw new Error('Could not read the saved session.');
    return data.session.messages.some((message) => message.id === attempt.messageId && message.role === 'user') ? data.session : undefined;
  };
  if (attempt.messageAttempted) {
    try { const saved = await reconcile(); if (saved) return { session: saved, started: true }; }
    catch { throw new LaunchFailure('Could not confirm delivery. Retry checks the same session and message.', false, true); }
  }
  attempt.messageAttempted = true;
  let response: Response | undefined;
  try {
    response = await request(api('/api/agent/message'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, messageId: attempt.messageId, participantId: session.primaryAgentId,
        text, mode: settings.mode, ...settings.modelSelection, diagramAttachments: [],
        reportAttachments: content.reportIds.map((reportId) => ({ reportId })), imageAttachments: content.images, ...(content.files.length ? { fileAttachments: content.files } : {}) }),
    });
    const runId = response.headers.get('X-CodeAI-Run-Id');
    if (response.ok && runId) {
      // Detach the response only. The server-owned run continues independently of its subscribers.
      await response.body?.cancel().catch(() => undefined);
      return { session, started: true, runId };
    }
    if (response.ok) {
      // Older executors have a live NDJSON response but no acceptance header. Never wait for it.
      await response.body?.cancel().catch(() => undefined);
      const saved = await reconcile();
      if (saved) return { session: saved, started: true };
      throw new LaunchFailure('Delivery status is unknown. Retry checks the same message.', false, true);
    }
    const data = await response.json().catch(() => ({})) as { error?: string; activeRun?: unknown };
    const saved = await reconcile();
    if (saved) return { session: saved, started: true };
    if (data.activeRun) throw new LaunchFailure('The original turn may still be accepting this message. Retry keeps its UUID and checks delivery.', false, true);
    if (!response.ok) throw new LaunchFailure(data.error || 'The first message was not accepted. Your session and draft are kept.', true);
  } catch (error) {
    if (error instanceof LaunchFailure) throw error;
    try { const saved = await reconcile(); if (saved) return { session: saved, started: true }; } catch { /* keep frozen */ }
  }
  throw new LaunchFailure('Delivery status is unknown. Retry checks the same message; do not create another session.', false, true);
}
