'use client';

import type { RootContent } from 'hast';
import type { createLowlight } from 'lowlight';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { RepositoryFile } from '@/shared/repositoryFiles';

// Bound tokenization and rendering independently of the file read limit.
const MAX_HIGHLIGHT_CHARACTERS = 64 * 1024;
const MAX_HIGHLIGHT_SPANS = 8_000;
const MAX_HIGHLIGHT_DEPTH = 64;
let highlighter: Promise<ReturnType<typeof createLowlight>> | undefined;

function fitsRenderBudget(nodes: RootContent[]) {
  let spans = 0;
  function visit(children: RootContent[], depth: number): boolean {
    for (const node of children) {
      if (node.type !== 'element') continue;
      spans++;
      if (spans > MAX_HIGHLIGHT_SPANS || depth >= MAX_HIGHLIGHT_DEPTH || !visit(node.children, depth + 1)) return false;
    }
    return true;
  }
  return visit(nodes, 0);
}

async function highlight(file: RepositoryFile): Promise<RootContent[] | undefined> {
  const name = file.path.split('/').pop()?.toLowerCase() || '';
  const language = name.slice(name.lastIndexOf('.') + 1);
  if (!language || /^(txt|text|plaintext)$/.test(language)) return;
  highlighter ??= import('lowlight').then(({ common, createLowlight }) => createLowlight(common));
  const syntax = await highlighter;
  if (!syntax.registered(language)) return;
  const { children } = syntax.highlight(language, file.text);
  if (fitsRenderBudget(children)) return children;
}

/** Keep whole-file grammar context when a line link divides the rendered source. */
function renderSource(nodes: RootContent[], start: number, end: number) {
  let offset = 0;
  function render(children: RootContent[]) {
    const sections: [ReactNode[], ReactNode[], ReactNode[]] = [[], [], []];
    children.forEach((node, index) => {
      if (node.type === 'text') {
        const from = Math.max(0, start - offset);
        const to = Math.max(0, end - offset);
        const parts = [node.value.slice(0, from), node.value.slice(from, to), node.value.slice(to)];
        parts.forEach((part, section) => { if (part) sections[section].push(part); });
        offset += node.value.length;
      } else if (node.type === 'element') {
        const className = Array.isArray(node.properties.className) ? node.properties.className.join(' ') : undefined;
        render(node.children).forEach((part, section) => {
          if (part.length) sections[section].push(<span className={className} key={index}>{part}</span>);
        });
      }
    });
    return sections;
  }
  return render(nodes);
}

export function RepositoryFileSource({ file, wrap, lines, line, endLine }: {
  file: RepositoryFile; wrap: boolean; lines: string[]; line?: number; endLine?: number;
}) {
  const [highlighted, setHighlighted] = useState<{ file: RepositoryFile; nodes: RootContent[] }>();
  useEffect(() => {
    if (!file.text || file.text.length > MAX_HIGHLIGHT_CHARACTERS) return;
    let current = true;
    void highlight(file).then(nodes => {
      if (current && nodes) setHighlighted({ file, nodes });
    }).catch(() => {
      // The source is already visible if the highlighter cannot load or parse it.
    });
    return () => { current = false; };
  }, [file]);

  const [before, selected, after] = useMemo(() => {
    const start = line ? lines.slice(0, line - 1).reduce((length, text) => length + text.length + 1, 0) : file.text.length;
    const end = line ? start + lines.slice(line - 1, endLine ?? line).join('\n').length : start;
    const nodes = highlighted?.file === file ? highlighted.nodes : [{ type: 'text' as const, value: file.text }];
    return renderSource(nodes, start, end);
  }, [endLine, file, highlighted, line, lines]);

  return <pre className={`repository-file-source${wrap ? ' wrap-lines' : ''}`} aria-label="File source"><code>
    {line ? <>{before}<mark data-file-line={line}>{selected}</mark>{after}</> : file.text ? before : '(empty file)'}
  </code></pre>;
}
