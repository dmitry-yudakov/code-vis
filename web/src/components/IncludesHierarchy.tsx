import React from 'react';
import ReactFlow, { ArrowHeadType, Background } from 'react-flow-renderer';
import { Node, FileIncludeInfo, PositionedNode } from '../types';
import { includeToGraphTypes, applyGraphLayout } from '../utils';
import './IncludesHierarchy.css';
import { FilenamePrettyView } from './FilenamePrettyView';

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
  onClick: (nodeName: string) => void;
}> = React.memo(({ includes, onClick }) => {
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

  const elements = [
    ...(nodes as PositionedNode[]).map((node) => {
      const { id, x, y } = node;
      return {
        id,
        data: {
          label: <NodeView node={node} />,
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
        onElementClick={(e, el) => {
          if (el.data) {
            // onClick(el.data.label);
            onClick(el.data.node.label);
          }
        }}
      >
        <Background color="#aaa" gap={16} />
      </ReactFlow>
    </div>
  );
});

const NodeView: React.FC<{ node: Node }> = ({ node }) => (
  <FilenamePrettyView filename={node.label} />
);
