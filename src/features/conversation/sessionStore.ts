import type {
  ArenaMachineSnapshot, CanvasTarget, SessionSnapshot, DiagramArtifact, PublicSession, SketchCanvas, SessionPage,
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

export function getArtifacts(session: Pick<SessionSnapshot, 'messages'> & Partial<Pick<SessionSnapshot, 'canvases'>>): DiagramArtifact[] {
  const artifacts = session.messages.flatMap((message) => message.role === 'assistant'
    ? message.blocks.flatMap((block) => block.kind === 'diagram' ? [block.artifact] : [])
    : []);
  return [...new Map([...(session.canvases || []), ...artifacts].map(artifact => [artifact.id, artifact])).values()];
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
  snapshot: PublicSession & Partial<Pick<SessionSnapshot, 'history' | 'canvases'>>,
  prior?: SessionSnapshot,
  device?: Partial<SessionHydrationState>,
): SessionSnapshot {
  const base = structuredClone(snapshot) as SessionSnapshot;
  if (prior?.titleRevision && prior.titleRevision > snapshot.revision) {
    base.title = prior.title;
    base.allowAgentArchive = prior.allowAgentArchive;
    base.agentArchiveCheck = prior.agentArchiveCheck;
    if (prior.allowAgentArchive !== undefined && base.version < 15) base.version = 15;
    base.titleRevision = prior.titleRevision;
  }
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
    ...(snapshot.history?.canvasIds || []),
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

/** A history page can add older messages, never replace newer metadata, live activity or edits. */
export function mergeSessionPage(
  page: SessionPage, prior?: SessionSnapshot, device?: Partial<SessionHydrationState>, before?: string,
): SessionSnapshot {
  if (before) {
    if (!prior?.history || prior.history.before !== before) return prior!;
    const known = new Set(prior.messages.map(message => message.id));
    const added = page.session.messages.filter(message => !known.has(message.id));
    return hydrateSession({ ...prior, messages: [...added, ...prior.messages], history: {
      ...prior.history, before: page.history.before,
      deferredMessageIds: [...new Set([...prior.history.deferredMessageIds,
        ...page.history.deferredMessageIds.filter(id => !known.has(id))])],
      inlineDeferredMessageIds: [...(prior.history.inlineDeferredMessageIds ?? prior.history.deferredMessageIds),
        ...(page.history.inlineDeferredMessageIds ?? page.history.deferredMessageIds).filter(id => !known.has(id))],
    } }, prior, device);
  }
  if (prior && page.session.revision < prior.revision) return prior;
  const deferred = new Set(page.history.deferredMessageIds);
  const priorDeferred = new Set(prior?.history?.deferredMessageIds);
  const priorInline = new Set(prior?.history?.inlineDeferredMessageIds ?? priorDeferred);
  const incoming = new Set(page.session.messages.map(message => message.id));
  const messages = page.session.messages.map(message => {
    const previous = prior?.messages.find(item => item.id === message.id);
    if (!previous || !deferred.has(message.id) || priorDeferred.has(message.id)) return message;
    const unchanged = message.role === 'assistant' && previous.role === 'assistant'
      || message.role === 'user' && previous.role === 'user' && (message.text === previous.text || prior?.revision === page.session.revision)
        && message.turn?.sequence === previous.turn?.sequence;
    if (!unchanged) return message;
    deferred.delete(message.id);
    return previous;
  });
  const overlaps = prior?.messages.some(message => incoming.has(message.id));
  // After a long absence, a disjoint recent window starts a fresh contiguous range. Its cursor
  // can recover every older message; retaining a disconnected prefix would hide the gap.
  const retained = prior?.messages.filter(message => !incoming.has(message.id)
    && (overlaps || message.role === 'user' && message.status === 'sending')) || [];
  const optimistic = retained.filter(message => message.role === 'user' && message.status === 'sending');
  const older = retained.filter(message => !optimistic.includes(message));
  const sameCanvases = Boolean(prior && JSON.stringify(page.history.canvasIds) === JSON.stringify(prior.history?.canvasIds));
  const history = { ...page.history,
    before: prior && !prior.history && overlaps ? undefined : older.length ? prior?.history?.before : page.history.before,
    deferredMessageIds: [...new Set([...older.filter(message => priorDeferred.has(message.id)).map(message => message.id), ...deferred])],
    inlineDeferredMessageIds: [...older.filter(message => priorInline.has(message.id)).map(message => message.id),
      ...(page.history.inlineDeferredMessageIds ?? page.history.deferredMessageIds).filter(id => deferred.has(id))],
    canvasesLoaded: sameCanvases && prior?.revision === page.session.revision ? prior?.history?.canvasesLoaded ?? false : false,
  };
  return hydrateSession({ ...page.session, messages: [...older, ...messages, ...optimistic], history,
    canvases: prior?.canvases, sketches: prior?.sketches || [], annotations: prior?.annotations || {},
  }, prior, device);
}

/** Merge metadata without claiming the rest of a newer full session has been fetched. */
export function reconcileSessionTitles(sessions: SessionSnapshot[], machines: ArenaMachineSnapshot[], localMachineId?: string): SessionSnapshot[] {
  let changed = false;
  const next = sessions.map(session => {
    const owner = machines.find(machine => machine.machine.id === (session.machineId ?? localMachineId));
    if (owner?.machine.state !== 'online' || owner.snapshotFresh === false) return session;
    const summary = owner.sessions.find(item => item.id === session.id);
    if (!summary || summary.revision <= Math.max(session.revision, session.titleRevision ?? 0)
      || summary.title === session.title && summary.allowAgentArchive === session.allowAgentArchive
        && JSON.stringify(summary.agentArchiveCheck) === JSON.stringify(session.agentArchiveCheck)) return session;
    changed = true;
    return { ...session, title: summary.title, titleRevision: summary.revision,
      ...(summary.allowAgentArchive !== undefined && session.version < 15 ? { version: 15 as const } : {}),
      allowAgentArchive: summary.allowAgentArchive, agentArchiveCheck: summary.agentArchiveCheck };
  });
  return changed ? next : sessions;
}

export function serializeSessionExport(session: SessionSnapshot, exportedAt = new Date().toISOString()) {
  if (session.history) throw new Error('Load the complete session before exporting.');
  const participantById = new Map(session.participants.map((participant) => [participant.id, participant]));
  const {
    history: _history,
    canvases: _canvases,
    machineId: _machineId,
    titleRevision: _titleRevision,
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
