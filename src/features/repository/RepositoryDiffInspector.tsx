'use client';

import type { GitChangedFile } from '@/shared/types';
import type { RepositoryDiffState } from './useRepositoryDiff';

function patchLineClass(line: string): string {
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+') && !line.startsWith('+++')) return 'addition';
  if (line.startsWith('-') && !line.startsWith('---')) return 'removal';
  if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) return 'meta';
  return '';
}

function Patch({ source }: { source?: string }) {
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

  return (
    <section className="repository-inspector diff-inspector" aria-label={`Changes in ${file.path}`}>
      <header className="diff-inspector-header">
        <button type="button" aria-label="Close file changes" title="Back to changed files" onClick={onClose}>←</button>
        <div><span className="eyebrow">{file.status} · read only</span><strong>{file.path}</strong></div>
      </header>
      <div className="diff-inspector-scroll">
        {loading ? <div className="repository-state"><span className="pulse-dot" /><p>Reading patch…</p></div> : error ? (
          <div className="repository-state error"><strong>Diff unavailable</strong><p>{error}</p><button type="button" onClick={onRetry}>Try again</button></div>
        ) : diff ? (
          <>
            {diff.staged !== undefined && <section className="diff-section"><header><strong>Staged</strong><span>index</span></header><Patch source={diff.staged} /></section>}
            {diff.unstaged !== undefined && <section className="diff-section"><header><strong>{file.status === 'untracked' ? 'Untracked' : 'Working tree'}</strong><span>{file.status === 'untracked' ? 'new file' : 'unstaged'}</span></header><Patch source={diff.unstaged} /></section>}
          </>
        ) : null}
      </div>
    </section>
  );
}
