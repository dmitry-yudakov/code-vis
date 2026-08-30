export interface CheckoutSummary {
  id: string;
  name: string;
  relativePath: string;
}

export interface CheckoutsResponse {
  checkouts: CheckoutSummary[];
  recentCheckoutIds: string[];
  discoveryDepth: number;
  hostId: string;
}

export interface ServerCheckout extends CheckoutSummary {
  realPath: string;
}

export type GitFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'conflicted'
  | 'untracked';

/** A repository-relative working-tree entry. Paths never expose the configured repositories root. */
export interface GitChangedFile {
  path: string;
  previousPath?: string;
  status: GitFileStatus;
  staged: boolean;
  unstaged: boolean;
}

export interface GitWorkingTree {
  isRepository: boolean;
  branch?: string;
  ahead?: number;
  behind?: number;
  files: GitChangedFile[];
}

export interface GitFileDiff {
  path: string;
  staged?: string;
  unstaged?: string;
}

export type AgentProvider = 'claude' | 'codex';
export type AgentRole = 'orchestrator' | 'coder' | 'reviewer' | 'tester' | 'custom';

export type ProviderSessionRef =
  | { provider: AgentProvider; started: false; sessionId?: never; hostId?: never }
  | { provider: AgentProvider; started: true; sessionId: string; hostId: string };

export interface RepositoryBinding {
  id: string;
  hostId: string;
  /** Host-scoped path hash returned by the checkout registry. */
  checkoutId: string;
  role: 'primary' | 'reference';
}

export interface DurableProject {
  version: 1;
  revision: number;
  id: string;
  name: string;
  repositories: RepositoryBinding[];
  createdAt: string;
  updatedAt: string;
}

export interface HumanParticipant {
  id: string;
  kind: 'human';
  displayName: string;
}

/** Public agent identity. Provider session ids never leave the server registry. */
export interface AgentParticipant {
  id: string;
  kind: 'agent';
  displayName: string;
  provider: AgentProvider;
  role: AgentRole;
  defaultMode: AgentMode;
}

export type Participant = HumanParticipant | AgentParticipant;

export interface ServerAgentParticipant extends AgentParticipant {
  session: ProviderSessionRef;
  lastObservedMessageId?: string;
  /** Private idempotency key used only while reconciling participant creation retries. */
  creationRequestId?: string;
}

export type ServerParticipant = HumanParticipant | ServerAgentParticipant;

export interface DurableSession {
  version: 3;
  revision: number;
  id: string;
  title: string;
  projectId?: string;
  repositories: RepositoryBinding[];
  createdAt: string;
  updatedAt: string;
  participants: ServerParticipant[];
  primaryAgentId: string;
  messages: ChatMessage[];
  pinnedDiagramIds: string[];
  annotations: Record<string, DiagramAnnotation>;
  sketches: SketchCanvas[];
}

export interface ProviderHealth {
  available: boolean;
  authenticated: boolean | 'unknown';
  supportedModes: AgentMode[];
  message?: string;
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

/** Diagrams come from the agent; sketches are blank surfaces the user opens and draws on. */
export type CanvasKind = 'diagram' | 'sketch';

/**
 * A blank drawing surface the user creates directly, with no Mermaid source behind it.
 * Sketches live on the session rather than inside an assistant message, but they share the
 * annotation store and the id space with diagrams, so selection, marks, and attachment all
 * behave the same way for both.
 */
export interface SketchCanvas {
  id: string;
  sessionId: string;
  ordinal: number;
  createdAt: string;
  viewBox: [number, number, number, number];
}

export interface DiagramMessageAttachment {
  diagramId: string;
  /** Omitted means `diagram`. A sketch attaches its marks and PNG with an empty source. */
  kind?: CanvasKind;
  source: string;
  marks: DrawingMark[];
  viewport: { viewBox: [number, number, number, number] };
  compositePngDataUrl?: string;
}

export interface DiagramAttachmentRecord {
  diagramId: string;
  kind?: CanvasKind;
  marksSnapshot: DrawingMark[];
  viewport: { viewBox: [number, number, number, number] };
  compositeIncluded: boolean;
}

export type EvidenceStatus =
  | 'observed'
  | 'inferred'
  | 'invalid'
  | 'missing-file'
  | 'outside-repository'
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
  sessionId: string;
  messageId: string;
  ordinal: number;
  source: string;
  createdAt: string;
  status: 'ready' | 'policy-error' | 'parse-error' | 'render-error';
  error?: string;
  derivedFromDiagramIds: string[];
  evidence: EvidenceResult[];
}

/** Whatever the canvas is showing and drawing on: an agent diagram or a user sketch. */
export type CanvasTarget =
  | { kind: 'diagram'; artifact: DiagramArtifact }
  | { kind: 'sketch'; sketch: SketchCanvas };

export type AssistantBlock =
  | { kind: 'markdown'; markdown: string }
  | { kind: 'code'; language?: string; source: string; warning?: string }
  | { kind: 'diagram'; artifact: DiagramArtifact };

export type AgentMode = 'ask' | 'plan' | 'agent';

export interface UserMessage {
  id: string;
  role: 'user';
  authorId: string;
  addressedParticipantId: string;
  text: string;
  createdAt: string;
  status: 'sending' | 'sent' | 'cancelled' | 'failed';
  delivery?: 'not-sent' | 'possibly-sent';
  diagramAttachments: DiagramAttachmentRecord[];
  mode?: AgentMode;
}

