export interface FileIncludeInfo {
  to: string;
  from: string;
  items: string[];
}

export interface FunctionCallInfo {
  name: string;
  filename: string;
  pos: number;
  end: number;
  args: string[];
  calleeText?: string;
  callChain?: string[];
  callKind?:
    | 'call'
    | 'constructor'
    | 'jsx-component'
    | 'tagged-template'
    | 'callback-reference';
  receiverText?: string;
  receiverKind?:
    | 'identifier'
    | 'property'
    | 'element-access'
    | 'call-result'
    | 'unknown';
  isOptional?: boolean;
  isBuiltin?: boolean;
}
export interface FunctionDeclarationInfo {
  name: string;
  filename: string;
  pos: number;
  end: number;
  args: string[];
  /** Owning class/module for methods and class-field arrows (part of the id). */
  container?: string;
  /** Static entity kind; defaults to 'function' when absent. */
  kind?: EntityKind;
}
export interface FileMapping {
  includes: FileIncludeInfo[];
  functionDeclarations: FunctionDeclarationInfo[];
  functionCalls: FunctionCallInfo[];
}

/**
 * Shared Entity/Relation model — a minimal, forward-compatible subset of the
 * vision's illustrative shape (docs/vision.md#L148). Only the fields M1 needs;
 * deferred fields (`confidence`, `traitOrigins`, `changePhase`, `description`, …)
 * are omitted now but the shape is a strict subset so they add cleanly later.
 *
 * Duplicated verbatim in server/src/types.d.ts — keep the two in sync (AGENTS.md).
 */
export type EntityKind =
  | 'file'
  | 'class'
  | 'function'
  | 'method'
  | 'variable'
  | 'constant';
export type RelationKind = 'contains' | 'declares' | 'imports' | 'calls';
export type Provenance = 'static'; // only value emitted in M1; widened later
export type ChangeStatus = 'added' | 'modified' | 'deleted'; // diff-driven

export interface SourceLocation {
  filename: string;
  pos?: number;
  end?: number;
  startLine?: number;
  endLine?: number;
}

export interface Entity {
  id: string; // entityId(...) — the merge key; pos NOT included
  kind: EntityKind;
  name: string;
  container?: string; // owning class/module; part of the id
  location?: SourceLocation; // pos lives here, refreshed each extraction
  origin: Provenance;
  traits?: Record<string, unknown>;
  content?: string; // lazy code slice (reuses Story 1 card rendering)
  changeStatus?: ChangeStatus;
}

export interface Relation {
  id: string;
  kind: RelationKind;
  source: string; // entity id
  target: string; // entity id
  origin: Provenance;
  changeStatus?: ChangeStatus;
}

export type ChangedFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export type ChangeSource =
  | { mode: 'diff' }
  | { mode: 'branch'; baseRef: string }
  | { mode: 'commit'; ref: string; parentRef: string };

export type ChangeSourceRequest =
  | { mode: 'diff' }
  | { mode: 'branch'; baseRef?: string }
  | { mode: 'commit'; ref: string; parentRef?: string };

export interface CommitSummary {
  hash: string;
  shortHash: string;
  subject: string;
  authorName: string;
  timestamp: number;
}

export interface ChangedFileInfo {
  filename: string;
  status: ChangedFileStatus;
  addedLines?: Array<{ start: number; end: number }>;
  removedLines?: Array<{ start: number; end: number }>;
}

export interface ChangeSet {
  source: ChangeSource;
  files: ChangedFileInfo[];
}

export interface FocusedReviewOptions {
  includeTests?: boolean;
}

export interface RelatedReason {
  type:
    | 'changed'
    | 'imports-changed'
    | 'imported-by-changed'
    | 'function-neighbor'
    | 'related-test';
  via?: string;
}

export interface FocusedFileInfo {
  filename: string;
  reasons: RelatedReason[];
  isChanged: boolean;
  isTest: boolean;
  changeStatus?: ChangedFileStatus;
}

export interface FocusedDeclarationReason {
  type:
    | 'changed'
    | 'calls-changed'
    | 'called-by-changed'
    | 'bridge-between-changes';
  via?: string;
}

export interface FocusedDeclarationInfo {
  id: string;
  name: string;
  filename: string;
  pos: number;
  end: number;
  args: string[];
  reasons: FocusedDeclarationReason[];
  isChanged: boolean;
  changeStatus?: ChangedFileStatus;
  startLine?: number;
  endLine?: number;
  kind?: EntityKind; // class/function/method/variable/constant (defaults to function)
  container?: string; // owning class for methods/class-field arrows
  summary?: string; // what changed & why it matters (≤ ~120 chars)
  causalReason?: string; // this node's role in the change story (≤ ~80 chars)
  narrativeRank?: number; // 0 = root cause; consumed by Story 2's layout, not this story
}

export interface FocusedDeclarationCallInfo {
  id: string;
  from: string;
  to: string;
  name: string;
  filename: string;
  pos: number;
  end: number;
  reasons: FocusedDeclarationReason[];
  isHeuristic: boolean;
}

export interface FocusedReviewMap {
  changeSet: ChangeSet;
  files: FocusedFileInfo[];
  includes: FileIncludeInfo[];
  declarations: FocusedDeclarationInfo[];
  declarationCalls: FocusedDeclarationCallInfo[];
  /** Richer static Entity/Relation model (M1); additive over the legacy fields. */
  entities?: Entity[];
  relations?: Relation[];
}

export type CodeMapLens = 'overview' | 'review' | 'feature' | 'impact';

export type CodeMapScopeGranularity = 'files' | 'declarations';

export type CodeMapScopeNodeKind =
  | 'file'
  | 'module'
  | 'declaration'
  | 'test'
  | 'class'
  | 'method'
  | 'variable'
  | 'constant';

export interface CodeMapScopeNode {
  id: string;
  kind: CodeMapScopeNodeKind;
  label: string;
  filename?: string;
  pos?: number;
  end?: number;
  startLine?: number;
  endLine?: number;
  reasons: string[];
  isChanged: boolean;
  isTest: boolean;
  isDeleted: boolean;
  changeStatus?: ChangedFileStatus;
}

export interface CodeMapScopeEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface CodeMapScope {
  scopeId: string;
  lens: CodeMapLens;
  mode: string;
  granularity: CodeMapScopeGranularity;
  selectedNodeId?: string;
  source?: ChangeSource;
  includeContext?: boolean;
  includeTests?: boolean;
  expandedDirectory?: string;
  expandedFile?: string;
  files: string[];
  declarations: CodeMapScopeNode[];
  nodes: CodeMapScopeNode[];
  edges: CodeMapScopeEdge[];
  generatedAt?: string;
}

export interface FileMapDetailed {
  filename?: string;
  content: string;
  mapping: FileMapping;
}

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  rootPath: string;
  mtimeMs: number;
  mtime: string;
  lastOpenedAt?: string;
  isActive?: boolean;
}

export interface ProjectListResponse {
  rootPath: string;
  projects: ProjectInfo[];
  activeProjectId?: string;
}

export interface OpenProjectResponse extends ProjectListResponse {
  project: ProjectInfo;
  projectMap: FileIncludeInfo[];
}

export interface ProjectChangeEvent {
  type: 'add' | 'change' | 'remove';
  path: string;
  projectId?: string;
  projectName?: string;
  projectPath?: string;
}

export interface Edge {
  source: string;
  target: string;
}
export interface Node {
  id: string;
  label: string;
}
export interface PositionedNode extends Node {
  x: number;
  y: number;
}
