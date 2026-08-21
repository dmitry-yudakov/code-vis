import {
  CodeLayoutEdge,
  CodeLayoutNode,
  CodeLayoutResult,
} from './types';
import {
  compareLayoutNodes,
  getLayoutSortKey,
  sortLayoutNodes,
} from './stableSort';

type Lane = 'left' | 'center' | 'right' | 'test';
type SeedDistance = { id: string; index: number; distance: number };
type FileAnchor = { centerY: number; sortNode: CodeLayoutNode };
type RankedFileNode = {
  node: CodeLayoutNode;
  rank: number;
  order: number;
  component: number;
};

const FILE_LANE_X: Record<Lane, number> = {
  left: -620,
  center: 0,
  right: 620,
  test: 0,
};

const DECLARATION_LANE_X: Record<Lane, number> = {
  left: -760,
  center: 0,
  right: 760,
  test: 0,
};

const FILE_CENTER_COLUMN_GAP = 340;
const FILE_CENTER_COMPONENT_GAP = 120;
const DECLARATION_CENTER_COLUMN_GAP = 360;
const DECLARATION_CENTER_FILE_GAP = 110;

const fileRowGap = (node: CodeLayoutNode) =>
  Math.max(node.height ?? 150, 150) + 48;
const declarationRowGap = (node: CodeLayoutNode) =>
  Math.max(node.height ?? 140, 140) + 44;

const isSeed = (node: CodeLayoutNode): boolean =>
  node.role === 'seed' || node.role === 'changed';

const getMapValues = <T>(
  map: Map<string, T[]>,
  key: string
): T[] => map.get(key) || [];

const getLayoutFilename = (node: CodeLayoutNode): string =>
  node.filename || node.label;

const getFileNodeHeight = (node: CodeLayoutNode): number =>
  Math.max(node.height ?? 150, 150);

