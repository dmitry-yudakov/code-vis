'use client';

import { Disclosure } from '@/features/shell/Disclosure';
import { useEffect, useState, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import { MAX_MESSAGE_TEXT_CHARS } from '@/shared/limits';
import { ShellIcon } from '@/features/shell/ShellIcon';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TextFile } from '@/shared/textFiles';
import type { ThemeName } from '@/shared/design/tokens';
import type { AgentMode, ChatMessage as ChatMessageType, DiagramAttachmentRecord, Participant } from '@/shared/types';
import { DiagramCard } from '@/features/diagram/components/DiagramCard';
import { MarkdownTable } from '@/features/markdown/MarkdownTable';
import { reportAttachmentSummary } from '@/features/reports/reportModel';
import { imageAttachmentSummary } from './imageAttachments';
import { CodeBlock } from './CodeBlock';
import { RepositoryLink, repositoryUrlTransform } from '@/features/repository/RepositoryFilesProvider';

function attachmentSummary(records: DiagramAttachmentRecord[]): string {
  const sketches = records.filter((record) => record.kind === 'sketch').length;
  const diagrams = records.length - sketches;
  const parts = [
    diagrams && `${diagrams} diagram snapshot${diagrams === 1 ? '' : 's'}`,
    sketches && `${sketches} sketch${sketches === 1 ? '' : 'es'}`,
  ].filter(Boolean);
  return `${parts.join(' and ')} attached`;
}

