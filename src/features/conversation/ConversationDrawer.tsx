'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { ThemeName } from '@/shared/design/tokens';
import type {
  AgentMode, AgentParticipant, AgentProvider, AgentRole, CanvasTarget, ModelChoices, ModelSelection, SessionSnapshot,
} from '@/shared/types';
import { toolActivityLabel, type PendingPermission, type ToolActivityEntry } from '@/features/agents/toolActivity';
import { ChatMessage } from './ChatMessage';
import { InstructionComposer, type PendingReportChip } from './InstructionComposer';
import { recentCanvases } from './recentCanvases';
import { PermissionCard } from '@/features/agents/PermissionCard';
import { ParticipantControls } from '@/features/agents/ParticipantControls';
import { AGENT_ROLE_LABELS, PROVIDER_LABELS } from '@/shared/participants';

export function ConversationDrawer({
  open, session, theme, agents, activeAgent, healthyProviders, participantBusy, preview, toolActivity, permissions, decidingPermission, running, cancelReady, turnBlocked,
  status, composer, mode, unsupportedModes, modelChoices, modelSelection, attached, reports, markCounts, onSelectDiagram, onRetry,
  onComposer, onModeChange, onModelSelectionChange, onSelectAgent, onMakePrimary, onAddAgent, onHandoff, onSend, onCancel, onRemoveAttachment, onRemoveReport, onDecidePermission, onExecutePlan,
  continuing, continuationUnavailable, onContinue, onToggleAttachment, onOpenHistory, onNewSketch, onOpenReports,
}: {
  open: boolean;
  session?: SessionSnapshot;
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
  cancelReady: boolean;
  continuing: boolean;
  continuationUnavailable?: string;
  turnBlocked?: boolean;
  status: string;
  composer: string;
  mode: AgentMode;
  unsupportedModes: AgentMode[];
  modelChoices?: ModelChoices;
  modelSelection: ModelSelection;
  attached: CanvasTarget[];
  reports: PendingReportChip[];
  markCounts: Record<string, number>;
  onSelectDiagram(id: string): void;
  onRetry(text: string, participantId: string, mode: AgentMode, reportIds: string[]): void;
  onComposer(value: string): void;
  onModeChange(mode: AgentMode): void;
  onModelSelectionChange(selection: ModelSelection): void;
  onSelectAgent(participantId: string): void;
  onMakePrimary(participantId: string): void;
  onAddAgent(provider: AgentProvider, role: AgentRole): void;
  onHandoff(participantId: string, text: string, mode: AgentMode): void;
  onSend(): void;
  onCancel(): void;
  onRemoveAttachment(id: string): void;
  onRemoveReport(id: string): void;
  onDecidePermission(requestId: string, decision: 'allow' | 'deny'): void;
  onExecutePlan(participantId: string): void;
  onContinue(): void;
  onToggleAttachment(id: string): void;
  onOpenHistory(): void;
  onNewSketch(): void;
  onOpenReports?(): void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  // Streaming re-renders the drawer many times a second; the canvases change only with the session.
  const canvases = useMemo(() => session ? recentCanvases(session, Date.now()) : [], [session]);
  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'end' });
  }, [open, preview, toolActivity.length, permissions.length, session?.messages.length]);
  if (!open) return null;
  const lastMessage = session?.messages[session.messages.length - 1];
  return (
    <aside className="conversation-drawer" aria-label="Conversation">
      <header>
        <div>
          <strong>{session?.title || 'New session'}</strong>
          {activeAgent && <span className={`provider-badge provider-${activeAgent.provider}`}>{PROVIDER_LABELS[activeAgent.provider]} · {AGENT_ROLE_LABELS[activeAgent.role]}</span>}
        </div>
      </header>
      <div className="conversation-scroll">
        {session?.messages.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
            theme={theme}
            participants={session.participants}
            activeDiagramId={session.activeDiagramId}
            running={running || Boolean(turnBlocked)}
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
        {!session?.messages.length && <div className="drawer-empty">Your conversation history will stay here while you work on the canvas.</div>}
        <div ref={endRef} />
      </div>
      <div className="drawer-composer">
        <ParticipantControls
          agents={agents}
          activeAgentId={activeAgent?.id}
          primaryAgentId={session?.primaryAgentId}
          providers={healthyProviders}
          disabled={running}
          busy={participantBusy}
          onSelect={onSelectAgent}
          onMakePrimary={onMakePrimary}
          onAdd={onAddAgent}
          onHandoff={onHandoff}
        />
        <div className={`inline-status ${running ? 'working' : ''}`} aria-live="polite"><span />{turnBlocked && !running ? 'Another session is running' : status || 'Ready for an instruction'}</div>
        <InstructionComposer
          execution={session?.execution}
          value={composer}
          running={running}
          cancelReady={cancelReady}
          turnBlocked={turnBlocked}
          autoFocus
          attached={attached}
          reports={reports}
          activeDiagramId={session?.activeDiagramId}
          markCounts={markCounts}
          mode={mode}
          unsupportedModes={unsupportedModes}
          modelChoices={modelChoices}
          modelSelection={modelSelection}
          theme={theme}
          recentCanvases={canvases}
          continuation={{ unavailable: continuationUnavailable, busy: continuing, onContinue }}
          onChange={onComposer}
          onModeChange={onModeChange}
          onModelSelectionChange={onModelSelectionChange}
          onSend={onSend}
          onCancel={onCancel}
          onRemoveAttachment={onRemoveAttachment}
          onRemoveReport={onRemoveReport}
          onToggleAttachment={onToggleAttachment}
          onOpenHistory={onOpenHistory}
          onNewSketch={onNewSketch}
          onOpenReports={onOpenReports}
        />
      </div>
    </aside>
  );
}
