'use client';

import { useEffect, useRef } from 'react';
import type { ThemeName } from '@/shared/design/tokens';
import type { AgentMode, AgentParticipant, AgentProvider, AgentRole, CanvasTarget, ChatThread } from '@/shared/types';
import { toolActivityLabel, type PendingPermission, type ToolActivityEntry } from '@/features/agents/toolActivity';
import { ChatMessage } from './ChatMessage';
import { InstructionComposer } from './InstructionComposer';
import { PermissionCard } from '@/features/agents/PermissionCard';
import { ParticipantControls } from '@/features/agents/ParticipantControls';
import { AGENT_ROLE_LABELS, PROVIDER_LABELS } from '@/shared/participants';

export function ConversationDrawer({
  open, thread, theme, agents, activeAgent, healthyProviders, participantBusy, preview, toolActivity, permissions, decidingPermission, running,
  status, composer, mode, unsupportedModes, attached, markCounts, onClose, onSelectDiagram, onRetry, onComposer, onModeChange,
  onSelectAgent, onMakePrimary, onAddAgent, onHandoff, onSend, onCancel, onRemoveAttachment, onDecidePermission, onExecutePlan,
}: {
  open: boolean;
  thread?: ChatThread;
  theme: ThemeName;
  agents: AgentParticipant[];
  activeAgent?: AgentParticipant;
  healthyProviders: AgentProvider[];
  participantBusy: boolean;
  preview: string;
  toolActivity: ToolActivityEntry[];
  permissions: PendingPermission[];
  decidingPermission?: string;
  running: boolean;
  status: string;
  composer: string;
  mode: AgentMode;
  unsupportedModes: AgentMode[];
  attached: CanvasTarget[];
  markCounts: Record<string, number>;
  onClose(): void;
  onSelectDiagram(id: string): void;
  onRetry(text: string, participantId: string, mode: AgentMode): void;
  onComposer(value: string): void;
  onModeChange(mode: AgentMode): void;
  onSelectAgent(participantId: string): void;
  onMakePrimary(participantId: string): void;
  onAddAgent(provider: AgentProvider, role: AgentRole): void;
  onHandoff(participantId: string, text: string, mode: AgentMode): void;
  onSend(): void;
  onCancel(): void;
  onRemoveAttachment(id: string): void;
  onDecidePermission(requestId: string, decision: 'allow' | 'deny'): void;
  onExecutePlan(participantId: string): void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'end' });
  }, [open, preview, toolActivity.length, permissions.length, thread?.messages.length]);
  if (!open) return null;
  const lastMessage = thread?.messages[thread.messages.length - 1];
  return (
    <aside className="conversation-drawer" aria-label="Conversation">
      <header>
        <div>
          <span className="eyebrow">Conversation</span>
          <strong>{thread?.title || 'New conversation'}</strong>
          {activeAgent && <span className={`provider-badge provider-${activeAgent.provider}`}>{PROVIDER_LABELS[activeAgent.provider]} · {AGENT_ROLE_LABELS[activeAgent.role]}</span>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close conversation">×</button>
      </header>
      <div className="conversation-scroll">
        {thread?.messages.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
            theme={theme}
            participants={thread.participants}
            activeDiagramId={thread.activeDiagramId}
            running={running}
            onSelectDiagram={onSelectDiagram}
            onRetry={onRetry}
            onExecutePlan={message.id === lastMessage?.id ? onExecutePlan : undefined}
          />
        ))}
        {running && toolActivity.length > 0 && (
          <div className="tool-timeline" aria-label="Agent tool activity">
            <span className="tool-timeline-title">Working in the repository</span>
            <ol>
              {toolActivity.map((entry, index) => (
                <li key={entry.key} className={`${index === toolActivity.length - 1 ? 'current' : ''} ${entry.denied ? 'denied' : ''}`.trim()}>
                  <span className="tool-timeline-dot" />
                  <span>{toolActivityLabel(entry)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {permissions.map((request) => (
          <PermissionCard
            key={request.requestId}
            request={request}
            participant={agents.find((agent) => agent.id === request.participantId)}
            busy={decidingPermission === request.requestId}
            onDecide={onDecidePermission}
          />
        ))}
        {preview && (
          <article className="chat-message assistant streaming">
            <div className="message-meta"><span>{activeAgent?.displayName || 'Agent'}</span><span>streaming</span></div>
            <p className="stream-preview">{preview}<span className="typing-cursor" /></p>
          </article>
        )}
        {!thread?.messages.length && <div className="drawer-empty">Your conversation history will stay here while you work on the canvas.</div>}
        <div ref={endRef} />
      </div>
      <div className="drawer-composer">
        <ParticipantControls
          agents={agents}
          activeAgentId={activeAgent?.id}
          primaryAgentId={thread?.primaryAgentId}
          providers={healthyProviders}
          disabled={running}
          busy={participantBusy}
          onSelect={onSelectAgent}
          onMakePrimary={onMakePrimary}
          onAdd={onAddAgent}
          onHandoff={onHandoff}
        />
        <div className={`inline-status ${running ? 'working' : ''}`} aria-live="polite"><span />{status || 'Ready for an instruction'}</div>
        <InstructionComposer
          value={composer}
          running={running}
          autoFocus
          attached={attached}
          activeDiagramId={thread?.activeDiagramId}
          markCounts={markCounts}
          mode={mode}
          unsupportedModes={unsupportedModes}
          onChange={onComposer}
          onModeChange={onModeChange}
          onSend={onSend}
          onCancel={onCancel}
          onRemoveAttachment={onRemoveAttachment}
        />
      </div>
    </aside>
  );
}
