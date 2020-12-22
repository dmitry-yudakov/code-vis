import { LogicNode, LogicNodeType } from './components/FilesMapping';
import {
  Node,
  Edge,
  FileIncludeInfo,
  FunctionCallInfo,
  FunctionDeclarationInfo,
} from './types';
import dagre from 'dagre';

export const rand = (upperLimit: number) =>
  Math.floor(Math.random() * upperLimit);

const reSpecialSymbols = /-/g;
const normalizeString = (str: string) => str.replace(reSpecialSymbols, '_');

export const includeToGraphTypes = (
  includes: FileIncludeInfo[]
): { nodes: Node[]; edges: Edge[] } => {
  const labels = Array.from(
    new Set(includes.flatMap((incl) => [incl.from, incl.to]))
  );
  const nodes = labels.map((label) => ({ label, id: normalizeString(label) }));

  const edges = includes.map(({ from, to, items }, idx) => ({
    source: normalizeString(from),
    target: normalizeString(to),
  }));
  return { nodes, edges };
};

const _reSomeContent = /\S/gm;

export const isEmptyContent = (content: string): boolean => {
  return !_reSomeContent.test(content);
};

const reFilenameParts = /([^/\\]+)\.([^.]+)$/;
export const getFilenameParts = (filename: string) => {
  const res = reFilenameParts.exec(filename);
  if (!res) return { path: '', name: filename, ext: '' };
  const [, name, ext] = res;
  const path = filename.replace(reFilenameParts, '');
  const parts = {
    path,
    name,
    ext,
  };
  // console.log('filename parts:', parts);
  return parts;
};

export const findRelatedFiles = (
  filename: string,
  projectMap: FileIncludeInfo[]
): string[] => {
  const includes = projectMap
    .filter((incl) => incl.to === filename)
    .map((incl) => incl.from);
  const references = projectMap
    .filter((incl) => incl.from === filename)
    .map((incl) => incl.to);

  return uniq([...includes, ...references]);
};

export const buildNodesTree = (
  functionDeclarations: FunctionDeclarationInfo[],
  functionCalls: FunctionCallInfo[],
  contentSize: number
): LogicNode => {
  const nodes: LogicNode[] = [
    // whole file - root node
    {
      type: LogicNodeType.file,
      pos: 0,
      end: contentSize,
      children: [],
      value: '',
    },

    // decls
    ...functionDeclarations.map((f) => ({
      type: LogicNodeType.decl,
      value: f,
      pos: f.pos,
      end: f.end,
      children: [],
    })),

    // calls
    ...functionCalls.map((f) => ({
      type: LogicNodeType.call,
      value: f,
      pos: f.pos,
      end: f.end,
      children: [],
    })),
  ].sort((l, r) => l.pos - r.pos);
  // console.log('NODES:', funcs);

  const emplaceCurrentNode = (currentIndex: number) => {
    const current = nodes[currentIndex];

    for (
      let reverseSearchIndex = currentIndex - 1;
      reverseSearchIndex >= 0;
      --reverseSearchIndex
    ) {
      const potentialParent = nodes[reverseSearchIndex];
      if (
        potentialParent.pos <= current.pos &&
        current.end <= potentialParent.end
      ) {
        potentialParent.children.push(current);
        return;
      }
    }
    console.log('WTF, cannot emplace current node', { i: currentIndex, nodes });
  };

  for (let currentIndex = 1; currentIndex < nodes.length; ++currentIndex) {
    emplaceCurrentNode(currentIndex);
  }

  const fillGaps = (node: LogicNode) => {
    let currentPos = node.pos;
    const enrichedChildren = [];

    for (const child of node.children) {
      if (child.pos > currentPos) {
        enrichedChildren.push({
          type: LogicNodeType.code,
          pos: currentPos,
          end: child.pos,
          value: 'FILL LATER',
          children: [],
        });
      }

      enrichedChildren.push(child);
      currentPos = child.end;
    }

    if (currentPos < node.end) {
      enrichedChildren.push({
        type: LogicNodeType.code,
        pos: currentPos,
        end: node.end,
        value: 'FILL LATER',
        children: [],
      });
    }

    node.children = enrichedChildren;
  };

  nodes.forEach(fillGaps);

  // console.log('STRUCTURED NODES', nodes[0], nodes);

  return nodes[0];
};

export const funcCallSlug = (fc: FunctionCallInfo) =>
  `call:${fc.filename}->${fc.name}:${fc.pos}`;
export const funcDeclSlugFromPieces = (filename: string, name: string) =>
  `decl:${filename}->${name}`;
export const funcDeclSlug = (fd: FunctionDeclarationInfo) =>
  funcDeclSlugFromPieces(fd.filename, fd.name);

export const uniq = (arr: string[]): string[] => Array.from(new Set(arr));

export const applyGraphLayout = (
  nodes: Node[] | (() => Node[]),
  edges: Edge[] | (() => Edge[]),
  cbApplyPosition: (node: Node, x: number, y: number) => void,
  nodeWidth: number = 200,
  nodeHeight: number = 100,
  rankDirection = 'TB'
): void => {
  const g = new dagre.graphlib.Graph({
    multigraph: true,
    compound: true,
    directed: true,
  });

  // https://github.com/dagrejs/dagre/wiki#configuring-the-layout
  g.setGraph({
    rankdir: rankDirection, // TB | LR
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

  const _nodes = typeof nodes === 'function' ? nodes() : nodes;
  for (const n of _nodes)
    g.setNode(n.id, { label: n.label, width: nodeWidth, height: nodeHeight });

  // Add edges to the graph.
  const _edges = typeof edges === 'function' ? edges() : edges;
  for (const e of _edges) g.setEdge(e.source, e.target);

  dagre.layout(g);

  //const posNodes =
  _nodes.forEach((node) => {
    const { x, y } = g.node(node.id);
    cbApplyPosition(node, x, y);
    // return { ...node, x, y };
  });
  // console.log('positioned nodes', _nodes);
  // return posNodes;
};
