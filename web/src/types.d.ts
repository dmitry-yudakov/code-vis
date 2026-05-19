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
  callKind?: 'call' | 'constructor' | 'jsx-component' | 'tagged-template';
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
  | { mode: 'branch'; baseRef: string };

export type ChangeSourceRequest =
  | { mode: 'diff' }
  | { mode: 'branch'; baseRef?: string };

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

export interface FileMapDetailed {
  filename?: string;
  content: string;
  mapping: FileMapping;
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
