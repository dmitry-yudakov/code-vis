export type CodeLayoutNodeKind =
  | 'module'
  | 'directory'
  | 'file'
  | 'test'
  | 'declaration'
  | 'class'
  | 'method'
  | 'variable'
  | 'constant';

export type CodeLayoutNodeRole =
  | 'seed'
  | 'changed'
  | 'context'
  | 'bridge'
  | 'test'
  | 'expanded'
  | 'overview';

export type CodeLayoutEdgeKind =
  | 'imports'
  | 'imported-by'
  | 'calls'
  | 'called-by'
  | 'declares'
  | 'contains'
  | 'bridge'
  | 'heuristic';

export type CodeLayoutStrategy =
  | 'overview'
  | 'review-files'
  | 'review-declarations'
  | 'file-map'
  | 'logic-map'
  | 'fallback';

export type CodeLayoutEngine = 'semantic' | 'elk';

export interface CodeLayoutNode {
  id: string;
  label: string;
  kind: CodeLayoutNodeKind;
  role: CodeLayoutNodeRole;
  filename?: string;
  directory?: string;
  startLine?: number;
  endLine?: number;
  width?: number;
  height?: number;
  sortKey?: string;
  pinned?: boolean;
}

export interface CodeLayoutEdge {
  id: string;
  source: string;
  target: string;
  kind: CodeLayoutEdgeKind;
  label?: string;
  weight?: number;
  isHeuristic?: boolean;
}

export interface CodeLayoutResult {
  positions: Record<string, { x: number; y: number }>;
  edgeRoutes?: Record<
    string,
    Array<{
      x: number;
      y: number;
    }>
  >;
  bounds?: {
    width: number;
    height: number;
  };
}

export interface CodeLayoutInput {
  strategy: CodeLayoutStrategy;
  nodes: CodeLayoutNode[];
  edges: CodeLayoutEdge[];
  engine?: CodeLayoutEngine;
  previousPositions?: Record<string, { x: number; y: number }>;
  preservePrevious?: boolean;
  viewport?: { width: number; height: number };
}