const getDeclarationNodeHeight = (node: CodeLayoutNode): number =>
  Math.max(node.height ?? 140, 140);

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
        count.right++;
      } else {
        count.left++;
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

const buildFileSeedAdjacency = (
  seedNodes: CodeLayoutNode[],
  edges: CodeLayoutEdge[]
): Map<string, Set<string>> => {
  const seedIds = new Set(seedNodes.map((node) => node.id));
  const adjacency = new Map(seedNodes.map((node) => [node.id, new Set<string>()]));

  for (const edge of edges) {
    if (!seedIds.has(edge.source) || !seedIds.has(edge.target)) continue;
    adjacency.get(edge.source)!.add(edge.target);
    adjacency.get(edge.target)!.add(edge.source);
  }

  return adjacency;
};

const buildFileSeedRanks = (
  seedNodes: CodeLayoutNode[],
  edges: CodeLayoutEdge[]
): RankedFileNode[] => {
  const seedIds = new Set(seedNodes.map((node) => node.id));
  const adjacency = buildFileSeedAdjacency(seedNodes, edges);
  const sortedSeeds = sortLayoutNodes(seedNodes);
  const visited = new Set<string>();
  const ranked: RankedFileNode[] = [];
  let component = 0;

  for (const root of sortedSeeds) {
    if (visited.has(root.id)) continue;

    const componentIds = new Set<string>();
    const queue = [root.id];
    visited.add(root.id);

    while (queue.length > 0) {
      const id = queue.shift()!;
      componentIds.add(id);
      for (const nextId of adjacency.get(id) || []) {
        if (visited.has(nextId)) continue;
        visited.add(nextId);
        queue.push(nextId);
      }
    }

    const componentNodes = sortedSeeds.filter((node) =>
      componentIds.has(node.id)
    );
    const outgoing = new Map(componentNodes.map((node) => [node.id, [] as string[]]));
    const indegree = new Map(componentNodes.map((node) => [node.id, 0]));

    for (const edge of edges) {
      if (!componentIds.has(edge.source) || !componentIds.has(edge.target)) {
        continue;
      }
      outgoing.get(edge.source)!.push(edge.target);
      indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
    }

    const ranks = new Map(componentNodes.map((node) => [node.id, 0]));
    const rankQueue = componentNodes
      .filter((node) => (indegree.get(node.id) || 0) === 0)
      .map((node) => node.id);
    const orderedQueue = rankQueue.length > 0 ? rankQueue : [componentNodes[0].id];
    let cursor = 0;

    while (cursor < orderedQueue.length) {
      const id = orderedQueue[cursor++];
      const rank = ranks.get(id) || 0;
      for (const targetId of outgoing.get(id) || []) {
        ranks.set(targetId, Math.max(ranks.get(targetId) || 0, rank + 1));
        indegree.set(targetId, (indegree.get(targetId) || 0) - 1);
        if ((indegree.get(targetId) || 0) === 0) {
          orderedQueue.push(targetId);
        }
      }
    }

    for (const [order, node] of componentNodes.entries()) {
      ranked.push({
        node,
        rank: ranks.get(node.id) || 0,
        order,
        component,
      });
    }

    component += 1;
  }

  return ranked;
};

const buildFileSeedAnchors = (
  seedNodes: CodeLayoutNode[],
  positions: CodeLayoutResult['positions']
): Map<string, FileAnchor> => {
  const anchors = new Map<string, FileAnchor>();

  for (const node of seedNodes) {
    const position = positions[node.id];
    if (!position) continue;
    anchors.set(node.id, {
      centerY: position.y + getFileNodeHeight(node) / 2,
      sortNode: node,
    });
  }

  return anchors;
};

const findStrongestRelatedFileSeed = (
  node: CodeLayoutNode,
  seedAnchors: Map<string, FileAnchor>,
  edges: CodeLayoutEdge[]
): FileAnchor | null => {
  const counts = new Map<string, number>();

  for (const edge of edges) {
    if (edge.source === node.id && seedAnchors.has(edge.target)) {
      counts.set(edge.target, (counts.get(edge.target) || 0) + (edge.weight ?? 1));
    }
    if (edge.target === node.id && seedAnchors.has(edge.source)) {
      counts.set(edge.source, (counts.get(edge.source) || 0) + (edge.weight ?? 1));
    }
  }

  const [seedId] =
    Array.from(counts.entries()).sort((left, right) => {
      if (left[1] !== right[1]) return right[1] - left[1];
      const leftAnchor = seedAnchors.get(left[0])!;
      const rightAnchor = seedAnchors.get(right[0])!;
      return compareLayoutNodes(leftAnchor.sortNode, rightAnchor.sortNode);
    })[0] || [];

  return seedId ? seedAnchors.get(seedId) || null : null;
};

const placeAnchoredFileSideLane = (
  nodes: CodeLayoutNode[],
  x: number,
  seedAnchors: Map<string, FileAnchor>,
  edges: CodeLayoutEdge[],
  positions: CodeLayoutResult['positions']
): number => {
  const sorted = sortLayoutNodes(nodes)
    .map((node) => ({
      node,
      anchor: findStrongestRelatedFileSeed(node, seedAnchors, edges),
    }))
    .sort((left, right) => {
      if (left.anchor && right.anchor) {
        if (left.anchor.centerY !== right.anchor.centerY) {
          return left.anchor.centerY - right.anchor.centerY;
        }
        return compareLayoutNodes(left.anchor.sortNode, right.anchor.sortNode);
      }
      if (left.anchor && !right.anchor) return -1;
      if (!left.anchor && right.anchor) return 1;
      return compareLayoutNodes(left.node, right.node);
    });

  let cursorY = 0;
  let maxY = 0;

  for (const item of sorted) {
    const anchoredTop = item.anchor
      ? item.anchor.centerY - getFileNodeHeight(item.node) / 2
      : cursorY;
    const y = Math.max(cursorY, Math.max(0, anchoredTop));
    positions[item.node.id] = { x, y };
    cursorY = y + fileRowGap(item.node);
    maxY = Math.max(maxY, y + getFileNodeHeight(item.node));
  }

  return maxY;
};

const placeReviewFileLanes = (
  lanes: Record<Lane, CodeLayoutNode[]>,
  edges: CodeLayoutEdge[]
): CodeLayoutResult => {
  const positions: CodeLayoutResult['positions'] = {};
  let maxX = 0;
  let maxY = 0;

  const rankedSeeds = buildFileSeedRanks(lanes.center, edges);
  let componentTop = 0;

  for (const component of Array.from(
    new Set(rankedSeeds.map((item) => item.component))
  )) {
    const items = rankedSeeds.filter((item) => item.component === component);
    const ranks = Array.from(new Set(items.map((item) => item.rank))).sort(
      (left, right) => left - right
    );
    const rankOffset = (ranks.length - 1) / 2;
    const rankIndex = new Map(ranks.map((rank, index) => [rank, index]));
    const rowCursorByRank = new Map<number, number>();
    let componentHeight = 0;

    for (const item of items.sort((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank;
      return compareCenterNodeStable(
        left.node,
        right.node,
        left.order,
        right.order
      );
    })) {
      const index = rankIndex.get(item.rank) || 0;
      const x = (index - rankOffset) * FILE_CENTER_COLUMN_GAP;
      const localY = rowCursorByRank.get(item.rank) || 0;
      const y = componentTop + localY;
      positions[item.node.id] = { x, y };
      rowCursorByRank.set(item.rank, localY + fileRowGap(item.node));
      componentHeight = Math.max(componentHeight, localY + getFileNodeHeight(item.node));
      maxX = Math.max(maxX, x + (item.node.width ?? 280));
      maxY = Math.max(maxY, y + getFileNodeHeight(item.node));
    }

    componentTop += componentHeight + FILE_CENTER_COMPONENT_GAP;
  }

  const seedAnchors = buildFileSeedAnchors(lanes.center, positions);

  for (const lane of ['left', 'right'] as Lane[]) {
    const laneMaxY = placeAnchoredFileSideLane(
      lanes[lane],
      FILE_LANE_X[lane],
      seedAnchors,
      edges,
      positions
    );
    maxY = Math.max(maxY, laneMaxY);
    for (const node of lanes[lane]) {
      maxX = Math.max(maxX, FILE_LANE_X[lane] + (node.width ?? 280));
    }
  }

  const centerHeight = Math.max(componentTop, 0);
  let testY = Math.max(centerHeight + 80, 260);
  for (const node of sortLayoutNodes(lanes.test)) {
    positions[node.id] = { x: FILE_LANE_X.test, y: testY };
    maxX = Math.max(maxX, FILE_LANE_X.test + (node.width ?? 280));
    maxY = Math.max(maxY, testY + getFileNodeHeight(node));
    testY += fileRowGap(node);
  }

  return {
    positions,
    bounds: {
      width: maxX,
      height: maxY,
    },
  };
};

const buildBridgeAdjacency = (
  nodes: CodeLayoutNode[],
  edges: CodeLayoutEdge[]
): {
  incoming: Map<string, string[]>;
  outgoing: Map<string, string[]>;
  undirected: Map<string, string[]>;
} => {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  const undirected = new Map<string, string[]>();

  for (const node of nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
    undirected.set(node.id, []);
  }

  for (const edge of edges) {
    if (edge.kind !== 'bridge') continue;
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;

    outgoing.get(edge.source)!.push(edge.target);
    incoming.get(edge.target)!.push(edge.source);
    undirected.get(edge.source)!.push(edge.target);
    undirected.get(edge.target)!.push(edge.source);
  }

  return { incoming, outgoing, undirected };
};

const findClosestSeed = (
  startId: string,
  adjacency: Map<string, string[]>,
  seedIndexById: Map<string, number>
): SeedDistance | null => {
  const visited = new Set([startId]);
  const queue: Array<{ id: string; distance: number }> = [
    { id: startId, distance: 0 },
  ];
  let cursor = 0;
  let closestDistance: number | null = null;
  const closest: SeedDistance[] = [];

  while (cursor < queue.length) {
    const current = queue[cursor++];
    if (closestDistance !== null && current.distance > closestDistance) break;

    for (const nextId of getMapValues(adjacency, current.id)) {
      if (visited.has(nextId)) continue;
      visited.add(nextId);
      const distance = current.distance + 1;
      if (closestDistance !== null && distance > closestDistance) continue;
      const index = seedIndexById.get(nextId);

      if (index !== undefined) {
        closestDistance = distance;
        closest.push({ id: nextId, index, distance });
        continue;
      }

      queue.push({ id: nextId, distance });
    }
  }

  return closest.sort((left, right) => left.index - right.index)[0] || null;
};

const findReachableSeedIndexes = (
  startId: string,
  adjacency: Map<string, string[]>,
  seedIndexById: Map<string, number>
): number[] => {
  const visited = new Set([startId]);
  const queue = [startId];
  let cursor = 0;
  const indexes = new Set<number>();

  while (cursor < queue.length) {
    const current = queue[cursor++];

    for (const nextId of getMapValues(adjacency, current)) {
      if (visited.has(nextId)) continue;
      visited.add(nextId);
      const seedIndex = seedIndexById.get(nextId);
      if (seedIndex !== undefined) {
        indexes.add(seedIndex);
        continue;
      }
      queue.push(nextId);
    }
  }

  return Array.from(indexes.values()).sort((left, right) => left - right);
};

const getBridgeSortRank = (
  node: CodeLayoutNode,
  adjacency: ReturnType<typeof buildBridgeAdjacency>,
  seedIndexById: Map<string, number>,
  seedCount: number,
  fallbackIndex: number
): number => {
  const upstreamSeed = findClosestSeed(
    node.id,
    adjacency.incoming,
    seedIndexById
  );
  const downstreamSeed = findClosestSeed(
    node.id,
    adjacency.outgoing,
    seedIndexById
  );

  if (upstreamSeed && downstreamSeed) {
    const totalDistance = upstreamSeed.distance + downstreamSeed.distance;
    const offset =
      totalDistance === 0 ? 0.5 : upstreamSeed.distance / totalDistance;

    return (
      upstreamSeed.index +
      (downstreamSeed.index - upstreamSeed.index) * offset
    );
  }

  const reachableSeedIndexes = findReachableSeedIndexes(
    node.id,
    adjacency.undirected,
    seedIndexById
  );

  if (reachableSeedIndexes.length >= 2) {
    const first = reachableSeedIndexes[0];
    const last = reachableSeedIndexes[reachableSeedIndexes.length - 1];
    return first + (last - first) / 2;
  }

  if (upstreamSeed) return upstreamSeed.index + 0.5;
  if (downstreamSeed) return downstreamSeed.index - 0.5;

  return seedCount + 1 + fallbackIndex;
};

const orderDeclarationCenterLane = (
  nodes: CodeLayoutNode[],
  edges: CodeLayoutEdge[]
): CodeLayoutNode[] => {
  const seeds = sortLayoutNodes(nodes.filter(isSeed));
  const bridges = sortLayoutNodes(
    nodes.filter((node) => node.role === 'bridge')
  );
  const otherCenterNodes = sortLayoutNodes(
    nodes.filter((node) => !isSeed(node) && node.role !== 'bridge')
  );

  if (seeds.length === 0) {
    return [...bridges, ...otherCenterNodes];
  }

  const seedIndexById = new Map(
    seeds.map((node, index): [string, number] => [node.id, index])
  );
  const adjacency = buildBridgeAdjacency(nodes, edges);
  const rankedNodes: Array<{
    node: CodeLayoutNode;
    rank: number;
    priority: number;
    stableIndex: number;
  }> = [
    ...seeds.map((node, index) => ({
      node,
      rank: index,
      priority: 0,
      stableIndex: index,
    })),
    ...bridges.map((node, index) => ({
      node,
      rank: getBridgeSortRank(
        node,
        adjacency,
        seedIndexById,
        seeds.length,
        index
      ),
      priority: 1,
      stableIndex: index,
    })),
    ...otherCenterNodes.map((node, index) => ({
      node,
      rank: seeds.length + bridges.length + 1 + index,
      priority: 2,
      stableIndex: index,
    })),
  ];

  return rankedNodes
    .sort((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank;
      if (left.priority !== right.priority) return left.priority - right.priority;
      return compareCenterNodeStable(
        left.node,
        right.node,
        left.stableIndex,
        right.stableIndex
      );
    })
    .map((item) => item.node);
};

const compareCenterNodeStable = (
  left: CodeLayoutNode,
  right: CodeLayoutNode,
  leftIndex: number,
  rightIndex: number
): number => {
  return compareLayoutNodes(left, right) || leftIndex - rightIndex;
};

const buildCenterFileAnchors = (
  centerNodes: CodeLayoutNode[],
  positions: CodeLayoutResult['positions']
): Map<string, FileAnchor> => {
  const groupedCenters = new Map<
    string,
    { totalCenterY: number; count: number; sortNode: CodeLayoutNode }
  >();

  for (const node of centerNodes) {
    const position = positions[node.id];
    if (!position) continue;

    const filename = getLayoutFilename(node);
    const centerY = position.y + getDeclarationNodeHeight(node) / 2;
    const existing = groupedCenters.get(filename);

    if (existing) {
      existing.totalCenterY += centerY;
      existing.count += 1;
      if (compareLayoutNodes(node, existing.sortNode) < 0) {
        existing.sortNode = node;
      }
      continue;
    }

    groupedCenters.set(filename, {
      totalCenterY: centerY,
      count: 1,
      sortNode: node,
    });
  }

  return new Map(
    Array.from(groupedCenters.entries()).map(([filename, group]) => [
      filename,
      {
        centerY: group.totalCenterY / group.count,
        sortNode: group.sortNode,
      },
    ])
  );
};

const groupDeclarationNodesByFile = (
  nodes: CodeLayoutNode[]
): Array<{ filename: string; nodes: CodeLayoutNode[] }> => {
  const groups = new Map<string, CodeLayoutNode[]>();

  for (const node of sortLayoutNodes(nodes)) {
    const filename = getLayoutFilename(node);
    groups.set(filename, [...(groups.get(filename) || []), node]);
  }

  return Array.from(groups.entries()).map(([filename, groupedNodes]) => ({
    filename,
    nodes: sortLayoutNodes(groupedNodes),
  }));
};

const groupOrderedDeclarationNodesByFile = (
  nodes: CodeLayoutNode[]
): Array<{ filename: string; nodes: CodeLayoutNode[] }> => {
  const groups = new Map<string, CodeLayoutNode[]>();

  for (const node of nodes) {
    const filename = getLayoutFilename(node);
    groups.set(filename, [...(groups.get(filename) || []), node]);
  }

  return Array.from(groups.entries()).map(([filename, groupedNodes]) => ({
    filename,
    nodes: groupedNodes,
  }));
};

const computeDeclarationCallRanks = (
  nodes: CodeLayoutNode[],
  edges: CodeLayoutEdge[]
): Map<string, number> => {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    if (
      edge.kind !== 'calls' &&
      edge.kind !== 'bridge' &&
      edge.kind !== 'heuristic'
    ) {
      continue;
    }

    outgoing.get(edge.source)!.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
  }

  const ranks = new Map(nodes.map((node) => [node.id, 0]));
  const queue = nodes
    .filter((node) => (indegree.get(node.id) || 0) === 0)
    .map((node) => node.id);
  const orderedQueue = queue.length > 0 ? queue : [nodes[0]?.id].filter(Boolean);
  let cursor = 0;

  while (cursor < orderedQueue.length) {
    const id = orderedQueue[cursor++];
    const rank = ranks.get(id) || 0;

    for (const targetId of outgoing.get(id) || []) {
      ranks.set(targetId, Math.max(ranks.get(targetId) || 0, rank + 1));
      indegree.set(targetId, (indegree.get(targetId) || 0) - 1);
      if ((indegree.get(targetId) || 0) === 0) {
        orderedQueue.push(targetId);
      }
    }
  }

  return ranks;
};

