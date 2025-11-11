import React, { useState, useCallback, useMemo, useEffect } from 'react';
import ReactFlow, {
  Controls,
  MarkerType,
  Node as FlowNode,
  Edge as FlowEdge,
  applyNodeChanges,
  NodeChange,
} from 'react-flow-renderer';
import { FilenamePrettyView } from '../atoms';
import { Node, FileIncludeInfo, PositionedNode } from '../types';
import { includeToGraphTypes, applyGraphLayout } from '../utils';
import './IncludesHierarchy.css';

// const calcEdgeWeightBySimilarity = (incl: Include) => {
//   const {to, from} = incl;
//   let i = 0;
//   for(; i < Math.min(to.length, from.length); ++i) {
//     if(to[i] !== from[i])
//     break;
//   }
//   return i;
// }

const MAX_ITEMS_TO_SHOW = 3;
const edgeLabel = (items: string[]) => {
  if (items.length <= MAX_ITEMS_TO_SHOW) return items.join(', ');
  const extra = items.length - MAX_ITEMS_TO_SHOW;
  return `${items.slice(0, MAX_ITEMS_TO_SHOW).join(', ')}... ${extra} more`;
};

export const IncludesHierarchy: React.FC<{
  includes: FileIncludeInfo[];
  renderNodeMenu: (
    filename: string,
    anchor: HTMLElement | null,
    onClose: () => void
  ) => React.ReactElement;
}> = React.memo(({ includes, renderNodeMenu }) => {
  console.log('includes', includes);

  const { initialNodes, edgesElements } = useMemo(() => {
    const { nodes, edges } = includeToGraphTypes(includes);

    applyGraphLayout(
      nodes,
      edges,
      (n, x, y) => {
        const p = n as PositionedNode;
        p.x = x;
        p.y = y;
      },
      250,
      200
    );

    const initialNodes = (nodes as PositionedNode[]).map((node) => {
      const { id, x, y } = node;
      return {
        id,
        data: {
          label: <FileView node={node} />,
          node,
        },
        position: { x, y },
      };
    });

    const edgesElements = edges.map(({ source, target }, idx) => {
      const items = includes[idx].items;
      const label = edgeLabel(items);
      return {
        id: `${source}-${target}-${idx}`,
        markerEnd: { type: MarkerType.Arrow },
        source,
        target,
        label,
      };
    });

    return { initialNodes, edgesElements };
  }, [includes]);

  const [showMenu, setShowMenu] = useState<{
    anchor: HTMLElement | null;
    node: Node;
  } | null>(null);

  const [nodesElements, setNodesElements] = useState(initialNodes);

  useEffect(() => {
    setNodesElements(initialNodes);
  }, [initialNodes]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodesElements((nds) => applyNodeChanges(changes, nds));
  }, []);

  console.log('generated elements', {
    nodes: nodesElements,
    edges: edgesElements,
  });
  return (
    <div className="mapper">
      <ReactFlow
        nodes={nodesElements}
        edges={edgesElements}
        onNodesChange={onNodesChange}
        nodesConnectable={false}
        nodesDraggable={true}
        // panOnScroll
        minZoom={0.01}
        onNodeClick={(e: any, el: any) => {
          if (el.data) {
            setShowMenu({
              anchor: e.currentTarget as HTMLElement,
              node: el.data.node,
            });
          }
        }}
      >
        <Controls />
      </ReactFlow>
      {!!showMenu &&
        renderNodeMenu(showMenu.node.label, showMenu.anchor, () =>
          setShowMenu(null)
        )}
    </div>
  );
});

const FileView: React.FC<{ node: Node }> = ({ node }) => (
  <FilenamePrettyView filename={node.label} />
);
