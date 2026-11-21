'use client';

import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { DraftSource } from './draftLifecycle';
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
import type { DevicePreferences } from '@/features/shell/devicePreferences';
import { nativeClaudeIsolationIssue } from '@/shared/globalInstructions';
import { TurnCheckpoint } from './TurnCheckpoint';
import type { TurnCheckpointControls } from './useTurnCheckpoint';
import type { TurnRecord } from '@/shared/turnActivity';
import { ApprovalArea, type PermissionFeedback } from './ApprovalArea';
import { TurnActivity, StreamingMarkdown } from './TurnActivity';
import { ShellIcon } from '@/features/shell/ShellIcon';
import { conversationNavigation } from './messageNavigation';
import { MessageNavigation } from './MessageNavigation';
import { SessionArchiveSettings } from './SessionArchiveSettings';

const STARTER_PROMPTS = [
  { label: 'Explore the project', detail: 'Understand the code and how it fits together', icon: 'code', text: 'Explain the architecture of this project and the main parts of the code.' },
  { label: 'Review changes', detail: 'Take a closer look at the working tree', icon: 'changes', text: 'Review the working changes in this project for bugs and regressions.' },
  { label: 'Plan a change', detail: 'Work through an idea before building', icon: 'plan', text: 'Help me plan a change to this project. Start by asking what I want to achieve.' },
] as const;

function ConversationStarters({ draft, onChoose }: { draft: DraftSource; onChoose(label: string, text: string): void }) {
  const text = useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getSnapshot);
  return <div className="conversation-starters">
    {STARTER_PROMPTS.map(prompt => <Button key={prompt.label} color="inherit" className="conversation-starter"
      sx={{ justifyContent: 'flex-start', gap: 1.5, px: 1.75, py: 1.5 }}
      disabled={Boolean(text.trim())} aria-label={prompt.label}
      onClick={() => { if (!draft.getSnapshot().trim()) onChoose(prompt.label, prompt.text); }}>
      <ShellIcon name={prompt.icon} />
      <span className="conversation-starter-copy"><strong>{prompt.label}</strong><small>{prompt.detail}</small></span>
      <ShellIcon name="arrowUpRight" />
    </Button>)}
  </div>;
}