export interface AssistantMessage {
  id: string;
  role: 'assistant';
  authorId: string;
  createdAt: string;
  status: 'complete' | 'cancelled' | 'failed';
  rawMarkdown: string;
  blocks: AssistantBlock[];
  metrics?: { durationMs: number; outputBytes: number };
  mode?: AgentMode;
  planProposed?: boolean;
}

export type ChatMessage = UserMessage | AssistantMessage;

export interface DiagramAnnotation {
  version: 1;
  diagramId: string;
  marks: DrawingMark[];
  updatedAt: string;
}

/** Public server snapshot. Private provider sessions and cursors are removed. */
export interface PublicSession {
  version: 3;
  revision: number;
  id: string;
  title: string;
  projectId?: string;
  repositories: RepositoryBinding[];
  createdAt: string;
  updatedAt: string;
  participants: Participant[];
  primaryAgentId: string;
  messages: ChatMessage[];
  pinnedDiagramIds: string[];
  annotations: Record<string, DiagramAnnotation>;
  sketches: SketchCanvas[];
}

/**
 * A public host snapshot plus device-only selection state. The optional fields are never persisted
 * as session content and can be reconstructed after a refetch.
 */
export interface SessionSnapshot extends PublicSession {
  /** Recipient selected for the next turn. Falls back to `primaryAgentId`. */
  addressedAgentId?: string;
  /** Points at a diagram artifact or a sketch — both share one canvas id space. */
  activeDiagramId?: string;
  previousDiagramId?: string;
  /** Mode pre-selected for the next message. Sessions themselves stay mode-agnostic. */
  defaultMode?: AgentMode;
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
  | 'max-turns'
  | 'timeout'
  | 'cancelled'
  | 'malformed-stream'
  | 'oversized-output'
  | 'absent-result'
  | 'internal';

/** How a pending permission request ended. Only `allow` lets the tool call proceed. */
export type PermissionResolution = 'allow' | 'deny' | 'timeout' | 'cancelled';

export type AgentEvent =
  | { type: 'run-started'; runId: string; sessionId: string; messageId: string; participantId: string }
  | { type: 'status'; runId: string; phase: AgentPhase; label: string }
  | { type: 'tool-activity'; runId: string; tool: string; detail?: string; denied?: boolean }
  | { type: 'assistant-delta'; runId: string; delta: string }
  | { type: 'assistant-message'; runId: string; message: AssistantMessage }
  | { type: 'permission-request'; runId: string; requestId: string; participantId: string; tool: string; detail: string }
  | { type: 'permission-resolved'; runId: string; requestId: string; decision: PermissionResolution }
  | {
      type: 'error';
      runId: string;
      code: AgentErrorCode;
      message: string;
      retryable: boolean;
      delivery: 'not-sent' | 'possibly-sent';
    }
  | { type: 'done'; runId: string; durationMs: number; cancelled: boolean };

/** Public, host-local identity for a live or briefly retained agent run. */
export interface RunDescriptor {
  runId: string;
  sessionId: string;
  participantId: string;
  startedAt: number;
  finishedAt?: number;
}

export interface RunDiscovery {
  active: RunDescriptor[];
  recent: RunDescriptor[];
}

export interface AgentMessageRequest {
  sessionId: string;
  messageId: string;
  participantId: string;
  text: string;
  diagramAttachments: DiagramMessageAttachment[];
  /** Omitted means `ask`; anything outside the enum is rejected with 400. */
  mode?: AgentMode;
}

/** Browser-held transcript input. Author metadata is resolved from the server-owned roster. */
export interface TranscriptContextMessage {
  id: string;
  authorId: string;
  createdAt: string;
  text: string;
  status: UserMessage['status'] | AssistantMessage['status'];
  delivery?: UserMessage['delivery'];
}

export interface PermissionDecisionRequest {
  runId: string;
  requestId: string;
  decision: 'allow' | 'deny';
}

export interface ResolvedAgentPolicy {
  profile: 'ask-readonly' | 'plan-readonly' | 'agent-full';
  mode: AgentMode;
  /** Undefined means the CLI default toolset (agent mode). */
  tools?: readonly string[];
  /** Server-owned permission rules, e.g. `Bash(git log:*)`. Never browser-configurable. */
  allowedTools: readonly string[];
  permissionMode: 'plan' | 'default';
  interactivePermissions: boolean;
  safeMode: true;
  sessionPersistence: true;
  maxTurns: number;
  timeoutMs: number;
  approvalTimeoutMs?: number;
}

/**
 * Answers the CLI's `can_use_tool` control requests. `settle` is invoked exactly once per
 * request and synchronously enough that cancellation can flush denials before SIGTERM.
 */
export interface PermissionGate {
  request(requestId: string, settle: (resolution: PermissionResolution) => void): void;
  cancelAll(): void;
}

export interface AgentProcessEvent {
  type: 'session-started' | 'text-delta' | 'activity' | 'phase' | 'permission-request' | 'permission-resolved';
  sessionId?: string;
  text?: string;
  tool?: string;
  detail?: string;
  denied?: boolean;
  phase?: 'thinking' | 'responding';
  requestId?: string;
  decision?: PermissionResolution;
}

export interface AgentProcessRun {
  runId: string;
  checkout: ServerCheckout;
  session: { id?: string; action: 'start' | 'resume' };
  prompt: string;
  attachmentDirectory: string;
  policy: ResolvedAgentPolicy;
  permissions?: PermissionGate;
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

export interface AgentProviderAdapter {
  readonly id: AgentProvider;
  readonly supportedModes: readonly AgentMode[];
  checkHealth(): Promise<ProviderHealth>;
  createRunner(): AgentProcessRunner;
}
