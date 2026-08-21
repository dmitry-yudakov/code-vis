import ELK, {
  type ElkExtendedEdge,
  type ElkNode,
  type LayoutOptions,
} from 'elkjs/lib/elk.bundled.js';
import {
  CodeLayoutEdge,
  CodeLayoutInput,
  CodeLayoutNode,
  CodeLayoutResult,
  LayoutCluster,
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

// Inner padding reserved around a cluster's members. Side padding must stay
// ≥ the band padding the component draws (so the soft band sits inside the
// group box and sibling spacing keeps adjacent bands apart); the larger top
// leaves room for the region's label chip.
const CLUSTER_PADDING = '[top=58.0,left=44.0,bottom=44.0,right=44.0]';

const toElkLeaf = (node: CodeLayoutNode): ElkNode => ({
  id: node.id,
  width: node.width ?? DEFAULT_NODE_WIDTH,
  height: node.height ?? DEFAULT_NODE_HEIGHT,
  labels: [{ text: node.label }],
});

// Partition the leaf nodes into cluster group nodes + ungrouped leaves. A node
// claimed by several clusters lands in the first (clusters sorted by id, for
// determinism); a cluster with <2 present members is dropped so it doesn't
// reserve a group box for a single node. Returns groupCount so the caller can
// skip hierarchical handling entirely when nothing actually grouped.
const buildHierarchicalChildren = (
  nodes: CodeLayoutNode[],
  clusters: LayoutCluster[]
): { children: ElkNode[]; groupCount: number } => {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const assigned = new Set<string>();
  const groups: ElkNode[] = [];

  for (const cluster of [...clusters].sort((a, b) => a.id.localeCompare(b.id))) {
    const members = cluster.nodeIds
      .filter((id) => nodeById.has(id) && !assigned.has(id))
      .map((id) => nodeById.get(id)!);
    if (members.length < 2) continue;

    members.forEach((member) => assigned.add(member.id));
    groups.push({
      id: `cluster:${cluster.id}`,
      layoutOptions: {
        'elk.algorithm': 'layered',
        'org.eclipse.elk.padding': CLUSTER_PADDING,
        'elk.spacing.nodeNode': '40',
        'org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers': '70',
      },
      children: sortLayoutNodes(members).map(toElkLeaf),
    });
  }

  const ungrouped = sortLayoutNodes(
    nodes.filter((node) => !assigned.has(node.id))
  ).map(toElkLeaf);

  return { children: [...groups, ...ungrouped], groupCount: groups.length };
};

const toElkGraph = (
  strategy: CodeLayoutInput['strategy'],
  nodes: CodeLayoutNode[],
  edges: CodeLayoutEdge[],
  viewport?: CodeLayoutInput['viewport'],
  options?: ElkLayoutOptions,
  clusters?: LayoutCluster[]
): ElkNode => {
  const layoutOptions = getLayoutOptions(strategy, viewport, options);
  const hierarchical = clusters?.length
    ? buildHierarchicalChildren(nodes, clusters)
    : null;
  const useHierarchy = !!hierarchical && hierarchical.groupCount > 0;

  return {
    id: 'code-layout-root',
    layoutOptions: useHierarchy
      ? {
          ...layoutOptions,
          // Let edges crossing group boundaries route across the hierarchy.
          'org.eclipse.elk.hierarchyHandling': 'INCLUDE_CHILDREN',
        }
      : layoutOptions,
    children: useHierarchy
      ? hierarchical!.children
      : sortLayoutNodes(nodes).map(toElkLeaf),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };
};

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
  options?: ElkLayoutOptions,
  clusters?: LayoutCluster[]
): Promise<CodeLayoutResult> => {
  const elk = new ELK();
  const graph = await elk.layout(
    toElkGraph(strategy, nodes, edges, viewport, options, clusters)
  );
  const positions: CodeLayoutResult['positions'] = {};
  let maxX = 0;
  let maxY = 0;

  // Cluster group nodes nest their members, whose coordinates elk reports
  // relative to the group. Walk the tree, accumulating the parent offset, and
  // record only leaves in absolute space (group ids are layout-only).
  const collect = (children: ElkNode[] | undefined, offsetX: number, offsetY: number) => {
    for (const node of children || []) {
      const x = (node.x ?? 0) + offsetX;
      const y = (node.y ?? 0) + offsetY;
      if (node.children?.length) {
        collect(node.children, x, y);
        continue;
      }
      const width = node.width ?? DEFAULT_NODE_WIDTH;
      const height = node.height ?? DEFAULT_NODE_HEIGHT;
      positions[node.id] = { x, y };
      maxX = Math.max(maxX, x + width);
      maxY = Math.max(maxY, y + height);
    }
  };
  collect(graph.children, 0, 0);

  return {
    positions,
    edgeRoutes: extractEdgeRoutes(graph.edges),
    bounds: {
      width: maxX,
      height: maxY,
    },
  };
};
