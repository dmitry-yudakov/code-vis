import { LogicNode, LogicNodeType } from './components/LogicMap';
import {
  Node,
  Edge,
  FileIncludeInfo,
  FileMapping,
  FunctionCallInfo,
  FunctionDeclarationInfo,
} from './types';

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

export const dropIrrelevantFunctionCalls = (
  mapping: FileMapping
): FileMapping => {
  const includedItems = new Set(mapping.includes.flatMap((incl) => incl.items));
  // const declaredItems = new Set(
  //   mapping.functionDeclarations.flatMap((decl) => decl.name)
  // );
  const filteredMapping = {
    ...mapping,
    functionCalls: mapping.functionCalls.filter(
      (fc) => includedItems.has(fc.name)
      // temp
      //|| declaredItems.has(fc.name)
    ),
  };

  return filteredMapping;
};

export const funcCallSlug = (fc: FunctionCallInfo) =>
  `call:${fc.filename}->${fc.name}:${fc.pos}`;
export const funcDeclSlugFromPieces = (filename: string, name: string) =>
  `decl:${filename}->${name}`;
export const funcDeclSlug = (fd: FunctionDeclarationInfo) =>
  funcDeclSlugFromPieces(fd.filename, fd.name);

export const uniq = (arr: string[]): string[] => Array.from(new Set(arr));
