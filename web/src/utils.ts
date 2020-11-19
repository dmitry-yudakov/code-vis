import { Include } from './types';

export const rand = (upperLimit: number) =>
  Math.floor(Math.random() * upperLimit);

export const extractNodes = (includes: Include[]): string[] => {
  return Array.from(new Set(includes.flatMap((incl) => [incl.from, incl.to])));
};

export const getNodesObj = (nodes: string[]) =>
  nodes.reduce((obj, node, idx) => {
    obj[node] = idx.toString();
    return obj;
  }, {} as Record<string, string>);
