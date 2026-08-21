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

/**
 * An editorial grouping the layout should keep physically together (the LLM
 * arrangement's regions). The elk path nests each cluster's members under a
 * group node so they lay out as one cohesive block — what lets the soft band
 * wrap a tight, non-overlapping area instead of a sprawl across the canvas.
 * Membership is a partition: a node listed in several clusters lands in the
 * first by id. Clusters with fewer than two present members are ignored.
 */
export interface LayoutCluster {
  id: string;
  label?: string;
  nodeIds: string[];
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
  /** Editorial groupings to keep together; honored by the elk engine only. */
  clusters?: LayoutCluster[];
}
