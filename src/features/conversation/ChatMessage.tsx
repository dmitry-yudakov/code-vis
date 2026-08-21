'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AgentMode, ChatMessage as ChatMessageType, DiagramAttachmentRecord, Participant } from '@/shared/types';
import { AGENT_MODE_LABELS } from '@/features/agents/toolActivity';
import { DiagramCard } from '@/features/diagram/components/DiagramCard';
import { AGENT_ROLE_LABELS, PROVIDER_LABELS } from '@/shared/participants';

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

export function ChatMessage({ message, participants, activeDiagramId, running, onSelectDiagram, onRetry, onExecutePlan }: {
  message: ChatMessageType;
  participants: Participant[];
  activeDiagramId?: string;
  running?: boolean;
  onSelectDiagram(id: string): void;
  onRetry?(text: string, participantId: string, mode: AgentMode): void;
  onExecutePlan?(participantId: string): void;
}) {
  const author = participants.find((participant) => participant.id === message.authorId);
  if (message.role === 'user') {
    const addressee = participants.find((participant) => participant.id === message.addressedParticipantId);
    return (
      <article className={`chat-message user ${message.status}`}>
        <div className="message-meta">
          <span>{author?.displayName || 'You'}{addressee ? ` → @${addressee.displayName}` : ''}{message.mode && message.mode !== 'ask' ? <em className={`mode-tag mode-${message.mode}`}>{AGENT_MODE_LABELS[message.mode]}</em> : null}</span>
          <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
        </div>
        <p>{message.text}</p>
        {message.diagramAttachments.length > 0 && <div className="message-attachments">{attachmentSummary(message.diagramAttachments)}</div>}
        {message.status !== 'sent' && (
          <div className="message-state">
            <span>{message.status}{message.delivery === 'possibly-sent' ? ' · delivery uncertain' : ''}</span>
            {onRetry && <button type="button" onClick={() => onRetry(message.text, message.addressedParticipantId, message.mode || 'ask')}>Retry</button>}
          </div>
        )}
      </article>
    );
  }

  return (
    <article className={`chat-message assistant ${message.status}`}>
      <div className="message-meta">
        <span>{author?.displayName || 'Agent'}{author?.kind === 'agent' ? ` · ${PROVIDER_LABELS[author.provider]}/${AGENT_ROLE_LABELS[author.role]}` : ''}{message.mode && message.mode !== 'ask' ? <em className={`mode-tag mode-${message.mode}`}>{AGENT_MODE_LABELS[message.mode]}</em> : null}</span>
        <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
      </div>
      <div className="assistant-blocks">
        {message.blocks.map((block, index) => {
          if (block.kind === 'diagram') return (
            <DiagramCard
              key={block.artifact.id}
              artifact={block.artifact}
              active={activeDiagramId === block.artifact.id}
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
          <span>Nothing runs until you approve. Executing resumes this same session in Agent mode.</span>
          <button type="button" disabled={running} onClick={() => onExecutePlan(message.authorId)}>Execute plan</button>
        </div>
      )}
    </article>
  );
}
