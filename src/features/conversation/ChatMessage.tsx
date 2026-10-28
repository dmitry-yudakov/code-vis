'use client';

import { Disclosure } from '@/features/shell/Disclosure';
import { useEffect, useState, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { ShellIcon } from '@/features/shell/ShellIcon';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TextFile } from '@/shared/textFiles';
import type { ThemeName } from '@/shared/design/tokens';
import type { AgentMode, ChatMessage as ChatMessageType, DiagramAttachmentRecord, Participant } from '@/shared/types';
import { DiagramCard } from '@/features/diagram/components/DiagramCard';
import { reportAttachmentSummary } from '@/features/reports/reportModel';
import { imageAttachmentSummary } from './imageAttachments';

function safeHref(href?: string): string | undefined {
  if (!href) return undefined;
  return /^(https?:|mailto:|#)/i.test(href) ? href : undefined;
}

function attachmentSummary(records: DiagramAttachmentRecord[]): string {
  const sketches = records.filter((record) => record.kind === 'sketch').length;
  const diagrams = records.length - sketches;
  const parts = [
    diagrams && `${diagrams} diagram snapshot${diagrams === 1 ? '' : 's'}`,
    sketches && `${sketches} sketch${sketches === 1 ? '' : 'es'}`,
  ].filter(Boolean);
  return `${parts.join(' and ')} attached`;
}

export function ChatMessage({ message, theme, participants, activeDiagramId, running, liveState, executePlanBlocked, onSelectDiagram, onRetry, onExecutePlan, onArchive, archiveDisabledReason, navigation }: {
  message: ChatMessageType;
  theme: ThemeName;
  participants: Participant[];
  activeDiagramId?: string;
  running?: boolean;
  liveState?: 'queued' | 'running' | 'needs-you';
  executePlanBlocked?: string;
  onSelectDiagram(id: string): void;
  onRetry?(text: string, participantId: string, mode: AgentMode, reportIds: string[], imageCount: number, files?: TextFile[], uncertain?: boolean): void;
  onExecutePlan?(participantId: string): void;
  onArchive?(): void;
  archiveDisabledReason?: string;
  navigation?: ReactNode;
}) {
  const [copyState, setCopyState] = useState<'copied' | 'failed'>();
  useEffect(() => {
    if (copyState !== 'copied') return;
    const timer = setTimeout(() => setCopyState(undefined), 2000);
    return () => clearTimeout(timer);
  }, [copyState]);
  const author = participants.find((participant) => participant.id === message.authorId);
  if (message.role === 'user') {
    const addressee = participants.find((participant) => participant.id === message.addressedParticipantId);
    return (
      <article className={`chat-message user ${message.status}`} data-navigation-id={`message:${message.id}`} tabIndex={-1}>
        <div className="message-meta">
          <span>{author?.displayName || 'You'}{addressee ? ` → @${addressee.displayName}` : ''}</span>
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
            <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
            {navigation}
          </Box>
        </div>
        <p>{message.text}</p>
        {message.diagramAttachments.length > 0 && <div className="message-attachments">{attachmentSummary(message.diagramAttachments)}</div>}
        {message.reportAttachments?.length ? <div className="message-attachments report">{reportAttachmentSummary(message.reportAttachments)}</div> : null}
        {message.imageAttachments?.length ? <div className="message-attachments image">{imageAttachmentSummary(message.imageAttachments)}</div> : null}
        {message.fileAttachments?.map((file, index) => <Disclosure className="message-attachments" key={index} title={<>{file.name} · {file.bytes} bytes</>}>
          <pre>{file.text}</pre></Disclosure>)}
        {(liveState || message.status !== 'sent') && (
          <div className="message-state">
            <span>{liveState === 'queued' ? 'Queued' : liveState === 'needs-you' ? 'Needs approval' : liveState ? 'Working' : message.status === 'sending' ? 'Checking delivery' : message.status}{message.delivery === 'possibly-sent' ? ' · delivery uncertain' : ''}</span>
            {onRetry && !running && !liveState && message.status !== 'sending' && <Button type="button" onClick={() => onRetry(message.text, message.addressedParticipantId, message.mode || 'ask',
              message.reportAttachments?.map((report) => report.reportId) || [], message.imageAttachments?.length || 0, message.fileAttachments?.map(({ name, text }) => ({ name, text })), message.status === 'sending' || message.delivery === 'possibly-sent')}>Retry</Button>}
          </div>
        )}
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
            <div key={index} className="code-block">
              {block.warning && <div className="block-warning">{block.warning}</div>}
              <pre><code>{block.source}</code></pre>
            </div>
          );
          return (
            <ReactMarkdown
              key={index}
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => <a href={safeHref(href)} target="_blank" rel="noreferrer noopener">{children}</a>,
                code: ({ children }) => <code>{children}</code>,
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
        {onArchive && <Tooltip title={archiveDisabledReason || (running ? 'Wait for this turn to finish.' : 'Archive session. You can undo or restore it later.')}>
          <span><IconButton type="button" size="small" color="inherit" aria-label="Archive session"
            disabled={running || Boolean(archiveDisabledReason)} onClick={onArchive}
          ><ShellIcon name="archive" /></IconButton></span>
        </Tooltip>}
        <Tooltip title="Copy reply">
          <IconButton type="button" size="small" color="inherit" aria-label="Copy reply" onClick={async () => {
            try { await navigator.clipboard.writeText(message.rawMarkdown); setCopyState('copied'); }
            catch { setCopyState('failed'); }
          }}><ShellIcon name="copy" /></IconButton>
        </Tooltip>
        {copyState && <span role="status">{copyState === 'copied' ? 'Copied' : 'Could not copy. Try again.'}</span>}
        {navigation}
      </Box>
    </article>
  );
}