const getDeclarationGroupHeight = (nodes: CodeLayoutNode[]): number => {
  if (nodes.length === 0) return 0;

  return nodes.reduce((height, node, index) => {
    if (index === nodes.length - 1) {
      return height + getDeclarationNodeHeight(node);
    }
    return height + declarationRowGap(node);
  }, 0);
};

const placeAnchoredDeclarationSideLane = (
  nodes: CodeLayoutNode[],
  x: number,
  fileAnchors: Map<string, FileAnchor>,
  positions: CodeLayoutResult['positions']
): number => {
  const groups = groupDeclarationNodesByFile(nodes).sort((left, right) => {
    const leftAnchor = fileAnchors.get(left.filename);
    const rightAnchor = fileAnchors.get(right.filename);

    if (leftAnchor && rightAnchor && leftAnchor.centerY !== rightAnchor.centerY) {
      return leftAnchor.centerY - rightAnchor.centerY;
    }
    if (leftAnchor && !rightAnchor) return -1;
    if (!leftAnchor && rightAnchor) return 1;

    const leftSortNode = leftAnchor?.sortNode || left.nodes[0];
    const rightSortNode = rightAnchor?.sortNode || right.nodes[0];
    return compareLayoutNodes(leftSortNode, rightSortNode);
  });

  let cursorY = 0;
  let maxY = 0;

  for (const group of groups) {
    const anchor = fileAnchors.get(group.filename);
    const groupHeight = getDeclarationGroupHeight(group.nodes);
    const anchoredTop = anchor ? anchor.centerY - groupHeight / 2 : cursorY;
    let y = Math.max(cursorY, Math.max(0, anchoredTop));

    for (const node of group.nodes) {
      positions[node.id] = { x, y };
      maxY = Math.max(maxY, y + getDeclarationNodeHeight(node));
      y += declarationRowGap(node);
    }

    cursorY = Math.max(cursorY, y + 40);
  }

  return maxY;
};

