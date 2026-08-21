import dagre from 'dagre';
import {
  CodeLayoutEdge,
  CodeLayoutNode,
  CodeLayoutResult,
} from './types';
import { sortLayoutNodes } from './stableSort';

type DagreDirection = 'TB' | 'BT' | 'LR' | 'RL';

export interface DagreLayoutOptions {
  rankDirection?: DagreDirection;
  nodeWidth?: number;
  nodeHeight?: number;
  nodeSep?: number;
  rankSep?: number;
}

export const layoutWithDagre = (
  nodes: CodeLayoutNode[],
  edges: CodeLayoutEdge[],
  options: DagreLayoutOptions = {}
): CodeLayoutResult => {
  const {
    rankDirection = 'TB',
    nodeWidth = 250,
    nodeHeight = 160,
    nodeSep = 24,
    rankSep = 48,
  } = options;
  const graph = new dagre.graphlib.Graph({
    multigraph: true,
    compound: true,
    directed: true,
  });

  graph.setGraph({
    rankdir: rankDirection,
    ranker: 'longest-path',
    nodesep: nodeSep,
    ranksep: rankSep,
  });

  graph.setDefaultEdgeLabel(() => ({}));

  for (const node of sortLayoutNodes(nodes)) {
    graph.setNode(node.id, {
      label: node.label,
      width: node.width ?? nodeWidth,
      height: node.height ?? nodeHeight,
    });
  }

  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target, {
      weight: edge.weight ?? 1,
    });
  }

  dagre.layout(graph);

  const positions: CodeLayoutResult['positions'] = {};
  let maxX = 0;
  let maxY = 0;

  for (const node of nodes) {
    const positioned = graph.node(node.id);
    if (!positioned) continue;

    // dagre returns center coords; convert to top-left to match React Flow and other layout strategies
    const w = node.width ?? nodeWidth;
    const h = node.height ?? nodeHeight;
    const left = positioned.x - w / 2;
    const top = positioned.y - h / 2;
    positions[node.id] = { x: left, y: top };
    maxX = Math.max(maxX, left + w);
    maxY = Math.max(maxY, top + h);
  }

  return {
    positions,
    bounds: {
      width: maxX,
      height: maxY,
    },
  };
};

