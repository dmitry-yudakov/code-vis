import type { ThemeName } from '@/shared/design/tokens';
import { validateMermaidSource } from '@/features/diagram/mermaid/mermaidPolicy';
import { readMermaidDiagram } from '@/features/diagram/mermaid/mermaidRenderer';

export const MAX_SPATIAL_NODES = 100;
export const MAX_SPATIAL_EDGES = 150;
export const MAX_SPATIAL_GROUPS = 20;
export const MAX_VISIBLE_SPATIAL_NODES = 30;
export const MAX_VISIBLE_SPATIAL_EDGES = 45;

const DIRECTIONS = new Set(['TB', 'TD', 'BT', 'LR', 'RL']);
const NODE_SHAPES = new Set(['', 'square', 'rect', 'circle', 'ellipse', 'diamond']);

interface ParsedVertex {
  id?: unknown;
  text?: unknown;
  type?: unknown;
  labelType?: unknown;
  classes?: unknown;
  styles?: unknown;
  link?: unknown;
  icon?: unknown;
  img?: unknown;
  props?: unknown;
}

interface ParsedEdge {
  id?: unknown;
  start?: unknown;
  end?: unknown;
  text?: unknown;
  type?: unknown;
  stroke?: unknown;
  labelType?: unknown;
  classes?: unknown;
  style?: unknown;
  animate?: unknown;
  animation?: unknown;
}

interface ParsedGroup {
  id?: unknown;
  title?: unknown;
  nodes?: unknown;
  labelType?: unknown;
  classes?: unknown;
}

interface FlowchartDatabase {
  getDirection?(): unknown;
  getVertices?(): unknown;
  getEdges?(): unknown;
  getSubGraphs?(): unknown;
}

export interface SpatialDiagramNode {
  id: string;
  key: string;
  label: string;
  shape: string;
  groupId?: string;
}

export interface SpatialDiagramEdge {
  id: string;
  key: string;
  label: string;
  start: string;
  end: string;
}

export interface SpatialDiagramGroup {
  id: string;
  key: string;
  label: string;
  nodeIds: string[];
}

export interface SpatialDiagramGraph {
  artifactId: string;
  direction: 'TB' | 'TD' | 'BT' | 'LR' | 'RL';
  nodes: SpatialDiagramNode[];
  edges: SpatialDiagramEdge[];
  groups: SpatialDiagramGroup[];
}

export type SpatialDiagramResult =
  | { supported: true; graph: SpatialDiagramGraph }
  | { supported: false; reason: string };

export interface SpatialDiagramPage {
  nodeIds: string[];
  edgeIds: string[];
}

export interface SpatialNodePlacement {
  id: string;
  position: [number, number, number];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? [...value] : [];
}

function plainLabel(value: unknown, fallback: string): string | undefined {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return;
  return value.replaceAll(/<br\s*\/?\s*>/gi, '\n').trim() || fallback;
}

function plainLabelType(value: unknown): boolean {
  return value === undefined || value === 'text' || value === 'string';
}

function unsupported(reason: string): SpatialDiagramResult {
  return { supported: false, reason: `2D projection retained: ${reason}` };
}

