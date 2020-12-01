import { Node, Edge, FileIncludeInfo } from './types';

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
