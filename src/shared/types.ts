import type { LaunchMode } from './agentModes';

export interface CheckoutSummary {
  id: string;
  name: string;
  relativePath: string;
  /** Advisory source eligibility; creation independently repeats full validation. */
  worktreeCreation?: WorktreeCapability;
  worktree?: SessionWorktree;
  branch?: string;
  unavailableReason?: string;
}

export interface WorktreeCapability {
  available: boolean;
  message?: string;
  branch?: string;
  /** Source-specific Docker restrictions; Local availability is independent. */
  dockerUnavailableReason?: string;
}

export interface SessionWorktree {
  id: string;
  originCheckoutId: string;
  baseCommit: string;
  /** Initial generated name; operations resolve the live branch themselves. */
  branch: string;
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
export type AgentExecution = 'local' | 'docker';
export type AgentRole = 'orchestrator' | 'coder' | 'reviewer' | 'tester' | 'custom';
/** A session's own answer to "do its agents get the user's global instructions?". Absent: the machine's switch. */
export type GlobalInstructionsChoice = 'global' | 'isolated';

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
  /** A role's default is never Auto: Auto is chosen for a session, by the user. */
  defaultMode: LaunchMode;
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
  /**
   * Version 5 is version 4 plus report evidence on user messages; version 6 is version 5 plus Auto
   * messages. Each is written only by the first message that needs it. Version 7 is version 6 plus
   * `instructions`, and only a session created with that choice is written at it. Version 8 is
   * version 7 plus images on user messages, written by the first message that carries one.
   * Version 9 adds Native writing modes and levels, only when a message needs them.
   */
  version: 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  /** Server-only receipt; never included in public sessions. */
  creationReceipt?: { requestId: string; fingerprint: string };
  worktree?: SessionWorktree;
  /** Required from version 4; absent in version 3, whose execution is always local. */
  execution?: AgentExecution;
  /** Fixed at creation and held only by a version 7 session. Absent: each turn follows the machine's switch. */
  instructions?: GlobalInstructionsChoice;
  revision: number;
  id: string;
  title: string;
  /** Present only while the record lives in the host's archived-sessions directory. */
  archivedAt?: string;
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

export interface ProviderModel {
  /** Sent back as `model`; the server passes it to the provider unchanged. */
  id: string;
  label: string;
  /** Efforts this model accepts, in provider order; empty means effort cannot be named. */
  efforts: string[];
}

export interface ProviderHealth {
  available: boolean;
  authenticated: boolean | 'unknown';
  supportedModes: AgentMode[];
  message?: string;
  /** Server-owned models a turn may name. Absent or empty: only Default. */
  models?: ProviderModel[];
  /** Efforts a turn may name while the model is Default. */
  efforts?: string[];
}

/** The part of a provider's health a turn's model and effort are checked against. */
export type ModelChoices = Pick<ProviderHealth, 'models' | 'efforts'>;

/** Device-only choice for one agent's next turn. Absent fields mean Default. */
export interface ModelSelection {
  model?: string;
  effort?: string;
}

/**
 * Why a global instruction file is not passed. `missing` is the ordinary case of having none;
 * `agent-link` is a symbolic link an agent turn could repoint, `protected` a path that ends in a
 * provider folder's private files, and `unverified` a file a turn can reach on a system that cannot
 * prove which file was opened.
 */
export type InstructionFileIssue =
  | 'missing' | 'not-file' | 'too-large' | 'not-text' | 'unreadable' | 'agent-link' | 'protected' | 'unverified';

/**
 * One machine's Global instructions, as its health reports them: each provider's switch, whether
 * CodeAI has text to pass, and whether a file is there for local Codex to load itself.
 */
export type MachineInstructions = Record<AgentProvider, { enabled: boolean; passable: boolean; present: boolean }>;

/** What the line under the composer says applies to the addressed agent; `unavailable` is on with nothing to give. */
export type InstructionsLine = GlobalInstructionsChoice | 'unavailable';

/** One provider's global instructions on this machine. */
export interface ProviderInstructions {
  /** This machine's switch for the provider. */
  enabled: boolean;
  /** Relative to the home directory; a symbolic link shows its target after an arrow. */
  displayPath: string;
  /** Present when the file can be passed. It is never a truncated file. */
  text?: string;
  issue?: InstructionFileIssue;
  /** Claude only: the text holds `@path` imports, which are passed as written and not followed. */
  imports: boolean;
  /** Codex only: local Codex loads this file itself, whatever the switch says. */
  localAlways?: true;
  /** The file lies under the repositories root or a temp directory, where a turn can change what it says. */
  agentEditable?: true;
  /** What a Docker worker sees read-only under `/user/<provider>`, and the entries left out. */
  docker: { entries: string[]; skipped: string[] };
}

/** `GET /api/instructions`: the home machine's global instructions, for its own devices only. */
export interface GlobalInstructionsView {
  providers: Record<AgentProvider, ProviderInstructions>;
  /** Both providers resolve to one file. */
  shared: boolean;
  /** The settings record is damaged, so both switches read as off until one is saved. */
  damaged?: true;
}

/** The offline check an update's candidate failed, or `build` when it could not be built. */
export type DockerCheck = 'build' | 'version' | 'claude-flags' | 'codex-handshake' | 'codex-models';
export type DockerUpdateState = 'building' | 'checking' | 'switching' | 'switched' | 'failed' | 'in-use';

/** A version Arena may offer for one provider's Docker CLI. */
export interface DockerCliOffer {
  version: string;
  /** Below the recorded version: the newer CLI may already have migrated the provider's shared home. */
  downgrade: boolean;
}

export interface DockerCliStatus {
  /** The version in the image this machine records. */
  version: string;
  /** The lowest version this CodeAI supports, which a fresh provision installs. */
  minimum: string;
  /** npm's `latest`, when it is above the recorded version. */
  latest?: DockerCliOffer;
  /** The version the last update replaced, when it is at least the minimum and not `latest`. */
  previous?: DockerCliOffer;
}

/** One CLI update on this machine, running or finished since CodeAI started. */
export interface DockerUpdateOperation {
  id: string;
  provider: AgentProvider;
  version: string;
  state: DockerUpdateState;
  check?: DockerCheck;
  message?: string;
  startedAt: string;
  finishedAt?: string;
}

/** `GET /api/execution/docker/versions`. */
export interface DockerVersionsStatus {
  providers: Record<AgentProvider, DockerCliStatus>;
  /** When npm was last asked; `failed` means that lookup failed, so it offers nothing. */
  releases: { checkedAt: string; failed?: true };
  operation?: DockerUpdateOperation;
}

export type ExecutionHealth = Record<AgentExecution, {
  enabled: boolean;
  providers: Record<AgentProvider, ProviderHealth>;
}>;

export interface DeviceAuthStatus {
  mode: 'local' | 'paired';
  authenticated: boolean;
  transportSecure: boolean;
  hostLabel: string;
  device?: { id: string; label: string };
}

export interface PairedDeviceSummary {
  id: string;
  label: string;
  pairedAt: string;
  expiresAt: string;
  current: boolean;
}

export type MachineConnectionState = 'online' | 'offline';

export interface MachineIdentity {
  id: string;
  label: string;
}

export interface ArenaMachineIdentity extends MachineIdentity {
  kind: 'local' | 'remote';
  state: MachineConnectionState;
  lastSeenAt?: string;
}

/** Public summary of an executor that has authenticated to this machine. */
export interface AttachedMachineSummary extends MachineIdentity {
  pairedAt: string;
  expiresAt: string;
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

/**
 * A CodeAI report carried by a user message. Metadata only: the JSON and screenshot live in the
 * session's promoted copy on the home machine, never in the message or on the wire.
 */
export interface ReportAttachmentRecord {
  reportId: string;
  receivedAt: string;
  kind: 'capture' | 'error';
  screenshotIncluded: boolean;
  errorCount: number;
}

/** The browser names a retained report by id; the server resolves every file. */
export interface ReportAttachmentRequest {
  reportId: string;
}

export type ImageMediaType = 'image/png' | 'image/jpeg';

/** An image the user pasted or dropped into the composer, as the browser prepared it: a PNG or JPEG data URL. */
export interface ImageAttachmentRequest {
  dataUrl: string;
}

/**
 * An image carried by a user message. Metadata only: the bytes existed in that turn's run
 * directory and are kept nowhere.
 */
export interface ImageAttachmentRecord {
  mediaType: ImageMediaType;
  bytes: number;
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

/**
 * `auto` is CodeAI's sandboxed mode: what the provider's operating-system sandbox contains runs
 * without a card, and anything that leaves it asks. See `src/shared/agentModes.ts`.
 */
export type SecurityLevel = 'guarded' | 'native';
export type AgentMode = 'ask' | 'plan' | 'agent' | 'edits' | 'auto' | 'full';

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
  /** Present only on messages that carried reports, which only a version 5 session holds. */
  reportAttachments?: ReportAttachmentRecord[];
  /** Present only on messages that carried images, which only a version 8 session holds. */
  imageAttachments?: ImageAttachmentRecord[];
  fileAttachments?: import('./textFiles').TextFileRecord[];
  mode?: AgentMode;
  /** Native Agent/Auto need a level; the two Native-only modes identify themselves. */
  level?: 'native';
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
  level?: 'native';
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
  version: 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
  worktree?: SessionWorktree;
  /** Required from version 4; absent in version 3, whose execution is always local. */
  execution?: AgentExecution;
  instructions?: GlobalInstructionsChoice;
  revision: number;
  id: string;
  title: string;
  archivedAt?: string;
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

/** Bounded host snapshot for the cross-project Arena; never includes transcripts or private handles. */
export interface ArenaSessionSummary {
  worktree?: SessionWorktree;
  /** Added by the Arena client when flattening machine projections; never stored canonically. */
  machineId?: string;
  /** Absent for version 3 sessions, which always execute locally. */
  execution?: AgentExecution;
  id: string;
  revision: number;
  title: string;
  archivedAt?: string;
  projectId?: string;
  repositoryCheckoutIds: string[];
  agents: Array<Pick<AgentParticipant, 'id' | 'displayName' | 'provider' | 'role'>>;
  updatedAt: string;
  lastActivity?: {
    messageId: string;
    createdAt: string;
    status: ChatMessage['status'];
  };
}

/**
 * A public host snapshot plus device-only selection state. The optional fields are never persisted
 * as session content and can be reconstructed after a refetch.
 */
export interface SessionSnapshot extends PublicSession {
  /** Executor selected by this browser view; never persisted in the canonical session. */
  machineId?: string;
  /** Recipient selected for the next turn. Falls back to `primaryAgentId`. */
  addressedAgentId?: string;
  /** Points at a diagram artifact or a sketch — both share one canvas id space. */
  activeDiagramId?: string;
  previousDiagramId?: string;
  /** Mode pre-selected for the next message. Sessions themselves stay mode-agnostic. */
  defaultMode?: AgentMode;
}

export type AgentPhase =
  | 'queued'
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
  | { type: 'mode-changed'; runId: string; mode: AgentMode }
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
export type RunState = 'queued' | 'running' | 'needs-you' | 'finished';

export interface RunPermissionSummary {
  requestId: string;
  participantId: string;
  tool: string;
  detail: string;
}

export type RunOutcome = 'completed' | 'failed' | 'cancelled';

export interface RunDescriptor {
  /** Added by the Arena client when flattening machine projections; never stored by a run registry. */
  machineId?: string;
  runId: string;
  sessionId: string;
  participantId: string;
  /** Latest accepted mode for this turn, including a change still being applied. */
  mode?: AgentMode;
  state: RunState;
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  /** One-based and present only while queued. */
  queuePosition?: number;
  pendingPermissionCount: number;
  /** Safe, answerable summaries for the host-wide Inbox. */
  pendingPermissions: RunPermissionSummary[];
  /** The latest human-readable lifecycle line emitted by this run. */
  status?: string;
  /** Present only after a retained run has reached a terminal event. */
  outcome?: RunOutcome;
}

export interface RunDiscovery {
  active: RunDescriptor[];
  recent: RunDescriptor[];
}

export interface ArenaSnapshot {
  machines: ArenaMachineSnapshot[];
}

/** A machine-owned projection. It never includes transcripts, provider handles, absolute paths, or credentials. */
export interface ExecutorSnapshot {
  worktrees?: WorktreeCapability;
  machine: MachineIdentity;
  /** Omitted at Guarded for compatibility with older homes. */
  securityLevel?: 'native';
  projects: DurableProject[];
  checkouts: CheckoutSummary[];
  recentCheckoutIds: string[];
  providers: Record<AgentProvider, ProviderHealth>;
  sessions: ArenaSessionSummary[];
  archivedSessions: ArenaSessionSummary[];
  runs: RunDiscovery;
}

/** One executor as observed by the home Arena. Offline entries carry the last valid cached data. */
/** snapshotFresh is disposable browser observation state, never an executor assertion. */
export interface ArenaMachineSnapshot extends Omit<ExecutorSnapshot, 'machine'> {
  machine: ArenaMachineIdentity;
  snapshotFresh?: boolean;
}

export interface AgentMessageRequest {
  sessionId: string;
  messageId: string;
  participantId: string;
  text: string;
  diagramAttachments: DiagramMessageAttachment[];
  /** CodeAI reports for a self-project session; the protocol parser defaults absence to `[]`. */
  reportAttachments?: ReportAttachmentRequest[];
  /** Pasted or dropped images for this turn only; the protocol parser defaults absence to `[]`. */
  imageAttachments?: ImageAttachmentRequest[];
  fileAttachments?: import('./textFiles').TextFile[];
  /** Omitted means `ask`; anything outside the enum is rejected with 400. */
  mode?: AgentMode;
  /** Omitted means Default. Must be an `id` in the addressed provider's `models`, or 400. */
  model?: string;
  /** Omitted means Default. Must be in the named model's `efforts` (or `efforts`), or 400. */
  effort?: string;
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
  execution?: AgentExecution;
  level: SecurityLevel;
  profile: 'ask-readonly' | 'plan-readonly' | 'agent-full' | 'auto-sandboxed' | 'native';
  mode: AgentMode;
  /** Undefined means the CLI default toolset (agent mode). */
  tools?: readonly string[];
  /** Server-owned permission rules, e.g. `Bash(git log:*)`. Never browser-configurable. */
  allowedTools: readonly string[];
  permissionMode: 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions';
  interactivePermissions: boolean;
  sessionPersistence: true;
  maxTurns: number;
  /** Zero disables CodeAI's execution clock; provider-owned limits still apply. */
  timeoutMs: number;
  /** Zero disables approval expiry. */
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
  type: 'session-started' | 'turn-started' | 'text-delta' | 'activity' | 'phase' | 'permission-request' | 'permission-resolved';
  sessionId?: string;
  text?: string;
  tool?: string;
  detail?: string;
  denied?: boolean;
  phase?: 'thinking' | 'responding';
  requestId?: string;
  decision?: PermissionResolution;
}

/** The user's global instruction file for one turn, read on the server. */
export interface GlobalInstructions {
  displayPath: string;
  text: string;
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
  /** Already validated. Undefined model means the installation default; undefined effort sends none. */
  model?: string;
  effort?: string;
  /**
   * Server-resolved; undefined means isolated, a file that cannot be passed, or local Codex, which
   * loads its own file.
   */
  globalInstructions?: GlobalInstructions;
  /** Server-resolved; Docker only: the turn's choice is on, so the worker may see the allowlisted entries. */
  userCustomizations?: boolean;
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
  /** With a mode, checks only the policy needed by that turn; otherwise lists all ready modes. */
  checkHealth(mode?: AgentMode): Promise<ProviderHealth>;
  createRunner(): AgentProcessRunner;
}
