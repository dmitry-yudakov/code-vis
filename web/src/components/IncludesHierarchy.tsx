import React, { useState } from 'react';
import ReactFlow, { ArrowHeadType, Controls } from 'react-flow-renderer';
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
    anchor: Element,
    onClose: () => void
  ) => JSX.Element;
}> = React.memo(({ includes, renderNodeMenu }) => {
  console.log('includes', includes);
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

  const [showMenu, setShowMenu] = useState<{
    anchor: Element;
    node: Node;
  } | null>(null);

  const elements = [
    ...(nodes as PositionedNode[]).map((node) => {
      const { id, x, y } = node;
      return {
        id,
        data: {
          label: <FileView node={node} />,
          node,
        },
        position: { x, y },
      };
    }),

    ...edges.map(({ source, target }, idx) => {
      // const source = nodesObj[from];
      // const target = nodesObj[to];
      const items = includes[idx].items;
      const label = edgeLabel(items);
      return {
        id: `${source}-${target}-${idx}`,
        // type: 'straight',
        arrowHeadType: ArrowHeadType.Arrow,
        source,
        target,
        label,
      };
    }),
  ];

  console.log('generated elements', elements);
  return (
    <div className="mapper">
      <ReactFlow
        elements={elements}
        nodesConnectable={false}
        // panOnScroll
        minZoom={0.01}
        onElementClick={(e, el) => {
          if (el.data) {
            setShowMenu({ anchor: e.target as Element, node: el.data.node });
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
