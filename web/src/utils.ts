import { Node, Edge, Include } from './types';

export const rand = (upperLimit: number) =>
  Math.floor(Math.random() * upperLimit);

const reSpecialSymbols = /-/g;
const normalizeString = (str: string) => str.replace(reSpecialSymbols, '_');

export const includeToGraphTypes = (
  includes: Include[]
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