export function ConversationDrawer({
  open, visible = open, session, onLoadEarlier, onLoadMessage, theme, focusRequest, onFocusRequestHandled, agents, activeAgent, healthyProviders, participantBusy, preview, toolActivity, permissions, decidingPermission, running, cancelReady, sendBlocked,
  turn, liveMessageId, liveState, permissionFeedback, onRefreshPermissions, retryBlocked,
  status, composer, mode, unsupportedModes, modelChoices, modelSelection, attached, reports, images, files, onRemoveFile, markCounts, onSelectDiagram, onRetry,
  agentChoice, onAgentChoiceChange, onComposer, onModeChange, onModelSelectionChange, onSelectAgent, onMakePrimary, onAddAgent, onHandoff, onSend, onCancel, onRemoveAttachment, onRemoveReport,
  onAddImages, onRemoveImage, onOpenImage, onDecidePermission, onExecutePlan, onEditQueuedMessage,
  onArchiveAllowedChange,
  continuing, continuationUnavailable, instructions, repositoryContext, securityLevel, recovery, onContinue, onNewChat, onArchive, archiveDisabledReason, onToggleAttachment, onOpenHistory, onNewSketch, onOpenReports, paneControl,
}: {
  open: boolean;
  visible?: boolean;
  paneControl?: ReactNode;
  turn?: TurnRecord;
  liveMessageId?: string;
  onEditQueuedMessage?(messageId: string, text: string, expectedText: string): Promise<void>;
  retryBlocked?: boolean;
  liveState?: 'queued' | 'running' | 'needs-you';
  permissionFeedback?: Record<string, PermissionFeedback>;
  onRefreshPermissions?(): void;
  session?: SessionSnapshot;
  onLoadEarlier?(): Promise<void>;
  onLoadMessage?(messageId: string, signal: AbortSignal): Promise<void>;
  theme: ThemeName;
  focusRequest?: string;
  onFocusRequestHandled?(): void;
  agents: AgentParticipant[];
  activeAgent?: AgentParticipant;
  healthyProviders: AgentProvider[];
  participantBusy: boolean;
  agentChoice: Pick<DevicePreferences, 'provider' | 'role'>;
  onAgentChoiceChange(change: Pick<DevicePreferences, 'provider' | 'role'>): void;
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
  composer: DraftSource;
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
  onRetry(text: string, participantId: string, mode: AgentMode, reportIds: string[], imageCount: number, files?: TextFile[], uncertain?: boolean, activeFile?: import('@/shared/activeFileContext').ActiveFileContext): void;
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
  onNewChat(): Promise<boolean> | void;
  onArchive(): Promise<boolean> | void;
  onArchiveAllowedChange(allowed: boolean): Promise<void>;
  archiveDisabledReason?: string;
  onToggleAttachment(id: string): void;
  onOpenHistory(): void;
  onNewSketch(): void;
  onOpenReports?(): void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prepend = useRef<{ key: string; height: number; top: number } | undefined>(undefined);
  const [historyLoad, setHistoryLoad] = useState<{ key: string; busy?: boolean; error?: string }>();
  const [messageLoads, setMessageLoads] = useState<Record<string, { busy?: boolean; error?: string }>>({});
  const messageRequests = useRef(new Map<string, AbortController>());
  const positions = useRef(new Map<string, { top: number; follow: boolean }>());
  const following = useRef(true);
  const navigationScrollTop = useRef<number | undefined>(undefined);
  const observedActivity = useRef(new Map<string, string>());
  const [hasNewActivity, setHasNewActivity] = useState(false);
  const [starterFocus, setStarterFocus] = useState<string>();
  const [reviewRequest, setReviewRequest] = useState<{ id: string; revision: number; scope: string }>();
  const key = `${session?.machineId || ''}:${session?.id || ''}`;
  useLayoutEffect(() => {
    const anchor = prepend.current;
    const scroll = scrollRef.current;
    if (!anchor || !scroll) return;
    if (anchor.key === key) {
      scroll.scrollTop = anchor.top + scroll.scrollHeight - anchor.height;
      navigationScrollTop.current = scroll.scrollTop;
      positions.current.set(key, { top: scroll.scrollTop, follow: false });
    }
    prepend.current = undefined;
  }, [key, session?.messages[0]?.id]);
  const loadEarlier = async () => {
    if (!onLoadEarlier || historyLoad?.key === key && historyLoad.busy) return;
    const scroll = scrollRef.current;
    if (scroll) prepend.current = { key, height: scroll.scrollHeight, top: scroll.scrollTop };
    following.current = false;
    setHistoryLoad({ key, busy: true });
    try { await onLoadEarlier(); setHistoryLoad({ key }); }
    catch (error) {
      prepend.current = undefined;
      setHistoryLoad({ key, error: error instanceof Error ? error.message : 'Could not load earlier messages.' });
    }
  };
  const loadMessage = useCallback(async (id: string) => {
    const loadKey = `${key}:${id}`;
    if (!onLoadMessage || messageRequests.current.has(loadKey)) return;
    const controller = new AbortController();
    messageRequests.current.set(loadKey, controller);
    setMessageLoads(current => ({ ...current, [loadKey]: { busy: true } }));
    let failure: string | undefined;
    try { await onLoadMessage(id, controller.signal); }
    catch (error) {
      if (!controller.signal.aborted) failure = error instanceof Error ? error.message : 'Could not load the saved message.';
    } finally {
      messageRequests.current.delete(loadKey);
      setMessageLoads(current => {
        const next = { ...current };
        if (failure) next[loadKey] = { error: failure };
        else delete next[loadKey];
        return next;
      });
    }
  }, [key, onLoadMessage]);
  useEffect(() => {
    const requests = messageRequests.current;
    return () => {
      for (const controller of requests.values()) controller.abort();
    };
  }, [key]);

  const deferredIds = session?.history?.deferredMessageIds;
  const inlineDeferredIds = session?.history?.inlineDeferredMessageIds ?? deferredIds;
  useEffect(() => {
    const root = scrollRef.current;
    if (!open || !visible || !root || !onLoadMessage || !inlineDeferredIds?.length
      || inlineDeferredIds.some(id => messageLoads[`${key}:${id}`]?.busy)) return;
    const candidates = Array.from(root.querySelectorAll<HTMLElement>('[data-deferred-message-id]')).reverse()
      .filter(element => !messageLoads[`${key}:${element.dataset.deferredMessageId}`]?.error);
    const observer = new IntersectionObserver(entries => {
      const intersecting = new Set(entries.filter(entry => entry.isIntersecting).map(entry => entry.target));
      const id = candidates.find(element => intersecting.has(element))?.dataset.deferredMessageId;
      if (!id) return;
      observer.disconnect();
      void loadMessage(id);
    }, { root });
    for (const element of candidates) observer.observe(element);
    return () => observer.disconnect();
  }, [inlineDeferredIds, key, loadMessage, messageLoads, onLoadMessage, open, session?.messages, turn?.sequence, visible]);
  const activitySignature = `${session?.messages.map(message => `${message.id}:${message.status}:${message.role === 'user' ? message.turn?.sequence || 0 : ''}`).join('|')}|${turn?.sequence || 0}|${preview.length}|${toolActivity.length}`;
  const jump = () => {
    navigationScrollTop.current = undefined;
    following.current = true;
    setHasNewActivity(false);
    const scroll = scrollRef.current;
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
    positions.current.set(key, { top: scroll?.scrollTop || 0, follow: true });
  };
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || !visible) return;
    const saved = positions.current.get(key);
    following.current = saved?.follow ?? true;
    const before = scroll.scrollTop;
    scroll.scrollTop = following.current ? scroll.scrollHeight : saved!.top;
    navigationScrollTop.current = scroll.scrollTop === before ? undefined : scroll.scrollTop;
    setHasNewActivity(false);
  }, [key, open, visible]);
  // Streaming re-renders the drawer many times a second; the canvases change only with the session.
  const canvases = useMemo(() => session ? recentCanvases(session, Date.now()) : [], [session]);
  useLayoutEffect(() => {
    if (!visible) return;
    const previous = observedActivity.current.get(key);
    observedActivity.current.set(key, activitySignature);
    if (following.current) { const scroll = scrollRef.current; if (scroll) scroll.scrollTop = scroll.scrollHeight; }
    else if (previous !== undefined && previous !== activitySignature) setHasNewActivity(true);
  }, [visible, key, activitySignature, deferredIds?.length]);
  if (!open) return null;
  const lastMessage = session?.messages[session.messages.length - 1];
  const hasAssistantActivity = turn?.entries.some(entry => entry.kind === 'assistant');
  const streamingText = hasAssistantActivity
    ? turn?.entries.some(entry => entry.kind === 'assistant' && !entry.complete && entry.text)
    : Boolean(preview);
  const waitingForActivity = running && !permissions.length && !streamingText
    && !turn?.entries.some(entry => entry.kind === 'tool' && entry.status === 'running');
  const recordFor = (message: NonNullable<typeof session>['messages'][number]) => {
    if (message.role !== 'user') return undefined;
    return displayedTurn(message.turn, turn?.userMessageId === message.id ? turn : undefined);
  };
  const canonicalIds = new Set(session?.messages.flatMap(message => recordFor(message)?.entries.flatMap(entry => entry.kind === 'assistant' && entry.canonicalMessageId ? [entry.canonicalMessageId] : []) || []));
  const navigate = (id: string) => {
    const scroll = scrollRef.current;
    const target = scroll && Array.from(scroll.querySelectorAll<HTMLElement>('[data-navigation-id]')).find(element => element.dataset.navigationId === id);
    if (!scroll || !target) return;
    following.current = false;
    target.focus({ preventScroll: true });
    const before = scroll.scrollTop;
    scroll.scrollTop += target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - scroll.clientTop - 8;
    navigationScrollTop.current = scroll.scrollTop === before ? undefined : scroll.scrollTop;
    positions.current.set(key, { top: scroll.scrollTop, follow: false });
  };
  const stops = conversationNavigation(session?.messages || [], turn);
  const navigation = new Map<string, ReactNode>();
  for (const [kind, ids] of [['user message', stops.users], ['response', stops.responses]] as const) {
    ids.forEach((id, index) => navigation.set(id, <MessageNavigation kind={kind} previous={ids[index - 1]} next={ids[index + 1]} onNavigate={navigate} />));
  }
  const renderMessage = (message: NonNullable<typeof session>['messages'][number]) => {
    const deferred = deferredIds?.includes(message.id);
    const load = messageLoads[`${key}:${message.id}`];
    return <div data-deferred-message-id={message.role === 'assistant' && inlineDeferredIds?.includes(message.id) ? message.id : undefined}>
      <ChatMessage
        message={message} theme={theme} participants={session!.participants} activeDiagramId={session?.activeDiagramId}
        navigation={navigation.get(`message:${message.id}`)}
        running={running} liveState={message.id === liveMessageId ? liveState || 'running' : undefined}
        onEditQueuedMessage={message.id === liveMessageId && message.role === 'user' && message.turn?.lifecycle === 'queued' && !deferred ? onEditQueuedMessage : undefined}
        executePlanBlocked={nativeClaudeIsolationIssue({ provider: agents.find(agent => agent.id === message.authorId)?.provider || 'claude', execution: session?.execution, level: securityLevel, mode: 'agent', choice: session?.instructions })}
        onSelectDiagram={onSelectDiagram}
        detailsDeferred={deferred}
        detailsLoading={load?.busy}
        onLoadDetails={deferred && onLoadMessage ? () => void loadMessage(message.id) : undefined}
        onRetry={retryBlocked || deferred ? undefined : onRetry}
        onExecutePlan={message.id === lastMessage?.id && !deferred ? onExecutePlan : undefined}
      />
      {deferred && load?.error && <div role="alert" style={{ padding: '0 12px 8px' }}>
        {load.error} <Button onClick={() => void loadMessage(message.id)}>Retry</Button>
      </div>}
    </div>;
  };
  return (
    <Paper component="aside" square variant="elevation" elevation={0} className="conversation-drawer" aria-label="Conversation">
      <header>
        <div>
          <strong>{session?.title || 'New session'}</strong>
          {repositoryContext && <p className="conversation-repository-context">{repositoryContext}</p>}
        </div>
        <div className="pane-header-actions">
          <IconButton
            type="button"
            className="drawer-session-action"
            aria-label="New chat"
            title={running ? 'Wait for this turn to finish.' : continuing ? 'Creating a session…'
              : participantBusy ? 'Wait for agent changes to finish.' : recovery?.busy ? 'Wait for Undo to finish.'
              : 'New chat with the same project and settings'}
            disabled={!session || !activeAgent || running || continuing || participantBusy || recovery?.busy}
            onClick={onNewChat}
          ><ShellIcon name="newChat" /></IconButton>
          <Tooltip title={archiveDisabledReason || (running ? 'Wait for this turn to finish.' : 'Archive session. You can undo or restore it later.')}>
            <span><IconButton type="button" className="drawer-session-action" aria-label="Archive session"
              disabled={!session || running || Boolean(archiveDisabledReason)} onClick={onArchive}
            ><ShellIcon name="archive" /></IconButton></span>
          </Tooltip>
          {paneControl}
        </div>
      </header>
      <div className={`conversation-scroll${!session?.messages.length ? ' is-empty' : ''}`} ref={scrollRef} onScroll={() => {
        const scroll = scrollRef.current;
        if (!scroll) return;
        // Preserve follow mode through programmatic message jumps and session restoration.
        if (scroll.scrollTop !== navigationScrollTop.current) following.current = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 40;
        navigationScrollTop.current = undefined;
        positions.current.set(key, { top: scroll.scrollTop, follow: following.current });
        if (following.current) setHasNewActivity(false);
      }} onClickCapture={event => {
        if ((event.target as HTMLElement).closest('.activity-tool button, .message-file button')) {
          following.current = false;
          positions.current.set(key, { top: scrollRef.current?.scrollTop || 0, follow: false });
        }
      }}>
        {session?.history?.before && onLoadEarlier && <div style={{ padding: '8px 12px' }}>
          <Button disabled={historyLoad?.key === key && historyLoad.busy} onClick={() => void loadEarlier()}>
            {historyLoad?.key === key && historyLoad.busy ? 'Loading earlier messages…' : historyLoad?.key === key && historyLoad.error ? 'Retry earlier messages' : 'Load earlier messages'}
          </Button>
          {historyLoad?.key === key && historyLoad.error && <p role="alert">{historyLoad.error}</p>}
        </div>}
        {session?.messages.map(message => {
          if (message.role === 'assistant' && canonicalIds.has(message.id)) return null;
          const record = recordFor(message);
          return <div key={message.id} data-message-id={message.id}
            data-deferred-message-id={message.role === 'user' && inlineDeferredIds?.includes(message.id) ? message.id : undefined}>
            {recovery?.checkpoint?.messageId === message.id && <TurnCheckpoint controls={recovery} />}
            {renderMessage(message)}

            {record && <TurnActivity turn={record} agentName={agents.find(agent => agent.id === record.participantId)?.displayName || 'Agent'}
              onLoadDetails={deferredIds?.includes(message.id) && onLoadMessage ? () => void loadMessage(message.id) : undefined}
              detailsLoading={messageLoads[`${key}:${message.id}`]?.busy}
              renderNavigation={id => navigation.get(id)}
              permissions={record.runId === turn?.runId ? permissions : []} onReview={id => setReviewRequest({ id, revision: Date.now(), scope: `${key}:${turn?.runId || ""}` })}
              renderFinal={id => { const final = session.messages.find(item => item.id === id); return final ? renderMessage(final) : null; }} />}
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
        {preview && !hasAssistantActivity && (
          <article className="chat-message assistant streaming">
            <div className="message-meta"><span>{activeAgent?.displayName || 'Agent'}</span><span>streaming</span></div>
            <StreamingMarkdown text={preview} />
          </article>
        )}
        {waitingForActivity && <div className="turn-progress">
          <Tooltip title={status || 'Working'}><CircularProgress size={12} color="inherit" aria-label={status || 'Working'} /></Tooltip>
          {liveState === 'queued' && <span>{status}</span>}
        </div>}
        {!session?.messages.length && <section className="conversation-welcome" aria-label="Get started">
          <div className="welcome-symbol" aria-hidden="true"><ShellIcon name="code" /></div>
          <h1>What would you like to build?</h1>
          <p>Bring a question, an idea, or a change to work through.</p>
          <ConversationStarters draft={composer} onChoose={(label, text) => {
            onComposer(text);
            setStarterFocus(`${key}:${label}`);
          }} />
        </section>}
      </div>
      <div className="drawer-composer">
        {hasNewActivity && <Button className="jump-latest" onClick={jump}>Jump to latest · New activity</Button>}
        <ApprovalArea key={`${key}:${turn?.runId || ""}`} requests={permissions} agents={agents} deciding={decidingPermission} feedback={permissionFeedback}
          reviewRequest={reviewRequest?.scope === `${key}:${turn?.runId || ""}` ? reviewRequest : undefined} onDecide={onDecidePermission} onStop={onCancel} onRefresh={onRefreshPermissions} />
        {!running && sendBlocked && <small className="composer-blocked" role="status">{sendBlocked}</small>}
        <InstructionComposer
          key={key}
          settingsControl={session && <SessionArchiveSettings key={key} session={session}
            onAllowedChange={onArchiveAllowedChange} />}
          onArchiveAllowedChange={session ? onArchiveAllowedChange : undefined}
          onNewChat={async () => (await onNewChat()) !== false}
          onArchive={async () => (await onArchive()) !== false}
          newChatDisabledReason={!activeAgent ? 'Choose an agent first.' : continuing ? 'Creating a session…'
            : participantBusy ? 'Wait for agent changes to finish.' : recovery?.busy ? 'Wait for Undo to finish.' : undefined}
          archiveDisabledReason={archiveDisabledReason}
          agentControl={<ParticipantControls
            choice={agentChoice}
            onChoiceChange={onAgentChoiceChange}
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
          />}
          execution={session?.execution}
          securityLevel={securityLevel}
          provider={activeAgent?.provider}
          isolated={session?.instructions === 'isolated'}
          instructions={instructions}
          draft={composer}
          running={running}
          cancelReady={cancelReady}
          sendBlocked={sendBlocked}
          autoFocus
          autoFocusRequest={focusRequest}
          focusRequest={starterFocus}
          onFocusRequestHandled={() => { setStarterFocus(undefined); onFocusRequestHandled?.(); }}
          attached={attached}
          reports={reports}
          images={images} files={files} onRemoveFile={onRemoveFile}
          activeDiagramId={session?.activeDiagramId}
          markCounts={markCounts}
          mode={mode}
          unsupportedModes={unsupportedModes}
          modelChoices={modelChoices}
          modelSelection={modelSelection}
          sendContext={JSON.stringify([activeAgent?.id, session?.annotations])}
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
