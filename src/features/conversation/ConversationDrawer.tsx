'use client';

import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TextFile } from '@/shared/textFiles';
import type { ThemeName } from '@/shared/design/tokens';
import type {
  AgentMode, AgentParticipant, AgentProvider, AgentRole, CanvasTarget, InstructionsLine, ModelChoices, ModelSelection,
  SecurityLevel, SessionSnapshot,
} from '@/shared/types';
import { toolActivityLabel, type PendingPermission, type ToolActivityEntry } from '@/features/agents/toolActivity';
import { ChatMessage } from './ChatMessage';
import { InstructionComposer, type PendingReportChip } from './InstructionComposer';
import type { PendingImage } from './imageAttachments';
import { recentCanvases } from './recentCanvases';
import { displayedTurn } from './runPresentation';
import { ParticipantControls } from '@/features/agents/ParticipantControls';
import { nativeClaudeIsolationIssue } from '@/shared/globalInstructions';
import { TurnCheckpoint } from './TurnCheckpoint';
import type { TurnCheckpointControls } from './useTurnCheckpoint';
import type { TurnRecord } from '@/shared/turnActivity';
import { ApprovalArea, type PermissionFeedback } from './ApprovalArea';
import { TurnActivity, StreamingMarkdown } from './TurnActivity';
import { ShellIcon } from '@/features/shell/ShellIcon';

