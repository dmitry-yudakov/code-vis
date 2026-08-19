'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentEvent, AgentMode, AgentParticipant, AgentProvider, AgentRole, AssistantMessage, ChatThread, DiagramArtifact,
  DiagramMessageAttachment, DrawingMark, GitWorkingTree, Participant, ProjectSummary, ProviderHealth, SketchCanvas,
  TranscriptContextMessage, UserMessage,
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
  canvasTargetId, exportThread, findCanvasTarget, getArtifacts, getSketches, loadProjectThreads,
  loadSelectedProjectId, saveProjectThreads, saveSelectedProjectId,
} from '@/lib/client/conversationStore';
import { ProjectPicker } from './ProjectPicker';
import { ThreadPicker } from './ThreadPicker';
import { ConversationDrawer } from './ConversationDrawer';
import { DiagramNavigator } from './DiagramNavigator';
import { CanvasWorkspace, type CanvasSnapshot } from './CanvasWorkspace';
import { EMPTY_CANVAS_SVG } from './DiagramCanvas';
import { RepositoryPanel } from './RepositoryPanel';
import { findAgentParticipant, PROVIDER_LABELS } from '@/lib/shared/participants';

interface Health {
  ok: boolean;
  projectsRootReady: boolean;
  dataDirectoryReady: boolean;
  providers: Record<AgentProvider, ProviderHealth>;
  message?: string;
}

const AGENT_MODES: readonly AgentMode[] = ['ask', 'plan', 'agent'];
const AGENT_PROVIDERS: readonly AgentProvider[] = ['claude', 'codex'];

/** Sent when the user draws and hits send without typing anything. */
const SKETCH_ONLY_INSTRUCTION = 'I drew the attached sketch. Read it as my instruction: say what you understand it to mean, then answer it against this repository.';

function newLocalThread(server: {
  id: string;
  projectId: string;
  createdAt: string;
  participants: Participant[];
  primaryAgentId: string;
}, index: number): ChatThread {
  return {
    version: 2,
    id: server.id,
    projectId: server.projectId,
    title: `Conversation ${index + 1}`,
    createdAt: server.createdAt,
    updatedAt: server.createdAt,
    participants: server.participants,
    primaryAgentId: server.primaryAgentId,
    addressedAgentId: server.primaryAgentId,
    defaultMode: findAgentParticipant(server.participants, server.primaryAgentId)?.defaultMode || 'ask',
    messages: [],
    pinnedDiagramIds: [],
    annotations: {},
  };
}

