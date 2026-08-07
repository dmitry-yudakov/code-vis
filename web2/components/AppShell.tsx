'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentEvent, AgentMode, AssistantMessage, ChatThread, DiagramArtifact, DiagramMessageAttachment, DrawingMark,
  ProjectSummary, UserMessage,
} from '@/lib/shared/types';
import { readNdjson } from '@/lib/client/ndjson';
import {
  MAX_TOOL_ACTIVITY_ENTRIES, permissionLabel, toolActivityLabel,
  type PendingPermission, type ToolActivityEntry,
} from '@/lib/client/toolActivity';
import { EXECUTE_PLAN_INSTRUCTION } from '@/lib/shared/plan';
import { compositePng } from '@/lib/client/compositeExport';
import { createUuid } from '@/lib/client/uuid';
import {
  exportThread, getArtifacts, loadProjectThreads, loadSelectedProjectId, saveProjectThreads, saveSelectedProjectId,
} from '@/lib/client/conversationStore';
import { ProjectPicker } from './ProjectPicker';
import { ThreadPicker } from './ThreadPicker';
import { ConversationDrawer } from './ConversationDrawer';
import { DiagramNavigator } from './DiagramNavigator';
import { CanvasWorkspace, type CanvasSnapshot } from './CanvasWorkspace';

interface Health {
  ok: boolean;
  projectsRootReady: boolean;
  dataDirectoryReady: boolean;
  claudeBinaryReady: boolean;
  claudeFlagsReady: boolean;
  unsupportedModes?: AgentMode[];
  message?: string;
}

function newLocalThread(server: { id: string; projectId: string; createdAt: string }, index: number): ChatThread {
  return {
    version: 1,
    id: server.id,
    projectId: server.projectId,
    title: `Conversation ${index + 1}`,
    createdAt: server.createdAt,
    updatedAt: server.createdAt,
    messages: [],
    pinnedDiagramIds: [],
    annotations: {},
  };
}

function updateArtifact(thread: ChatThread, id: string, update: (artifact: DiagramArtifact) => DiagramArtifact): ChatThread {
  return {
    ...thread,
    messages: thread.messages.map((message) => message.role === 'assistant' ? {
      ...message,
      blocks: message.blocks.map((block) => block.kind === 'diagram' && block.artifact.id === id
        ? { ...block, artifact: update(block.artifact) }
        : block),
    } : message),
  };
}

