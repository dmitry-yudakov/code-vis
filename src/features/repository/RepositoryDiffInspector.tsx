'use client';

import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { useCallback, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { ShellIcon } from '@/features/shell/ShellIcon';
import type { GitChangedFile } from '@/shared/types';
import type { RepositoryDiffState } from './useRepositoryDiff';
import { MarkdownPreviewCodeBlock } from './MarkdownPreviewCodeBlock';

function patchLineClass(line: string): string {
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+') && !line.startsWith('+++')) return 'addition';
  if (line.startsWith('-') && !line.startsWith('---')) return 'removal';
  if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) return 'meta';
  return '';
}

export function Patch({ source }: { source?: string }) {
  if (!source) return <div className="diff-empty">No textual patch is available for this part of the change.</div>;
  return (
    <pre className="diff-patch" aria-label="Unified diff">
      {source.split('\n').map((line, index) => (
        <span className={patchLineClass(line)} key={`${index}-${line.slice(0, 24)}`}>{line || ' '}</span>
      ))}
    </pre>
  );
}

export function RepositoryDiffInspector({ file, state, onClose, onRetry }: {
  file: GitChangedFile;
  state: RepositoryDiffState;
  onClose(): void;
  onRetry(): void;
}) {
  const { diff, loading, error } = state;
  const [wrap, setWrap] = useState(true);
  const [view, setView] = useState<'diff' | 'preview'>('diff');
  const preview = diff?.preview;
  const showPreview = view === 'preview' && preview;
  const scrollPositions = useRef({ diff: 0, preview: 0 });
  const shownView = showPreview ? 'preview' : 'diff';
  const restoreScroll = useCallback((element: HTMLDivElement | null) => {
    if (element) element.scrollTop = scrollPositions.current[shownView];
  }, [shownView]);

  const content = (
    <section className={`repository-inspector diff-inspector ${wrap ? 'wrap-lines' : ''}`} aria-label={`Changes in ${file.path}`}>
      <header className="diff-inspector-header">
        <IconButton type="button" aria-label="Close file changes" title="Close diff tab" onClick={onClose}>×</IconButton>
        <div><span className="eyebrow">{file.status} · read only</span><strong title={file.path}>{file.path}</strong></div>
        <IconButton aria-label="Refresh file changes" disabled={loading} onClick={onRetry}><ShellIcon name="refresh" /></IconButton>
      </header>
      <div className="diff-inspector-toolbar">
        {preview && <ToggleButtonGroup size="small" exclusive value={view} aria-label="File review view" onChange={(_, value) => { if (value) setView(value); }}>
          <ToggleButton value="diff">Diff</ToggleButton>
          <ToggleButton value="preview">Preview</ToggleButton>
        </ToggleButtonGroup>}
        {showPreview ? <span className="diff-preview-source">Current working-tree file</span> : <ToggleButton size="small" value="wrap" selected={wrap} onChange={() => setWrap(!wrap)} aria-label="Wrap text">Wrap</ToggleButton>}
      </div>
      <div ref={restoreScroll} className="diff-inspector-scroll" onScroll={event => { scrollPositions.current[shownView] = event.currentTarget.scrollTop; }}>
        {loading && !diff ? <div className="repository-state"><span className="pulse-dot" /><p>Reading patch…</p></div> : error ? (
          <div className="repository-state error"><strong>Diff unavailable</strong><p>{error}</p><Button type="button" onClick={onRetry}>Try again</Button></div>
        ) : showPreview ? 'markdown' in preview ? (
          <article className="assistant-blocks diff-markdown-preview" aria-label="Markdown preview">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
              pre: MarkdownPreviewCodeBlock,
              a: ({ href, children }) => /^https?:\/\//i.test(href ?? '')
                ? <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
                : <span title={href}>{children}</span>,
              img: ({ alt }) => <span className="diff-preview-image">[Image: {alt || 'image'}]</span>,
            }}>{preview.markdown}</ReactMarkdown>
          </article>
        ) : (
          <div className="repository-state error"><strong>Preview unavailable</strong><p>{preview.error}</p><Button onClick={onRetry}>Try again</Button></div>
        ) : diff ? (
          <>
            {diff.staged !== undefined && <section className="diff-section"><header><strong>Staged</strong><span>index</span></header><Patch source={diff.staged} /></section>}
            {diff.unstaged !== undefined && <section className="diff-section"><header><strong>{file.status === 'untracked' ? 'Untracked' : 'Working tree'}</strong><span>{file.status === 'untracked' ? 'new file' : 'unstaged'}</span></header><Patch source={diff.unstaged} /></section>}
          </>
        ) : null}
      </div>
    </section>
  );

  return content;
}
