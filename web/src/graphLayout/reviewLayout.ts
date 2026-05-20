import {
  CodeLayoutEdge,
  CodeLayoutNode,
  CodeLayoutResult,
} from './types';
import { getLayoutSortKey, sortLayoutNodes } from './stableSort';

type Lane = 'left' | 'center' | 'right' | 'test';

const FILE_LANE_X: Record<Lane, number> = {
  left: -460,
  center: 0,
  right: 460,
  test: 0,
};

const DECLARATION_LANE_X: Record<Lane, number> = {
  left: -520,
  center: 0,
  right: 520,
  test: 0,
};

const fileRowGap = (node: CodeLayoutNode) => Math.max(node.height ?? 150, 150) + 48;
const declarationRowGap = (node: CodeLayoutNode) =>
  Math.max(node.height ?? 140, 140) + 44;

const isSeed = (node: CodeLayoutNode): boolean =>
  node.role === 'seed' || node.role === 'changed';

const placeLanes = (
  lanes: Record<Lane, CodeLayoutNode[]>,
  laneX: Record<Lane, number>,
  rowGapFor: (node: CodeLayoutNode) => number
): CodeLayoutResult => {
  const positions: CodeLayoutResult['positions'] = {};
  let maxX = 0;
  let maxY = 0;

  for (const lane of ['left', 'center', 'right'] as Lane[]) {
    let y = 0;
    for (const node of sortLayoutNodes(lanes[lane])) {
      positions[node.id] = { x: laneX[lane], y };
      maxX = Math.max(maxX, laneX[lane] + (node.width ?? 260));
      maxY = Math.max(maxY, y + (node.height ?? 150));
      y += rowGapFor(node);
    }
  }

  const centerHeight = sortLayoutNodes(lanes.center).reduce(
    (total, node) => total + rowGapFor(node),
    0
  );
  let testY = Math.max(centerHeight + 80, 260);
  for (const node of sortLayoutNodes(lanes.test)) {
    positions[node.id] = { x: laneX.test, y: testY };
    maxX = Math.max(maxX, laneX.test + (node.width ?? 260));
    maxY = Math.max(maxY, testY + (node.height ?? 150));
    testY += rowGapFor(node);
  }

  return {
    positions,
    bounds: {
      width: maxX,
      height: maxY,
    },
  };
};

const buildSeedRelationCounts = (
  nodes: CodeLayoutNode[],
  edges: CodeLayoutEdge[],
  mode: 'imports' | 'calls'
): Map<string, { left: number; right: number }> => {
  const seedIds = new Set(nodes.filter(isSeed).map((node) => node.id));
  const counts = new Map<string, { left: number; right: number }>();

  const ensure = (id: string) => {
    const existing = counts.get(id);
    if (existing) return existing;
    const created = { left: 0, right: 0 };
    counts.set(id, created);
    return created;
  };

  for (const edge of edges) {
    const sourceIsSeed = seedIds.has(edge.source);
    const targetIsSeed = seedIds.has(edge.target);
    if (sourceIsSeed === targetIsSeed) continue;

    const contextId = sourceIsSeed ? edge.target : edge.source;
    const count = ensure(contextId);

    if (mode === 'imports') {
      if (sourceIsSeed) {
        count.left++;
      } else {
        count.right++;
      }
    } else {
      if (sourceIsSeed) {
        count.right++;
      } else {
        count.left++;
      }
    }
  }

  return counts;
};

export const layoutReviewFiles = (
  nodes: CodeLayoutNode[],
  edges: CodeLayoutEdge[]
): CodeLayoutResult => {
  const relationCounts = buildSeedRelationCounts(nodes, edges, 'imports');
  const lanes: Record<Lane, CodeLayoutNode[]> = {
    left: [],
    center: [],
    right: [],
    test: [],
  };

  for (const node of nodes) {
    if (node.role === 'test' || node.kind === 'test') {
      lanes.test.push({
        ...node,
        sortKey: node.sortKey || `test|${getLayoutSortKey(node)}`,
      });
      continue;
    }

    if (isSeed(node) || node.role === 'bridge') {
      lanes.center.push(node);
      continue;
    }

    const relation = relationCounts.get(node.id);
    if (!relation) {
      lanes.center.push(node);
      continue;
    }

    lanes[relation.left >= relation.right ? 'left' : 'right'].push(node);
  }

  return placeLanes(lanes, FILE_LANE_X, fileRowGap);
};

export const layoutReviewDeclarations = (
  nodes: CodeLayoutNode[],
  edges: CodeLayoutEdge[]
): CodeLayoutResult => {
  const relationCounts = buildSeedRelationCounts(nodes, edges, 'calls');
  const lanes: Record<Lane, CodeLayoutNode[]> = {
    left: [],
    center: [],
    right: [],
    test: [],
  };

  for (const node of nodes) {
    if (isSeed(node) || node.role === 'bridge') {
      lanes.center.push(node);
      continue;
    }

    const relation = relationCounts.get(node.id);
    if (!relation) {
      lanes.center.push(node);
      continue;
    }

    lanes[relation.left >= relation.right ? 'left' : 'right'].push(node);
  }

  return placeLanes(lanes, DECLARATION_LANE_X, declarationRowGap);
};

