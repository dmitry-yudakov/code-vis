import type {
  CanvasTarget, SessionSnapshot, DiagramArtifact, PublicSession, SketchCanvas,
} from '@/shared/types';
import { boundSessionActivity, type TurnRecord } from '@/shared/turnActivity';

const ACTIVE_CHECKOUT_KEY = 'code-ai:device:v1:active-checkout';

function activeCheckoutKey(machineId?: string): string {
  return machineId ? `${ACTIVE_CHECKOUT_KEY}:machine:${machineId}` : ACTIVE_CHECKOUT_KEY;
}

export function loadSelectedCheckoutId(storage: Storage = localStorage, machineId?: string): string | undefined {
  return storage.getItem(activeCheckoutKey(machineId)) || undefined;
}

export function saveSelectedCheckoutId(checkoutId: string, storage: Storage = localStorage, machineId?: string): void {
  storage.setItem(activeCheckoutKey(machineId), checkoutId);
}

export function getArtifacts(session: Pick<SessionSnapshot, 'messages'>): DiagramArtifact[] {
  return session.messages.flatMap((message) => message.role === 'assistant'
    ? message.blocks.flatMap((block) => block.kind === 'diagram' ? [block.artifact] : [])
    : []);
}

export function getSketches(session: Pick<SessionSnapshot, 'sketches'>): SketchCanvas[] {
  return session.sketches;
}

/** Resolves a canvas id against both id spaces; diagrams win if an id somehow collides. */
export function findCanvasTarget(session: SessionSnapshot, id?: string): CanvasTarget | undefined {
  if (!id) return undefined;
  const artifact = getArtifacts(session).find((item) => item.id === id);
  if (artifact) return { kind: 'diagram', artifact };
  const sketch = getSketches(session).find((item) => item.id === id);
  return sketch ? { kind: 'sketch', sketch } : undefined;
}

export function canvasTargetId(target: CanvasTarget): string {
  return target.kind === 'diagram' ? target.artifact.id : target.sketch.id;
}

/**
 * Adds ephemeral browser selection to a public host snapshot. A refetch preserves selection only
 * while the target still exists; otherwise the newest canvas becomes active.
 */
export type SessionHydrationState = Pick<SessionSnapshot, 'addressedAgentId' | 'activeDiagramId' | 'previousDiagramId' | 'defaultMode'>;

export function mergeTurnActivity(session: SessionSnapshot, turn: TurnRecord): SessionSnapshot {
  return { ...session, messages: boundSessionActivity(session.messages.map(message => {
    if (message.role !== 'user' || message.id !== turn.userMessageId) return message;
    const prior = message.turn;
    if (prior && (prior.runId !== turn.runId || prior.sequence > turn.sequence
      || prior.sequence === turn.sequence && (prior.history === 'saved' || turn.history !== 'saved'))) return message;
    return { ...message, turn };
  }), turn.runId) };
}

export function hydrateSession(
  snapshot: PublicSession,
  prior?: SessionSnapshot,
  device?: Partial<SessionHydrationState>,
): SessionSnapshot {
  const base = structuredClone(snapshot) as SessionSnapshot;
  if (prior) {
    base.messages = base.messages.map(message => {
      if (message.role !== 'user') return message;
      const previous = prior.messages.find(item => item.id === message.id);
      if (previous?.role !== 'user' || !previous.turn || previous.turn.runId !== message.turn?.runId) return message;
      const newer = previous.turn.sequence > message.turn.sequence
        || previous.turn.sequence === message.turn.sequence && previous.turn.incomplete && message.turn.history !== 'saved';
      return newer ? { ...message, turn: previous.turn } : message;
    });
    for (const [id, annotation] of Object.entries(prior.annotations)) {
      if (!base.annotations[id] || annotation.updatedAt > base.annotations[id].updatedAt) {
        base.annotations[id] = structuredClone(annotation);
      }
    }
  }
  base.messages = boundSessionActivity(base.messages);
  const canvasIds = new Set([
    ...getArtifacts(base).map((artifact) => artifact.id),
    ...getSketches(base).map((sketch) => sketch.id),
  ]);
  const agents = new Set(base.participants.flatMap((participant) => participant.kind === 'agent' ? [participant.id] : []));
  const newestCanvas = [...canvasIds].at(-1);
  const addressedAgentId = prior?.addressedAgentId && agents.has(prior.addressedAgentId)
    ? prior.addressedAgentId
    : device?.addressedAgentId && agents.has(device.addressedAgentId)
      ? device.addressedAgentId
      : undefined;
  const activeDiagramId = prior?.activeDiagramId && canvasIds.has(prior.activeDiagramId)
    ? prior.activeDiagramId
    : device?.activeDiagramId && canvasIds.has(device.activeDiagramId)
      ? device.activeDiagramId
      : newestCanvas;
  return {
    ...base,
    addressedAgentId: addressedAgentId || base.primaryAgentId,
    activeDiagramId,
    previousDiagramId: prior?.previousDiagramId && canvasIds.has(prior.previousDiagramId)
      ? prior.previousDiagramId
      : undefined,
    defaultMode: prior?.defaultMode ?? device?.defaultMode,
  };
}

export function serializeSessionExport(session: SessionSnapshot, exportedAt = new Date().toISOString()) {
  const participantById = new Map(session.participants.map((participant) => [participant.id, participant]));
  const {
    machineId: _machineId,
    addressedAgentId: _addressedAgentId,
    activeDiagramId: _activeDiagramId,
    previousDiagramId: _previousDiagramId,
    defaultMode: _defaultMode,
    ...durableSession
  } = session;
  return {
    version: 4,
    exportedAt,
    session: durableSession,
    entries: session.messages.map((message) => {
      const author = participantById.get(message.authorId);
      return {
        message,
        author: author && {
          id: author.id,
          displayName: author.displayName,
          kind: author.kind,
          ...(author.kind === 'agent' ? { provider: author.provider, role: author.role } : {}),
        },
      };
    }),
  };
}

export function exportSession(session: SessionSnapshot): void {
  const safe = JSON.stringify(serializeSessionExport(session), null, 2);
  const url = URL.createObjectURL(new Blob([safe], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `codeai-${session.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'session'}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