export function deriveSpatialDiagram(artifactId: string, diagram: { type: string; db: unknown }): SpatialDiagramResult {
  if (diagram.type !== 'flowchart' && diagram.type !== 'flowchart-v2') return unsupported('this Mermaid diagram type is not in the spatial flowchart subset.');
  const db = diagram.db as FlowchartDatabase;
  if (!db.getVertices || !db.getEdges || !db.getSubGraphs) return unsupported('the parsed diagram does not expose a complete flowchart graph.');
  const vertexValue = db.getVertices();
  const edgeValue = db.getEdges();
  const groupValue = db.getSubGraphs();
  if (!(vertexValue instanceof Map) || !Array.isArray(edgeValue) || !Array.isArray(groupValue)) {
    return unsupported('the parsed flowchart graph has an unknown shape.');
  }
  const directionValue = db.getDirection?.();
  const direction = typeof directionValue === 'string' ? directionValue.toUpperCase() : 'TB';
  if (!DIRECTIONS.has(direction)) return unsupported(`direction ${String(directionValue)} is not supported.`);
  if (vertexValue.size > MAX_SPATIAL_NODES || edgeValue.length > MAX_SPATIAL_EDGES || groupValue.length > MAX_SPATIAL_GROUPS) {
    return unsupported(`the graph exceeds the ${MAX_SPATIAL_NODES}-node, ${MAX_SPATIAL_EDGES}-edge, or ${MAX_SPATIAL_GROUPS}-group spatial limit.`);
  }

  const rawGroups = groupValue as ParsedGroup[];
  const groupIds = new Set(rawGroups.map((group) => typeof group.id === 'string' ? group.id : ''));
  const memberOwner = new Map<string, string>();
  const groups: SpatialDiagramGroup[] = [];
  for (const group of rawGroups) {
    if (typeof group.id !== 'string' || !group.id || !plainLabelType(group.labelType) || strings(group.classes).length) {
      return unsupported('a subgraph has no stable plain identifier/title or uses styling.');
    }
    const nodeIds = strings(group.nodes);
    if (nodeIds.some((id) => groupIds.has(id))) return unsupported('nested subgraphs are not supported.');
    for (const nodeId of nodeIds) {
      if (memberOwner.has(nodeId)) return unsupported('overlapping subgraphs are not supported.');
      memberOwner.set(nodeId, group.id);
    }
    const label = plainLabel(group.title, group.id);
    if (!label) return unsupported('a subgraph label is not plain text.');
    groups.push({ id: group.id, key: `${artifactId}:group:${group.id}`, label, nodeIds });
  }

  const nodes: SpatialDiagramNode[] = [];
  const nodeIds = new Set<string>();
  for (const [mapId, value] of vertexValue as Map<unknown, ParsedVertex>) {
    const id = typeof value.id === 'string' ? value.id : typeof mapId === 'string' ? mapId : undefined;
    const shape = typeof value.type === 'string' ? value.type : '';
    if (!id || nodeIds.has(id)) return unsupported('a node has no unique explicit identifier.');
    if (!plainLabelType(value.labelType) || !NODE_SHAPES.has(shape)) return unsupported(`node ${id} uses a label or shape outside the spatial subset.`);
    if (strings(value.classes).length || strings(value.styles).length || value.link || value.icon || value.img
      || value.props && typeof value.props === 'object' && Object.keys(value.props as object).length) {
      return unsupported(`node ${id} uses links, media, metadata, or styling that the spatial projection cannot preserve.`);
    }
    const label = plainLabel(value.text, id);
    if (!label) return unsupported(`node ${id} does not have a plain text label.`);
    nodeIds.add(id);
    nodes.push({ id, key: `${artifactId}:node:${id}`, label, shape, groupId: memberOwner.get(id) });
  }
  if (groups.some((group) => group.nodeIds.some((id) => !nodeIds.has(id)))) return unsupported('a subgraph references a missing node.');

  const edges: SpatialDiagramEdge[] = [];
  const edgeIds = new Set<string>();
  const endpointPairs = new Set<string>();
  for (const value of edgeValue as ParsedEdge[]) {
    const { id, start, end } = value;
    if (typeof id !== 'string' || !id || edgeIds.has(id) || typeof start !== 'string' || typeof end !== 'string') {
      return unsupported('an edge has no unique parsed identity or endpoints.');
    }
    if (!nodeIds.has(start) || !nodeIds.has(end)) return unsupported(`edge ${id} references a missing node.`);
    const endpointPair = `${start}\0${end}`;
    if (start === end || endpointPairs.has(endpointPair)) return unsupported(`edge ${id} is a self-loop or parallel edge outside the spatial subset.`);
    if (value.type !== 'arrow_point' || value.stroke && value.stroke !== 'normal' || !plainLabelType(value.labelType)
      || strings(value.classes).length || strings(value.style).length || value.animate || value.animation) {
      return unsupported(`edge ${id} is not a solid directed edge with a plain label.`);
    }
    const label = plainLabel(value.text, '');
    if (label === undefined) return unsupported(`edge ${id} does not have a plain text label.`);
    edgeIds.add(id);
    endpointPairs.add(endpointPair);
    edges.push({ id, key: `${artifactId}:edge:${id}`, label, start, end });
  }
  return { supported: true, graph: { artifactId, direction: direction as SpatialDiagramGraph['direction'], nodes, edges, groups } };
}

export async function parseSpatialDiagram(
  artifactId: string,
  source: string,
  theme: ThemeName,
): Promise<SpatialDiagramResult> {
  const policy = validateMermaidSource(source);
  if (!policy.ok) return unsupported(policy.error || 'the canonical Mermaid source was rejected by policy.');
  try {
    return await readMermaidDiagram(source, theme, (diagram) => deriveSpatialDiagram(artifactId, diagram));
  } catch (error) {
    return unsupported(error instanceof Error ? error.message : 'Mermaid could not parse this diagram.');
  }
}

