import ELK, {
  type ElkExtendedEdge,
  type ElkNode,
  type LayoutOptions,
} from 'elkjs';
import {
  CodeLayoutEdge,
  CodeLayoutInput,
  CodeLayoutNode,
  CodeLayoutResult,
} from './types';
import { sortLayoutNodes } from './stableSort';

type ElkDirection = 'RIGHT' | 'DOWN';

export interface ElkLayoutOptions {
  direction?: ElkDirection;
  nodeNodeSpacing?: number;
  layerSpacing?: number;
}

const DEFAULT_NODE_WIDTH = 250;
const DEFAULT_NODE_HEIGHT = 160;

const getDefaultDirection = (
  strategy: CodeLayoutInput['strategy'],
  viewport?: CodeLayoutInput['viewport']
): ElkDirection => {
  if (
    strategy === 'logic-map' ||
    strategy === 'review-declarations' ||
    strategy === 'review-files' ||
    strategy === 'file-map'
  ) {
    return 'RIGHT';
  }

  if (viewport && viewport.width > viewport.height * 1.6) return 'RIGHT';
  return 'DOWN';
};

const getLayoutOptions = (
  strategy: CodeLayoutInput['strategy'],
  viewport?: CodeLayoutInput['viewport'],
  options: ElkLayoutOptions = {}
): LayoutOptions => {
  const direction = options.direction ?? getDefaultDirection(strategy, viewport);
  const nodeNodeSpacing = `${options.nodeNodeSpacing ?? 44}`;
  const layerSpacing = `${options.layerSpacing ?? 86}`;

  return {
    'elk.algorithm': 'layered',
    'elk.direction': direction,
    'elk.spacing.nodeNode': nodeNodeSpacing,
    'org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers': layerSpacing,
    'org.eclipse.elk.edgeRouting': 'ORTHOGONAL',
  };
};

const toElkGraph = (
  strategy: CodeLayoutInput['strategy'],
  nodes: CodeLayoutNode[],
  edges: CodeLayoutEdge[],
  viewport?: CodeLayoutInput['viewport'],
  options?: ElkLayoutOptions
): ElkNode => ({
  id: 'code-layout-root',
  layoutOptions: getLayoutOptions(strategy, viewport, options),
  children: sortLayoutNodes(nodes).map((node) => ({
    id: node.id,
    width: node.width ?? DEFAULT_NODE_WIDTH,
    height: node.height ?? DEFAULT_NODE_HEIGHT,
    labels: [{ text: node.label }],
  })),
  edges: edges.map((edge) => ({
    id: edge.id,
    sources: [edge.source],
    targets: [edge.target],
  })),
});

const extractEdgeRoutes = (
  edges?: ElkExtendedEdge[]
): CodeLayoutResult['edgeRoutes'] => {
  const routes: CodeLayoutResult['edgeRoutes'] = {};

  for (const edge of edges || []) {
    const points = edge.sections?.flatMap((section) => [
      section.startPoint,
      ...(section.bendPoints || []),
      section.endPoint,
    ]);

    if (points?.length) {
      routes[edge.id] = points.map((point) => ({ x: point.x, y: point.y }));
    }
  }

  return routes;
};

export const layoutWithElk = async (
  strategy: CodeLayoutInput['strategy'],
  nodes: CodeLayoutNode[],
  edges: CodeLayoutEdge[],
  viewport?: CodeLayoutInput['viewport'],
  options?: ElkLayoutOptions
): Promise<CodeLayoutResult> => {
  const elk = new ELK();
  const graph = await elk.layout(
    toElkGraph(strategy, nodes, edges, viewport, options)
  );
  const positions: CodeLayoutResult['positions'] = {};
  let maxX = 0;
  let maxY = 0;

  for (const node of graph.children || []) {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const width = node.width ?? DEFAULT_NODE_WIDTH;
    const height = node.height ?? DEFAULT_NODE_HEIGHT;
    positions[node.id] = { x, y };
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }

  return {
    positions,
    edgeRoutes: extractEdgeRoutes(graph.edges),
    bounds: {
      width: maxX,
      height: maxY,
    },
  };
};