function transcriptContext(thread: ChatThread): TranscriptContextMessage[] {
  return thread.messages.map((message) => ({
    id: message.id,
    authorId: message.authorId,
    createdAt: message.createdAt,
    text: (message.role === 'user' ? message.text : message.rawMarkdown).slice(-8_000),
  }));
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
  const [newProvider, setNewProvider] = useState<AgentProvider>('claude');
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
  const [repositoryOpen, setRepositoryOpen] = useState(true);
  const [repositoryTree, setRepositoryTree] = useState<GitWorkingTree>();
  const [unread, setUnread] = useState(0);
  const [pendingAttachmentIds, setPendingAttachmentIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<string>();
  const [missingSession, setMissingSession] = useState(false);
  /** Set when a turn stopped on its turn budget: the session survives, so it can be resumed. */
  const [continueMode, setContinueMode] = useState<AgentMode>();
  const [participantBusy, setParticipantBusy] = useState(false);
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
  const selectedProject = useMemo(() => projects.find((project) => project.id === projectId), [projectId, projects]);
  const selectableProviders = useMemo(() => AGENT_PROVIDERS.filter((provider) => health?.providers[provider]?.available), [health]);
  const agents = useMemo(() => thread?.participants.filter((participant): participant is AgentParticipant => participant.kind === 'agent') || [], [thread]);
  const activeAgent = findAgentParticipant(agents, thread?.addressedAgentId)
    || findAgentParticipant(agents, thread?.primaryAgentId);
  const activeProvider = activeAgent?.provider || newProvider;
  const providerHealth = health?.providers[activeProvider];
  const unsupportedModes = useMemo(() => health
    ? AGENT_MODES.filter((agentMode) => !providerHealth?.supportedModes.includes(agentMode))
    : [], [health, providerHealth]);
  // A mode the installed CLI cannot run falls back to Ask rather than failing at send time.
  const storedMode = thread?.defaultMode || 'ask';
  const mode: AgentMode = unsupportedModes.includes(storedMode)
    ? providerHealth?.supportedModes[0] || 'ask'
    : storedMode;
  const attachedCanvases = useMemo(() => {
    if (!thread) return [];
    return pendingAttachmentIds.flatMap((id) => {
      const target = findCanvasTarget(thread, id);
      return target ? [target] : [];
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
      const healthy = AGENT_PROVIDERS.filter((provider) => healthResult.providers[provider]?.available);
      setNewProvider((current) => healthy.includes(current) ? current : healthy[0] || 'claude');
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

  const createThread = useCallback(async (requestedProvider: AgentProvider = newProvider) => {
    if (!projectId || running) return;
    setNotice(undefined);
    try {
      const response = await fetch('/api/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, provider: requestedProvider }),
      });
      const data = await response.json() as {
        thread?: {
          id: string;
          projectId: string;
          createdAt: string;
          participants: Participant[];
          primaryAgentId: string;
        };
        error?: string;
      };
      if (!response.ok || !data.thread) throw new Error(data.error || 'Could not create a conversation.');
      const created = newLocalThread(data.thread, threads.length);
      setThreads((current) => [created, ...current]);
      setThreadId(created.id);
      setChatOpen(true);
      setMissingSession(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not create a conversation.');
    }
  }, [newProvider, projectId, running, threads.length]);

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
    setRepositoryTree(undefined);
    setRepositoryOpen(true);
  };

  const selectDiagram = useCallback((id: string) => {
    if (!threadId) return;
    navigationRevision.current += 1;
    mutateThread(threadId, (current) => ({ ...current, activeDiagramId: id }));
    setPendingAttachmentIds([id]);
  }, [mutateThread, threadId]);

  /** A blank sheet the user can draw on before any diagram exists. */
  const createSketch = useCallback(() => {
    if (!threadId || running) return;
    const sketch: SketchCanvas = {
      id: createUuid(),
      threadId,
      ordinal: 0,
      createdAt: new Date().toISOString(),
      viewBox: [0, 0, 1_600, 1_000],
    };
    navigationRevision.current += 1;
    mutateThread(threadId, (current) => {
      const sketches = getSketches(current);
      return {
        ...current,
        sketches: [...sketches, { ...sketch, ordinal: sketches.length + 1 }],
        activeDiagramId: sketch.id,
      };
    });
    setPendingAttachmentIds([sketch.id]);
    snapshotRef.current = undefined;
  }, [mutateThread, running, threadId]);

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

  const selectAgent = useCallback((participantId: string) => {
    if (!threadId || running) return;
    mutateThread(threadId, (current) => {
      const participant = findAgentParticipant(current.participants, participantId);
      return participant ? { ...current, addressedAgentId: participantId, defaultMode: participant.defaultMode } : current;
    });
  }, [mutateThread, running, threadId]);

  const addAgent = useCallback(async (provider: AgentProvider, role: AgentRole) => {
    if (!thread || running || participantBusy) return;
    setParticipantBusy(true);
    setNotice(undefined);
    try {
      const response = await fetch(`/api/threads/${encodeURIComponent(thread.id)}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: thread.projectId, provider, role }),
      });
      const data = await response.json() as { participants?: Participant[]; primaryAgentId?: string; error?: string };
      if (!response.ok || !data.participants || !data.primaryAgentId) throw new Error(data.error || 'Could not add that agent.');
      const added = data.participants.find((participant) => !thread.participants.some((current) => current.id === participant.id));
      mutateThread(thread.id, (current) => ({
        ...current,
        participants: data.participants!,
        primaryAgentId: data.primaryAgentId!,
        addressedAgentId: added?.kind === 'agent' ? added.id : current.addressedAgentId,
        defaultMode: added?.kind === 'agent' ? added.defaultMode : current.defaultMode,
      }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not add that agent.');
    } finally {
      setParticipantBusy(false);
    }
  }, [mutateThread, participantBusy, running, thread]);

  const setPrimaryAgent = useCallback(async (participantId: string) => {
    if (!thread || running || participantBusy) return;
    setParticipantBusy(true);
    setNotice(undefined);
    try {
      const response = await fetch(`/api/threads/${encodeURIComponent(thread.id)}/participants`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: thread.projectId, primaryAgentId: participantId }),
      });
      const data = await response.json() as { participants?: Participant[]; primaryAgentId?: string; error?: string };
      if (!response.ok || !data.participants || !data.primaryAgentId) throw new Error(data.error || 'Could not change the main agent.');
      mutateThread(thread.id, (current) => ({
        ...current,
        participants: data.participants!,
        primaryAgentId: data.primaryAgentId!,
        addressedAgentId: participantId,
      }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not change the main agent.');
    } finally {
      setParticipantBusy(false);
    }
  }, [mutateThread, participantBusy, running, thread]);

  const prefillHandoff = useCallback((participantId: string, text: string, handoffMode?: AgentMode) => {
    selectAgent(participantId);
    setComposer(text);
    if (handoffMode && threadId) mutateThread(threadId, (current) => ({ ...current, defaultMode: handoffMode }));
  }, [mutateThread, selectAgent, threadId]);

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
        mutateThread(turn.threadId, (current) => ({ ...current, addressedAgentId: event.participantId }));
      }
      if (event.type === 'status') setStatus(event.label);
      if (event.type === 'tool-activity') {
        const entry = { tool: event.tool, detail: event.detail, denied: event.denied };
        setStatus(toolActivityLabel(entry));
        setToolActivity((current) => [...current, { ...entry, key: current.length }].slice(-MAX_TOOL_ACTIVITY_ENTRIES));
      }
      if (event.type === 'permission-request') {
        const request: PendingPermission = {
          requestId: event.requestId,
          participantId: event.participantId,
          tool: event.tool,
          detail: event.detail,
        };
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

  const send = useCallback(async (override?: { text: string; mode: AgentMode; participantId?: string }) => {
    if (!thread || running) return;
    const turnAgent = findAgentParticipant(thread.participants, override?.participantId) || activeAgent;
    if (!turnAgent) return;
    const selected = pendingAttachmentIds.flatMap((id) => {
      const canvas = findCanvasTarget(thread, id);
      return canvas ? [canvas] : [];
    });
    // A sketch is itself the instruction, so an empty composer still makes a valid turn.
    const typed = (override?.text ?? composer).trim();
    const text = typed || (selected.some((canvas) => canvas.kind === 'sketch') ? SKETCH_ONLY_INSTRUCTION : '');
    if (!text) return;
    const turnMode: AgentMode = override?.mode ?? mode;
    const turnProviderHealth = health?.providers[turnAgent.provider];
    if (!turnProviderHealth?.available || !turnProviderHealth.supportedModes.includes(turnMode)) {
      setNotice(turnProviderHealth?.message || `${PROVIDER_LABELS[turnAgent.provider]} is not available for ${turnMode} mode.`);
      return;
    }
    setNotice(undefined);
    setMissingSession(false);
    setContinueMode(undefined);
    const attachmentPayload: DiagramMessageAttachment[] = [];
    let compositeWarning = false;
    for (const canvas of selected) {
      const id = canvasTargetId(canvas);
      const marks = thread.annotations[id]?.marks || [];
      const snapshot = id === thread.activeDiagramId ? snapshotRef.current : undefined;
      // A sketch has no rendered source, so its own sheet is the fallback frame for the marks.
      const fallbackViewBox = canvas.kind === 'sketch' ? canvas.sketch.viewBox : [0, 0, 1, 1] as const;
      const viewBox = snapshot?.viewBox || fallbackViewBox;
      let png: string | undefined;
      if (snapshot || canvas.kind === 'sketch') {
        try {
          png = await compositePng(snapshot?.svg || EMPTY_CANVAS_SVG, marks, viewBox as [number, number, number, number]);
        } catch { compositeWarning = true; }
      }
      attachmentPayload.push({
        diagramId: id,
        kind: canvas.kind,
        source: canvas.kind === 'diagram' ? canvas.artifact.source : '',
        marks,
        viewport: { viewBox: viewBox as [number, number, number, number] },
        compositePngDataUrl: png,
      });
    }
    if (compositeWarning) {
      setNotice(selected.every((canvas) => canvas.kind === 'sketch')
        ? 'Composite image export was unavailable; the vector marks are still attached.'
        : 'Composite image export was unavailable; Mermaid source and vector marks are still attached.');
    }

    const userId = createUuid();
    const createdAt = new Date().toISOString();
    const human = thread.participants.find((participant) => participant.kind === 'human');
    if (!human) {
      setNotice('This conversation has no local user identity.');
      return;
    }
    const userMessage: UserMessage = {
      id: userId,
      role: 'user',
      authorId: human.id,
      addressedParticipantId: turnAgent.id,
      text,
      createdAt,
      status: 'sending',
      diagramAttachments: attachmentPayload.map((item) => ({
        diagramId: item.diagramId,
        kind: item.kind,
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
      // A sketch-only turn would otherwise title the thread with the whole synthesized instruction.
      title: current.messages.length === 0 ? (typed ? typed.slice(0, 56) : 'Sketch conversation') : current.title,
      messages: [...current.messages, userMessage],
    }));
    if (!override) setComposer('');
    setPreview('');
    setToolActivity([]);
    setPermissions([]);
    setRunning(true);
    setStatus(turnMode === 'agent'
      ? `Starting ${turnAgent.displayName}`
      : `Starting read-only ${turnAgent.displayName}`);
    const controller = new AbortController();
    abortRef.current = controller;
    let streamError: Extract<AgentEvent, { type: 'error' }> | undefined;

    try {
      const response = await fetch('/api/agent/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: thread.projectId,
          threadId: thread.id,
          messageId: userId,
          participantId: turnAgent.id,
          text,
          transcript: transcriptContext(thread),
          diagramAttachments: attachmentPayload,
          mode: turnMode,
        }),
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
  }, [activeAgent, composer, consumeStream, health, mode, mutateThread, pendingAttachmentIds, running, thread]);

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

  const executePlan = useCallback((participantId: string) => {
    const planAgent = findAgentParticipant(thread?.participants || [], participantId);
    const planHealth = planAgent && health?.providers[planAgent.provider];
    if (!planAgent || !planHealth?.supportedModes.includes('agent')) {
      setNotice(planHealth?.message || 'That agent cannot execute in Agent mode.');
      return;
    }
    void send({ text: EXECUTE_PLAN_INSTRUCTION, mode: 'agent', participantId });
  }, [health, send, thread?.participants]);

  if (loading) return <div className="app-loading"><div className="brand-mark">C</div><p>Opening your code canvas…</p></div>;

  return (
    <div className={`app-shell ${repositoryOpen && projectId ? 'repository-open' : ''}`}>
      <header className="app-header">
        <div className="brand"><span className="brand-mark">C</span><span><strong>Cartograph</strong><small>conversational code canvas</small></span></div>
        <div className="header-pickers">
          <ProjectPicker projects={projects} value={projectId} discoveryDepth={projectDiscoveryDepth} disabled={running} onChange={switchProject} />
          <ThreadPicker
            threads={threads}
            value={threadId}
            disabled={running || !projectId}
            providers={selectableProviders}
            newProvider={newProvider}
            onChange={setThreadId}
            onNewProvider={setNewProvider}
            onNew={(provider) => void createThread(provider)}
          />
        </div>
        <div className="header-actions">
          {projectId && (
            <button
              type="button"
              className={`repository-toggle ${repositoryTree?.files.length ? 'dirty' : ''}`}
              aria-pressed={repositoryOpen}
              onClick={() => setRepositoryOpen((current) => !current)}
            >
              Repository{repositoryTree?.files.length ? <span>{repositoryTree.files.length}</span> : null}
            </button>
          )}
          <span
            className={`health-pill ${providerHealth?.available ? 'ready' : 'warning'}`}
            title={providerHealth?.message || health?.message || 'Local readiness'}
          >
            <span />{providerHealth?.available ? `${PROVIDER_LABELS[activeProvider]} ready` : 'Setup needed'}
          </span>
          {thread && <button type="button" onClick={() => exportThread(thread)}>Export</button>}
        </div>
      </header>

      {projectId && selectedProject && (
        <RepositoryPanel
          projectId={projectId}
          projectName={selectedProject.name}
          open={repositoryOpen}
          onClose={() => setRepositoryOpen(false)}
          onTreeChange={setRepositoryTree}
        />
      )}

      {notice && (
        <div className="notice-banner" role="status">
          <span>{notice}</span>
          {missingSession && <button type="button" onClick={() => { void createThread(activeProvider); setComposer(`Continue this conversation in a new agent session. Here is a brief visible recap:\n\n${thread?.messages.slice(-6).map((message) => `${thread.participants.find((participant) => participant.id === message.authorId)?.displayName || message.role}: ${message.role === 'user' ? message.text : message.rawMarkdown.slice(0, 600)}`).join('\n\n') || ''}`); }}>Continue in new session</button>}
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
          <button type="button" className="primary-cta" disabled={!selectableProviders.length} onClick={() => void createThread(newProvider)}>New conversation <span>→</span></button>
          <small>{selectableProviders.length
            ? `${selectableProviders.map((provider) => PROVIDER_LABELS[provider]).join(' and ')} run locally on your own login. Ask and Plan stay read-only; Agent appears only where its approval contract is verified.`
            : 'Install and authenticate Claude Code or Codex to start a local conversation.'}</small>
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
            onNewSketch={createSketch}
            onMarksChange={handleMarksChange}
            onSnapshot={handleSnapshot}
            onArtifactError={handleArtifactError}
          />
          <ConversationDrawer
            open={chatOpen}
            thread={thread}
            agents={agents}
            activeAgent={activeAgent}
            healthyProviders={selectableProviders}
            participantBusy={participantBusy}
            preview={preview}
            toolActivity={toolActivity}
            permissions={permissions}
            decidingPermission={decidingPermission}
            running={running}
            status={status}
            composer={composer}
            mode={mode}
            unsupportedModes={unsupportedModes}
            attached={attachedCanvases}
            markCounts={Object.fromEntries(attachedCanvases.map((canvas) => [canvasTargetId(canvas), thread.annotations[canvasTargetId(canvas)]?.marks.length || 0]))}
            onClose={() => setChatOpen(false)}
            onSelectDiagram={(id) => selectDiagram(id)}
            onRetry={(text, participantId, retryMode) => prefillHandoff(participantId, text, retryMode)}
            onComposer={setComposer}
            onModeChange={setMode}
            onSelectAgent={selectAgent}
            onMakePrimary={(participantId) => void setPrimaryAgent(participantId)}
            onAddAgent={(provider, role) => void addAgent(provider, role)}
            onHandoff={prefillHandoff}
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
