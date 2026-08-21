import type { AgentMode, AgentProvider, CanvasTarget, ChatMessage, ChatThread, DiagramArtifact, Participant, SketchCanvas } from '@/shared/types';
import { normalizeMermaidSource, validateMermaidSource } from '@/features/diagram/mermaid/mermaidPolicy';
import { legacyParticipants } from '@/shared/participants';
import { MAX_STORED_MESSAGES } from '@/shared/limits';

const PREFIX = 'code-ai:web2:v1:';
const ACTIVE_PROJECT_KEY = `${PREFIX}active-project`;
const MAX_THREADS = 20;
const MAX_ARTIFACTS = 100;

interface StoredProject {
  version: 1 | 2 | 3;
  /** Bookkeeping only. localStorage revisions are not compare-and-swap conflict tokens. */
  revision?: number;
  threads: unknown[];
}

export interface ProjectConversationSnapshot {
  revision: number;
  threads: ChatThread[];
}

export interface ConversationPersistenceFailure {
  threadId: string;
  message: string;
  lastValid?: ChatThread;
}

export interface SaveProjectThreadsResult extends ProjectConversationSnapshot {
  failures: ConversationPersistenceFailure[];
}

export function projectConversationStorageKey(projectId: string): string {
  return `${PREFIX}${projectId}`;
}

export function projectConversationLockName(projectId: string): string {
  return `${projectConversationStorageKey(projectId)}:commit`;
}

function crossTabLocks(): LockManager | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.locks;
}

export function loadSelectedProjectId(storage: Storage = localStorage): string | undefined {
  return storage.getItem(ACTIVE_PROJECT_KEY) || undefined;
}

export function saveSelectedProjectId(projectId: string, storage: Storage = localStorage): void {
  storage.setItem(ACTIVE_PROJECT_KEY, projectId);
}

function isStoredThread(value: unknown, projectId: string): boolean {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (item.version === 1 || item.version === 2)
    && typeof item.id === 'string'
    && item.projectId === projectId
    && typeof item.title === 'string'
    && (item.provider === undefined || item.provider === 'claude' || item.provider === 'codex')
    && Array.isArray(item.messages)
    && Array.isArray(item.pinnedDiagramIds)
    // Threads saved before sketches existed have no `sketches` key at all.
    && (item.sketches === undefined || Array.isArray(item.sketches))
    && Boolean(item.annotations && typeof item.annotations === 'object');
}

function isParticipant(value: unknown): value is Participant {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<Participant>;
  if (typeof item.id !== 'string' || typeof item.displayName !== 'string') return false;
  return item.kind === 'human' || (item.kind === 'agent'
    && (item.provider === 'claude' || item.provider === 'codex')
    && ['orchestrator', 'coder', 'reviewer', 'tester', 'custom'].includes(String(item.role))
    && ['ask', 'plan', 'agent'].includes(String(item.defaultMode)));
}

function validRoster(participants: unknown, primaryAgentId: unknown): participants is Participant[] {
  if (!Array.isArray(participants) || !participants.every(isParticipant)) return false;
  const ids = participants.map((participant) => participant.id);
  return new Set(ids).size === ids.length
    && participants.filter((participant) => participant.kind === 'human').length === 1
    && participants.some((participant) => participant.kind === 'agent' && participant.id === primaryAgentId);
}

export function getArtifacts(thread: ChatThread): DiagramArtifact[] {
  return thread.messages.flatMap((message) => message.role === 'assistant'
    ? message.blocks.flatMap((block) => block.kind === 'diagram' ? [block.artifact] : [])
    : []);
}

