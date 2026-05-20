import {
  CodeLayoutEdge,
  CodeLayoutNode,
  CodeLayoutResult,
} from './types';
import { groupLayoutNodesByFile } from './stableSort';

const computeCallRanks = (
  nodes: CodeLayoutNode[],
  edges: CodeLayoutEdge[]
): Map<string, number> => {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  for (const node of nodes) {
    outgoing.set(node.id, []);
    indegree.set(node.id, 0);
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    outgoing.get(edge.source)!.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
  }

  const ranks = new Map(nodes.map((node) => [node.id, 0]));
  const queue = nodes
    .filter((node) => (indegree.get(node.id) || 0) === 0)
    .map((node) => node.id);
  let cursor = 0;

  while (cursor < queue.length) {
    const id = queue[cursor++];
    const rank = ranks.get(id) || 0;
    for (const target of outgoing.get(id) || []) {
      ranks.set(target, Math.max(ranks.get(target) || 0, rank + 1));
      indegree.set(target, (indegree.get(target) || 0) - 1);
      if ((indegree.get(target) || 0) === 0) {
        queue.push(target);
      }
    }
  }

  return ranks;
};

export const layoutLogicMap = (
  nodes: CodeLayoutNode[],
  edges: CodeLayoutEdge[]
): CodeLayoutResult => {
  const ranks = computeCallRanks(nodes, edges);
  const groups = groupLayoutNodesByFile(nodes);
  const positions: CodeLayoutResult['positions'] = {};
  let y = 0;
  let maxX = 0;

  for (const group of groups) {
    for (const node of group.nodes) {
      const rank = ranks.get(node.id) || 0;
      const x = rank * 720;
      positions[node.id] = { x, y };
      maxX = Math.max(maxX, x + (node.width ?? 650));
      y += Math.max(node.height ?? 150, 150) + 40;
    }
    y += 90;
  }

  return {
    positions,
    bounds: {
      width: maxX,
      height: y,
    },
  };
};

