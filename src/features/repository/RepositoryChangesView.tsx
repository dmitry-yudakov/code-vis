'use client';

import Button from '@mui/material/Button';
import ListItemButton from '@mui/material/ListItemButton';

import type { GitChangedFile, GitFileStatus, GitWorkingTree } from '@/shared/types';

const STATUS_MARK: Record<GitFileStatus, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  conflicted: '!',
  untracked: '?',
};

function pathParts(filePath: string): { name: string; directory?: string } {
  const separator = filePath.lastIndexOf('/');
  return separator === -1
    ? { name: filePath }
    : { name: filePath.slice(separator + 1), directory: filePath.slice(0, separator) };
}

function FileRow({ file, selected, onSelect }: {
  file: GitChangedFile;
  selected: boolean;
  onSelect(): void;
}) {
  const parts = pathParts(file.path);
  return (
    <ListItemButton component="button" selected={selected}
      type="button" className={`repository-file ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={onSelect}
    >
      <span className={`git-status-mark status-${file.status}`} aria-label={file.status}>{STATUS_MARK[file.status]}</span>
      <span className="repository-file-path">
        <strong>{parts.name}</strong>
        {parts.directory && <small>{parts.directory}</small>}
        {file.previousPath && <small className="previous-path">from {file.previousPath}</small>}
      </span>
      {/* Untracked files already say so in the status mark on the left; repeating it as a `U`
          chip on the right states the same fact twice. Staged/working tree is new information. */}
      {file.status !== 'untracked' && (
        <span className="git-stage-marks" aria-label="Change areas">
          {file.staged && <i title="Staged">S</i>}
          {file.unstaged && <i title="Working tree">W</i>}
        </span>
      )}
    </ListItemButton>
  );
}

/** The button's words for what the server said it would do. */
export function pushOffer({ pushTarget, publishes, ahead, upstream }: GitWorkingTree): { label: string; description: string } | undefined {
  if (!pushTarget) return undefined;
  if (publishes) return { label: 'Publish', description: `Publish this branch to ${pushTarget}` };
  return { label: 'Push', description: ahead && upstream === pushTarget ? `Push ${ahead} ${ahead === 1 ? 'commit' : 'commits'} to ${pushTarget}` : `Push to ${pushTarget}` };
}

export function RepositoryChangesView({ tree, loading, error, selectedPath, onSelect, onRetry }: {
  tree?: GitWorkingTree;
  loading: boolean;
  error?: string;
  selectedPath?: string;
  onSelect(path: string): void;
  onRetry(): void;
}) {
  const staged = tree?.files.filter((file) => file.staged).length || 0;
  const working = tree?.files.filter((file) => file.unstaged && file.status !== 'untracked').length || 0;
  const untracked = tree?.files.filter((file) => file.status === 'untracked').length || 0;

  return (
    <div className="repository-summary-scroll">
      {loading && !tree ? <div className="repository-state"><span className="pulse-dot" /><p>Reading working tree…</p></div> : error ? (
        <div className="repository-state error"><strong>Status unavailable</strong><p>{error}</p><Button type="button" onClick={onRetry}>Try again</Button></div>
      ) : tree && !tree.isRepository ? (
        <div className="repository-state"><span className="repository-state-mark">◇</span><strong>Not a Git repository</strong><p>This repository can still be used as working context; Git changes are unavailable.</p></div>
      ) : tree ? (
        <>
          <div className="git-change-heading">
            <strong>{tree.files.length ? `${tree.files.length} changed ${tree.files.length === 1 ? 'file' : 'files'}` : 'Working tree clean'}</strong>
            {/* Only the counts that are actually non-zero, spelled out. `S 0  W 0  U 5` gives two
                zeros the same weight as the one number that matters, behind letters nobody reads. */}
            {tree.files.length > 0 && (
              <div className="git-counts">
                {staged > 0 && <span>{staged} staged</span>}
                {working > 0 && <span>{working} unstaged</span>}
                {untracked > 0 && <span>{untracked} untracked</span>}
              </div>
            )}
          </div>
          {tree.files.length ? (
            <div className="repository-file-list">
              {tree.files.map((file) => <FileRow key={file.path} file={file} selected={file.path === selectedPath} onSelect={() => onSelect(file.path)} />)}
            </div>
          ) : (
            <div className="repository-state compact"><span className="repository-state-mark clean">✓</span><strong>Nothing to review</strong><p>No uncommitted changes.</p></div>
          )}
        </>
      ) : null}
    </div>
  );
}
