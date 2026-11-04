'use client';

import Button from '@mui/material/Button';
import type { useRepositoryHistory } from './useRepositoryHistory';

export function RepositoryHistoryView({ history, error, loading, onRetry }: ReturnType<typeof useRepositoryHistory> & { onRetry(): void }) {
  return <div className="repository-summary-scroll">
    {loading && !history ? <div className="repository-state" role="status"><span className="pulse-dot" /><p>Reading Git history…</p></div>
      : error ? <div className="repository-state error" role="alert"><strong>History unavailable</strong><p>{error}</p><Button onClick={onRetry}>Try again</Button></div>
      : history && !history.isRepository ? <div className="repository-state"><strong>Not a Git repository</strong><p>Git history is unavailable for this folder.</p></div>
      : history && !history.commits.length ? <div className="repository-state"><strong>No commits yet</strong><p>Commits on this branch will appear here.</p></div>
      : history ? <>
        <ol className="repository-commit-list" aria-label="Recent commits">
          {history.commits.map(commit => <li key={commit.hash}>
            <strong>{commit.subject || 'Untitled commit'}</strong>
            <div className="repository-commit-meta"><span>{commit.author}</span><time dateTime={commit.date} title={new Date(commit.date).toLocaleString()}>{new Date(commit.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time></div>
            <code title={commit.hash}>{commit.hash.slice(0, 8)}</code>
          </li>)}
        </ol>
        {history.truncated && <p className="repository-history-limit">Showing the latest 100 commits on this branch.</p>}
      </> : null}
  </div>;
}
