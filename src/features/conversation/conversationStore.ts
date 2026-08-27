import type {
  CanvasTarget, ChatThread, DiagramArtifact, PublicConversation, SketchCanvas,
} from '@/shared/types';

const ACTIVE_CHECKOUT_KEY = 'code-ai:device:v1:active-checkout';

export function loadSelectedProjectId(storage: Storage = localStorage): string | undefined {
  return storage.getItem(ACTIVE_CHECKOUT_KEY) || undefined;
}

export function saveSelectedProjectId(checkoutId: string, storage: Storage = localStorage): void {
  storage.setItem(ACTIVE_CHECKOUT_KEY, checkoutId);
}

export function getArtifacts(thread: Pick<ChatThread, 'messages'>): DiagramArtifact[] {
  return thread.messages.flatMap((message) => message.role === 'assistant'
    ? message.blocks.flatMap((block) => block.kind === 'diagram' ? [block.artifact] : [])
    : []);
}

export function getSketches(thread: Pick<ChatThread, 'sketches'>): SketchCanvas[] {
  return thread.sketches;
}

/** Resolves a canvas id against both id spaces; diagrams win if an id somehow collides. */
export function findCanvasTarget(thread: ChatThread, id?: string): CanvasTarget | undefined {
  if (!id) return undefined;
  const artifact = getArtifacts(thread).find((item) => item.id === id);
  if (artifact) return { kind: 'diagram', artifact };
  const sketch = getSketches(thread).find((item) => item.id === id);
  return sketch ? { kind: 'sketch', sketch } : undefined;
}

export function canvasTargetId(target: CanvasTarget): string {
  return target.kind === 'diagram' ? target.artifact.id : target.sketch.id;
}

/**
 * Adds ephemeral browser selection to a public host snapshot. A refetch preserves selection only
 * while the target still exists; otherwise the newest canvas becomes active.
 */
export function hydrateConversation(snapshot: PublicConversation, prior?: ChatThread): ChatThread {
  const base = structuredClone(snapshot) as ChatThread;
  const canvasIds = new Set([
    ...getArtifacts(base).map((artifact) => artifact.id),
    ...getSketches(base).map((sketch) => sketch.id),
  ]);
  const agents = new Set(base.participants.flatMap((participant) => participant.kind === 'agent' ? [participant.id] : []));
  const newestCanvas = [...canvasIds].at(-1);
  return {
    ...base,
    addressedAgentId: prior?.addressedAgentId && agents.has(prior.addressedAgentId)
      ? prior.addressedAgentId
      : base.primaryAgentId,
    activeDiagramId: prior?.activeDiagramId && canvasIds.has(prior.activeDiagramId)
      ? prior.activeDiagramId
      : newestCanvas,
    previousDiagramId: prior?.previousDiagramId && canvasIds.has(prior.previousDiagramId)
      ? prior.previousDiagramId
      : undefined,
    defaultMode: prior?.defaultMode,
  };
}

export function serializeThreadExport(thread: ChatThread, exportedAt = new Date().toISOString()) {
  const participantById = new Map(thread.participants.map((participant) => [participant.id, participant]));
  const {
    addressedAgentId: _addressedAgentId,
    activeDiagramId: _activeDiagramId,
    previousDiagramId: _previousDiagramId,
    defaultMode: _defaultMode,
    ...conversation
  } = thread;
  return {
    version: 3,
    exportedAt,
    conversation,
    entries: thread.messages.map((message) => {
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

export function exportThread(thread: ChatThread): void {
  const safe = JSON.stringify(serializeThreadExport(thread), null, 2);
  const url = URL.createObjectURL(new Blob([safe], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `codeai-${thread.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'conversation'}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