/** Packs complete edges and their endpoints, then isolated nodes, so every element is reachable. */
export function spatialDiagramPages(graph: SpatialDiagramGraph, collapsedGroups: ReadonlySet<string>): SpatialDiagramPage[] {
  const hiddenNodes = new Set(graph.groups.filter((group) => collapsedGroups.has(group.id)).flatMap((group) => group.nodeIds));
  const nodes = graph.nodes.filter((node) => !hiddenNodes.has(node.id));
  const edges = graph.edges.filter((edge) => !hiddenNodes.has(edge.start) && !hiddenNodes.has(edge.end));
  const pages: Array<{ nodes: Set<string>; edges: string[] }> = [];
  for (const edge of edges) {
    let page = pages.at(-1);
    const endpoints = new Set([...(page?.nodes || []), edge.start, edge.end]);
    if (!page || page.edges.length >= MAX_VISIBLE_SPATIAL_EDGES || endpoints.size > MAX_VISIBLE_SPATIAL_NODES) {
      page = { nodes: new Set(), edges: [] };
      pages.push(page);
    }
    page.nodes.add(edge.start); page.nodes.add(edge.end); page.edges.push(edge.id);
  }
  for (const node of nodes) {
    if (pages.some((page) => page.nodes.has(node.id))) continue;
    let page = pages.find((candidate) => candidate.nodes.size < MAX_VISIBLE_SPATIAL_NODES);
    if (!page) { page = { nodes: new Set(), edges: [] }; pages.push(page); }
    page.nodes.add(node.id);
  }
  if (!pages.length) pages.push({ nodes: new Set(), edges: [] });
  return pages.map((page) => ({ nodeIds: [...page.nodes], edgeIds: page.edges }));
}

export function layoutSpatialNodes(graph: SpatialDiagramGraph, page: SpatialDiagramPage): SpatialNodePlacement[] {
  const nodeOrder = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const indegree = new Map(page.nodeIds.map((id) => [id, 0]));
  const outgoing = new Map(page.nodeIds.map((id) => [id, [] as string[]]));
  for (const edge of graph.edges.filter((candidate) => page.edgeIds.includes(candidate.id))) {
    indegree.set(edge.end, (indegree.get(edge.end) || 0) + 1);
    outgoing.get(edge.start)?.push(edge.end);
  }
  const ranks = new Map(page.nodeIds.map((id) => [id, 0]));
  const queue = page.nodeIds.filter((id) => indegree.get(id) === 0);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor];
    for (const next of outgoing.get(id) || []) {
      ranks.set(next, Math.max(ranks.get(next) || 0, (ranks.get(id) || 0) + 1));
      indegree.set(next, (indegree.get(next) || 1) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  const maxRank = Math.max(0, ...ranks.values());
  const layers = Array.from({ length: maxRank + 1 }, () => [] as string[]);
  for (const id of page.nodeIds) layers[ranks.get(id) || 0].push(id);
  for (const layer of layers) layer.sort((left, right) => (nodeOrder.get(left) || 0) - (nodeOrder.get(right) || 0));
  const horizontal = graph.direction === 'LR' || graph.direction === 'RL';
  const reverse = graph.direction === 'RL' || graph.direction === 'BT';
  const placements: SpatialNodePlacement[] = [];
  if (layers.some((layer) => layer.length > 6)) {
    const columns = Math.min(6, Math.max(1, Math.ceil(Math.sqrt(page.nodeIds.length * 1.2))));
    const rows = Math.ceil(page.nodeIds.length / columns);
    page.nodeIds.forEach((id, index) => {
      const rawColumn = index % columns;
      const rawRow = Math.floor(index / columns);
      const column = reverse && horizontal ? columns - rawColumn - 1 : rawColumn;
      const row = reverse && !horizontal ? rows - rawRow - 1 : rawRow;
      const groupIndex = Math.max(0, graph.groups.findIndex((group) => group.nodeIds.includes(id)) + 1);
      placements.push({ id, position: [
        (column / Math.max(1, columns - 1) - 0.5) * 1.02,
        -(row / Math.max(1, rows - 1) - 0.5) * 0.52,
        0.025 + groupIndex * 0.012 + (row % 3) * 0.006,
      ] });
    });
    return placements;
  }
  layers.forEach((layer, rank) => layer.forEach((id, lane) => {
    const primary = (reverse ? maxRank - rank : rank) / Math.max(1, maxRank) - 0.5;
    const secondary = lane / Math.max(1, layer.length - 1) - 0.5;
    const groupIndex = Math.max(0, graph.groups.findIndex((group) => group.nodeIds.includes(id)) + 1);
    placements.push({ id, position: horizontal
      ? [primary * 1.02, -secondary * 0.52, 0.025 + groupIndex * 0.012]
      : [secondary * 1.02, -primary * 0.52, 0.025 + groupIndex * 0.012] });
  }));
  return placements;
}
