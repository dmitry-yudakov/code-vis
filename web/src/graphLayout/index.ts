import { layoutWithDagre } from './dagreLayout';
import { layoutLogicMap } from './declarationLayout';
import { layoutFileMap } from './fileMapLayout';
import { layoutOverview } from './overviewLayout';
import { layoutReviewDeclarations, layoutReviewFiles } from './reviewLayout';
import {
  CodeLayoutEdge,
  CodeLayoutInput,
  CodeLayoutNode,
  CodeLayoutResult,
} from './types';

export * from './types';
export * from './stableSort';

const DEFAULT_DIMENSIONS: Record<
  CodeLayoutInput['strategy'],
  { width: number; height: number }
> = {
  overview: { width: 250, height: 180 },
  'review-files': { width: 280, height: 150 },
  'review-declarations': { width: 300, height: 140 },
  'file-map': { width: 360, height: 280 },
  'logic-map': { width: 650, height: 150 },
  fallback: { width: 250, height: 160 },
};

const normalizeNodes = (input: CodeLayoutInput): CodeLayoutNode[] => {
  const defaults = DEFAULT_DIMENSIONS[input.strategy];
  return input.nodes.map((node) => ({
    ...node,
    width: node.width ?? defaults.width,
    height: node.height ?? defaults.height,
    directory:
      node.directory ??
      (() => {
        const filename = node.filename || node.label;
        const idx = filename.lastIndexOf('/');
        return idx >= 0 ? filename.slice(0, idx) || '.' : '.';
      })(),
  }));
};

const filterVisibleEdges = (
  nodes: CodeLayoutNode[],
  edges: CodeLayoutEdge[]
): CodeLayoutEdge[] => {
  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  return edges.filter(
    (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
  );
};

const mergePreviousPositions = (
  result: CodeLayoutResult,
  nodes: CodeLayoutNode[],
  previousPositions?: Record<string, { x: number; y: number }>
): CodeLayoutResult => {
  if (!previousPositions) return result;

  const positions = { ...result.positions };
  for (const node of nodes) {
    if (previousPositions[node.id]) {
      positions[node.id] = previousPositions[node.id];
    }
  }

  return {
    ...result,
    positions,
  };
};

export function layoutCodeGraph(input: CodeLayoutInput): CodeLayoutResult {
  const nodes = normalizeNodes(input);
  const edges = filterVisibleEdges(nodes, input.edges);
  let result: CodeLayoutResult;

  switch (input.strategy) {
    case 'overview':
      result = layoutOverview(nodes, edges, input.viewport);
      break;
    case 'review-files':
      result = layoutReviewFiles(nodes, edges);
      break;
    case 'review-declarations':
      result = layoutReviewDeclarations(nodes, edges);
      break;
    case 'file-map':
      result = layoutFileMap(nodes, edges, input.viewport);
      break;
    case 'logic-map':
      result = layoutLogicMap(nodes, edges);
      break;
    case 'fallback':
    default:
      result = layoutWithDagre(nodes, edges);
      break;
  }

  if (!input.preservePrevious) return result;
  return mergePreviousPositions(result, nodes, input.previousPositions);
}

export async function layoutCodeGraphAsync(
  input: CodeLayoutInput
): Promise<CodeLayoutResult> {
  if (input.engine !== 'elk') {
    return layoutCodeGraph(input);
  }

  const nodes = normalizeNodes(input);
  const edges = filterVisibleEdges(nodes, input.edges);
  const { layoutWithElk } = await import('./elkLayout');
  const result = await layoutWithElk(
    input.strategy,
    nodes,
    edges,
    input.viewport,
    undefined,
    input.clusters
  );

  if (!input.preservePrevious) return result;
  return mergePreviousPositions(result, nodes, input.previousPositions);
}
