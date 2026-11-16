'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
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
      type="button" title={file.path} className={`repository-file ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={onSelect}
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

export function RepositoryChangesView({ tree, loading, error, selectedPath, onSelect, onRetry, busy, onStage, onUnstage, onCommit, message = '', onMessageChange }: {
  message?: string;
  onMessageChange?(message: string): void;
  busy?: boolean;
  onStage?(paths: string[]): Promise<unknown>;
  onUnstage?(paths: string[]): Promise<unknown>;
  onCommit?(message: string): Promise<string | undefined>;
  tree?: GitWorkingTree;
  loading: boolean;
  error?: string;
  selectedPath?: string;
  onSelect(path: string): void;
  onRetry(): void;
}) {
  const [feedback, setFeedback] = useState<{ error?: string; success?: string }>();
  const disabled = busy || loading || !tree?.indexState;
  const perform = async (action: () => Promise<unknown>, committing = false) => {
    setFeedback(undefined);
    try {
      const result = await action();
      if (committing) { setFeedback({ success: `Committed ${String(result).slice(0, 8)}` }); }
    } catch (reason) { setFeedback({ error: reason instanceof Error ? reason.message : 'Git operation failed. Refresh and retry.' }); }
  };
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
          {busy && <LinearProgress aria-label="Updating Git" sx={{ mx: 1, mb: 1 }} />}
          {feedback && <Alert severity={feedback.error ? 'error' : 'success'} sx={{ mx: 1, mb: 1 }} onClose={() => setFeedback(undefined)}>{feedback.error || feedback.success}</Alert>}
          {onCommit && <Box component="form" sx={{ px: 1, pb: 1.5, display: 'grid', gap: 1 }} onSubmit={event => { event.preventDefault(); if (!disabled && staged && message.trim()) void perform(() => onCommit(message), true); }}>
            <TextField label="Commit message" size="small" multiline minRows={2} maxRows={5} value={message}
              disabled={busy} onChange={event => onMessageChange?.(event.target.value)} slotProps={{ htmlInput: { maxLength: 16_000 } }} />
            <Button type="submit" variant="contained" title="Commit staged changes without hooks or signing" disabled={disabled || !staged || !message.trim() || tree.files.some(file => file.status === 'conflicted')}>Commit staged{staged ? ` (${staged})` : ''}</Button>
          </Box>}
          {tree.files.length ? (
            <>
              {(onStage || onUnstage) && <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, px: 1, pb: 1 }}>
                {onStage && <Button size="small" disabled={disabled || !tree.files.some(file => file.unstaged || file.status === 'untracked')} onClick={() => void perform(() => onStage(tree.files.filter(file => file.unstaged || file.status === 'untracked').map(file => file.path)))}>Stage all</Button>}
                {onUnstage && <Button size="small" disabled={disabled || !staged} onClick={() => void perform(() => onUnstage(tree.files.filter(file => file.staged).map(file => file.path)))}>Unstage all</Button>}
              </Box>}
              <div className="repository-file-list">
                {tree.files.map(file => <Box key={file.path} sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                  <FileRow file={file} selected={file.path === selectedPath} onSelect={() => onSelect(file.path)} />
                  {(onStage || onUnstage) && <Box sx={{ display: 'flex', flexShrink: 0, gap: 0.5 }}>
                    {onStage && (file.unstaged || file.status === 'untracked') && <Button size="small" disabled={disabled} aria-label={`Stage ${file.path}`} onClick={() => void perform(() => onStage([file.path]))}>Stage</Button>}
                    {onUnstage && file.staged && <Button size="small" disabled={disabled} aria-label={`Unstage ${file.path}`} onClick={() => void perform(() => onUnstage([file.path]))}>Unstage</Button>}
                  </Box>}
                </Box>)}
              </div>
            </>
          ) : (
            <div className="repository-state compact"><span className="repository-state-mark clean">✓</span><strong>Nothing to review</strong><p>No uncommitted changes.</p></div>
          )}
        </>
      ) : null}
    </div>
  );
}
