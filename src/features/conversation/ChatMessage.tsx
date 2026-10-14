'use client';

import { Disclosure } from '@/features/shell/Disclosure';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TextFile } from '@/shared/textFiles';
import type { ThemeName } from '@/shared/design/tokens';
import type { AgentMode, ChatMessage as ChatMessageType, DiagramAttachmentRecord, Participant } from '@/shared/types';
import { AGENT_MODE_LABELS } from '@/features/agents/toolActivity';
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

export function ChatMessage({ message, theme, participants, activeDiagramId, running, liveState, executePlanBlocked, onSelectDiagram, onRetry, onExecutePlan }: {
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
}) {
  const author = participants.find((participant) => participant.id === message.authorId);
  if (message.role === 'user') {
    const addressee = participants.find((participant) => participant.id === message.addressedParticipantId);
    return (
      <article className={`chat-message user ${message.status}`}>
        <div className="message-meta">
          <span>{author?.displayName || 'You'}{addressee ? ` → @${addressee.displayName}` : ''}{message.mode && message.mode !== 'ask' ? <Chip className="mode-tag" component="em" variant="outlined" color={message.mode === 'full' ? 'error' : ['agent', 'auto', 'edits'].includes(message.mode) ? 'warning' : 'default'} label={`${message.level === 'native' ? 'Native · ' : ''}${AGENT_MODE_LABELS[message.mode]}`} /> : null}</span>
          <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
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
    <article className={`chat-message assistant ${message.status}`}>
      <div className="message-meta">
        <span>{author?.displayName || 'Agent'}{message.mode && message.mode !== 'ask' ? <Chip className="mode-tag" component="em" variant="outlined" color={message.mode === 'full' ? 'error' : ['agent', 'auto', 'edits'].includes(message.mode) ? 'warning' : 'default'} label={`${message.level === 'native' ? 'Native · ' : ''}${AGENT_MODE_LABELS[message.mode]}`} /> : null}</span>
        <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
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
    </article>
  );
}
