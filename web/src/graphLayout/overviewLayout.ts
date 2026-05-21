import { layoutWithDagre } from './dagreLayout';
import {
  CodeLayoutEdge,
  CodeLayoutNode,
  CodeLayoutResult,
} from './types';
import { sortLayoutNodes } from './stableSort';

type OverviewLane = 'left' | 'center' | 'right';

const OVERVIEW_FILE_LANE_X: Record<OverviewLane, number> = {
  left: -520,
  center: 0,
  right: 520,
};

const getNodeWidth = (node: CodeLayoutNode): number => node.width ?? 250;
const getNodeHeight = (node: CodeLayoutNode): number =>
  node.height ?? (node.kind === 'declaration' ? 140 : 180);

const getRowGap = (node: CodeLayoutNode): number =>
  getNodeHeight(node) + (node.kind === 'declaration' ? 42 : 54);

const isFileNode = (node: CodeLayoutNode): boolean =>
  node.kind === 'file' || node.kind === 'test';

const isDeclarationNode = (node: CodeLayoutNode): boolean =>
  node.kind === 'declaration';

const getResultBounds = (
  nodes: CodeLayoutNode[],
  positions: CodeLayoutResult['positions']
): CodeLayoutResult['bounds'] => {
  let maxX = 0;
  let maxY = 0;

  for (const node of nodes) {
    const position = positions[node.id];
    if (!position) continue;
    maxX = Math.max(maxX, position.x + getNodeWidth(node));
    maxY = Math.max(maxY, position.y + getNodeHeight(node));
  }

  return { width: maxX, height: maxY };
};

const buildExpandedRelationCounts = (
  expandedIds: Set<string>,
  edges: CodeLayoutEdge[]
): Map<string, { left: number; right: number }> => {
  const counts = new Map<string, { left: number; right: number }>();

  const ensure = (id: string) => {
    const existing = counts.get(id);
    if (existing) return existing;
    const created = { left: 0, right: 0 };
    counts.set(id, created);
    return created;
  };

  for (const edge of edges) {
    const sourceExpanded = expandedIds.has(edge.source);
    const targetExpanded = expandedIds.has(edge.target);
    if (sourceExpanded === targetExpanded) continue;

    const contextId = sourceExpanded ? edge.target : edge.source;
    const relation = ensure(contextId);
    const weight = edge.weight ?? 1;

    if (sourceExpanded) {
      relation.left += weight;
    } else {
      relation.right += weight;
    }
  }

  return counts;
};

const layoutExpandedFileRegion = (
  nodes: CodeLayoutNode[],
  edges: CodeLayoutEdge[]
): CodeLayoutResult | null => {
  const expandedFiles = sortLayoutNodes(
    nodes.filter((node) => isFileNode(node) && node.role === 'expanded')
  );

  if (expandedFiles.length === 0) return null;
  if (
    nodes.some(
      (node) => !isDeclarationNode(node) && node.role === 'overview'
    )
  ) {
    return null;
  }

  const expandedIds = new Set(expandedFiles.map((node) => node.id));
  const relationCounts = buildExpandedRelationCounts(expandedIds, edges);
  const lanes: Record<OverviewLane, CodeLayoutNode[]> = {
    left: [],
    center: expandedFiles,
    right: [],
  };

  for (const node of nodes) {
    if (expandedIds.has(node.id) || isDeclarationNode(node)) continue;

    const relation = relationCounts.get(node.id);
    if (!relation) {
      lanes.right.push(node);
      continue;
    }

    lanes[relation.left >= relation.right ? 'left' : 'right'].push(node);
  }

  const positions: CodeLayoutResult['positions'] = {};

  for (const lane of ['left', 'center', 'right'] as OverviewLane[]) {
    let y = 0;
    for (const node of sortLayoutNodes(lanes[lane])) {
      positions[node.id] = { x: OVERVIEW_FILE_LANE_X[lane], y };
      y += getRowGap(node);
    }
  }

  return {
    positions,
    bounds: getResultBounds(nodes, positions),
  };
};

const layoutDeclarationExpansion = (
  nodes: CodeLayoutNode[],
  edges: CodeLayoutEdge[],
  viewport?: { width: number; height: number }
): CodeLayoutResult | null => {
  const declarations = nodes.filter(isDeclarationNode);
  if (declarations.length === 0) return null;

  const declarationIds = new Set(declarations.map((node) => node.id));
  const parentByDeclaration = new Map<string, string>();

  for (const edge of edges) {
    if (edge.kind !== 'declares') continue;
    if (!declarationIds.has(edge.target)) continue;
    parentByDeclaration.set(edge.target, edge.source);
  }

  if (parentByDeclaration.size === 0) return null;

  const baseNodes = nodes.filter((node) => !declarationIds.has(node.id));
  const baseNodeIds = new Set(baseNodes.map((node) => node.id));
  const baseEdges = edges.filter(
    (edge) => baseNodeIds.has(edge.source) && baseNodeIds.has(edge.target)
  );
  const baseResult = layoutOverview(baseNodes, baseEdges, viewport);
  const positions: CodeLayoutResult['positions'] = {
    ...baseResult.positions,
  };

  const declarationsByParent = new Map<string, CodeLayoutNode[]>();
  for (const declaration of declarations) {
    const parentId = parentByDeclaration.get(declaration.id);
    if (!parentId) continue;
    declarationsByParent.set(parentId, [
      ...(declarationsByParent.get(parentId) || []),
      declaration,
    ]);
  }

  for (const [parentId, childNodes] of declarationsByParent.entries()) {
    const parent = baseNodes.find((node) => node.id === parentId);
    const parentPosition = positions[parentId];
    if (!parent || !parentPosition) continue;

    const sortedChildren = sortLayoutNodes(childNodes);
    const groupHeight = sortedChildren.reduce(
      (height, node, index) =>
        height +
        (index === sortedChildren.length - 1
          ? getNodeHeight(node)
          : getRowGap(node)),
      0
    );
    const childX = parentPosition.x + getNodeWidth(parent) + 120;
    let childY = Math.max(0, parentPosition.y - groupHeight / 2);

    for (const child of sortedChildren) {
      positions[child.id] = { x: childX, y: childY };
      childY += getRowGap(child);
    }
  }

  return {
    positions,
    bounds: getResultBounds(nodes, positions),
  };
};

export const layoutOverview = (
  nodes: CodeLayoutNode[],
  edges: CodeLayoutEdge[],
  viewport?: { width: number; height: number }
): CodeLayoutResult => {
  const declarationExpansion = layoutDeclarationExpansion(
    nodes,
    edges,
    viewport
  );
  if (declarationExpansion) return declarationExpansion;

  const expandedFileRegion = layoutExpandedFileRegion(nodes, edges);
  if (expandedFileRegion) return expandedFileRegion;

  const rankDirection =
    viewport && viewport.width > viewport.height * 1.6 ? 'LR' : 'TB';

  return layoutWithDagre(nodes, edges, {
    rankDirection,
    nodeWidth: 250,
    nodeHeight: 180,
    nodeSep: 28,
    rankSep: 58,
  });
};
