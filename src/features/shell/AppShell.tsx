'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentEvent, AgentMode, AgentParticipant, AgentProvider, AgentRole, AssistantMessage, ChatThread, DiagramArtifact,
  DiagramMessageAttachment, DrawingMark, GitWorkingTree, ProjectSummary, ProviderHealth, PublicConversation,
  ProjectsResponse, RunDescriptor, RunDiscovery, SketchCanvas, UserMessage,
} from '@/shared/types';
import { readNdjson } from '@/features/conversation/ndjson';
import {
  MAX_TOOL_ACTIVITY_ENTRIES, permissionLabel, toolActivityLabel,
  type PendingPermission, type ToolActivityEntry,
} from '@/features/agents/toolActivity';
import { EXECUTE_PLAN_INSTRUCTION } from '@/shared/plan';
import { compositePng } from '@/features/diagram/annotations/compositeExport';
import { createUuid } from '@/shared/uuid';
import {
  canvasTargetId, exportThread, findCanvasTarget, getSketches, hydrateConversation,
  loadSelectedProjectId, saveSelectedProjectId,
} from '@/features/conversation/conversationStore';
import { ProjectPicker } from '@/features/projects/ProjectPicker';
import { ThreadPicker } from '@/features/conversation/ThreadPicker';
import { ConversationDrawer } from '@/features/conversation/ConversationDrawer';
import { DiagramNavigator } from '@/features/diagram/components/DiagramNavigator';
import { CanvasWorkspace, type CanvasSnapshot } from '@/features/diagram/components/CanvasWorkspace';
import { EMPTY_CANVAS_SVG } from '@/features/diagram/components/DiagramCanvas';
import { renderMermaid } from '@/features/diagram/mermaid/mermaidRenderer';
import { RepositoryPanel } from '@/features/repository/RepositoryPanel';
import { findAgentParticipant, PROVIDER_LABELS } from '@/shared/participants';
import { reconcileThreadRun } from '@/features/conversation/runRecovery';
import { useTheme, type ThemePreference } from './useTheme';
import { usePanelLayout } from './usePanelLayout';
import { CONVERSATION_MIN_WIDTH, REPOSITORY_MIN_WIDTH } from './panelLayout';

interface Health {
  ok: boolean;
  projectsRootReady: boolean;
  dataDirectoryReady: boolean;
  providers: Record<AgentProvider, ProviderHealth>;
  message?: string;
}

const AGENT_MODES: readonly AgentMode[] = ['ask', 'plan', 'agent'];
const AGENT_PROVIDERS: readonly AgentProvider[] = ['claude', 'codex'];
const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];

