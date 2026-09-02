'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import type {
  AgentEvent, AgentMode, AgentParticipant, AgentProvider, AgentRole, AssistantMessage, SessionSnapshot, DiagramArtifact,
  CheckoutSummary, CheckoutsResponse, DiagramMessageAttachment, DrawingMark, DurableProject, GitWorkingTree,
  ProviderHealth, PublicSession, RepositoryBinding, RunDescriptor, RunDiscovery, SketchCanvas, UserMessage,
} from '@/shared/types';
import { readNdjson } from '@/features/conversation/ndjson';
import {
  applyRunEvent, isReplayedStreamEvent, latestRunUserMessage, runOutcomeFromError,
  unreadAfterRunAttention, withSessionRunOutcome,
  type RunPresentation, type SessionRunOutcome,
} from '@/features/conversation/runPresentation';
import { EXECUTE_PLAN_INSTRUCTION } from '@/shared/plan';
import { compositePng } from '@/features/diagram/annotations/compositeExport';
import { createUuid } from '@/shared/uuid';
import {
  canvasTargetId, exportSession, findCanvasTarget, getSketches, hydrateSession,
  loadSelectedCheckoutId, saveSelectedCheckoutId,
} from '@/features/conversation/sessionStore';
import { ProjectPicker } from '@/features/projects/ProjectPicker';
import { SessionPicker } from '@/features/conversation/SessionPicker';
import { WorkspaceTabs } from '@/features/conversation/WorkspaceTabs';
import { ConversationDrawer } from '@/features/conversation/ConversationDrawer';
import { DiagramNavigator } from '@/features/diagram/components/DiagramNavigator';
import { CanvasWorkspace, type CanvasSnapshot } from '@/features/diagram/components/CanvasWorkspace';
import { EMPTY_CANVAS_SVG } from '@/features/diagram/components/DiagramCanvas';
import { renderMermaid } from '@/features/diagram/mermaid/mermaidRenderer';
import { RepositoryPanel } from '@/features/repository/RepositoryPanel';
import { RepositoryManager } from '@/features/repository/RepositoryManager';
import { findAgentParticipant, PROVIDER_LABELS } from '@/shared/participants';
import { useTheme, type ThemePreference } from './useTheme';
import { usePanelLayout } from './usePanelLayout';
import { useWorkspaceViews } from './useWorkspaceViews';
import { replacePendingCanvasRevision } from './workspaceViews';
import { CONVERSATION_MIN_WIDTH, REPOSITORY_MIN_WIDTH } from './panelLayout';

interface Health {
  ok: boolean;
  repositoriesRootReady: boolean;
  dataDirectoryReady: boolean;
  providers: Record<AgentProvider, ProviderHealth>;
  message?: string;
}

const AGENT_MODES: readonly AgentMode[] = ['ask', 'plan', 'agent'];
const AGENT_PROVIDERS: readonly AgentProvider[] = ['claude', 'codex'];
const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];

/** Sent when the user draws and hits send without typing anything. */
const SKETCH_ONLY_INSTRUCTION = 'I drew the attached sketch. Read it as my instruction: say what you understand it to mean, then answer it against this repository.';

