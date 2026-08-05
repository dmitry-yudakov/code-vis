'use client';

import { useEffect, useRef } from 'react';
import type { ChatThread } from '@/lib/shared/types';
import { ChatMessage } from './ChatMessage';

export function ConversationDrawer({
  open, thread, preview, onClose, onSelectDiagram, onRetry,
}: {
  open: boolean;
  thread?: ChatThread;
  preview: string;
  onClose(): void;
  onSelectDiagram(id: string): void;
  onRetry(text: string): void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) endRef.current?.scrollIntoView({ block: 'end' }); }, [open, preview, thread?.messages.length]);
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
        {preview && (
          <article className="chat-message assistant streaming">
            <div className="message-meta"><span>Cartograph</span><span>streaming</span></div>
            <p className="stream-preview">{preview}<span className="typing-cursor" /></p>
          </article>
        )}
        {!thread?.messages.length && <div className="drawer-empty">Your conversation history will stay here while you work on the canvas.</div>}
        <div ref={endRef} />
      </div>
    </aside>
  );
}
