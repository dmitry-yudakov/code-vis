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
}
export interface FileMapping {
  includes: FileIncludeInfo[];
  functionDeclarations: FunctionDeclarationInfo[];
  functionCalls: FunctionCallInfo[];
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
}

export type CodeMapLens = 'overview' | 'review' | 'feature' | 'impact';

export type CodeMapScopeGranularity = 'files' | 'declarations';

export type CodeMapScopeNodeKind = 'file' | 'module' | 'declaration' | 'test';

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