function updateArtifact(session: SessionSnapshot, id: string, update: (artifact: DiagramArtifact) => DiagramArtifact): SessionSnapshot {
  return {
    ...session,
    messages: session.messages.map((message) => message.role === 'assistant' ? {
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
  const [projects, setProjects] = useState<DurableProject[]>([]);
  const [checkouts, setCheckouts] = useState<CheckoutSummary[]>([]);
  const [recentCheckoutIds, setRecentCheckoutIds] = useState<string[]>([]);
  const [hostId, setHostId] = useState<string>();
  const [projectId, setProjectId] = useState<string>();
  const [savedCheckoutId, setSavedCheckoutId] = useState<string>();
  const [catalogReady, setCatalogReady] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const [sessions, setSessions] = useState<SessionSnapshot[]>([]);
  const workspace = useWorkspaceViews(projectId);
  const sessionId = workspace.scope.focusedSessionId;
  const view = sessionId ? workspace.scope.views[sessionId] : undefined;
  const panelLayout = usePanelLayout(shellRef, Boolean(sessionId), sessionId);
  const [newProvider, setNewProvider] = useState<AgentProvider>('claude');
  const [loading, setLoading] = useState(true);
  const [runsBySession, setRunsBySession] = useState<Record<string, RunPresentation>>({});
  const [runOutcomesBySession, setRunOutcomesBySession] = useState<Record<string, SessionRunOutcome>>({});
  const [repositoryTree, setRepositoryTree] = useState<GitWorkingTree>();
  const [notice, setNotice] = useState<string>();
  const [busyRun, setBusyRun] = useState<RunDescriptor>();
  const [participantBusy, setParticipantBusy] = useState(false);
  const runControllers = useRef(new Map<string, AbortController>());
  const runsBySessionRef = useRef<Record<string, RunPresentation>>({});
  const toolActivityKeyRef = useRef(0);
  const snapshotRef = useRef<CanvasSnapshot | undefined>(undefined);
  const navigationRevisions = useRef(new Map<string, number>());
  const participantRequestIds = useRef(new Map<string, string>());
  const sessionsRef = useRef<SessionSnapshot[]>([]);
  const mutationQueues = useRef(new Map<string, Promise<void>>());
  const annotationTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const chatOpenRef = useRef(panelLayout.conversationOpen);
  chatOpenRef.current = panelLayout.conversationOpen;
  sessionsRef.current = sessions;
  const focusedSessionIdRef = useRef(sessionId);
  focusedSessionIdRef.current = sessionId;

  const putRun = useCallback((run: RunPresentation) => {
    const next = { ...runsBySessionRef.current, [run.sessionId]: run };
    runsBySessionRef.current = next;
    setRunsBySession(next);
  }, []);
  const updateRun = useCallback((targetSessionId: string, update: (run: RunPresentation) => RunPresentation) => {
    const prior = runsBySessionRef.current[targetSessionId];
    if (!prior) return;
    const next = { ...runsBySessionRef.current, [targetSessionId]: update(prior) };
    runsBySessionRef.current = next;
    setRunsBySession(next);
  }, []);
  const removeRun = useCallback((targetSessionId: string, runId?: string) => {
    const known = runsBySessionRef.current[targetSessionId];
    if (!known || (runId && known.runId && known.runId !== runId)) return;
    const next = { ...runsBySessionRef.current };
    delete next[targetSessionId];
    runsBySessionRef.current = next;
    setRunsBySession(next);
    runControllers.current.delete(targetSessionId);
  }, []);
  const setRunOutcome = useCallback((targetSessionId: string, outcome?: SessionRunOutcome) => {
    setRunOutcomesBySession((current) => withSessionRunOutcome(current, targetSessionId, outcome));
  }, []);

  const composer = view?.composer || '';
  const unread = view?.unread || 0;
  const pendingAttachmentIds = view?.pendingAttachmentIds
    ?? (sessions.find((item) => item.id === sessionId)?.activeDiagramId
      ? [sessions.find((item) => item.id === sessionId)!.activeDiagramId!]
      : []);
  const selectedCheckoutId = view?.selectedCheckoutId;
  const setComposer = useCallback((value: SetStateAction<string>) => {
    if (!sessionId) return;
    workspace.updateView(sessionId, (current) => ({
      ...current,
      composer: typeof value === 'function' ? value(current.composer) : value,
    }));
  }, [sessionId, workspace.updateView]);
  const setUnread = useCallback((value: SetStateAction<number>) => {
    if (!sessionId) return;
    workspace.updateView(sessionId, (current) => ({
      ...current,
      unread: typeof value === 'function' ? value(current.unread) : value,
    }));
  }, [sessionId, workspace.updateView]);
  const setPendingAttachmentIds = useCallback((value: SetStateAction<string[]>) => {
    if (!sessionId) return;
    workspace.updateView(sessionId, (current) => {
      const existing = current.pendingAttachmentIds ?? pendingAttachmentIds;
      return { ...current, pendingAttachmentIds: typeof value === 'function' ? value(existing) : value };
    });
  }, [pendingAttachmentIds, sessionId, workspace.updateView]);
  const setSelectedCheckoutId = useCallback((value?: string) => {
    if (!sessionId) return;
    workspace.updateView(sessionId, (current) => ({ ...current, selectedCheckoutId: value }));
  }, [sessionId, workspace.updateView]);

  const session = useMemo(() => sessions.find((item) => item.id === sessionId), [sessions, sessionId]);
  const focusedRun = sessionId ? runsBySession[sessionId] : undefined;
  const focusedRunOutcome = sessionId ? runOutcomesBySession[sessionId] : undefined;
  const sessionRunning = Boolean(focusedRun);
  const running = Object.keys(runsBySession).length > 0;
  const status = focusedRun?.status || 'Ready for an instruction';
  const preview = focusedRun?.preview || '';
  const toolActivity = focusedRun?.toolActivity || [];
  const permissions = focusedRun?.permissions || [];
  const runFailed = focusedRun?.runFailed || false;
  const decidingPermission = focusedRun?.decidingPermission;
  const selectedProject = useMemo(() => projects.find((project) => project.id === projectId), [projectId, projects]);
  const orderedCheckouts = useMemo(() => {
    const recentOrder = new Map(recentCheckoutIds.map((id, index) => [id, index]));
    return [...checkouts].sort((left, right) => {
      const leftOrder = recentOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = recentOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.name.localeCompare(right.name);
    });
  }, [checkouts, recentCheckoutIds]);
  const selectedCheckout = useMemo(
    () => checkouts.find((checkout) => checkout.id === selectedCheckoutId),
    [checkouts, selectedCheckoutId],
  );
  const selectableProviders = useMemo(() => AGENT_PROVIDERS.filter((provider) => health?.providers[provider]?.available), [health]);
  const agents = useMemo(() => session?.participants.filter((participant): participant is AgentParticipant => participant.kind === 'agent') || [], [session]);
  const activeAgent = findAgentParticipant(agents, session?.addressedAgentId)
    || findAgentParticipant(agents, session?.primaryAgentId);
  const activeProvider = activeAgent?.provider || newProvider;
  const providerHealth = health?.providers[activeProvider];
  const unsupportedModes = useMemo(() => health
    ? AGENT_MODES.filter((agentMode) => !providerHealth?.supportedModes.includes(agentMode))
    : [], [health, providerHealth]);
  // A mode the installed CLI cannot run falls back to Ask rather than failing at send time.
  const storedMode = session?.defaultMode || 'ask';
  const mode: AgentMode = unsupportedModes.includes(storedMode)
    ? providerHealth?.supportedModes[0] || 'ask'
    : storedMode;
  const attachedCanvases = useMemo(() => {
    if (!session) return [];
    return pendingAttachmentIds.flatMap((id) => {
      const target = findCanvasTarget(session, id);
      return target ? [target] : [];
    });
  }, [session, pendingAttachmentIds]);

  const applyServerSnapshot = useCallback((snapshot: PublicSession): SessionSnapshot => {
    const current = sessionsRef.current;
    const prior = current.find((item) => item.id === snapshot.id);
    const hydrated = hydrateSession(snapshot, prior, workspace.getView(snapshot.id));
    const next = prior
      ? current.map((item) => item.id === snapshot.id ? hydrated : item)
      : [hydrated, ...current];
    sessionsRef.current = next;
    setSessions(next);
    const primaryCheckoutId = snapshot.repositories.find((repository) => repository.role === 'primary')?.checkoutId;
    if (primaryCheckoutId) {
      setRecentCheckoutIds((current) => [
        primaryCheckoutId,
        ...current.filter((id) => id !== primaryCheckoutId),
      ].slice(0, 5));
    }
    return hydrated;
  }, [workspace.getView]);

  const refreshSession = useCallback(async (targetSessionId: string): Promise<SessionSnapshot | undefined> => {
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(targetSessionId)}`, { cache: 'no-store' });
      const data = await response.json() as { session?: PublicSession; error?: string };
      if (!response.ok || !data.session) return undefined;
      return applyServerSnapshot(data.session);
    } catch {
      return undefined;
    }
  }, [applyServerSnapshot]);

  const enqueueSessionMutation = useCallback((
    targetSessionId: string,
    operation: (current: SessionSnapshot) => Promise<Response>,
  ): Promise<SessionSnapshot> => {
    const prior = mutationQueues.current.get(targetSessionId) || Promise.resolve();
    let result!: Promise<SessionSnapshot>;
    const queued = prior.then(async () => {
      const current = sessionsRef.current.find((item) => item.id === targetSessionId);
      if (!current) throw new Error('Session is no longer available.');
      const response = await operation(current);
      const data = await response.json().catch(() => ({})) as { session?: PublicSession; error?: string };
      if (!response.ok || !data.session) {
        if (response.status === 409) await refreshSession(targetSessionId);
        throw new Error(data.error || 'Session update failed.');
      }
      return applyServerSnapshot(data.session);
    });
    result = queued;
    mutationQueues.current.set(targetSessionId, queued.then(() => undefined, () => undefined));
    return result;
  }, [applyServerSnapshot, refreshSession]);

  const refreshProjects = useCallback(async (): Promise<DurableProject[]> => {
    const response = await fetch('/api/projects', { cache: 'no-store' });
    const data = await response.json() as { projects?: DurableProject[]; error?: string };
    if (!response.ok) throw new Error(data.error || 'Could not load projects.');
    const next = data.projects || [];
    setProjects(next);
    return next;
  }, []);

  useEffect(() => {
    try { setSavedCheckoutId(loadSelectedCheckoutId()); } catch { /* Device preference is optional. */ }
  }, []);

  useEffect(() => {
    let current = true;
    void Promise.all([
      fetch('/api/health', { cache: 'no-store' }).then((response) => response.json() as Promise<Health>),
      fetch('/api/projects', { cache: 'no-store' }).then(async (response) => {
        const data = await response.json() as { projects?: DurableProject[]; error?: string };
        if (!response.ok) throw new Error(data.error || 'Could not load projects.');
        return data.projects || [];
      }),
      fetch('/api/checkouts', { cache: 'no-store' }).then(async (response) => {
        const data = await response.json() as Partial<CheckoutsResponse> & { error?: string };
        if (!response.ok) throw new Error(data.error || 'Could not discover repositories.');
        return data;
      }),
    ]).then(([healthResult, projectResult, checkoutResult]) => {
      if (!current) return;
      setHealth(healthResult);
      setProjects(projectResult);
      setCheckouts(checkoutResult.checkouts || []);
      setRecentCheckoutIds(checkoutResult.recentCheckoutIds || []);
      setHostId(checkoutResult.hostId);
      const healthy = AGENT_PROVIDERS.filter((provider) => healthResult.providers[provider]?.available);
      setNewProvider((current) => healthy.includes(current) ? current : healthy[0] || 'claude');
      setProjectId(projectResult[0]?.id);
      setCatalogReady(true);
    }).catch((error: unknown) => {
      if (current) {
        setNotice(error instanceof Error ? error.message : 'Could not start CodeAI.');
        setLoading(false);
      }
    });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (!catalogReady || !workspace.ready) return;
    let current = true;
    setLoading(true);
    const query = projectId ? `projectId=${encodeURIComponent(projectId)}` : 'loose=true';
    void fetch(`/api/sessions?${query}`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json() as { sessions?: PublicSession[]; error?: string };
        if (!response.ok) throw new Error(data.error || 'Could not load sessions.');
        return data.sessions || [];
      })
      .then((snapshots) => {
        if (!current) return;
        const prior = new Map(sessionsRef.current.map((item) => [item.id, item]));
        const hydrated = snapshots.map((snapshot) => hydrateSession(snapshot, prior.get(snapshot.id), workspace.getView(snapshot.id)));
        sessionsRef.current = hydrated;
        setSessions(hydrated);
        const retainedViewIds = workspace.reconcile(hydrated.map((item) => item.id));
        panelLayout.reconcile(retainedViewIds);
        setNotice(undefined);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (!current) return;
        sessionsRef.current = [];
        setSessions([]);
        setNotice(error instanceof Error ? error.message : 'Sessions could not be loaded.');
        setLoading(false);
      });
    return () => { current = false; };
  }, [catalogReady, panelLayout.reconcile, projectId, workspace.getView, workspace.ready, workspace.reconcile]);

  useEffect(() => {
    snapshotRef.current = undefined;
  }, [sessionId, session?.activeDiagramId]);

  useEffect(() => {
    if (!session || !hostId) return;
    const local = session.repositories.filter((repository) => (
      repository.hostId === hostId && checkouts.some((checkout) => checkout.id === repository.checkoutId)
    ));
    const next = local.some((repository) => repository.checkoutId === selectedCheckoutId)
      ? selectedCheckoutId
      : local.some((repository) => repository.checkoutId === savedCheckoutId)
        ? savedCheckoutId
        : local.find((repository) => repository.role === 'primary')?.checkoutId || local[0]?.checkoutId;
    setSelectedCheckoutId(next);
  }, [checkouts, hostId, savedCheckoutId, selectedCheckoutId, session]);

  useEffect(() => {
    if (!session) return;
    workspace.updateView(session.id, (current) => {
      if (
        current.activeDiagramId === session.activeDiagramId
        && current.addressedAgentId === session.addressedAgentId
        && current.defaultMode === session.defaultMode
      ) return current;
      return {
        ...current,
        activeDiagramId: session.activeDiagramId,
        addressedAgentId: session.addressedAgentId,
        defaultMode: session.defaultMode,
      };
    });
  }, [session?.activeDiagramId, session?.addressedAgentId, session?.defaultMode, session?.id, workspace.updateView]);

  useEffect(() => {
    if (session && panelLayout.conversationOpen && unread) setUnread(0);
  }, [panelLayout.conversationOpen, session, setUnread, unread]);

  const mutateSession = useCallback((id: string, operation: (value: SessionSnapshot) => SessionSnapshot) => {
    setSessions((current) => {
      const next = current.map((item) => item.id === id ? operation(item) : item);
      sessionsRef.current = next;
      return next;
    });
  }, []);

  const createSession = useCallback(async (requestedProvider: AgentProvider = newProvider) => {
    setNotice(undefined);
    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(projectId ? { projectId } : {}), provider: requestedProvider }),
      });
      const data = await response.json() as { session?: PublicSession; error?: string };
      if (!response.ok || !data.session) throw new Error(data.error || 'Could not create a session.');
      const created = applyServerSnapshot(data.session);
      panelLayout.openConversationFor(created.id);
      workspace.open(created.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not create a session.');
    }
  }, [applyServerSnapshot, newProvider, panelLayout.openConversationFor, projectId, workspace.open]);

  const switchProject = (next?: string) => {
    if (next === projectId) return;
    setLoading(true);
    setProjectId(next);
    sessionsRef.current = [];
    setSessions([]);
    setRepositoryTree(undefined);
  };

  const createProject = useCallback(async (name: string) => {
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, checkoutIds: [] }),
      });
      const data = await response.json() as { project?: DurableProject; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error || 'Could not create the project.');
      setProjects((current) => [data.project!, ...current]);
      switchProject(data.project.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not create the project.');
    }
  }, [projectId, running]);

  const renameProject = useCallback(async (project: DurableProject, name: string) => {
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: project.revision, name }),
      });
      const data = await response.json() as { project?: DurableProject; error?: string };
      if (!response.ok || !data.project) {
        if (response.status === 409) await refreshProjects().catch(() => undefined);
        throw new Error(data.error || 'Could not rename the project.');
      }
      setProjects((current) => [data.project!, ...current.filter((item) => item.id !== project.id)]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not rename the project.');
    }
  }, [refreshProjects]);

  const deleteProject = useCallback(async (project: DurableProject) => {
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: project.revision }),
      });
      const data = await response.json() as { detachedSessionCount?: number; error?: string };
      if (!response.ok) {
        if (response.status === 409) await refreshProjects().catch(() => undefined);
        throw new Error(data.error || 'Could not delete the project.');
      }
      setProjects((current) => current.filter((item) => item.id !== project.id));
      if (projectId === project.id) switchProject(undefined);
      setNotice(`${data.detachedSessionCount || 0} session${data.detachedSessionCount === 1 ? '' : 's'} moved to No project.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not delete the project.');
    }
  }, [projectId, refreshProjects]);

  const selectCheckout = useCallback((checkoutId: string) => {
    setSelectedCheckoutId(checkoutId);
    setSavedCheckoutId(checkoutId);
    setRepositoryTree(undefined);
    try { saveSelectedCheckoutId(checkoutId); } catch { /* Selection still works without persistence. */ }
  }, []);

  const updateRepositories = useCallback((update: (current: RepositoryBinding[]) => RepositoryBinding[]) => {
    if (!session || sessionRunning) return;
    void enqueueSessionMutation(session.id, (current) => {
      const repositories = update(current.repositories);
      return fetch(`/api/sessions/${encodeURIComponent(session.id)}/repositories`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: current.revision, repositories }),
      });
    }).then((updated) => {
      if (selectedCheckoutId && !updated.repositories.some((item) => item.checkoutId === selectedCheckoutId)) {
        const fallback = updated.repositories.find((item) => item.role === 'primary') || updated.repositories[0];
        setSelectedCheckoutId(fallback?.checkoutId);
      }
      if (updated.projectId) void refreshProjects().catch(() => undefined);
    }).catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : 'Could not update session repositories.');
    });
  }, [enqueueSessionMutation, refreshProjects, selectedCheckoutId, session, sessionRunning]);

  const selectDiagram = useCallback((id: string) => {
    if (!sessionId) return;
    navigationRevisions.current.set(sessionId, (navigationRevisions.current.get(sessionId) || 0) + 1);
    mutateSession(sessionId, (current) => ({ ...current, activeDiagramId: id }));
    setPendingAttachmentIds([id]);
  }, [mutateSession, sessionId]);

  /** A blank sheet the user can draw on before any diagram exists. */
  const createSketch = useCallback(() => {
    if (!sessionId || sessionRunning) return;
    const current = sessionsRef.current.find((item) => item.id === sessionId);
    if (!current) return;
    const sketch: SketchCanvas = {
      id: createUuid(),
      sessionId,
      ordinal: getSketches(current).length + 1,
      createdAt: new Date().toISOString(),
      viewBox: [0, 0, 1_600, 1_000],
    };
    navigationRevisions.current.set(sessionId, (navigationRevisions.current.get(sessionId) || 0) + 1);
    void enqueueSessionMutation(sessionId, () => fetch(
      `/api/sessions/${encodeURIComponent(sessionId)}/sketches`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sketch }),
      },
    )).then(() => {
      mutateSession(sessionId, (session) => ({ ...session, activeDiagramId: sketch.id }));
      setPendingAttachmentIds([sketch.id]);
      snapshotRef.current = undefined;
    }).catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : 'Could not create the sketch.');
    });
  }, [enqueueSessionMutation, mutateSession, sessionId, sessionRunning]);

  const removeAttachment = (id: string) => setPendingAttachmentIds((current) => current.filter((item) => item !== id));
  const toggleAttachment = (id: string) => setPendingAttachmentIds((current) => current.includes(id)
    ? current.filter((item) => item !== id)
    : current.length < 4 ? [...current, id] : current);

  const togglePin = useCallback((canvasId: string) => {
    if (!sessionId) return;
    void enqueueSessionMutation(sessionId, (current) => {
      const pinnedDiagramIds = current.pinnedDiagramIds.includes(canvasId)
        ? current.pinnedDiagramIds.filter((item) => item !== canvasId)
        : [...current.pinnedDiagramIds, canvasId];
      return fetch(`/api/sessions/${encodeURIComponent(sessionId)}/pins`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: current.revision, pinnedDiagramIds }),
      });
    }).catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : 'Could not update the pinned canvases.');
    });
  }, [enqueueSessionMutation, sessionId]);

  const handleMarksChange = useCallback((diagramId: string, marks: DrawingMark[]) => {
    if (!sessionId) return;
    const annotation = { version: 1 as const, diagramId, marks, updatedAt: new Date().toISOString() };
    mutateSession(sessionId, (current) => ({
      ...current,
      annotations: {
        ...current.annotations,
        [diagramId]: annotation,
      },
    }));
    const key = `${sessionId}:${diagramId}`;
    const prior = annotationTimers.current.get(key);
    if (prior) clearTimeout(prior);
    annotationTimers.current.set(key, setTimeout(() => {
      annotationTimers.current.delete(key);
      void enqueueSessionMutation(sessionId, (current) => {
        return fetch(`/api/sessions/${encodeURIComponent(sessionId)}/annotations`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedRevision: current.revision, annotation }),
        });
      }).catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : 'Could not save the drawing.');
      });
    }, 250));
  }, [enqueueSessionMutation, mutateSession, sessionId]);

  const handleArtifactError = useCallback((diagramId: string, artifactStatus: 'parse-error' | 'render-error', error: string) => {
    if (!sessionId) return;
    mutateSession(sessionId, (current) => updateArtifact(current, diagramId, (artifact) => ({ ...artifact, status: artifactStatus, error })));
  }, [mutateSession, sessionId]);

  const handleSnapshot = useCallback((value?: CanvasSnapshot) => {
    snapshotRef.current = value;
  }, []);

  const handleCanvasViewChange = useCallback((diagramId: string, canvasView: { zoom: number; pan: { x: number; y: number }; fitted: boolean }) => {
    if (!sessionId) return;
    workspace.updateView(sessionId, (current) => {
      const prior = current.canvasViews[diagramId];
      if (
        prior?.zoom === canvasView.zoom
        && prior.pan.x === canvasView.pan.x
        && prior.pan.y === canvasView.pan.y
        && prior.fitted === canvasView.fitted
      ) return current;
      return { ...current, canvasViews: { ...current.canvasViews, [diagramId]: canvasView } };
    });
  }, [sessionId, workspace.updateView]);

  const setMode = useCallback((next: AgentMode) => {
    if (!sessionId) return;
    mutateSession(sessionId, (current) => ({ ...current, defaultMode: next }));
  }, [mutateSession, sessionId]);

  const selectAgent = useCallback((participantId: string) => {
    if (!sessionId || sessionRunning) return;
    mutateSession(sessionId, (current) => {
      const participant = findAgentParticipant(current.participants, participantId);
      return participant ? { ...current, addressedAgentId: participantId } : current;
    });
  }, [mutateSession, sessionId, sessionRunning]);

  const addAgent = useCallback(async (provider: AgentProvider, role: AgentRole) => {
    if (!session || sessionRunning || participantBusy) return;
    setParticipantBusy(true);
    setNotice(undefined);
    const requestKey = `${session.id}:${provider}:${role}`;
    const requestId = participantRequestIds.current.get(requestKey) || createUuid();
    participantRequestIds.current.set(requestKey, requestId);
    try {
      const updated = await enqueueSessionMutation(session.id, () => fetch(
        `/api/sessions/${encodeURIComponent(session.id)}/participants`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, role, requestId }),
        },
      ));
      participantRequestIds.current.delete(requestKey);
      const added = updated.participants.find((participant) => !session.participants.some((current) => current.id === participant.id));
      if (added?.kind === 'agent') {
        mutateSession(session.id, (current) => ({ ...current, addressedAgentId: added.id }));
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not add that agent.');
    } finally {
      setParticipantBusy(false);
    }
  }, [enqueueSessionMutation, mutateSession, participantBusy, session, sessionRunning]);

  const setPrimaryAgent = useCallback(async (participantId: string) => {
    if (!session || sessionRunning || participantBusy) return;
    setParticipantBusy(true);
    setNotice(undefined);
    try {
      await enqueueSessionMutation(session.id, (current) => fetch(
        `/api/sessions/${encodeURIComponent(session.id)}/participants`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ primaryAgentId: participantId, expectedRevision: current.revision }),
        },
      ));
      mutateSession(session.id, (current) => ({
        ...current,
        addressedAgentId: participantId,
      }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not change the main agent.');
    } finally {
      setParticipantBusy(false);
    }
  }, [enqueueSessionMutation, mutateSession, participantBusy, session, sessionRunning]);

  const prefillHandoff = useCallback((participantId: string, text: string, handoffMode?: AgentMode) => {
    selectAgent(participantId);
    setComposer((current) => current.trim() ? `${current.trimEnd()}\n\n${text}` : text);
    if (handoffMode && sessionId) mutateSession(sessionId, (current) => ({ ...current, defaultMode: handoffMode }));
  }, [mutateSession, selectAgent, sessionId]);

  const decidePermission = useCallback(async (requestId: string, decision: 'allow' | 'deny') => {
    const targetSessionId = focusedSessionIdRef.current;
    if (!targetSessionId) return;
    const runId = runsBySessionRef.current[targetSessionId]?.runId;
    if (!runId) return;
    updateRun(targetSessionId, (run) => ({ ...run, decidingPermission: requestId }));
    try {
      const response = await fetch('/api/agent/permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, requestId, decision }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        updateRun(targetSessionId, (run) => ({
          ...run,
          permissions: run.permissions.filter((item) => item.requestId !== requestId),
        }));
        setNotice(data.error || 'That approval could not be delivered.');
      }
    } catch {
      setNotice('That approval could not be delivered.');
    } finally {
      updateRun(targetSessionId, (run) => ({ ...run, decidingPermission: undefined }));
    }
  }, [updateRun]);

  /**
   * Drives the UI from one run's event stream. Shared by sending a message and by reattaching to a
   * run already in flight, so a reloaded page recovers the live turn instead of losing it.
   */
  const consumeStream = useCallback(async (response: Response, turn: {
    sessionId: string;
    mode: AgentMode;
    runId?: string;
    recovering?: boolean;
    userMessageId?: string;
    activeAtSend?: string;
    navigationAtSend?: number;
    attachmentIds?: string[];
  }) => {
    let receivedFinal = false;
    let streamError: Extract<AgentEvent, { type: 'error' }> | undefined;
    let userMessageId = turn.userMessageId;
    let streamRunId = turn.runId;
    let terminalUnreadRecorded = false;
    const replayHeader = Number.parseInt(response.headers.get('X-CodeAI-Replay-Events') || '0', 10);
    const replayEventCount = turn.recovering && Number.isFinite(replayHeader)
      ? Math.max(0, replayHeader)
      : 0;
    let eventIndex = 0;
    for await (const event of readNdjson<AgentEvent>(response)) {
      const replayed = isReplayedStreamEvent(eventIndex, replayEventCount);
      eventIndex += 1;
      if (streamRunId && event.runId !== streamRunId) continue;
      streamRunId ||= event.runId;
      updateRun(turn.sessionId, (run) => applyRunEvent(
        run,
        event,
        event.type === 'tool-activity' ? toolActivityKeyRef.current++ : undefined,
      ));
      if (event.type === 'run-started') {
        userMessageId ||= event.messageId;
        mutateSession(turn.sessionId, (current) => ({ ...current, addressedAgentId: event.participantId }));
        await refreshSession(turn.sessionId);
      }
      if (event.type === 'permission-request') {
        if (!replayed && (focusedSessionIdRef.current !== turn.sessionId || !chatOpenRef.current)) {
          workspace.updateView(turn.sessionId, (current) => ({ ...current, unread: current.unread + 1 }));
        }
      }
      if (event.type === 'permission-resolved') {
        if (event.decision === 'timeout' && focusedSessionIdRef.current === turn.sessionId) {
          setNotice('An approval request expired and was denied automatically.');
        }
      }
      if (event.type === 'error') {
        streamError = event;
        setRunOutcome(turn.sessionId, runOutcomeFromError(event, turn.mode));
        mutateSession(turn.sessionId, (current) => ({ ...current, messages: current.messages.map((message) => message.id === userMessageId && message.role === 'user'
          ? { ...message, status: event.code === 'cancelled' ? 'cancelled' : 'failed', delivery: event.delivery }
          : message) }));
        if (!terminalUnreadRecorded && (focusedSessionIdRef.current !== turn.sessionId || !chatOpenRef.current)) {
          terminalUnreadRecorded = true;
          workspace.updateView(turn.sessionId, (current) => ({
            ...current,
            unread: unreadAfterRunAttention(current.unread, replayed),
          }));
        }
        await refreshSession(turn.sessionId);
      }
      if (event.type === 'assistant-message') {
        receivedFinal = true;
        const assistant = event.message as AssistantMessage;
        const currentSession = sessionsRef.current.find((item) => item.id === turn.sessionId);
        const alreadyPresent = currentSession?.messages.some((message) => message.id === assistant.id) ?? false;
        const ready = assistant.blocks.flatMap((block) => block.kind === 'diagram' && block.artifact.status === 'ready' ? [block.artifact] : []);
        const revisedFromId = !alreadyPresent
          && ready.length === 1
          && turn.activeAtSend
          && turn.attachmentIds?.includes(turn.activeAtSend)
          && currentSession?.activeDiagramId === turn.activeAtSend
          && (navigationRevisions.current.get(turn.sessionId) || 0) === turn.navigationAtSend
          ? turn.activeAtSend
          : undefined;
        mutateSession(turn.sessionId, (current) => {
          if (current.messages.some((message) => message.id === assistant.id)) return current;
          let activeDiagramId = current.activeDiagramId;
          let previousDiagramId = current.previousDiagramId;
          if (!activeDiagramId && ready[0]) activeDiagramId = ready[0].id;
          else if (revisedFromId) {
            previousDiagramId = revisedFromId;
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
        if (revisedFromId) {
          workspace.updateView(turn.sessionId, (current) => {
            const pendingAttachmentIds = replacePendingCanvasRevision(
              current.pendingAttachmentIds,
              revisedFromId,
              ready[0].id,
            );
            return pendingAttachmentIds === current.pendingAttachmentIds
              ? current
              : { ...current, pendingAttachmentIds };
          });
        }
        if (!terminalUnreadRecorded
          && (replayed || !alreadyPresent)
          && (focusedSessionIdRef.current !== turn.sessionId || !chatOpenRef.current)) {
          terminalUnreadRecorded = true;
          workspace.updateView(turn.sessionId, (current) => ({
            ...current,
            unread: unreadAfterRunAttention(current.unread, replayed),
          }));
        }
        if (ready.length > 1) setNotice(`${ready.length} diagram results are ready in history. The active canvas was preserved.`);
        await refreshSession(turn.sessionId);
      }
    }
    return { receivedFinal, streamError, userMessageId, runId: streamRunId };
  }, [mutateSession, refreshSession, setRunOutcome, updateRun, workspace.updateView]);

  const send = useCallback(async (override?: { text: string; mode: AgentMode; participantId?: string }) => {
    if (!session || runsBySessionRef.current[session.id]) return;
    if (!session.repositories.some((repository) => repository.role === 'primary')) {
      setNotice('Attach a repository and make it primary before running an agent turn. The canvas and participant setup remain available.');
      panelLayout.openRepository();
      return;
    }
    const turnAgent = findAgentParticipant(session.participants, override?.participantId) || activeAgent;
    if (!turnAgent) return;
    const selected = pendingAttachmentIds.flatMap((id) => {
      const canvas = findCanvasTarget(session, id);
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
    setRunOutcome(session.id);
    const attachmentPayload: DiagramMessageAttachment[] = [];
    let compositeWarning = false;
    for (const canvas of selected) {
      const id = canvasTargetId(canvas);
      const marks = session.annotations[id]?.marks || [];
      const snapshot = id === session.activeDiagramId ? snapshotRef.current : undefined;
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
    const human = session.participants.find((participant) => participant.kind === 'human');
    if (!human) {
      setNotice('This session has no local user identity.');
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
    const activeAtSend = session.activeDiagramId;
    const navigationAtSend = navigationRevisions.current.get(session.id) || 0;
    mutateSession(session.id, (current) => ({
      ...current,
      // A sketch-only turn would otherwise title the session with the whole synthesized instruction.
      title: current.messages.length === 0 ? (typed ? typed.slice(0, 56) : 'Sketch session') : current.title,
      messages: [...current.messages, userMessage],
    }));
    if (!override) setComposer('');
    putRun({
      sessionId: session.id,
      participantId: turnAgent.id,
      mode: turnMode,
      state: 'running',
      status: turnMode === 'agent'
        ? `Starting ${turnAgent.displayName}`
        : `Starting read-only ${turnAgent.displayName}`,
      preview: '',
      toolActivity: [],
      runFailed: false,
      permissions: [],
    });
    const controller = new AbortController();
    runControllers.current.set(session.id, controller);
    let streamError: Extract<AgentEvent, { type: 'error' }> | undefined;
    let streamRunId: string | undefined;

    try {
      const response = await fetch('/api/agent/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.id,
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
        sessionId: session.id,
        mode: turnMode,
        userMessageId: userId,
        activeAtSend,
        navigationAtSend,
        attachmentIds: pendingAttachmentIds,
      });
      streamError = outcome.streamError;
      streamRunId = outcome.runId;
      if (!outcome.receivedFinal && !streamError) throw new Error('Agent stream ended without a final response.');
    } catch (error) {
      const cancelled = controller.signal.aborted;
      if (!streamError) {
        if (!cancelled) updateRun(session.id, (run) => ({ ...run, runFailed: true }));
        const message = cancelled
          ? 'The request was cancelled. Earlier conversation and diagrams are unchanged.'
          : error instanceof Error ? error.message : 'Agent request failed.';
        setRunOutcome(session.id, {
          runId: streamRunId,
          message,
          missingProviderSession: false,
        });
        if (focusedSessionIdRef.current !== session.id || !chatOpenRef.current) {
          workspace.updateView(session.id, (current) => ({ ...current, unread: current.unread + 1 }));
        }
        mutateSession(session.id, (current) => ({ ...current, messages: current.messages.map((message) => message.id === userId && message.role === 'user'
          ? { ...message, status: cancelled ? 'cancelled' : 'failed', delivery: cancelled ? 'possibly-sent' : 'not-sent' }
          : message) }));
        await refreshSession(session.id);
      }
    } finally {
      removeRun(session.id, streamRunId);
    }
  }, [activeAgent, composer, consumeStream, health, mode, mutateSession, panelLayout.openRepository, pendingAttachmentIds, putRun, refreshSession, removeRun, session, setRunOutcome, updateRun, workspace.updateView]);

  const busyRunLabel = busyRun && (
    sessions.find((item) => item.id === busyRun.sessionId)?.title
    || `session ${busyRun.sessionId.slice(0, 8)}`
  );
  const displayedNotice = focusedRunOutcome?.message || notice;
  const unreadBySession = Object.fromEntries(Object.entries(workspace.scope.views).map(([id, state]) => [id, state.unread]));
  const runTabsBySession = Object.fromEntries(Object.entries(runsBySession).map(([id, run]) => [id, {
    state: run.state,
    status: run.status,
    queuePosition: run.queuePosition,
    pendingApprovals: Math.max(run.pendingPermissionCount || 0, run.permissions.length),
  }]));

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
    const targetSessionId = focusedSessionIdRef.current;
    if (!targetSessionId) return;
    const runId = runsBySessionRef.current[targetSessionId]?.runId;
    if (!runId) {
      runControllers.current.get(targetSessionId)?.abort();
      return;
    }
    try {
      const response = await fetch('/api/agent/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        setRunOutcome(targetSessionId, {
          runId,
          message: data.error || 'That agent run could not be cancelled.',
          missingProviderSession: false,
        });
      }
    } catch {
      // Do not detach from work whose cancellation outcome is unknown. The stream remains the
      // authority and a later terminal event can still reconcile this session normally.
      setRunOutcome(targetSessionId, {
        runId,
        message: 'Cancellation could not be confirmed. The turn may still be running.',
        missingProviderSession: false,
      });
    }
  }, [setRunOutcome]);

  // Recover every active turn in this project's workspace. Each attachment owns its controller and
  // presentation, so one stale or failed stream cannot disturb another session's live work.
  useEffect(() => {
    if (loading || !workspace.ready) return;
    const discoveryController = new AbortController();
    const attachmentControllers = new Map<string, AbortController>();
    void (async () => {
      try {
        const response = await fetch('/api/agent/runs', {
          cache: 'no-store',
          signal: discoveryController.signal,
        });
        const data = await response.json().catch(() => ({})) as RunDiscovery & { error?: string };
        if (!response.ok) throw new Error(data.error || 'Could not discover running turns.');

        const relevant: Array<{ run: RunDescriptor; session: SessionSnapshot }> = [];
        for (const run of data.active) {
          // A local send already owns this session's response stream. Never replace its subscriber.
          if (runsBySessionRef.current[run.sessionId]) continue;
          let owningSession = sessionsRef.current.find((item) => item.id === run.sessionId);
          if (!owningSession) {
            const sessionResponse = await fetch(`/api/sessions/${encodeURIComponent(run.sessionId)}`, {
              cache: 'no-store',
              signal: discoveryController.signal,
            });
            const sessionData = await sessionResponse.json().catch(() => ({})) as { session?: PublicSession; error?: string };
            if (!sessionResponse.ok || !sessionData.session) continue;
            if (sessionData.session.projectId !== projectId) continue;
            owningSession = applyServerSnapshot(sessionData.session);
          }
          if (owningSession.projectId !== projectId) continue;
          relevant.push({ run, session: owningSession });
        }

        if (relevant.length) setNotice(`Reconnected to ${relevant.length} active turn${relevant.length === 1 ? '' : 's'}.`);
        await Promise.allSettled(relevant.map(async ({ run, session: owningSession }) => {
          workspace.ensure(run.sessionId);
          setRunOutcome(run.sessionId);
          const recoveredSession = await refreshSession(run.sessionId) || owningSession;
          const participant = findAgentParticipant(recoveredSession.participants, run.participantId);
          const acceptedMessage = latestRunUserMessage(recoveredSession.messages, run.participantId);
          const recoveredMode = acceptedMessage?.mode || participant?.defaultMode || 'agent';
          putRun({
            runId: run.runId,
            sessionId: run.sessionId,
            participantId: run.participantId,
            mode: recoveredMode,
            state: run.state === 'finished' ? 'running' : run.state,
            queuePosition: run.queuePosition,
            status: run.state === 'queued'
              ? `Queued · position ${run.queuePosition || 1}`
              : run.state === 'needs-you' ? 'Waiting for your approval' : 'Reconnecting to the running turn',
            preview: '',
            toolActivity: [],
            runFailed: false,
            permissions: [],
            pendingPermissionCount: run.pendingPermissionCount,
          });
          mutateSession(run.sessionId, (current) => ({ ...current, addressedAgentId: run.participantId }));
          const controller = new AbortController();
          attachmentControllers.set(run.runId, controller);
          runControllers.current.set(run.sessionId, controller);
          try {
            const stream = await fetch(`/api/agent/stream?runId=${encodeURIComponent(run.runId)}`, {
              cache: 'no-store',
              signal: controller.signal,
            });
            if (stream.status === 404) return;
            if (!stream.ok) throw new Error('Could not attach to the running turn.');
            await consumeStream(stream, {
              sessionId: run.sessionId,
              runId: run.runId,
              mode: recoveredMode,
              recovering: true,
              userMessageId: acceptedMessage?.id,
            });
          } catch {
            if (!controller.signal.aborted) {
              updateRun(run.sessionId, (current) => ({ ...current, runFailed: true }));
              setRunOutcome(run.sessionId, {
                runId: run.runId,
                message: 'Lost the connection to a running turn. Its work continues on this machine.',
                missingProviderSession: false,
              });
              if (focusedSessionIdRef.current !== run.sessionId || !chatOpenRef.current) {
                workspace.updateView(run.sessionId, (current) => ({ ...current, unread: current.unread + 1 }));
              }
            }
          } finally {
            await refreshSession(run.sessionId);
            removeRun(run.sessionId, run.runId);
          }
        }));
      } catch (error) {
        if (!discoveryController.signal.aborted) {
          setNotice(error instanceof Error ? error.message : 'Could not recover running turns.');
        }
      }
    })();
    return () => {
      discoveryController.abort();
      for (const controller of attachmentControllers.values()) controller.abort();
    };
  }, [applyServerSnapshot, consumeStream, loading, mutateSession, projectId, putRun, refreshSession, removeRun, setRunOutcome, updateRun, workspace.ensure, workspace.ready, workspace.updateView]);

  const executePlan = useCallback((participantId: string) => {
    const planAgent = findAgentParticipant(session?.participants || [], participantId);
    const planHealth = planAgent && health?.providers[planAgent.provider];
    if (!planAgent || !planHealth?.supportedModes.includes('agent')) {
      setNotice(planHealth?.message || 'That agent cannot execute in Agent mode.');
      return;
    }
    void send({ text: EXECUTE_PLAN_INSTRUCTION, mode: 'agent', participantId });
  }, [health, send, session?.participants]);

  // Keep the loading surface in the named canvas area. Rendering the interactive header only
  // after hydration also lets its device-owned theme controls reflect the pre-paint preference.
  if (loading) {
    return (
      <div
        ref={shellRef}
        className={`app-shell workspace-loading dock-capacity-${panelLayout.dockCapacity}`}
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
        <nav className="header-breadcrumbs" aria-label="Current project and session">
          <span className="breadcrumb-separator" aria-hidden="true">/</span>
          <ProjectPicker
            projects={projects}
            value={projectId}
            disabled={running}
            onChange={switchProject}
            onCreate={(name) => void createProject(name)}
            onRename={(project, name) => void renameProject(project, name)}
            onDelete={(project) => void deleteProject(project)}
          />
          <span className="breadcrumb-separator" aria-hidden="true">/</span>
          <SessionPicker
            sessions={sessions}
            value={sessionId}
            providers={selectableProviders}
            newProvider={newProvider}
            onChange={workspace.open}
            onNewProvider={setNewProvider}
            onNew={(provider) => void createSession(provider)}
          />
        </nav>
        {/* Grouped by what each control does: panels, then the session action, then readiness,
            then the one preference — with a rule before it so four kinds of control in one row
            stop reading as a single undifferentiated strip. */}
        <div className="header-actions">
          {session && (
            <button
              type="button"
              className={`repository-toggle ${repositoryTree?.files.length ? 'dirty' : ''}`}
              aria-pressed={panelLayout.repositoryOpen}
              onClick={panelLayout.toggleRepository}
            >
              Repository{repositoryTree?.files.length ? <span>{repositoryTree.files.length}</span> : null}
            </button>
          )}
          {session && (
            <button
              type="button"
              className={`run-status-toggle ${focusedRun?.state === 'running' ? 'working' : ''} ${focusedRun?.state === 'queued' ? 'queued' : ''} ${focusedRun?.state === 'needs-you' ? 'awaiting-approval' : ''}`}
              aria-pressed={panelLayout.conversationOpen}
              aria-label={focusedRun?.state === 'needs-you'
                ? `${permissions.length} action${permissions.length === 1 ? '' : 's'} waiting for your approval. ${panelLayout.conversationOpen ? 'Close' : 'Open'} conversation`
                : focusedRun?.state === 'queued'
                  ? `${status}. ${panelLayout.conversationOpen ? 'Close' : 'Open'} conversation`
                : sessionRunning
                  ? `Agent working: ${status}. ${panelLayout.conversationOpen ? 'Close' : 'Open'} conversation`
                  : panelLayout.conversationOpen ? 'Close conversation' : 'Open conversation'}
              title={sessionRunning || permissions.length ? status : 'Open conversation'}
              onClick={() => {
                if (panelLayout.conversationOpen) panelLayout.closeConversation();
                else {
                  panelLayout.openConversation();
                  setUnread(0);
                }
              }}
            >
              <span className="run-status-dot" aria-hidden="true" />
              <span>{focusedRun?.state === 'needs-you' ? 'Approval needed' : sessionRunning ? status : 'Conversation'}</span>
              {focusedRun?.state === 'needs-you' && permissions.length > 0 && <span className="approval-badge">{permissions.length}</span>}
              {unread > 0 && <span className="unread-badge">{unread}</span>}
            </button>
          )}
          {session && <button type="button" onClick={() => exportSession(session)}>Export</button>}
          <span
            className={`health-pill ${providerHealth?.available ? 'ready' : 'warning'}`}
            title={providerHealth?.message || health?.message || 'Local readiness'}
          >
            <span />{providerHealth?.available ? `${PROVIDER_LABELS[activeProvider]} ready` : 'Setup needed'}
          </span>
          <span className="header-divider" aria-hidden="true" />
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
        </div>
      </header>

      <WorkspaceTabs
        sessions={sessions}
        openSessionIds={workspace.scope.openSessionIds}
        focusedSessionId={sessionId}
        runsBySession={runTabsBySession}
        unreadBySession={unreadBySession}
        onFocus={workspace.open}
        onClose={(id) => { workspace.close(id); setRepositoryTree(undefined); }}
      />

      {session && (
        <div className="repository-region">
          <RepositoryPanel
            checkoutId={selectedCheckout?.id}
            repositoryName={selectedCheckout?.name || 'No repository'}
            manager={(
              <RepositoryManager
                repositories={session.repositories}
                checkouts={orderedCheckouts}
                hostId={hostId}
                selectedCheckoutId={selectedCheckoutId}
                disabled={sessionRunning}
                onSelect={selectCheckout}
                onChange={updateRepositories}
              />
            )}
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

      {displayedNotice && (
        <div className="notice-banner" role="status">
          <span>{displayedNotice}</span>
          {!focusedRunOutcome && busyRun && <button type="button" onClick={() => void cancelBusyRun()}>Cancel {busyRunLabel}</button>}
          {focusedRunOutcome?.missingProviderSession && <button type="button" onClick={() => { void createSession(activeProvider); setComposer(`Continue this session in a new CodeAI session. Here is a brief visible recap:\n\n${session?.messages.slice(-6).map((message) => `${session.participants.find((participant) => participant.id === message.authorId)?.displayName || message.role}: ${message.role === 'user' ? message.text : message.rawMarkdown.slice(0, 600)}`).join('\n\n') || ''}`); }}>Continue in new session</button>}
          {focusedRunOutcome?.continueMode && !sessionRunning && <button type="button" onClick={() => void send({ text: 'Continue where you stopped.', mode: focusedRunOutcome.continueMode! })}>Continue</button>}
          <button type="button" aria-label="Dismiss notice" onClick={() => {
            if (focusedRunOutcome && sessionId) setRunOutcome(sessionId);
            else { setNotice(undefined); setBusyRun(undefined); }
          }}>×</button>
        </div>
      )}

      {!session ? (
        <div className="welcome-screen">
          <div className="welcome-orbit"><span /><span /><span /><div className="brand-mark">C</div></div>
          <span className="eyebrow">Local exploration, planning, and building</span>
          <h1>{selectedProject ? selectedProject.name : 'No project'},<br />as a living map.</h1>
          <p>Start a persistent session with or without a repository. The canvas, participants, and conversation record work immediately; attach a repository when you want an agent turn or working-tree context.</p>
          <button type="button" className="primary-cta" disabled={!selectableProviders.length} onClick={() => void createSession(newProvider)}>New session <span>→</span></button>
          <small>{selectableProviders.length
            ? checkouts.length
              ? `${selectableProviders.map((provider) => PROVIDER_LABELS[provider]).join(' and ')} run locally on your own login. Ask and Plan stay read-only; Agent appears only where its approval contract is verified.`
              : 'No repositories were discovered. You can still create a repository-free session; set CODEAI_REPOSITORIES_ROOT when you need agent turns.'
            : 'Install and authenticate Claude Code or Codex to start a local session.'}</small>
        </div>
      ) : (
        <>
          <CanvasWorkspace
            session={session}
            theme={theme}
            unread={unread}
            pendingApprovals={sessionRunning ? permissions.length : 0}
            running={sessionRunning}
            runFailed={sessionRunning && runFailed}
            toolActivity={sessionRunning ? toolActivity : []}
            focusMode={panelLayout.focusMode}
            canvasView={session.activeDiagramId ? view?.canvasViews[session.activeDiagramId] : undefined}
            onComposer={setComposer}
            onOpenChat={() => { panelLayout.openConversation(); setUnread(0); }}
            onOpenHistory={panelLayout.openHistory}
            onToggleFocus={panelLayout.toggleFocusMode}
            onSelectDiagram={selectDiagram}
            onNewSketch={createSketch}
            onMarksChange={handleMarksChange}
            onCanvasViewChange={handleCanvasViewChange}
            onSnapshot={handleSnapshot}
            onArtifactError={handleArtifactError}
          />
          <div className="conversation-region">
            <ConversationDrawer
              open={panelLayout.conversationOpen}
              session={session}
              theme={theme}
              agents={agents}
              activeAgent={activeAgent}
              healthyProviders={selectableProviders}
              participantBusy={participantBusy}
              preview={sessionRunning ? preview : ''}
              toolActivity={sessionRunning ? toolActivity : []}
              permissions={sessionRunning ? permissions : []}
              decidingPermission={decidingPermission}
              running={sessionRunning}
              cancelReady={Boolean(focusedRun?.runId)}
              turnBlocked={false}
              status={sessionRunning ? status : 'Ready for an instruction'}
              composer={composer}
              mode={mode}
              unsupportedModes={unsupportedModes}
              attached={attachedCanvases}
              markCounts={Object.fromEntries(attachedCanvases.map((canvas) => [canvasTargetId(canvas), session.annotations[canvasTargetId(canvas)]?.marks.length || 0]))}
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
              session={session}
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