export function getSketches(thread: ChatThread): SketchCanvas[] {
  return thread.sketches || [];
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

const AGENT_MODES: readonly AgentMode[] = ['ask', 'plan', 'agent'];

/** An unrecognised stored mode falls back to the safest one rather than invalidating the thread. */
function knownMode(value: unknown): AgentMode | undefined {
  return AGENT_MODES.includes(value as AgentMode) ? value as AgentMode : undefined;
}

function restoreStoredThread(stored: unknown, projectId: string): ChatThread {
    if (!isStoredThread(stored, projectId)) throw new Error('Invalid stored conversation');
    const thread = stored as ChatThread & { version: 1 | 2; provider?: AgentProvider; participants?: Participant[]; primaryAgentId?: string };
    const provider = (thread.provider || 'claude') as AgentProvider;
    const participants = validRoster(thread.participants, thread.primaryAgentId)
      ? thread.participants
      : legacyParticipants(thread.id, provider);
    const human = participants.find((participant) => participant.kind === 'human')!;
    const primaryAgentId = participants.some((participant) => participant.kind === 'agent' && participant.id === thread.primaryAgentId)
      ? thread.primaryAgentId!
      : participants.find((participant) => participant.kind === 'agent')!.id;
    return {
    ...thread,
    version: 2 as const,
    participants,
    primaryAgentId,
    addressedAgentId: participants.some((participant) => participant.kind === 'agent' && participant.id === thread.addressedAgentId)
      ? thread.addressedAgentId
      : primaryAgentId,
    defaultMode: knownMode(thread.defaultMode),
    messages: thread.messages.map((storedMessage) => {
      const message = storedMessage as ChatMessage & { authorId?: string; addressedParticipantId?: string };
      return message.role === 'assistant' ? {
      ...message,
      authorId: message.authorId || primaryAgentId,
      mode: knownMode(message.mode),
      blocks: message.blocks.map((block) => {
        if (block.kind !== 'diagram') return block;
        const source = normalizeMermaidSource(block.artifact.source);
        const policy = validateMermaidSource(source);
        if (!policy.ok) {
          return { ...block, artifact: { ...block.artifact, source, status: 'policy-error' as const, error: policy.error } };
        }
        const retry = block.artifact.status === 'policy-error'
          || block.artifact.status === 'parse-error'
          || block.artifact.status === 'render-error';
        return {
          ...block,
          artifact: {
            ...block.artifact,
            source,
            status: retry ? 'ready' as const : block.artifact.status,
            error: retry ? undefined : block.artifact.error,
          },
        };
      }),
    } : {
      ...message,
      authorId: message.authorId || human.id,
      addressedParticipantId: message.addressedParticipantId || primaryAgentId,
      mode: knownMode(message.mode),
    };
    }),
  };
}

function validThreadForSave(thread: ChatThread, projectId: string): boolean {
  const names = thread.participants.map((participant) => participant.displayName);
  return thread.version === 2
    && isStoredThread(thread, projectId)
    && validRoster(thread.participants, thread.primaryAgentId)
    && new Set(names).size === names.length
    && thread.messages.every((message) => thread.participants.some((participant) => participant.id === message.authorId)
      && (message.role === 'assistant'
        || thread.participants.some((participant) => participant.kind === 'agent' && participant.id === message.addressedParticipantId)));
}

function parseStoredProject(raw: string): StoredProject {
  const parsed = JSON.parse(raw) as StoredProject;
  if (![1, 2, 3].includes(parsed.version) || !Array.isArray(parsed.threads)
    || (parsed.revision !== undefined && (!Number.isSafeInteger(parsed.revision) || parsed.revision < 0))) {
    throw new Error('Saved conversations are corrupt or from an unsupported version. The in-memory workspace is unchanged.');
  }
  return parsed;
}

export function loadProjectSnapshot(
  projectId: string,
  storage: Storage = localStorage,
): ProjectConversationSnapshot {
  const raw = storage.getItem(projectConversationStorageKey(projectId));
  if (!raw) return { revision: 0, threads: [] };
  const parsed = parseStoredProject(raw);
  let threads: ChatThread[];
  try {
    threads = parsed.threads.map((stored) => restoreStoredThread(stored, projectId));
  } catch {
    throw new Error('Saved conversations are corrupt or from an unsupported version. The in-memory workspace is unchanged.');
  }
  if (!threads.every((thread) => validThreadForSave(thread, projectId))) {
    throw new Error('Saved conversations contain invalid participant attribution. The in-memory workspace is unchanged.');
  }
  return { revision: parsed.revision || 0, threads };
}

export function loadProjectThreads(projectId: string, storage: Storage = localStorage): ChatThread[] {
  return loadProjectSnapshot(projectId, storage).threads;
}

function hasDrawings(thread: ChatThread): boolean {
  return Object.values(thread.annotations).some((annotation) => annotation.marks.length > 0);
}

function messageStatusRank(message: ChatMessage): number {
  if (message.role === 'assistant') return message.status === 'complete' ? 2 : 1;
  if (message.status === 'sent') return 2;
  return message.status === 'sending' ? 0 : 1;
}

function mergeMessage(existing: ChatMessage, incoming: ChatMessage): ChatMessage {
  return messageStatusRank(incoming) >= messageStatusRank(existing) ? incoming : existing;
}

function mergeThread(existing: ChatThread, incoming: ChatThread): ChatThread {
  const newer = incoming.updatedAt >= existing.updatedAt ? incoming : existing;
  const older = newer === incoming ? existing : incoming;
  const participants = new Map(older.participants.map((participant) => [participant.id, participant]));
  for (const participant of newer.participants) participants.set(participant.id, participant);
  const participantList = [...participants.values()];

  const messages = new Map(existing.messages.map((message) => [message.id, message]));
  for (const message of incoming.messages) {
    const prior = messages.get(message.id);
    messages.set(message.id, prior ? mergeMessage(prior, message) : message);
  }

  const annotations = { ...older.annotations };
  for (const [id, annotation] of Object.entries(newer.annotations)) {
    if (!annotations[id] || annotation.updatedAt >= annotations[id].updatedAt) annotations[id] = annotation;
  }
  const sketches = new Map(getSketches(older).map((sketch) => [sketch.id, sketch]));
  for (const sketch of getSketches(newer)) sketches.set(sketch.id, sketch);
  const primaryAgentId = participantList.some((participant) => participant.kind === 'agent' && participant.id === newer.primaryAgentId)
    ? newer.primaryAgentId
    : older.primaryAgentId;

  return {
    ...newer,
    updatedAt: newer.updatedAt >= older.updatedAt ? newer.updatedAt : older.updatedAt,
    participants: participantList,
    primaryAgentId,
    messages: [...messages.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    pinnedDiagramIds: [...new Set([...older.pinnedDiagramIds, ...newer.pinnedDiagramIds])],
    annotations,
    sketches: sketches.size ? [...sketches.values()] : undefined,
  };
}

/** Additive merge for cross-tab state. Participant/message ids are immutable and server-owned. */
export function mergeProjectThreads(current: ChatThread[], incoming: ChatThread[]): ChatThread[] {
  const merged = new Map(current.map((thread) => [thread.id, thread]));
  for (const thread of incoming) {
    const prior = merged.get(thread.id);
    merged.set(thread.id, prior ? mergeThread(prior, thread) : thread);
  }
  const result = [...merged.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return JSON.stringify(result) === JSON.stringify(current) ? current : result;
}

function readValidStoredSnapshot(projectId: string, storage: Storage): ProjectConversationSnapshot {
  const raw = storage.getItem(projectConversationStorageKey(projectId));
  if (!raw) return { revision: 0, threads: [] };
  try {
    const parsed = parseStoredProject(raw);
    const threads = parsed.threads.flatMap((stored) => {
      try {
        const thread = restoreStoredThread(stored, projectId);
        return validThreadForSave(thread, projectId) ? [thread] : [];
      } catch {
        return [];
      }
    });
    return { revision: parsed.revision || 0, threads };
  } catch {
    return { revision: 0, threads: [] };
  }
}

export function saveProjectThreads(
  projectId: string,
  input: ChatThread[],
  storage: Storage = localStorage,
): SaveProjectThreadsResult {
  const stored = readValidStoredSnapshot(projectId, storage);
  const lastValid = new Map(stored.threads.map((thread) => [thread.id, thread]));
  const failures: ConversationPersistenceFailure[] = [];
  const valid: ChatThread[] = [];

  input.forEach((thread, index) => {
    const threadId = typeof thread?.id === 'string' ? thread.id : `unknown-${index + 1}`;
    let message: string | undefined;
    if (!validThreadForSave(thread, projectId)) {
      message = 'invalid participant attribution or conversation shape';
    } else if (thread.messages.length > MAX_STORED_MESSAGES) {
      message = `the ${MAX_STORED_MESSAGES}-message local history limit was reached; export this conversation before archiving older entries`;
    } else if (getArtifacts(thread).length + getSketches(thread).length > MAX_ARTIFACTS) {
      message = 'the 100-canvas local history limit was reached; export this conversation before removing canvases';
    }
    if (message) {
      failures.push({
        threadId,
        message: `Conversation ${threadId} was not saved: ${message}.`,
        lastValid: lastValid.get(threadId),
      });
    } else {
      valid.push(thread);
    }
  });

  let threads = mergeProjectThreads(stored.threads, valid);
  if (threads.length > MAX_THREADS && threads.slice(MAX_THREADS).some(hasDrawings)) {
    for (const thread of threads.slice(MAX_THREADS).filter(hasDrawings)) {
      failures.push({
        threadId: thread.id,
        message: `Conversation ${thread.id} was not saved: export or delete older annotated conversations first.`,
        lastValid: lastValid.get(thread.id),
      });
    }
  }
  threads = threads.slice(0, MAX_THREADS);
  const revision = stored.revision + 1;
  storage.setItem(projectConversationStorageKey(projectId), JSON.stringify({
    version: 3,
    revision,
    threads,
  } satisfies StoredProject));
  return { revision, threads, failures };
}

/** Serializes the localStorage read/merge/write across same-origin tabs when Web Locks exist. */
export async function commitProjectThreads(
  projectId: string,
  input: ChatThread[],
  storage: Storage = localStorage,
): Promise<SaveProjectThreadsResult> {
  const locks = crossTabLocks();
  if (!locks) return saveProjectThreads(projectId, input, storage);
  return locks.request(
    projectConversationLockName(projectId),
    async () => saveProjectThreads(projectId, input, storage),
  );
}

export function serializeThreadExport(thread: ChatThread, exportedAt = new Date().toISOString()) {
  const participantById = new Map(thread.participants.map((participant) => [participant.id, participant]));
  return {
    version: 2,
    exportedAt,
    thread,
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
