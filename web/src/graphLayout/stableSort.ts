import { CodeLayoutNode } from './types';

const ROLE_ORDER: Record<string, number> = {
  seed: 0,
  changed: 1,
  bridge: 2,
  expanded: 3,
  overview: 4,
  context: 5,
  test: 6,
};

export const getLayoutDirectory = (node: CodeLayoutNode): string => {
  if (node.directory) return node.directory;

  const filename = node.filename || node.label;
  const idx = filename.lastIndexOf('/');
  if (idx < 0) return '.';
  return filename.slice(0, idx) || '.';
};

export const getLayoutSortKey = (node: CodeLayoutNode): string => {
  if (node.sortKey) return node.sortKey;

  const filename = node.filename || node.label;
  const line = `${node.startLine ?? 0}`.padStart(8, '0');
  const role = `${ROLE_ORDER[node.role] ?? 99}`.padStart(2, '0');
  return `${getLayoutDirectory(node)}|${filename}|${line}|${role}|${node.label}|${node.id}`;
};

export const compareLayoutNodes = (
  left: CodeLayoutNode,
  right: CodeLayoutNode
): number => {
  const dirCompare = getLayoutDirectory(left).localeCompare(
    getLayoutDirectory(right)
  );
  if (dirCompare !== 0) return dirCompare;

  const filenameCompare = (left.filename || left.label).localeCompare(
    right.filename || right.label
  );
  if (filenameCompare !== 0) return filenameCompare;

  const leftLine = left.startLine ?? 0;
  const rightLine = right.startLine ?? 0;
  if (leftLine !== rightLine) return leftLine - rightLine;

  const leftRole = ROLE_ORDER[left.role] ?? 99;
  const rightRole = ROLE_ORDER[right.role] ?? 99;
  if (leftRole !== rightRole) return leftRole - rightRole;

  return getLayoutSortKey(left).localeCompare(getLayoutSortKey(right));
};

export const sortLayoutNodes = (nodes: CodeLayoutNode[]): CodeLayoutNode[] =>
  [...nodes].sort(compareLayoutNodes);

export const groupLayoutNodesByFile = (
  nodes: CodeLayoutNode[]
): Array<{ filename: string; nodes: CodeLayoutNode[] }> => {
  const groups = new Map<string, CodeLayoutNode[]>();

  for (const node of sortLayoutNodes(nodes)) {
    const filename = node.filename || node.label;
    groups.set(filename, [...(groups.get(filename) || []), node]);
  }

  return Array.from(groups.entries())
    .map(([filename, groupedNodes]) => ({
      filename,
      nodes: sortLayoutNodes(groupedNodes),
    }))
    .sort((left, right) => left.filename.localeCompare(right.filename));
};