export function ChatMessage({ message, theme, participants, activeDiagramId, detailsDeferred, detailsLoading, onLoadDetails, running, liveState, executePlanBlocked, onSelectDiagram, onRetry, onExecutePlan, onEditQueuedMessage, onSteer, onRemoveQueued, onRunNow, navigation }: {
  message: ChatMessageType;
  detailsDeferred?: boolean;
  detailsLoading?: boolean;
  onLoadDetails?(): void;
  theme: ThemeName;
  participants: Participant[];
  activeDiagramId?: string;
  running?: boolean;
  liveState?: 'queued' | 'running' | 'needs-you';
  executePlanBlocked?: string;
  onSelectDiagram(id: string): void;
  onRetry?(text: string, participantId: string, mode: AgentMode, reportIds: string[], imageCount: number, files?: TextFile[], uncertain?: boolean, activeFile?: import('@/shared/activeFileContext').ActiveFileContext): void;
  onExecutePlan?(participantId: string): void;
  onEditQueuedMessage?(messageId: string, text: string, expectedText: string): Promise<void>;
  onSteer?(): Promise<void>;
  onRemoveQueued?(): Promise<void>;
  onRunNow?(): Promise<void>;
  navigation?: ReactNode;
}) {
  const [copyState, setCopyState] = useState<'copied' | 'failed'>();
  const [edit, setEdit] = useState<{ text: string; original: string }>();
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string>();
  const [queueAction, setQueueAction] = useState<'steer' | 'remove' | 'run-now'>();
  const [queueError, setQueueError] = useState<string>();
  useEffect(() => {
    if (copyState !== 'copied') return;
    const timer = setTimeout(() => setCopyState(undefined), 2000);
    return () => clearTimeout(timer);
  }, [copyState]);
  const author = participants.find((participant) => participant.id === message.authorId);
  if (message.role === 'user') {
    const addressee = participants.find((participant) => participant.id === message.addressedParticipantId);
    const runQueueAction = async (kind: NonNullable<typeof queueAction>, action: () => Promise<void>) => {
      setQueueError(undefined);
      setQueueAction(kind);
      try { await action(); }
      catch (error) { setQueueError(error instanceof Error ? error.message : 'The queued message could not be updated.'); }
      finally { setQueueAction(undefined); }
    };
    return (
      <article className={`chat-message user ${message.status}`} data-navigation-id={`message:${message.id}`} tabIndex={-1}>
        <div className="message-meta">
          <span>{author?.displayName || 'You'}{addressee ? ` → @${addressee.displayName}` : ''}</span>
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
            <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
            {navigation}
          </Box>
        </div>
        {edit ? <Box component="form" sx={{ display: 'grid', gap: 1, my: 1 }} onSubmit={async event => {
          event.preventDefault();
          if (saving || !edit.text.trim() || !onEditQueuedMessage) return;
          setSaving(true); setEditError(undefined);
          try { await onEditQueuedMessage(message.id, edit.text.trim(), edit.original); setEdit(undefined); }
          catch (error) { setEditError(error instanceof Error ? error.message : 'Could not save. Your edit is kept.'); }
          finally { setSaving(false); }
        }}>
          <TextField autoFocus fullWidth multiline minRows={3} maxRows={12} label="Queued message" value={edit.text} disabled={saving}
            slotProps={{ htmlInput: { maxLength: MAX_MESSAGE_TEXT_CHARS } }}
            onChange={event => setEdit({ ...edit, text: event.target.value })} />
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button type="submit" variant="contained" disabled={saving || !edit.text.trim() || liveState !== 'queued'}>{saving ? 'Saving…' : 'Save message'}</Button>
            <Button type="button" disabled={saving} onClick={() => { setEdit(undefined); setEditError(undefined); }}>Cancel edit</Button>
          </Box>
          {liveState !== 'queued' && <Alert severity="warning">This turn has started. Your edit has not been sent.</Alert>}
          {editError && <Alert severity="error">{editError}</Alert>}
        </Box> : <p>{message.text}</p>}
        {message.diagramAttachments.length > 0 && <div className="message-attachments">{attachmentSummary(message.diagramAttachments)}</div>}
        {message.reportAttachments?.length ? <div className="message-attachments report">{reportAttachmentSummary(message.reportAttachments)}</div> : null}
        {message.imageAttachments?.length ? <div className="message-attachments image">{imageAttachmentSummary(message.imageAttachments)}</div> : null}
        {message.fileAttachments?.map((file, index) => <Disclosure className="message-attachments message-file" key={index}
          title={<>{file.name} · {file.bytes} bytes</>}
          onChange={expanded => { if (expanded && detailsDeferred && file.bytes > 0 && !file.text) onLoadDetails?.(); }}>
          {detailsDeferred && file.bytes > 0 && !file.text
            ? detailsLoading && <p role="status">Loading file contents…</p>
            : <pre>{file.text}</pre>}
        </Disclosure>)}
        {(liveState || message.status !== 'sent' || message.steeredRunId) && (
          <div className="message-state">
            <span>{message.steeredRunId ? 'Steered active turn' : liveState === 'queued' ? 'Queued' : liveState === 'needs-you' ? 'Needs approval' : liveState ? 'Working' : message.status === 'sending' ? 'Checking delivery' : message.status}{message.delivery === 'possibly-sent' ? ' · delivery uncertain' : ''}</span>
            {liveState === 'queued' && !edit && <div className="message-state-actions">
              {onRunNow && <Button type="button" disabled={Boolean(queueAction)} title="Skip the wait for earlier sessions to be archived."
                onClick={() => void runQueueAction('run-now', onRunNow)}>{queueAction === 'run-now' ? 'Starting…' : 'Run now'}</Button>}
              {(onSteer || queueAction === 'steer') && <Button type="button" disabled={Boolean(queueAction)} onClick={() => { if (onSteer) void runQueueAction('steer', onSteer); }}>{queueAction === 'steer' ? 'Steering…' : 'Steer'}</Button>}
              {onEditQueuedMessage && <Button type="button" aria-label="Edit message" disabled={Boolean(queueAction)} onClick={() => { setEdit({ text: message.text, original: message.text }); setEditError(undefined); }}>Edit</Button>}
              {onRemoveQueued && <Button type="button" disabled={Boolean(queueAction)} onClick={() => void runQueueAction('remove', onRemoveQueued)}>{queueAction === 'remove' ? 'Removing…' : 'Remove'}</Button>}
            </div>}
            {onRetry && !running && !liveState && message.status !== 'sending' && <Button type="button" onClick={() => onRetry(message.text, message.addressedParticipantId, message.mode || 'ask',
              message.reportAttachments?.map((report) => report.reportId) || [], message.imageAttachments?.length || 0, message.fileAttachments?.map(({ name, text }) => ({ name, text })), message.status === 'sending' || message.delivery === 'possibly-sent', message.activeFile)}>Retry</Button>}
          </div>
        )}
        {queueError && <Alert severity="error">{queueError}</Alert>}
      </article>
    );
  }

  return (
    <article className={`chat-message assistant ${message.status}`} data-navigation-id={`message:${message.id}`} tabIndex={-1}>
      <div className="message-meta">
        <span>{author?.displayName || 'Agent'}</span>
      </div>
      <div className="assistant-blocks">
        {message.blocks.map((block, index) => {
          if (block.kind === 'diagram') return (
            <DiagramCard
              key={block.artifact.id}
              artifact={block.artifact}
              active={activeDiagramId === block.artifact.id}
              theme={theme}
              onSelect={() => onSelectDiagram(block.artifact.id)}
            />
          );
          if (block.kind === 'code') return (
            <CodeBlock key={index} warning={block.warning}><code>{block.source}</code></CodeBlock>
          );
          return (
            <ReactMarkdown
              key={index}
              remarkPlugins={[remarkGfm]}
              urlTransform={repositoryUrlTransform}
              components={{
                a: RepositoryLink,
                pre: CodeBlock,
                code: ({ children }) => <code>{children}</code>,
                table: MarkdownTable,
              }}
            >
              {block.markdown}
            </ReactMarkdown>
          );
        })}
      </div>
      {message.planProposed && onExecutePlan && (
        <div className="plan-approval">
          <span>{executePlanBlocked || 'Nothing runs until you approve. Executing resumes this same session in Agent mode.'}</span>
          <Button type="button" disabled={running || Boolean(executePlanBlocked)} title={executePlanBlocked} onClick={() => onExecutePlan(message.authorId)}>Execute plan</Button>
        </div>
      )}
      <Box component="footer" className="message-actions" sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5, mt: 0.5, color: 'text.secondary', fontSize: 11,
        '& .shell-icon': { width: 16, height: 16 } }}>
        <time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
        <Tooltip title={detailsDeferred ? 'Copy is available after the full reply loads' : 'Copy reply'}>
          <span><IconButton type="button" size="small" color="inherit" aria-label="Copy reply" disabled={detailsDeferred} onClick={async () => {
            try { await navigator.clipboard.writeText(message.rawMarkdown); setCopyState('copied'); }
            catch { setCopyState('failed'); }
          }}><ShellIcon name="copy" /></IconButton></span>
        </Tooltip>
        {copyState && <span role="status">{copyState === 'copied' ? 'Copied' : 'Could not copy. Try again.'}</span>}
        {navigation}
      </Box>
    </article>
  );
}
