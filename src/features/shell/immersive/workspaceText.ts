import type { GitFileDiff, GitWorkingTree } from '@/shared/types';

/** Fixed monospace columns match raster text; preserve code indentation and wrap long tokens. */
export function workspaceTextLines(text: string, columns = 56): string[] {
  return text.replaceAll('\t', '  ').split('\n').flatMap((line) => {
    const points = [...line];
    if (!points.length) return [''];
    const lines: string[] = [];
    let current = '';
    let width = 0;
    for (const point of points) {
      // Conservatively reserve two columns for non-Latin glyphs, including CJK and emoji.
      const advance = point.codePointAt(0)! > 0xff ? 2 : 1;
      if (width + advance > columns) { lines.push(current); current = ''; width = 0; }
      current += point;
      width += advance;
    }
    lines.push(current);
    return lines;
  });
}
export const EVIDENCE_LINES_PER_PAGE = 16;

export function repositoryStatusLines(tree: GitWorkingTree | undefined, status: string): string[] {
  if (!tree) return workspaceTextLines(status).slice(0, EVIDENCE_LINES_PER_PAGE);
  if (!tree.isRepository) return ['Not a Git repository', '', 'This checkout remains available as agent context.'];
  const tracking = [tree.ahead ? `ahead ${tree.ahead}` : '', tree.behind ? `behind ${tree.behind}` : ''].filter(Boolean).join(' · ');
  const heading = `Branch: ${tree.branch || 'unknown'}${tracking ? ` · ${tracking}` : ''}`;
  if (!tree.files.length) return [heading, '', 'Working tree clean'];
  return [heading, '', `${tree.files.length} changed ${tree.files.length === 1 ? 'file' : 'files'}`,
    ...tree.files.slice(0, 12).map((file) => `${file.staged ? 'S' : ' '} ${file.unstaged ? 'W' : ' '} ${file.status === 'untracked' ? '?' : ' '}  ${file.path}`),
    ...(tree.files.length > 12 ? [`… ${tree.files.length - 12} more; use file controls`] : []),
  ];
}

export function evidencePages(diff?: GitFileDiff): string[][] {
  const text = diff ? [
    diff.staged !== undefined ? `Staged\n${diff.staged || 'No textual patch available.'}` : '',
    diff.unstaged !== undefined ? `Working tree\n${diff.unstaged || 'No textual patch available.'}` : '',
  ].filter(Boolean).join('\n\n') : '';
  const lines = workspaceTextLines(text || 'No textual patch available.');
  const pages: string[][] = [];
  for (let start = 0; start < lines.length; start += EVIDENCE_LINES_PER_PAGE) pages.push(lines.slice(start, start + EVIDENCE_LINES_PER_PAGE));
  return pages;
}
