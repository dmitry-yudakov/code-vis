import { describe, expect, it } from 'vitest';
import {
  deriveSpatialDiagram, layoutSpatialNodes, MAX_VISIBLE_SPATIAL_EDGES, MAX_VISIBLE_SPATIAL_NODES,
  spatialDiagramPages,
} from '@/features/diagram/spatial/spatialDiagramModel';

function parsedFlowchart(nodeCount = 3, edgeCount = 2, groups: Array<{ id: string; title: string; nodes: string[] }> = []) {
  const vertices = new Map(Array.from({ length: nodeCount }, (_, index) => {
    const id = `N${index}`;
    return [id, { id, text: `Node ${index}`, type: index % 3 === 0 ? 'diamond' : 'square', labelType: 'text', classes: [], styles: [] }];
  }));
  const edges = Array.from({ length: edgeCount }, (_, index) => ({
    id: `edge-${index}`, start: `N${index % nodeCount}`, end: `N${(index % nodeCount + 1 + Math.floor(index / nodeCount)) % nodeCount}`,
    text: `Route ${index}`, type: 'arrow_point', stroke: 'normal', labelType: 'text', classes: [],
  }));
  return {
    type: 'flowchart-v2',
    db: { getDirection: () => 'LR', getVertices: () => vertices, getEdges: () => edges, getSubGraphs: () => groups },
  };
}

describe('spatial Mermaid graph', () => {
  it('copies every parser-owned node, directed labelled edge and group with artifact-scoped keys', () => {
    const first = deriveSpatialDiagram('artifact-a', parsedFlowchart(3, 2, [{ id: 'G', title: 'Workers', nodes: ['N0', 'N1'] }]));
    expect(first).toMatchObject({ supported: true, graph: {
      direction: 'LR',
      nodes: [
        { id: 'N0', key: 'artifact-a:node:N0', label: 'Node 0', groupId: 'G' },
        { id: 'N1', key: 'artifact-a:node:N1', label: 'Node 1', groupId: 'G' },
        { id: 'N2', key: 'artifact-a:node:N2', label: 'Node 2' },
      ],
      edges: [{ id: 'edge-0', key: 'artifact-a:edge:edge-0', start: 'N0', end: 'N1', label: 'Route 0' },
        { id: 'edge-1', key: 'artifact-a:edge:edge-1', start: 'N1', end: 'N2', label: 'Route 1' }],
      groups: [{ id: 'G', key: 'artifact-a:group:G', label: 'Workers', nodeIds: ['N0', 'N1'] }],
    } });
    const revision = deriveSpatialDiagram('artifact-b', parsedFlowchart());
    expect(revision.supported && revision.graph.nodes[0].key).toBe('artifact-b:node:N0');
  });

  it.each([
    ['another diagram type', { type: 'sequence', db: {} }],
    ['markdown node labels', (() => { const value = parsedFlowchart(); value.db.getVertices().get('N0')!.labelType = 'markdown'; return value; })()],
    ['open edges', (() => { const value = parsedFlowchart(); value.db.getEdges()[0].type = 'arrow_open'; return value; })()],
    ['self-loop edges', (() => { const value = parsedFlowchart(); value.db.getEdges()[0].end = 'N0'; return value; })()],
    ['missing endpoints', (() => { const value = parsedFlowchart(); value.db.getEdges()[0].end = 'missing'; return value; })()],
    ['nested groups', parsedFlowchart(3, 2, [{ id: 'outer', title: 'Outer', nodes: ['inner'] }, { id: 'inner', title: 'Inner', nodes: ['N0'] }])],
  ])('falls back completely for %s instead of returning a partial graph', (_label, diagram) => {
    const result = deriveSpatialDiagram('artifact', diagram);
    expect(result).toMatchObject({ supported: false });
    expect(result.supported || result.reason).toMatch(/^2D projection retained:/);
  });

  it('pages the 100-node/150-edge fixture within visible caps without losing an element', () => {
    const result = deriveSpatialDiagram('large', parsedFlowchart(100, 150));
    expect(result.supported).toBe(true);
    if (!result.supported) return;
    const pages = spatialDiagramPages(result.graph, new Set());
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => page.nodeIds.length <= MAX_VISIBLE_SPATIAL_NODES
      && page.edgeIds.length <= MAX_VISIBLE_SPATIAL_EDGES)).toBe(true);
    expect(new Set(pages.flatMap((page) => page.nodeIds)).size).toBe(100);
    expect(new Set(pages.flatMap((page) => page.edgeIds)).size).toBe(150);
    expect(layoutSpatialNodes(result.graph, pages[0])).toEqual(layoutSpatialNodes(result.graph, pages[0]));
  });

  it('counts collapsed group members by removing them and their incident edges until expanded', () => {
    const result = deriveSpatialDiagram('grouped', parsedFlowchart(30, 45, [{ id: 'G', title: 'Group', nodes: ['N0', 'N1', 'N2'] }]));
    if (!result.supported) throw new Error(result.reason);
    const expanded = spatialDiagramPages(result.graph, new Set());
    const collapsed = spatialDiagramPages(result.graph, new Set(['G']));
    expect(new Set(expanded.flatMap((page) => page.nodeIds)).size).toBe(30);
    expect(new Set(collapsed.flatMap((page) => page.nodeIds)).size).toBe(27);
    expect(new Set(collapsed.flatMap((page) => page.edgeIds)).size).toBeLessThan(45);
  });
});
