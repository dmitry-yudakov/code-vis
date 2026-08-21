import {
  CodeLayoutEdge,
  CodeLayoutNode,
  CodeLayoutResult,
} from './types';
import { sortLayoutNodes } from './stableSort';

export const layoutFileMap = (
  nodes: CodeLayoutNode[],
  edges: CodeLayoutEdge[],
  viewport: { width: number; height: number } = { width: 1200, height: 800 }
): CodeLayoutResult => {
  const seed = nodes.find(
    (node) => node.role === 'seed' || node.role === 'changed'
  );
  const seedId = seed?.id;
  const laneById = new Map<string, 'left' | 'center' | 'right'>();

  if (seedId) laneById.set(seedId, 'center');

  for (const edge of edges) {
    if (!seedId) break;
    if (edge.source === seedId) {
      laneById.set(edge.target, 'right');
    }
    if (edge.target === seedId) {
      laneById.set(edge.source, 'left');
    }
  }

  const lanes = {
    left: [] as CodeLayoutNode[],
    center: [] as CodeLayoutNode[],
    right: [] as CodeLayoutNode[],
  };

  for (const node of nodes) {
    lanes[laneById.get(node.id) || 'center'].push(node);
  }

  const colWidth = Math.max(260, viewport.width / 3);
  const xByLane = {
    left: Math.max(16, colWidth * 0.06),
    center: colWidth + Math.max(16, colWidth * 0.06),
    right: colWidth * 2 + Math.max(16, colWidth * 0.06),
  };
  const positions: CodeLayoutResult['positions'] = {};
  let maxY = 0;
  const initialY = 70;

  for (const lane of ['left', 'center', 'right'] as const) {
    let y = initialY;
    for (const node of sortLayoutNodes(lanes[lane])) {
      positions[node.id] = { x: xByLane[lane], y };
      y += Math.max(node.height ?? 280, 280) + 28;
    }
    maxY = Math.max(maxY, y);
  }

  return {
    positions,
    bounds: {
      width: viewport.width,
      height: Math.max(viewport.height, maxY),
    },
  };
};

