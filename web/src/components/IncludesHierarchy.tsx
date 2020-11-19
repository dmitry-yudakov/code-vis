import React from 'react';
import ReactFlow, { ArrowHeadType, Background } from 'react-flow-renderer';
import { Node, Edge, Include, PositionedNode } from '../types';
import { includeToGraphTypes } from '../utils';
import dagre from 'dagre';

// const calcEdgeWeightBySimilarity = (incl: Include) => {
//   const {to, from} = incl;
//   let i = 0;
//   for(; i < Math.min(to.length, from.length); ++i) {
//     if(to[i] !== from[i])
//     break;
//   }
//   return i;
// }

const positionElements = (
  nodes: Node[],
  edges: Edge[],
  nodeWidth: number = 200,
  nodeHeight: number = 100
): PositionedNode[] => {
  const g = new dagre.graphlib.Graph({ multigraph: true, compound: true });

  // Set an object for the graph label
  g.setGraph({
    rankdir: 'LR',
    // align: 'UR',
    // ranker: 'tight-tree',
    ranker: 'longest-path',
    nodesep: 1,
    ranksep: 1,
  });

  // Default to assigning a new object as a label for each new edge.
  g.setDefaultEdgeLabel(function () {
    return {};
  });

  for (const n of nodes)
    g.setNode(n.id, { label: n.label, width: nodeWidth, height: nodeHeight });

  // Add edges to the graph.
  for (const e of edges) g.setEdge(e.source, e.target);

  dagre.layout(g);

  const posNodes = nodes.map((node) => {
    const { x, y } = g.node(node.id);
    return { ...node, x, y };
  });
  console.log('positioned nodes', posNodes);
  return posNodes;
};

//position: { x: rand(window.innerWidth), y: rand(window.innerHeight) },

export const IncludesHierarchy: React.FC<{
  includes: Include[];
  onClick: (nodeName: string) => void;
}> = React.memo(({ includes, onClick }) => {
  console.log('includes', includes);
  const { nodes, edges } = includeToGraphTypes(includes);

  const positionedNodes = positionElements(nodes, edges);
  const elements = [
    ...positionedNodes.map((node) => {
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
      return {
        id: `${source}-${target}-${idx}`,
        // type: 'straight',
        arrowHeadType: ArrowHeadType.Arrow,
        source,
        target,
        label: items.join(items[0] === '*' ? ' ' : ', '),
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
  <div className="node">{node.label}</div>
);
