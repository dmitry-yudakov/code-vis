export interface ProjectSummary {
  id: string;
  name: string;
  relativePath: string;
}

export interface ServerProject extends ProjectSummary {
  realPath: string;
}

export interface ServerThread {
  id: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  claudeSessionStarted: boolean;
}

export type DrawingTool = 'pointer' | 'pan' | 'pen' | 'rectangle' | 'arrow' | 'text' | 'eraser';
export type Point = { x: number; y: number; pressure?: number };

interface DrawingMarkBase {
  id: string;
  origin: 'user';
  color: string;
  createdAt: string;
}

export type DrawingMark =
  | (DrawingMarkBase & { kind: 'pen'; points: Point[] })
  | (DrawingMarkBase & { kind: 'rectangle'; x: number; y: number; width: number; height: number })
  | (DrawingMarkBase & { kind: 'arrow'; start: Point; end: Point })
  | (DrawingMarkBase & { kind: 'text'; x: number; y: number; text: string });

export interface DiagramMessageAttachment {
  diagramId: string;
  source: string;
  marks: DrawingMark[];
  viewport: { viewBox: [number, number, number, number] };
  compositePngDataUrl?: string;
}

export interface DiagramAttachmentRecord {
  diagramId: string;
  marksSnapshot: DrawingMark[];
  viewport: { viewBox: [number, number, number, number] };
  compositeIncluded: boolean;
}

export type EvidenceStatus =
  | 'observed'
  | 'inferred'
  | 'invalid'
  | 'missing-file'
  | 'outside-project'
  | 'invalid-range';

export interface EvidenceResult {
  elementId?: string;
  location?: string;
  path?: string;
  startLine?: number;
  endLine?: number;
  status: EvidenceStatus;
  message: string;
}

export interface DiagramArtifact {
  id: string;
  threadId: string;
  messageId: string;
  ordinal: number;
  source: string;
  createdAt: string;
  status: 'ready' | 'policy-error' | 'parse-error' | 'render-error';
  error?: string;
  derivedFromDiagramIds: string[];
  evidence: EvidenceResult[];
}

export type AssistantBlock =
  | { kind: 'markdown'; markdown: string }
  | { kind: 'code'; language?: string; source: string; warning?: string }
  | { kind: 'diagram'; artifact: DiagramArtifact };

export interface UserMessage {
  id: string;
  role: 'user';
  text: string;
  createdAt: string;
  status: 'sending' | 'sent' | 'cancelled' | 'failed';
  delivery?: 'not-sent' | 'possibly-sent';
  diagramAttachments: DiagramAttachmentRecord[];
}

export interface AssistantMessage {
  id: string;
  role: 'assistant';
  createdAt: string;
  status: 'complete' | 'cancelled' | 'failed';
  rawMarkdown: string;
  blocks: AssistantBlock[];
  metrics?: { durationMs: number; outputBytes: number };
}

export type ChatMessage = UserMessage | AssistantMessage;

export interface DiagramAnnotation {
  version: 1;
  diagramId: string;
  marks: DrawingMark[];
  updatedAt: string;
}

export interface ChatThread {
  version: 1;
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  activeDiagramId?: string;
  previousDiagramId?: string;
  pinnedDiagramIds: string[];
  annotations: Record<string, DiagramAnnotation>;
}

export type AgentPhase =
  | 'starting'
  | 'resuming'
  | 'exploring'
  | 'reading-context'
  | 'thinking'
  | 'responding'
  | 'validating-artifacts'
  | 'completed';

export type AgentErrorCode =
  | 'busy'
  | 'invalid-request'
  | 'missing-binary'
  | 'unauthenticated'
  | 'unsupported-flags'
  | 'missing-session'
  | 'process-failed'
  | 'timeout'
  | 'cancelled'
  | 'malformed-stream'
  | 'oversized-output'
  | 'absent-result'
  | 'internal';

export type AgentEvent =
  | { type: 'run-started'; runId: string; threadId: string; messageId: string }
  | { type: 'status'; runId: string; phase: AgentPhase; label: string }
  | { type: 'tool-activity'; runId: string; tool: string; detail?: string }
  | { type: 'assistant-delta'; runId: string; delta: string }
  | { type: 'assistant-message'; runId: string; message: AssistantMessage }
  | {
      type: 'error';
      runId: string;
      code: AgentErrorCode;
      message: string;
      retryable: boolean;
      delivery: 'not-sent' | 'possibly-sent';
    }
  | { type: 'done'; runId: string; durationMs: number; cancelled: boolean };

export interface AgentMessageRequest {
  projectId: string;
  threadId: string;
  messageId: string;
  text: string;
  diagramAttachments: DiagramMessageAttachment[];
}

export interface ResolvedAgentPolicy {
  profile: 'conversation-readonly';
  tools: readonly ['Read', 'Glob', 'Grep'];
  permissionMode: 'plan';
  safeMode: true;
  sessionPersistence: true;
  maxTurns: number;
  timeoutMs: number;
}

export interface AgentProcessEvent {
  type: 'session-started' | 'text-delta' | 'activity' | 'phase';
  sessionId?: string;
  text?: string;
  tool?: string;
  detail?: string;
  phase?: 'thinking' | 'responding';
}

export interface AgentProcessRun {
  runId: string;
  project: ServerProject;
  session: { id: string; action: 'start' | 'resume' };
  prompt: string;
  attachmentDirectory: string;
  policy: ResolvedAgentPolicy;
  signal: AbortSignal;
  emit(event: AgentProcessEvent): void;
}

export interface AgentProcessResult {
  finalText: string;
  sessionId: string;
  durationMs: number;
  outputBytes: number;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface AgentProcessRunner {
  run(input: AgentProcessRun): Promise<AgentProcessResult>;
}