/** Sent when the user draws and hits send without typing anything. */
const SKETCH_ONLY_INSTRUCTION = 'I drew the attached sketch. Read it as my instruction: say what you understand it to mean, then answer it against this repository.';

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
  const { preference: themePreference, resolved: theme, setPreference: setThemePreference } = useTheme();
  const [health, setHealth] = useState<Health>();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [recentProjectIds, setRecentProjectIds] = useState<string[]>([]);
  const [projectDiscoveryDepth, setProjectDiscoveryDepth] = useState(1);
  const [projectId, setProjectId] = useState('');
  const shellRef = useRef<HTMLDivElement>(null);
  const panelLayout = usePanelLayout(shellRef, Boolean(projectId));
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadId, setThreadId] = useState<string>();
  const [newProvider, setNewProvider] = useState<AgentProvider>('claude');
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Ready for an instruction');
  const [composer, setComposer] = useState('');
  const [preview, setPreview] = useState('');
  const [toolActivity, setToolActivity] = useState<ToolActivityEntry[]>([]);
  const [runFailed, setRunFailed] = useState(false);
  const [permissions, setPermissions] = useState<PendingPermission[]>([]);
  const [decidingPermission, setDecidingPermission] = useState<string>();
  const [repositoryTree, setRepositoryTree] = useState<GitWorkingTree>();
  const [unread, setUnread] = useState(0);
  const [pendingAttachmentIds, setPendingAttachmentIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<string>();
  const [busyRun, setBusyRun] = useState<RunDescriptor>();
  const [missingSession, setMissingSession] = useState(false);
  /** Set when a turn stopped on its turn budget: the session survives, so it can be resumed. */
  const [continueMode, setContinueMode] = useState<AgentMode>();
  const [participantBusy, setParticipantBusy] = useState(false);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const runIdRef = useRef<string | undefined>(undefined);
  const toolActivityKeyRef = useRef(0);
  const snapshotRef = useRef<CanvasSnapshot | undefined>(undefined);
  const navigationRevision = useRef(0);
  const participantRequestIds = useRef(new Map<string, string>());
  const threadsRef = useRef<ChatThread[]>([]);
  const mutationQueues = useRef(new Map<string, Promise<void>>());
  const annotationTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const chatOpenRef = useRef(panelLayout.conversationOpen);
  chatOpenRef.current = panelLayout.conversationOpen;
  const runningRef = useRef(running);
  runningRef.current = running;
  threadsRef.current = threads;

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

  const applyServerSnapshot = useCallback((snapshot: PublicConversation): ChatThread => {
    const current = threadsRef.current;
    const prior = current.find((item) => item.id === snapshot.id);
    const hydrated = hydrateConversation(snapshot, prior);
    const next = prior
      ? current.map((item) => item.id === snapshot.id ? hydrated : item)
      : [hydrated, ...current];
    threadsRef.current = next;
    setThreads(next);
    const primaryCheckoutId = snapshot.attachments.find((attachment) => attachment.role === 'primary')?.checkoutId;
    if (primaryCheckoutId) {
      setRecentProjectIds((current) => [
        primaryCheckoutId,
        ...current.filter((id) => id !== primaryCheckoutId),
      ].slice(0, 5));
    }
    return hydrated;
  }, []);

  const refreshConversation = useCallback(async (targetThreadId: string): Promise<ChatThread | undefined> => {
    try {
      const response = await fetch(`/api/threads/${encodeURIComponent(targetThreadId)}`, { cache: 'no-store' });
      const data = await response.json() as { thread?: PublicConversation; error?: string };
      if (!response.ok || !data.thread) return undefined;
      return applyServerSnapshot(data.thread);
    } catch {
      return undefined;
    }
  }, [applyServerSnapshot]);

  const enqueueConversationMutation = useCallback((
    targetThreadId: string,
    operation: (current: ChatThread) => Promise<Response>,
  ): Promise<ChatThread> => {
    const prior = mutationQueues.current.get(targetThreadId) || Promise.resolve();
    let result!: Promise<ChatThread>;
    const queued = prior.then(async () => {
      const current = threadsRef.current.find((item) => item.id === targetThreadId);
      if (!current) throw new Error('Conversation is no longer available.');
      const response = await operation(current);
      const data = await response.json().catch(() => ({})) as { thread?: PublicConversation; error?: string };
      if (!response.ok || !data.thread) {
        if (response.status === 409) await refreshConversation(targetThreadId);
        throw new Error(data.error || 'Conversation update failed.');
      }
      return applyServerSnapshot(data.thread);
    });
    result = queued;
    mutationQueues.current.set(targetThreadId, queued.then(() => undefined, () => undefined));
    return result;
  }, [applyServerSnapshot, refreshConversation]);

  useEffect(() => {
    let current = true;
    void Promise.all([
      fetch('/api/health', { cache: 'no-store' }).then((response) => response.json() as Promise<Health>),
      fetch('/api/projects', { cache: 'no-store' }).then(async (response) => {
        const data = await response.json() as Partial<ProjectsResponse> & { error?: string };
        if (!response.ok) throw new Error(data.error || 'Could not load projects.');
        return {
          projects: data.projects || [],
          recentProjectIds: data.recentProjectIds || [],
          discoveryDepth: data.discoveryDepth || 1,
        };
      }),
    ]).then(([healthResult, projectResult]) => {
      if (!current) return;
      setHealth(healthResult);
      setProjects(projectResult.projects);
      setRecentProjectIds(projectResult.recentProjectIds);
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
      } else {
        setLoading(false);
      }
    }).catch((error: unknown) => {
      if (current) {
        setNotice(error instanceof Error ? error.message : 'Could not start CodeAI.');
        setLoading(false);
      }
    });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let current = true;
    void fetch(`/api/threads?checkoutId=${encodeURIComponent(projectId)}`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json() as { threads?: PublicConversation[]; error?: string };
        if (!response.ok) throw new Error(data.error || 'Could not load conversations.');
        return data.threads || [];
      })
      .then((snapshots) => {
        if (!current) return;
        const prior = new Map(threadsRef.current.map((item) => [item.id, item]));
        const hydrated = snapshots.map((snapshot) => hydrateConversation(snapshot, prior.get(snapshot.id)));
        threadsRef.current = hydrated;
        setThreads(hydrated);
        setThreadId((selected) => hydrated.some((item) => item.id === selected) ? selected : hydrated[0]?.id);
        setNotice(undefined);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (!current) return;
        threadsRef.current = [];
        setThreads([]);
        setThreadId(undefined);
        setNotice(error instanceof Error ? error.message : 'Conversations could not be loaded.');
        setLoading(false);
      });
    return () => { current = false; };
  }, [projectId]);

  useEffect(() => {
    const active = thread?.activeDiagramId;
    setPendingAttachmentIds(active ? [active] : []);
    snapshotRef.current = undefined;
  }, [threadId, thread?.activeDiagramId]);

  const mutateThread = useCallback((id: string, operation: (value: ChatThread) => ChatThread) => {
    setThreads((current) => {
      const next = current.map((item) => item.id === id ? operation(item) : item);
      threadsRef.current = next;
      return next;
    });
  }, []);

  const createThread = useCallback(async (requestedProvider: AgentProvider = newProvider) => {
    if (!projectId || running) return;
    setNotice(undefined);
    try {
      const response = await fetch('/api/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkoutId: projectId, provider: requestedProvider }),
      });
      const data = await response.json() as { thread?: PublicConversation; error?: string };
      if (!response.ok || !data.thread) throw new Error(data.error || 'Could not create a conversation.');
      const created = applyServerSnapshot(data.thread);
      setThreadId(created.id);
      panelLayout.openConversation();
      setMissingSession(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not create a conversation.');
    }
  }, [applyServerSnapshot, newProvider, panelLayout.openConversation, projectId, running]);

  const switchProject = (next: string) => {
    if (next === projectId) return;
    if (running) abortRef.current?.abort();
    try { saveSelectedProjectId(next); } catch { /* Project switching still works without preference persistence. */ }
    setLoading(true);
    setProjectId(next);
    threadsRef.current = [];
    setThreads([]);
    setThreadId(undefined);
    setUnread(0);
    panelLayout.closeConversation();
    panelLayout.closeHistory();
    setRepositoryTree(undefined);
    panelLayout.openRepository();
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
    const current = threadsRef.current.find((item) => item.id === threadId);
    if (!current) return;
    const sketch: SketchCanvas = {
      id: createUuid(),
      threadId,
      ordinal: getSketches(current).length + 1,
      createdAt: new Date().toISOString(),
      viewBox: [0, 0, 1_600, 1_000],
    };
    navigationRevision.current += 1;
    void enqueueConversationMutation(threadId, () => fetch(
      `/api/threads/${encodeURIComponent(threadId)}/sketches`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sketch }),
      },
    )).then(() => {
      mutateThread(threadId, (thread) => ({ ...thread, activeDiagramId: sketch.id }));
      setPendingAttachmentIds([sketch.id]);
      snapshotRef.current = undefined;
    }).catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : 'Could not create the sketch.');
    });
  }, [enqueueConversationMutation, mutateThread, running, threadId]);

  const removeAttachment = (id: string) => setPendingAttachmentIds((current) => current.filter((item) => item !== id));
  const toggleAttachment = (id: string) => setPendingAttachmentIds((current) => current.includes(id)
    ? current.filter((item) => item !== id)
    : current.length < 4 ? [...current, id] : current);

  const togglePin = useCallback((canvasId: string) => {
    if (!threadId) return;
    void enqueueConversationMutation(threadId, (current) => {
      const pinnedDiagramIds = current.pinnedDiagramIds.includes(canvasId)
        ? current.pinnedDiagramIds.filter((item) => item !== canvasId)
        : [...current.pinnedDiagramIds, canvasId];
      return fetch(`/api/threads/${encodeURIComponent(threadId)}/pins`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: current.revision, pinnedDiagramIds }),
      });
    }).catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : 'Could not update the pinned canvases.');
    });
  }, [enqueueConversationMutation, threadId]);

  const handleMarksChange = useCallback((diagramId: string, marks: DrawingMark[]) => {
    if (!threadId) return;
    const annotation = { version: 1 as const, diagramId, marks, updatedAt: new Date().toISOString() };
    mutateThread(threadId, (current) => ({
      ...current,
      annotations: {
        ...current.annotations,
        [diagramId]: annotation,
      },
    }));
    const key = `${threadId}:${diagramId}`;
    const prior = annotationTimers.current.get(key);
    if (prior) clearTimeout(prior);
    annotationTimers.current.set(key, setTimeout(() => {
      annotationTimers.current.delete(key);
      void enqueueConversationMutation(threadId, (current) => {
        return fetch(`/api/threads/${encodeURIComponent(threadId)}/annotations`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedRevision: current.revision, annotation }),
        });
      }).catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : 'Could not save the drawing.');
      });
    }, 250));
  }, [enqueueConversationMutation, mutateThread, threadId]);

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
      return participant ? { ...current, addressedAgentId: participantId } : current;
    });
  }, [mutateThread, running, threadId]);

  const addAgent = useCallback(async (provider: AgentProvider, role: AgentRole) => {
    if (!thread || running || participantBusy) return;
    setParticipantBusy(true);
    setNotice(undefined);
    const requestKey = `${thread.id}:${provider}:${role}`;
    const requestId = participantRequestIds.current.get(requestKey) || createUuid();
    participantRequestIds.current.set(requestKey, requestId);
    try {
      const updated = await enqueueConversationMutation(thread.id, () => fetch(
        `/api/threads/${encodeURIComponent(thread.id)}/participants`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, role, requestId }),
        },
      ));
      participantRequestIds.current.delete(requestKey);
      const added = updated.participants.find((participant) => !thread.participants.some((current) => current.id === participant.id));
      if (added?.kind === 'agent') {
        mutateThread(thread.id, (current) => ({ ...current, addressedAgentId: added.id }));
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not add that agent.');
    } finally {
      setParticipantBusy(false);
    }
  }, [enqueueConversationMutation, mutateThread, participantBusy, running, thread]);

  const setPrimaryAgent = useCallback(async (participantId: string) => {
    if (!thread || running || participantBusy) return;
    setParticipantBusy(true);
    setNotice(undefined);
    try {
      await enqueueConversationMutation(thread.id, (current) => fetch(
        `/api/threads/${encodeURIComponent(thread.id)}/participants`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ primaryAgentId: participantId, expectedRevision: current.revision }),
        },
      ));
      mutateThread(thread.id, (current) => ({
        ...current,
        addressedAgentId: participantId,
      }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not change the main agent.');
    } finally {
      setParticipantBusy(false);
    }
  }, [enqueueConversationMutation, mutateThread, participantBusy, running, thread]);

  const prefillHandoff = useCallback((participantId: string, text: string, handoffMode?: AgentMode) => {
    selectAgent(participantId);
    setComposer((current) => current.trim() ? `${current.trimEnd()}\n\n${text}` : text);
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
        await refreshConversation(turn.threadId);
      }
      if (event.type === 'status') setStatus(event.label);
      if (event.type === 'tool-activity') {
        const entry = { tool: event.tool, detail: event.detail, denied: event.denied };
        setStatus(toolActivityLabel(entry));
        setToolActivity((current) => [
          ...current,
          { ...entry, key: toolActivityKeyRef.current++ },
        ].slice(-MAX_TOOL_ACTIVITY_ENTRIES));
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
        setRunFailed(true);
        setNotice(event.message);
        if (event.code === 'missing-session') setMissingSession(true);
        if (event.code === 'max-turns') setContinueMode(turn.mode);
        mutateThread(turn.threadId, (current) => ({ ...current, messages: current.messages.map((message) => message.id === userMessageId && message.role === 'user'
          ? { ...message, status: event.code === 'cancelled' ? 'cancelled' : 'failed', delivery: event.delivery }
          : message) }));
        await refreshConversation(turn.threadId);
      }
      if (event.type === 'assistant-message') {
        receivedFinal = true;
        const assistant = event.message as AssistantMessage;
        const alreadyPresent = threadsRef.current
          .find((item) => item.id === turn.threadId)
          ?.messages.some((message) => message.id === assistant.id) ?? false;
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
        if (!alreadyPresent && !chatOpenRef.current) setUnread((value) => value + 1);
        if (ready.length > 1) setNotice(`${ready.length} diagram results are ready in history. The active canvas was preserved.`);
        setPreview('');
        await refreshConversation(turn.threadId);
      }
    }
    return { receivedFinal, streamError, userMessageId };
  }, [mutateThread, refreshConversation]);

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
    setBusyRun(undefined);
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
      let viewBox = snapshot?.viewBox || fallbackViewBox;
      let png: string | undefined;
      if (canvas.kind === 'diagram') {
        try {
          const lightSnapshot = await renderMermaid(
            `attachment-${id.replaceAll('-', '')}`,
            canvas.artifact.source,
            'light',
          );
          viewBox = lightSnapshot.viewBox;
          png = await compositePng(lightSnapshot.svg, marks, lightSnapshot.viewBox);
        } catch { compositeWarning = true; }
      } else {
        try {
          png = await compositePng(EMPTY_CANVAS_SVG, marks, viewBox as [number, number, number, number]);
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
    setRunFailed(false);
    runningRef.current = true;
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
          threadId: thread.id,
          messageId: userId,
          participantId: turnAgent.id,
          text,
          diagramAttachments: attachmentPayload,
          mode: turnMode,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string; activeRun?: RunDescriptor };
        if (data.activeRun) setBusyRun(data.activeRun);
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
        if (!cancelled) setRunFailed(true);
        setNotice(cancelled ? 'The request was cancelled. Earlier conversation and diagrams are unchanged.' : error instanceof Error ? error.message : 'Agent request failed.');
        mutateThread(thread.id, (current) => ({ ...current, messages: current.messages.map((message) => message.id === userId && message.role === 'user'
          ? { ...message, status: cancelled ? 'cancelled' : 'failed', delivery: cancelled ? 'possibly-sent' : 'not-sent' }
          : message) }));
        await refreshConversation(thread.id);
      }
    } finally {
      abortRef.current = undefined;
      runIdRef.current = undefined;
      runningRef.current = false;
      setRunning(false);
      setPreview('');
      setToolActivity([]);
      setPermissions([]);
      setDecidingPermission(undefined);
      setStatus('Ready for an instruction');
    }
  }, [activeAgent, composer, consumeStream, health, mode, mutateThread, pendingAttachmentIds, refreshConversation, running, thread]);

  const busyRunLabel = busyRun && (
    threads.find((item) => item.id === busyRun.threadId)?.title
    || `conversation ${busyRun.threadId.slice(0, 8)}`
  );

  const cancelBusyRun = useCallback(async () => {
    if (!busyRun) return;
    try {
      const response = await fetch('/api/agent/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: busyRun.runId }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || 'That agent run could not be cancelled.');
      const label = busyRunLabel;
      setBusyRun(undefined);
      setNotice(`Cancellation requested for ${label}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'That agent run could not be cancelled.');
    }
  }, [busyRun, busyRunLabel]);

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

  // Recover a turn that outlived the page: discovery selects only live work, while the canonical
  // conversation remains authoritative before and after every possible completion race.
  useEffect(() => {
    if (!threadId || runningRef.current) return;
    const controller = new AbortController();
    let adoptedRunId: string | undefined;
    void (async () => {
      try {
        await reconcileThreadRun<Response>({
          async discover() {
            const response = await fetch(`/api/agent/runs?threadId=${encodeURIComponent(threadId)}`, {
              cache: 'no-store',
              signal: controller.signal,
            });
            const data = await response.json().catch(() => ({})) as RunDiscovery & { error?: string };
            if (!response.ok) throw new Error(data.error || 'Could not discover running turns.');
            // A send that began while discovery was in flight owns its own stream. Do not replace
            // that subscriber or overwrite its optimistic state with recovery hydration.
            if (runningRef.current) {
              controller.abort();
              throw new DOMException('Run recovery was superseded by a local send.', 'AbortError');
            }
            return data.active[0];
          },
          adopt(run) {
            adoptedRunId = run.runId;
            runIdRef.current = run.runId;
            setRunFailed(false);
            mutateThread(threadId, (current) => ({ ...current, addressedAgentId: run.participantId }));
            runningRef.current = true;
            setRunning(true);
            setStatus('Reconnecting to the running turn');
          },
          async attach(runId) {
            const response = await fetch(`/api/agent/stream?runId=${encodeURIComponent(runId)}`, {
              cache: 'no-store',
              signal: controller.signal,
            });
            if (response.status === 404) return { kind: 'missing' };
            if (!response.ok) throw new Error('Could not attach to the running turn.');
            if (response.headers.get('X-CodeAI-Run-Finished') === 'true') {
              await response.body?.cancel();
              return { kind: 'finished' };
            }
            setNotice('Reconnected to the turn that was still running.');
            return { kind: 'stream', stream: response };
          },
          async hydrate() {
            await refreshConversation(threadId);
          },
          async consume(response) {
            await consumeStream(response, { threadId, mode: 'agent' });
          },
        });
      } catch {
        if (!controller.signal.aborted) {
          await refreshConversation(threadId);
          if (adoptedRunId) {
            setRunFailed(true);
            setNotice('Lost the connection to the running turn.');
          }
        }
      } finally {
        if (!controller.signal.aborted) {
          if (runIdRef.current === adoptedRunId) runIdRef.current = undefined;
          runningRef.current = false;
          setRunning(false);
          setPreview('');
          setToolActivity([]);
          setPermissions([]);
          setStatus('Ready for an instruction');
        }
      }
    })();
    return () => {
      controller.abort();
      if (runIdRef.current === adoptedRunId) runIdRef.current = undefined;
      if (adoptedRunId) {
        runningRef.current = false;
        setRunning(false);
      }
    };
  }, [consumeStream, mutateThread, refreshConversation, threadId]);

  const executePlan = useCallback((participantId: string) => {
    const planAgent = findAgentParticipant(thread?.participants || [], participantId);
    const planHealth = planAgent && health?.providers[planAgent.provider];
    if (!planAgent || !planHealth?.supportedModes.includes('agent')) {
      setNotice(planHealth?.message || 'That agent cannot execute in Agent mode.');
      return;
    }
    void send({ text: EXECUTE_PLAN_INSTRUCTION, mode: 'agent', participantId });
  }, [health, send, thread?.participants]);

  // Keep the loading surface in the named canvas area. Rendering the interactive header only
  // after hydration also lets its device-owned theme controls reflect the pre-paint preference.
  if (loading) {
    return (
      <div
        ref={shellRef}
        className={`app-shell dock-capacity-${panelLayout.dockCapacity}`}
        style={panelLayout.shellStyle}
      >
        <div className="app-loading"><div className="brand-mark">C</div><p>Opening your code canvas…</p></div>
      </div>
    );
  }

  return (
    <div
      ref={shellRef}
      className={`app-shell dock-capacity-${panelLayout.dockCapacity} ${panelLayout.focusMode ? 'focus-mode' : ''}`}
      style={panelLayout.shellStyle}
    >
      <header className="app-header">
        <div className="brand"><span className="brand-mark">C</span><strong>CodeAI</strong></div>
        <nav className="header-breadcrumbs" aria-label="Current project and conversation">
          <span className="breadcrumb-separator" aria-hidden="true">/</span>
          <ProjectPicker
            projects={projects}
            recentProjectIds={recentProjectIds}
            value={projectId}
            discoveryDepth={projectDiscoveryDepth}
            disabled={running}
            onChange={switchProject}
          />
          <span className="breadcrumb-separator" aria-hidden="true">/</span>
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
        </nav>
        <div className="header-actions">
          <div className="theme-selector" role="group" aria-label="Theme">
            {THEME_PREFERENCES.map((choice) => (
              <button
                key={choice}
                type="button"
                className={themePreference === choice ? 'active' : ''}
                aria-pressed={themePreference === choice}
                onClick={() => setThemePreference(choice)}
              >
                {choice[0].toUpperCase() + choice.slice(1)}
              </button>
            ))}
          </div>
          {projectId && (
            <button
              type="button"
              className={`repository-toggle ${repositoryTree?.files.length ? 'dirty' : ''}`}
              aria-pressed={panelLayout.repositoryOpen}
              onClick={panelLayout.toggleRepository}
            >
              Repository{repositoryTree?.files.length ? <span>{repositoryTree.files.length}</span> : null}
            </button>
          )}
          {thread && (
            <button
              type="button"
              className={`run-status-toggle ${running ? 'working' : ''} ${permissions.length ? 'awaiting-approval' : ''}`}
              aria-pressed={panelLayout.conversationOpen}
              aria-label={permissions.length > 0
                ? `${permissions.length} action${permissions.length === 1 ? '' : 's'} waiting for your approval. Open conversation`
                : running ? `Agent working: ${status}. Open conversation` : 'Open conversation'}
              title={running || permissions.length ? status : 'Open conversation'}
              onClick={() => {
                if (panelLayout.conversationOpen) panelLayout.closeConversation();
                else {
                  panelLayout.openConversation();
                  setUnread(0);
                }
              }}
            >
              <span className="run-status-dot" aria-hidden="true" />
              <span>{permissions.length ? 'Approval needed' : running ? status : 'Conversation'}</span>
              {permissions.length > 0 && <span className="approval-badge">{permissions.length}</span>}
              {unread > 0 && <span className="unread-badge">{unread}</span>}
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
        <div className="repository-region">
          <RepositoryPanel
            projectId={projectId}
            projectName={selectedProject.name}
            open={panelLayout.repositoryOpen}
            onClose={panelLayout.closeRepository}
            onTreeChange={setRepositoryTree}
            onInspectorOpenChange={panelLayout.setInspectorOpen}
          />
          {panelLayout.repositoryOpen && (
            <div
              className="panel-resize-handle repository-resize-handle"
              role="separator"
              tabIndex={0}
              aria-label="Resize repository panel"
              aria-orientation="vertical"
              aria-valuemin={REPOSITORY_MIN_WIDTH}
              aria-valuemax={panelLayout.repositoryMaximum}
              aria-valuenow={Math.round(panelLayout.repositoryPanelWidth)}
              onPointerDown={(event) => panelLayout.beginResize('repository', event)}
              onKeyDown={(event) => panelLayout.resizeByKeyboard('repository', event)}
            />
          )}
        </div>
      )}

      {notice && (
        <div className="notice-banner" role="status">
          <span>{notice}</span>
          {busyRun && <button type="button" onClick={() => void cancelBusyRun()}>Cancel {busyRunLabel}</button>}
          {missingSession && <button type="button" onClick={() => { void createThread(activeProvider); setComposer(`Continue this conversation in a new agent session. Here is a brief visible recap:\n\n${thread?.messages.slice(-6).map((message) => `${thread.participants.find((participant) => participant.id === message.authorId)?.displayName || message.role}: ${message.role === 'user' ? message.text : message.rawMarkdown.slice(0, 600)}`).join('\n\n') || ''}`); }}>Continue in new session</button>}
          {continueMode && !running && <button type="button" onClick={() => void send({ text: 'Continue where you stopped.', mode: continueMode })}>Continue</button>}
          <button type="button" aria-label="Dismiss notice" onClick={() => { setNotice(undefined); setBusyRun(undefined); }}>×</button>
        </div>
      )}

      {!projects.length ? (
        <div className="fatal-empty"><span className="eyebrow">No projects found</span><h1>Point CodeAI at a project.</h1><p>Set <code>CODEAI_PROJECTS_ROOT</code> to one project or a directory containing projects, then restart the app.</p></div>
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
            theme={theme}
            unread={unread}
            pendingApprovals={permissions.length}
            running={running}
            runFailed={runFailed}
            toolActivity={toolActivity}
            focusMode={panelLayout.focusMode}
            onComposer={setComposer}
            onOpenChat={() => { panelLayout.openConversation(); setUnread(0); }}
            onOpenHistory={panelLayout.openHistory}
            onToggleFocus={panelLayout.toggleFocusMode}
            onSelectDiagram={selectDiagram}
            onNewSketch={createSketch}
            onMarksChange={handleMarksChange}
            onSnapshot={handleSnapshot}
            onArtifactError={handleArtifactError}
          />
          <div className="conversation-region">
            <ConversationDrawer
              open={panelLayout.conversationOpen}
              thread={thread}
              theme={theme}
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
              onClose={panelLayout.closeConversation}
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
              open={panelLayout.historyOpen}
              thread={thread}
              pendingAttachmentIds={pendingAttachmentIds}
              onClose={panelLayout.closeHistory}
              onSelect={(id) => { selectDiagram(id); panelLayout.closeHistory(); }}
              onPin={togglePin}
              onToggleAttachment={toggleAttachment}
            />
            {(panelLayout.conversationOpen || panelLayout.historyOpen) && (
              <div
                className="panel-resize-handle conversation-resize-handle"
                role="separator"
                tabIndex={0}
                aria-label="Resize conversation panel"
                aria-orientation="vertical"
                aria-valuemin={CONVERSATION_MIN_WIDTH}
                aria-valuemax={panelLayout.conversationMaximum}
                aria-valuenow={Math.round(panelLayout.conversationPanelWidth)}
                onPointerDown={(event) => panelLayout.beginResize('conversation', event)}
                onKeyDown={(event) => panelLayout.resizeByKeyboard('conversation', event)}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
