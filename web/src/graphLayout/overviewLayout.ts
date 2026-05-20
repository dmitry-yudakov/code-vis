import { layoutWithDagre } from './dagreLayout';
import {
  CodeLayoutEdge,
  CodeLayoutNode,
  CodeLayoutResult,
} from './types';

export const layoutOverview = (
  nodes: CodeLayoutNode[],
  edges: CodeLayoutEdge[],
  viewport?: { width: number; height: number }
): CodeLayoutResult => {
  const rankDirection =
    viewport && viewport.width > viewport.height * 1.6 ? 'LR' : 'TB';

  return layoutWithDagre(nodes, edges, {
    rankDirection,
    nodeWidth: 250,
    nodeHeight: 180,
    nodeSep: 28,
    rankSep: 58,
  });
};

