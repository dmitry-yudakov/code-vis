import type { AgentMode, AgentProvider, CanvasTarget, ChatThread, DiagramArtifact, SketchCanvas } from '@/lib/shared/types';
import { normalizeMermaidSource, validateMermaidSource } from '@/lib/diagram/mermaidPolicy';

const PREFIX = 'code-ai:web2:v1:';
const ACTIVE_PROJECT_KEY = `${PREFIX}active-project`;
const MAX_THREADS = 20;
const MAX_MESSAGES = 200;
const MAX_ARTIFACTS = 100;

interface StoredProject {
  version: 1;
  threads: ChatThread[];
}

export function loadSelectedProjectId(storage: Storage = localStorage): string | undefined {
  return storage.getItem(ACTIVE_PROJECT_KEY) || undefined;
}

export function saveSelectedProjectId(projectId: string, storage: Storage = localStorage): void {
  storage.setItem(ACTIVE_PROJECT_KEY, projectId);
}

function isThread(value: unknown, projectId: string): value is ChatThread {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ChatThread>;
  return item.version === 1
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

export function loadProjectThreads(projectId: string, storage: Storage = localStorage): ChatThread[] {
  const raw = storage.getItem(`${PREFIX}${projectId}`);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as StoredProject;
  if (parsed.version !== 1 || !Array.isArray(parsed.threads) || !parsed.threads.every((thread) => isThread(thread, projectId))) {
    throw new Error('Saved conversations are corrupt or from an unsupported version. The in-memory workspace is unchanged.');
  }
  return parsed.threads.map((thread) => ({
    ...thread,
    // v1 localStorage predates provider selection; all such conversations were Claude sessions.
    provider: (thread.provider || 'claude') as AgentProvider,
    defaultMode: knownMode(thread.defaultMode),
    messages: thread.messages.map((message) => message.role === 'assistant' ? {
      ...message,
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
    } : message),
  }));
}

function hasDrawings(thread: ChatThread): boolean {
  return Object.values(thread.annotations).some((annotation) => annotation.marks.length > 0);
}

export function saveProjectThreads(projectId: string, input: ChatThread[], storage: Storage = localStorage): void {
  if (!input.every((thread) => isThread(thread, projectId))) throw new Error('Refusing to save invalid conversation data.');
  const sorted = [...input].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (sorted.length > MAX_THREADS && sorted.slice(MAX_THREADS).some(hasDrawings)) {
    throw new Error('Storage limit reached. Export or delete older annotated conversations before creating more.');
  }
  const threads = sorted.slice(0, MAX_THREADS).map((thread) => {
    if (thread.messages.length > MAX_MESSAGES || getArtifacts(thread).length + getSketches(thread).length > MAX_ARTIFACTS) {
      throw new Error('Conversation limit reached. Export this thread before removing messages or annotated canvases.');
    }
    return thread;
  });
  storage.setItem(`${PREFIX}${projectId}`, JSON.stringify({ version: 1, threads } satisfies StoredProject));
}

export function exportThread(thread: ChatThread): void {
  const safe = JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    thread,
  }, null, 2);
  const url = URL.createObjectURL(new Blob([safe], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `cartograph-${thread.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'conversation'}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
