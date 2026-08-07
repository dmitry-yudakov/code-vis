'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage as ChatMessageType, DiagramAttachmentRecord } from '@/lib/shared/types';
import { AGENT_MODE_LABELS } from '@/lib/client/toolActivity';
import { DiagramCard } from './DiagramCard';

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

export function ChatMessage({ message, activeDiagramId, running, onSelectDiagram, onRetry, onExecutePlan }: {
  message: ChatMessageType;
  activeDiagramId?: string;
  running?: boolean;
  onSelectDiagram(id: string): void;
  onRetry?(text: string): void;
  onExecutePlan?(): void;
}) {
  if (message.role === 'user') {
    return (
      <article className={`chat-message user ${message.status}`}>
        <div className="message-meta">
          <span>You{message.mode && message.mode !== 'ask' ? <em className={`mode-tag mode-${message.mode}`}>{AGENT_MODE_LABELS[message.mode]}</em> : null}</span>
          <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
        </div>
        <p>{message.text}</p>
        {message.diagramAttachments.length > 0 && <div className="message-attachments">{attachmentSummary(message.diagramAttachments)}</div>}
        {message.status !== 'sent' && (
          <div className="message-state">
            <span>{message.status}{message.delivery === 'possibly-sent' ? ' · delivery uncertain' : ''}</span>
            {onRetry && <button type="button" onClick={() => onRetry(message.text)}>Retry</button>}
          </div>
        )}
      </article>
    );
  }

  return (
    <article className={`chat-message assistant ${message.status}`}>
      <div className="message-meta">
        <span>Cartograph{message.mode && message.mode !== 'ask' ? <em className={`mode-tag mode-${message.mode}`}>{AGENT_MODE_LABELS[message.mode]}</em> : null}</span>
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
          <button type="button" disabled={running} onClick={onExecutePlan}>Execute plan</button>
        </div>
      )}
    </article>
  );
}