export function ConversationDrawer({
  open, session, theme, focusRequest, onFocusRequestHandled, agents, activeAgent, healthyProviders, participantBusy, preview, toolActivity, permissions, decidingPermission, running, cancelReady, sendBlocked,
  turn, liveMessageId, liveState, permissionFeedback, onRefreshPermissions, retryBlocked,
  status, composer, mode, unsupportedModes, modelChoices, modelSelection, attached, reports, images, files, onRemoveFile, markCounts, onSelectDiagram, onRetry,
  onComposer, onModeChange, onModelSelectionChange, onSelectAgent, onMakePrimary, onAddAgent, onHandoff, onSend, onCancel, onRemoveAttachment, onRemoveReport,
  onAddImages, onRemoveImage, onOpenImage, onDecidePermission, onExecutePlan,
  continuing, continuationUnavailable, instructions, repositoryContext, securityLevel, recovery, onContinue, onNewChat, onToggleAttachment, onOpenHistory, onNewSketch, onOpenReports,
}: {
  open: boolean;
  turn?: TurnRecord;
  liveMessageId?: string;
  retryBlocked?: boolean;
  liveState?: 'queued' | 'running' | 'needs-you';
  permissionFeedback?: Record<string, PermissionFeedback>;
  onRefreshPermissions?(): void;
  session?: SessionSnapshot;
  theme: ThemeName;
  focusRequest?: string;
  onFocusRequestHandled?(): void;
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
  /** Whether the addressed agent's next turn gets the user's global instructions. */
  instructions?: InstructionsLine;
  repositoryContext?: string;
  securityLevel?: SecurityLevel;
  recovery?: TurnCheckpointControls;
  sendBlocked?: string;
  status: string;
  composer: string;
  mode: AgentMode;
  unsupportedModes: AgentMode[];
  modelChoices?: ModelChoices;
  modelSelection: ModelSelection;
  attached: CanvasTarget[];
  reports: PendingReportChip[];
  images: PendingImage[];
  files?: TextFile[];
  onRemoveFile?(index: number): void;
  markCounts: Record<string, number>;
  onSelectDiagram(id: string): void;
  onRetry(text: string, participantId: string, mode: AgentMode, reportIds: string[], imageCount: number, files?: TextFile[], uncertain?: boolean): void;
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
  onAddImages(files: File[]): void;
  onRemoveImage(id: string): void;
  onOpenImage(id: string): void;
  onDecidePermission(requestId: string, decision: 'allow' | 'deny'): void;
  onExecutePlan(participantId: string): void;
  onContinue(): void;
  onNewChat(): void;
  onToggleAttachment(id: string): void;
  onOpenHistory(): void;
  onNewSketch(): void;
  onOpenReports?(): void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, { top: number; follow: boolean }>());
  const following = useRef(true);
  const observedActivity = useRef(new Map<string, string>());
  const [hasNewActivity, setHasNewActivity] = useState(false);
  const [reviewRequest, setReviewRequest] = useState<{ id: string; revision: number; scope: string }>();
  const key = `${session?.machineId || ''}:${session?.id || ''}`;
  const activitySignature = `${session?.messages.map(message => `${message.id}:${message.status}:${message.role === 'user' ? message.turn?.sequence || 0 : ''}`).join('|')}|${turn?.sequence || 0}|${preview.length}|${toolActivity.length}`;
  const jump = () => {
    following.current = true;
    setHasNewActivity(false);
    const scroll = scrollRef.current;
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
    positions.current.set(key, { top: scroll?.scrollTop || 0, follow: true });
  };
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || !open) return;
    const saved = positions.current.get(key);
    following.current = saved?.follow ?? true;
    scroll.scrollTop = following.current ? scroll.scrollHeight : saved!.top;
    setHasNewActivity(false);
  }, [key, open]);
  // Streaming re-renders the drawer many times a second; the canvases change only with the session.
  const canvases = useMemo(() => session ? recentCanvases(session, Date.now()) : [], [session]);
  useLayoutEffect(() => {
    if (!open) return;
    const previous = observedActivity.current.get(key);
    observedActivity.current.set(key, activitySignature);
    if (following.current) { const scroll = scrollRef.current; if (scroll) scroll.scrollTop = scroll.scrollHeight; }
    else if (previous !== undefined && previous !== activitySignature) setHasNewActivity(true);
  }, [open, key, activitySignature]);
  if (!open) return null;
  const lastMessage = session?.messages[session.messages.length - 1];
  const recordFor = (message: NonNullable<typeof session>['messages'][number]) => {
    if (message.role !== 'user') return undefined;
    return displayedTurn(message.turn, turn?.userMessageId === message.id ? turn : undefined);
  };
  const canonicalIds = new Set(session?.messages.flatMap(message => recordFor(message)?.entries.flatMap(entry => entry.kind === 'assistant' && entry.canonicalMessageId ? [entry.canonicalMessageId] : []) || []));
  const renderMessage = (message: NonNullable<typeof session>['messages'][number]) => <ChatMessage
    message={message} theme={theme} participants={session!.participants} activeDiagramId={session?.activeDiagramId}
    running={running} liveState={message.id === liveMessageId ? liveState || 'running' : undefined}
    executePlanBlocked={nativeClaudeIsolationIssue({ provider: agents.find(agent => agent.id === message.authorId)?.provider || 'claude', execution: session?.execution, level: securityLevel, mode: 'agent', choice: session?.instructions })}
    onSelectDiagram={onSelectDiagram} onRetry={retryBlocked ? undefined : onRetry} onExecutePlan={message.id === lastMessage?.id ? onExecutePlan : undefined} />;
  return (
    <Paper component="aside" square variant="elevation" elevation={0} className="conversation-drawer" aria-label="Conversation">
      <header>
        <div>
          <strong>{session?.title || 'New session'}</strong>
          {repositoryContext && <p className="conversation-repository-context">{repositoryContext}</p>}
        </div>
        <Button
          type="button"
          className="drawer-new-chat"
          aria-label="New chat"
          title={running ? 'Wait for this turn to finish.' : continuing ? 'Creating a session…'
            : participantBusy ? 'Wait for agent changes to finish.' : recovery?.busy ? 'Wait for Undo to finish.'
            : 'New chat with the same project and settings'}
          disabled={!session || !activeAgent || running || continuing || participantBusy || recovery?.busy}
          onClick={onNewChat}
        ><ShellIcon name="newChat" /></Button>
      </header>
      <div className="conversation-scroll" ref={scrollRef} onScroll={() => {
        const scroll = scrollRef.current;
        if (!scroll) return;
        following.current = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 40;
        positions.current.set(key, { top: scroll.scrollTop, follow: following.current });
        if (following.current) setHasNewActivity(false);
      }} onClickCapture={event => {
        if ((event.target as HTMLElement).closest('.activity-tool button')) {
          following.current = false;
          positions.current.set(key, { top: scrollRef.current?.scrollTop || 0, follow: false });
        }
      }}>
        {session?.messages.map(message => {
          if (message.role === 'assistant' && canonicalIds.has(message.id)) return null;
          const record = recordFor(message);
          return <div key={message.id} data-message-id={message.id}>
            {renderMessage(message)}
            {record && <TurnActivity turn={record} agentName={agents.find(agent => agent.id === record.participantId)?.displayName || 'Agent'}
              permissions={record.runId === turn?.runId ? permissions : []} onReview={id => setReviewRequest({ id, revision: Date.now(), scope: `${key}:${turn?.runId || ""}` })}
              renderFinal={id => { const final = session.messages.find(item => item.id === id); return final ? renderMessage(final) : null; }} />}
            {recovery?.checkpoint?.messageId === message.id && <TurnCheckpoint controls={recovery} />}
          </div>;
        })}
        {recovery?.error && !recovery.checkpoint && <TurnCheckpoint controls={recovery} />}
        {running && !turn?.entries.some(entry => entry.kind === 'tool') && toolActivity.length > 0 && (
          <div className="tool-timeline" aria-label="Agent tool activity">
            <span className="tool-timeline-title">Summary only · tool details unavailable</span>
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
        {preview && !turn?.entries.some(entry => entry.kind === 'assistant') && (
          <article className="chat-message assistant streaming">
            <div className="message-meta"><span>{activeAgent?.displayName || 'Agent'}</span><span>streaming</span></div>
            <StreamingMarkdown text={preview} />
          </article>
        )}
        {!session?.messages.length && <div className="drawer-empty">Start a conversation about your project.</div>}
      </div>
      <div className="drawer-composer">
        {hasNewActivity && <Button className="jump-latest" onClick={jump}>Jump to latest · New activity</Button>}
        <ApprovalArea key={`${key}:${turn?.runId || ""}`} requests={permissions} agents={agents} deciding={decidingPermission} feedback={permissionFeedback}
          reviewRequest={reviewRequest?.scope === `${key}:${turn?.runId || ""}` ? reviewRequest : undefined} onDecide={onDecidePermission} onStop={onCancel} onRefresh={onRefreshPermissions} />
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
        <div className={`inline-status ${running ? 'working' : ''}`} aria-live="polite"><span />{!running && sendBlocked || status || 'Ready for an instruction'}</div>
        <InstructionComposer
          execution={session?.execution}
          securityLevel={securityLevel}
          provider={activeAgent?.provider}
          isolated={session?.instructions === 'isolated'}
          instructions={instructions}
          value={composer}
          running={running}
          cancelReady={cancelReady}
          sendBlocked={sendBlocked}
          autoFocus
          focusRequest={focusRequest}
          onFocusRequestHandled={onFocusRequestHandled}
          attached={attached}
          reports={reports}
          images={images} files={files} onRemoveFile={onRemoveFile}
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
          onSend={() => { jump(); onSend(); }}
          onCancel={onCancel}
          onRemoveAttachment={onRemoveAttachment}
          onRemoveReport={onRemoveReport}
          onAddImages={onAddImages}
          onRemoveImage={onRemoveImage}
          onOpenImage={onOpenImage}
          onToggleAttachment={onToggleAttachment}
          onOpenHistory={onOpenHistory}
          onNewSketch={onNewSketch}
          onOpenReports={onOpenReports}
        />
      </div>
    </Paper>
  );
}