export function AppShell() {
  const [health, setHealth] = useState<Health>();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectDiscoveryDepth, setProjectDiscoveryDepth] = useState(1);
  const [projectId, setProjectId] = useState('');
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadId, setThreadId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Ready for an instruction');
  const [composer, setComposer] = useState('');
  const [preview, setPreview] = useState('');
  const [toolActivity, setToolActivity] = useState<ToolActivityEntry[]>([]);
  const [permissions, setPermissions] = useState<PendingPermission[]>([]);
  const [decidingPermission, setDecidingPermission] = useState<string>();
  const [chatOpen, setChatOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [pendingAttachmentIds, setPendingAttachmentIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<string>();
  const [missingSession, setMissingSession] = useState(false);
  /** Set when a turn stopped on its turn budget: the session survives, so it can be resumed. */
  const [continueMode, setContinueMode] = useState<AgentMode>();
  const abortRef = useRef<AbortController | undefined>(undefined);
  const runIdRef = useRef<string | undefined>(undefined);
  const snapshotRef = useRef<CanvasSnapshot | undefined>(undefined);
  const navigationRevision = useRef(0);
  const hydratedProject = useRef<string | undefined>(undefined);
  const chatOpenRef = useRef(chatOpen);
  chatOpenRef.current = chatOpen;
  const runningRef = useRef(running);
  runningRef.current = running;

  const thread = useMemo(() => threads.find((item) => item.id === threadId), [threads, threadId]);
  const unsupportedModes = useMemo(() => health?.unsupportedModes || [], [health]);
  // A mode the installed CLI cannot run falls back to Ask rather than failing at send time.
  const storedMode = thread?.defaultMode || 'ask';
  const mode: AgentMode = unsupportedModes.includes(storedMode) ? 'ask' : storedMode;
  const attachedArtifacts = useMemo(() => {
    if (!thread) return [];
    const artifacts = getArtifacts(thread);
    return pendingAttachmentIds.flatMap((id) => {
      const artifact = artifacts.find((item) => item.id === id);
      return artifact ? [artifact] : [];
    });
  }, [thread, pendingAttachmentIds]);

  useEffect(() => {
    let current = true;
    void Promise.all([
      fetch('/api/health', { cache: 'no-store' }).then((response) => response.json() as Promise<Health>),
      fetch('/api/projects', { cache: 'no-store' }).then(async (response) => {
        const data = await response.json() as { projects?: ProjectSummary[]; discoveryDepth?: number; error?: string };
        if (!response.ok) throw new Error(data.error || 'Could not load projects.');
        return { projects: data.projects || [], discoveryDepth: data.discoveryDepth || 1 };
      }),
    ]).then(([healthResult, projectResult]) => {
      if (!current) return;
      setHealth(healthResult);
      setProjects(projectResult.projects);
      setProjectDiscoveryDepth(projectResult.discoveryDepth);
      if (projectResult.projects.length) {
        let savedProjectId: string | undefined;
        try { savedProjectId = loadSelectedProjectId(); } catch { /* Fall back to the first available project. */ }
        const selected = projectResult.projects.some((project) => project.id === savedProjectId)
          ? savedProjectId!
          : projectResult.projects[0].id;
        setProjectId(selected);
      }
    }).catch((error: unknown) => {
      if (current) setNotice(error instanceof Error ? error.message : 'Could not start Cartograph.');
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (!projectId) return;
    try {
      const saved = loadProjectThreads(projectId);
      setThreads(saved);
      setThreadId(saved[0]?.id);
      hydratedProject.current = projectId;
      setNotice(undefined);
    } catch (error) {
      setThreads([]);
      setThreadId(undefined);
      hydratedProject.current = projectId;
      setNotice(error instanceof Error ? error.message : 'Saved conversations could not be restored.');
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId || hydratedProject.current !== projectId) return;
    try {
      saveProjectThreads(projectId, threads);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Conversation persistence failed.');
    }
  }, [projectId, threads]);

  useEffect(() => {
    const active = thread?.activeDiagramId;
    setPendingAttachmentIds(active ? [active] : []);
    snapshotRef.current = undefined;
  }, [threadId, thread?.activeDiagramId]);

  const mutateThread = useCallback((id: string, operation: (value: ChatThread) => ChatThread) => {
    setThreads((current) => current.map((item) => item.id === id
      ? { ...operation(item), updatedAt: new Date().toISOString() }
      : item));
  }, []);

  const createThread = useCallback(async () => {
    if (!projectId || running) return;
    setNotice(undefined);
    try {
      const response = await fetch('/api/threads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId }),
      });
      const data = await response.json() as { thread?: { id: string; projectId: string; createdAt: string }; error?: string };
      if (!response.ok || !data.thread) throw new Error(data.error || 'Could not create a conversation.');
      const created = newLocalThread(data.thread, threads.length);
      setThreads((current) => [created, ...current]);
      setThreadId(created.id);
      setChatOpen(true);
      setMissingSession(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not create a conversation.');
    }
  }, [projectId, running, threads.length]);

  const switchProject = (next: string) => {
    if (next === projectId) return;
    if (running) abortRef.current?.abort();
    try { saveSelectedProjectId(next); } catch { /* Project switching still works without preference persistence. */ }
    setProjectId(next);
    setThreads([]);
    setThreadId(undefined);
    setUnread(0);
    setChatOpen(false);
    setHistoryOpen(false);
  };

  const selectDiagram = useCallback((id: string) => {
    if (!threadId) return;
    navigationRevision.current += 1;
    mutateThread(threadId, (current) => ({ ...current, activeDiagramId: id }));
    setPendingAttachmentIds([id]);
  }, [mutateThread, threadId]);

  const removeAttachment = (id: string) => setPendingAttachmentIds((current) => current.filter((item) => item !== id));
  const toggleAttachment = (id: string) => setPendingAttachmentIds((current) => current.includes(id)
    ? current.filter((item) => item !== id)
    : current.length < 4 ? [...current, id] : current);

  const handleMarksChange = useCallback((diagramId: string, marks: DrawingMark[]) => {
    if (!threadId) return;
    mutateThread(threadId, (current) => ({
      ...current,
      annotations: {
        ...current.annotations,
        [diagramId]: { version: 1, diagramId, marks, updatedAt: new Date().toISOString() },
      },
    }));
  }, [mutateThread, threadId]);

  const handleArtifactError = useCallback((diagramId: string, artifactStatus: 'parse-error' | 'render-error', error: string) => {
    if (!threadId) return;
    mutateThread(threadId, (current) => updateArtifact(current, diagramId, (artifact) => ({ ...artifact, status: artifactStatus, error })));
  }, [mutateThread, threadId]);

  const handleSnapshot = useCallback((value?: CanvasSnapshot) => {
    snapshotRef.current = value;
  }, []);

  const setMode = useCallback((next: AgentMode) => {
    if (!threadId) return;
    mutateThread(threadId, (current) => ({ ...current, defaultMode: next }));
  }, [mutateThread, threadId]);

  const decidePermission = useCallback(async (requestId: string, decision: 'allow' | 'deny') => {
    const runId = runIdRef.current;
    if (!runId) return;
    setDecidingPermission(requestId);
    try {
      const response = await fetch('/api/agent/permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, requestId, decision }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        setPermissions((current) => current.filter((item) => item.requestId !== requestId));
        setNotice(data.error || 'That approval could not be delivered.');
      }
    } catch {
      setNotice('That approval could not be delivered.');
    } finally {
      setDecidingPermission(undefined);
    }
  }, []);

  /**
   * Drives the UI from one run's event stream. Shared by sending a message and by reattaching to a
   * run already in flight, so a reloaded page recovers the live turn instead of losing it.
   */
  const consumeStream = useCallback(async (response: Response, turn: {
    threadId: string;
    mode: AgentMode;
    userMessageId?: string;
    activeAtSend?: string;
    navigationAtSend?: number;
    attachmentIds?: string[];
  }) => {
    let receivedFinal = false;
    let streamError: Extract<AgentEvent, { type: 'error' }> | undefined;
    let userMessageId = turn.userMessageId;
    for await (const event of readNdjson<AgentEvent>(response)) {
      if (event.type === 'run-started') {
        runIdRef.current = event.runId;
        userMessageId ||= event.messageId;
      }
      if (event.type === 'status') setStatus(event.label);
      if (event.type === 'tool-activity') {
        const entry = { tool: event.tool, detail: event.detail, denied: event.denied };
        setStatus(toolActivityLabel(entry));
        setToolActivity((current) => [...current, { ...entry, key: current.length }].slice(-MAX_TOOL_ACTIVITY_ENTRIES));
      }
      if (event.type === 'permission-request') {
        const request: PendingPermission = { requestId: event.requestId, tool: event.tool, detail: event.detail };
        setPermissions((current) => current.some((item) => item.requestId === request.requestId) ? current : [...current, request]);
        setStatus(`Waiting for your approval — ${permissionLabel(request)}`);
        if (!chatOpenRef.current) setUnread((value) => value + 1);
      }
      if (event.type === 'permission-resolved') {
        setPermissions((current) => current.filter((item) => item.requestId !== event.requestId));
        if (event.decision === 'timeout') setNotice('An approval request expired and was denied automatically.');
      }
      if (event.type === 'assistant-delta') setPreview((current) => current + event.delta);
      if (event.type === 'error') {
        streamError = event;
        setNotice(event.message);
        if (event.code === 'missing-session') setMissingSession(true);
        if (event.code === 'max-turns') setContinueMode(turn.mode);
        mutateThread(turn.threadId, (current) => ({ ...current, messages: current.messages.map((message) => message.id === userMessageId && message.role === 'user'
          ? { ...message, status: event.code === 'cancelled' ? 'cancelled' : 'failed', delivery: event.delivery }
          : message) }));
      }
      if (event.type === 'assistant-message') {
        receivedFinal = true;
        const assistant = event.message as AssistantMessage;
        const ready = assistant.blocks.flatMap((block) => block.kind === 'diagram' && block.artifact.status === 'ready' ? [block.artifact] : []);
        mutateThread(turn.threadId, (current) => {
          if (current.messages.some((message) => message.id === assistant.id)) return current;
          let activeDiagramId = current.activeDiagramId;
          let previousDiagramId = current.previousDiagramId;
          if (!activeDiagramId && ready[0]) activeDiagramId = ready[0].id;
          else if (
            ready.length === 1
            && turn.activeAtSend
            && turn.attachmentIds?.includes(turn.activeAtSend)
            && current.activeDiagramId === turn.activeAtSend
            && navigationRevision.current === turn.navigationAtSend
          ) {
            previousDiagramId = turn.activeAtSend;
            activeDiagramId = ready[0].id;
          }
          return {
            ...current,
            activeDiagramId,
            previousDiagramId,
            messages: [
              ...current.messages.map((message) => message.id === userMessageId && message.role === 'user' ? { ...message, status: 'sent' as const } : message),
              assistant,
            ],
          };
        });
        if (!chatOpenRef.current) setUnread((value) => value + 1);
        if (ready.length > 1) setNotice(`${ready.length} diagram results are ready in history. The active canvas was preserved.`);
        setPreview('');
      }
    }
    return { receivedFinal, streamError, userMessageId };
  }, [mutateThread]);

  const send = useCallback(async (override?: { text: string; mode: AgentMode }) => {
    if (!thread || running) return;
    const text = (override?.text ?? composer).trim();
    if (!text) return;
    const turnMode: AgentMode = override?.mode ?? mode;
    setNotice(undefined);
    setMissingSession(false);
    setContinueMode(undefined);
    const artifacts = getArtifacts(thread);
    const selected = pendingAttachmentIds.flatMap((id) => {
      const artifact = artifacts.find((item) => item.id === id);
      return artifact ? [artifact] : [];
    });
    const attachmentPayload: DiagramMessageAttachment[] = [];
    let compositeWarning = false;
    for (const artifact of selected) {
      const marks = thread.annotations[artifact.id]?.marks || [];
      const snapshot = artifact.id === thread.activeDiagramId ? snapshotRef.current : undefined;
      let png: string | undefined;
      if (snapshot) {
        try { png = await compositePng(snapshot.svg, marks, snapshot.viewBox); } catch { compositeWarning = true; }
      }
      attachmentPayload.push({
        diagramId: artifact.id,
        source: artifact.source,
        marks,
        viewport: { viewBox: snapshot?.viewBox || [0, 0, 1, 1] },
        compositePngDataUrl: png,
      });
    }
    if (compositeWarning) setNotice('Composite image export was unavailable; Mermaid source and vector marks are still attached.');

    const userId = createUuid();
    const createdAt = new Date().toISOString();
    const userMessage: UserMessage = {
      id: userId,
      role: 'user',
      text,
      createdAt,
      status: 'sending',
      diagramAttachments: attachmentPayload.map((item) => ({
        diagramId: item.diagramId,
        marksSnapshot: structuredClone(item.marks),
        viewport: item.viewport,
        compositeIncluded: Boolean(item.compositePngDataUrl),
      })),
      mode: turnMode,
    };
    const activeAtSend = thread.activeDiagramId;
    const navigationAtSend = navigationRevision.current;
    mutateThread(thread.id, (current) => ({
      ...current,
      title: current.messages.length === 0 ? text.slice(0, 56) : current.title,
      messages: [...current.messages, userMessage],
    }));
    if (!override) setComposer('');
    setPreview('');
    setToolActivity([]);
    setPermissions([]);
    setRunning(true);
    setStatus(turnMode === 'agent' ? 'Starting agent' : 'Starting read-only agent');
    const controller = new AbortController();
    abortRef.current = controller;
    let streamError: Extract<AgentEvent, { type: 'error' }> | undefined;

    try {
      const response = await fetch('/api/agent/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: thread.projectId, threadId: thread.id, messageId: userId, text, diagramAttachments: attachmentPayload, mode: turnMode }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || `Agent request failed (${response.status}).`);
      }
      const outcome = await consumeStream(response, {
        threadId: thread.id,
        mode: turnMode,
        userMessageId: userId,
        activeAtSend,
        navigationAtSend,
        attachmentIds: pendingAttachmentIds,
      });
      streamError = outcome.streamError;
      if (!outcome.receivedFinal && !streamError) throw new Error('Agent stream ended without a final response.');
    } catch (error) {
      const cancelled = controller.signal.aborted;
      if (!streamError) {
        setNotice(cancelled ? 'The request was cancelled. Earlier conversation and diagrams are unchanged.' : error instanceof Error ? error.message : 'Agent request failed.');
        mutateThread(thread.id, (current) => ({ ...current, messages: current.messages.map((message) => message.id === userId && message.role === 'user'
          ? { ...message, status: cancelled ? 'cancelled' : 'failed', delivery: cancelled ? 'possibly-sent' : 'not-sent' }
          : message) }));
      }
    } finally {
      abortRef.current = undefined;
      runIdRef.current = undefined;
      setRunning(false);
      setPreview('');
      setToolActivity([]);
      setPermissions([]);
      setDecidingPermission(undefined);
      setStatus('Ready for an instruction');
    }
  }, [composer, consumeStream, mode, mutateThread, pendingAttachmentIds, running, thread]);

  /** Cancelling is explicit now: a closed tab detaches, only this stops the run. */
  const cancelRun = useCallback(async () => {
    const runId = runIdRef.current;
    if (!runId) {
      abortRef.current?.abort();
      return;
    }
    try {
      const response = await fetch('/api/agent/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId }),
      });
      // The server answers with a cancelled error and `done`; falling back keeps the UI unstuck.
      if (!response.ok) abortRef.current?.abort();
    } catch {
      abortRef.current?.abort();
    }
  }, []);

  // Recover a turn that outlived the page: a reload, a crash, or a dev-server refresh mid-run.
  useEffect(() => {
    if (!threadId || runningRef.current) return;
    const controller = new AbortController();
    let owned = false;
    void (async () => {
      let response: Response;
      try {
        response = await fetch(`/api/agent/stream?threadId=${encodeURIComponent(threadId)}`, { signal: controller.signal });
      } catch {
        return;
      }
      if (!response.ok || controller.signal.aborted || runningRef.current) return;
      owned = true;
      setRunning(true);
      setNotice('Reconnected to the turn that was still running.');
      try {
        await consumeStream(response, { threadId, mode: 'agent' });
      } catch {
        if (!controller.signal.aborted) setNotice('Lost the connection to the running turn.');
      } finally {
        if (!controller.signal.aborted) {
          runIdRef.current = undefined;
          setRunning(false);
          setPreview('');
          setToolActivity([]);
          setPermissions([]);
          setStatus('Ready for an instruction');
        }
      }
    })();
    return () => { controller.abort(); if (owned) setRunning(false); };
  }, [consumeStream, threadId]);

  const executePlan = useCallback(() => {
    if (unsupportedModes.includes('agent')) {
      setNotice('Agent mode needs a newer Claude Code. Run `claude update`, then execute the plan.');
      return;
    }
    void send({ text: EXECUTE_PLAN_INSTRUCTION, mode: 'agent' });
  }, [send, unsupportedModes]);

  if (loading) return <div className="app-loading"><div className="brand-mark">C</div><p>Opening your code canvas…</p></div>;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand"><span className="brand-mark">C</span><span><strong>Cartograph</strong><small>conversational code canvas</small></span></div>
        <div className="header-pickers">
          <ProjectPicker projects={projects} value={projectId} discoveryDepth={projectDiscoveryDepth} disabled={running} onChange={switchProject} />
          <ThreadPicker threads={threads} value={threadId} disabled={running || !projectId} onChange={setThreadId} onNew={() => void createThread()} />
        </div>
        <div className="header-actions">
          <span className={`health-pill ${health?.ok ? 'ready' : 'warning'}`} title={health?.message || 'Local readiness'}><span />{health?.ok ? 'Agent ready' : 'Setup needed'}</span>
          {thread && <button type="button" onClick={() => exportThread(thread)}>Export</button>}
        </div>
      </header>

      {notice && (
        <div className="notice-banner" role="status">
          <span>{notice}</span>
          {missingSession && <button type="button" onClick={() => { void createThread(); setComposer(`Continue this conversation in a new agent session. Here is a brief visible recap:\n\n${thread?.messages.slice(-6).map((message) => `${message.role}: ${message.role === 'user' ? message.text : message.rawMarkdown.slice(0, 600)}`).join('\n\n') || ''}`); }}>Continue in new session</button>}
          {continueMode && !running && <button type="button" onClick={() => void send({ text: 'Continue where you stopped.', mode: continueMode })}>Continue</button>}
          <button type="button" aria-label="Dismiss notice" onClick={() => setNotice(undefined)}>×</button>
        </div>
      )}

      {!projects.length ? (
        <div className="fatal-empty"><span className="eyebrow">No projects found</span><h1>Point Cartograph at a project.</h1><p>Set <code>CODEAI_WEB2_PROJECTS_ROOT</code> to one project or a directory containing projects, then restart the app.</p></div>
      ) : !thread ? (
        <div className="welcome-screen">
          <div className="welcome-orbit"><span /><span /><span /><div className="brand-mark">C</div></div>
          <span className="eyebrow">Local exploration, planning, and building</span>
          <h1>Your repository,<br />as a living map.</h1>
          <p>Start a persistent conversation. Ask questions, build a diagram, draw directly on it, and use those marks in your next instruction. Switch to Plan for an approvable plan, or Agent to build behind explicit approvals.</p>
          <button type="button" className="primary-cta" onClick={() => void createThread()}>New conversation <span>→</span></button>
          <small>Claude Code runs locally on your own login. Ask and Plan stay read-only; Agent asks before every change.</small>
        </div>
      ) : (
        <>
          <CanvasWorkspace
            thread={thread}
            running={running}
            status={status}
            unread={unread}
            pendingApprovals={permissions.length}
            markCount={thread.activeDiagramId ? thread.annotations[thread.activeDiagramId]?.marks.length || 0 : 0}
            onComposer={setComposer}
            onOpenChat={() => { setChatOpen(true); setHistoryOpen(false); setUnread(0); }}
            onOpenHistory={() => { setHistoryOpen(true); setChatOpen(false); }}
            onSelectDiagram={selectDiagram}
            onMarksChange={handleMarksChange}
            onSnapshot={handleSnapshot}
            onArtifactError={handleArtifactError}
          />
          <ConversationDrawer
            open={chatOpen}
            thread={thread}
            preview={preview}
            toolActivity={toolActivity}
            permissions={permissions}
            decidingPermission={decidingPermission}
            running={running}
            status={status}
            composer={composer}
            mode={mode}
            unsupportedModes={unsupportedModes}
            attached={attachedArtifacts}
            markCounts={Object.fromEntries(attachedArtifacts.map((artifact) => [artifact.id, thread.annotations[artifact.id]?.marks.length || 0]))}
            onClose={() => setChatOpen(false)}
            onSelectDiagram={(id) => selectDiagram(id)}
            onRetry={(text) => setComposer(text)}
            onComposer={setComposer}
            onModeChange={setMode}
            onSend={() => void send()}
            onCancel={() => void cancelRun()}
            onRemoveAttachment={removeAttachment}
            onDecidePermission={(requestId, decision) => void decidePermission(requestId, decision)}
            onExecutePlan={executePlan}
          />
          <DiagramNavigator
            open={historyOpen}
            thread={thread}
            pendingAttachmentIds={pendingAttachmentIds}
            onClose={() => setHistoryOpen(false)}
            onSelect={(id) => { selectDiagram(id); setHistoryOpen(false); }}
            onPin={(id) => mutateThread(thread.id, (current) => ({ ...current, pinnedDiagramIds: current.pinnedDiagramIds.includes(id) ? current.pinnedDiagramIds.filter((item) => item !== id) : [...current.pinnedDiagramIds, id] }))}
            onToggleAttachment={toggleAttachment}
          />
        </>
      )}
    </div>
  );
}
