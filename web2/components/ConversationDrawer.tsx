'use client';

import { useEffect, useRef } from 'react';
import type { ChatThread, DiagramArtifact } from '@/lib/shared/types';
import { toolActivityLabel, type ToolActivityEntry } from '@/lib/client/toolActivity';
import { ChatMessage } from './ChatMessage';
import { InstructionComposer } from './InstructionComposer';

export function ConversationDrawer({
  open, thread, preview, toolActivity, running, status, composer, attached, markCounts,
  onClose, onSelectDiagram, onRetry, onComposer, onSend, onCancel, onRemoveAttachment,
}: {
  open: boolean;
  thread?: ChatThread;
  preview: string;
  toolActivity: ToolActivityEntry[];
  running: boolean;
  status: string;
  composer: string;
  attached: DiagramArtifact[];
  markCounts: Record<string, number>;
  onClose(): void;
  onSelectDiagram(id: string): void;
  onRetry(text: string): void;
  onComposer(value: string): void;
  onSend(): void;
  onCancel(): void;
  onRemoveAttachment(id: string): void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) endRef.current?.scrollIntoView({ block: 'end' }); }, [open, preview, toolActivity.length, thread?.messages.length]);
  if (!open) return null;
  return (
    <aside className="conversation-drawer" aria-label="Conversation">
      <header>
        <div><span className="eyebrow">Conversation</span><strong>{thread?.title || 'New conversation'}</strong></div>
        <button type="button" onClick={onClose} aria-label="Close conversation">×</button>
      </header>
      <div className="conversation-scroll">
        {thread?.messages.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
            activeDiagramId={thread.activeDiagramId}
            onSelectDiagram={onSelectDiagram}
            onRetry={onRetry}
          />
        ))}
        {running && toolActivity.length > 0 && (
          <div className="tool-timeline" aria-label="Agent tool activity">
            <span className="tool-timeline-title">Exploring the repository</span>
            <ol>
              {toolActivity.map((entry, index) => (
                <li key={entry.key} className={index === toolActivity.length - 1 ? 'current' : ''}>
                  <span className="tool-timeline-dot" />
                  <span>{toolActivityLabel(entry)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {preview && (
          <article className="chat-message assistant streaming">
            <div className="message-meta"><span>Cartograph</span><span>streaming</span></div>
            <p className="stream-preview">{preview}<span className="typing-cursor" /></p>
          </article>
        )}
        {!thread?.messages.length && <div className="drawer-empty">Your conversation history will stay here while you work on the canvas.</div>}
        <div ref={endRef} />
      </div>
      <div className="drawer-composer">
        <div className={`inline-status ${running ? 'working' : ''}`} aria-live="polite"><span />{status || 'Ready for an instruction'}</div>
        <InstructionComposer
          value={composer}
          running={running}
          autoFocus
          attached={attached}
          activeDiagramId={thread?.activeDiagramId}
          markCounts={markCounts}
          onChange={onComposer}
          onSend={onSend}
          onCancel={onCancel}
          onRemoveAttachment={onRemoveAttachment}
        />
      </div>
    </aside>
  );
}