const placeReviewDeclarationLanes = (
  lanes: Record<Lane, CodeLayoutNode[]>,
  edges: CodeLayoutEdge[]
): CodeLayoutResult => {
  const positions: CodeLayoutResult['positions'] = {};
  let maxX = 0;
  let maxY = 0;

  const centerNodes = orderDeclarationCenterLane(lanes.center, edges);
  let centerFileY = 0;

  for (const group of groupOrderedDeclarationNodesByFile(centerNodes)) {
    const ranks = computeDeclarationCallRanks(group.nodes, edges);
    const uniqueRanks = Array.from(
      new Set(group.nodes.map((node) => ranks.get(node.id) || 0))
    ).sort((left, right) => left - right);
    const rankIndex = new Map(uniqueRanks.map((rank, index) => [rank, index]));
    const rankOffset = (uniqueRanks.length - 1) / 2;
    const cursorByRank = new Map<number, number>();
    let groupHeight = 0;

    for (const node of group.nodes) {
      const rank = ranks.get(node.id) || 0;
      const index = rankIndex.get(rank) || 0;
      const localY = cursorByRank.get(rank) || 0;
      const x =
        DECLARATION_LANE_X.center +
        (index - rankOffset) * DECLARATION_CENTER_COLUMN_GAP;
      const y = centerFileY + localY;

      positions[node.id] = { x, y };
      cursorByRank.set(rank, localY + declarationRowGap(node));
      groupHeight = Math.max(groupHeight, localY + getDeclarationNodeHeight(node));
      maxX = Math.max(maxX, x + (node.width ?? 300));
      maxY = Math.max(maxY, y + getDeclarationNodeHeight(node));
    }

    centerFileY += groupHeight + DECLARATION_CENTER_FILE_GAP;
  }

  const fileAnchors = buildCenterFileAnchors(centerNodes, positions);

  for (const lane of ['left', 'right'] as Lane[]) {
    const laneMaxY = placeAnchoredDeclarationSideLane(
      lanes[lane],
      DECLARATION_LANE_X[lane],
      fileAnchors,
      positions
    );
    maxY = Math.max(maxY, laneMaxY);
    for (const node of lanes[lane]) {
      maxX = Math.max(maxX, DECLARATION_LANE_X[lane] + (node.width ?? 300));
    }
  }

  return {
    positions,
    bounds: {
      width: maxX,
      height: maxY,
    },
  };
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

  return placeReviewFileLanes(lanes, edges);
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

  return placeReviewDeclarationLanes(lanes, edges);
};
