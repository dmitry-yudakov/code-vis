'use client';

import Link from 'next/link';

import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import NativeSelect from '@mui/material/NativeSelect';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

import { worktreeCreationError } from '@/features/conversation/worktreeCreationError';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type SetStateAction } from 'react';
import type {
  AgentEvent, AgentExecution, AgentMode, AgentParticipant, AgentProvider, AgentRole, ArenaMachineSnapshot,
  ArenaSessionSummary, AssistantMessage, SessionSnapshot, DiagramArtifact, ExecutionHealth,
  CheckoutSummary, CheckoutsResponse, DiagramMessageAttachment, DrawingMark, DurableProject, GitWorkingTree,
  GlobalInstructionsChoice, MachineInstructions, ModelSelection, ProviderHealth, PublicSession, RepositoryBinding, ReportAttachmentRecord, RunDescriptor, RunDiscovery,
  SecurityLevel, SketchCanvas, UserMessage,
} from '@/shared/types';
import { validateTextFiles, type TextFile } from '@/shared/textFiles';
import type { ActiveFileContext } from '@/shared/activeFileContext';
import { prepareTextFile } from '@/features/conversation/textFiles';
import { FILE_ONLY_INSTRUCTION } from '@/features/session-launch/sessionLaunch';
import type { ImmersiveReportSummary } from '@/shared/immersiveReport';
import { MAX_IMAGES_PER_MESSAGE, MAX_REPORTS_PER_MESSAGE } from '@/shared/limits';
import { IMAGE_ONLY_INSTRUCTION, carriesFiles, prepareImage, type PendingImage } from '@/features/conversation/imageAttachments';
import { offeredModelSelection } from '@/shared/modelChoices';
import { readNdjson } from '@/features/conversation/ndjson';
import { DraftIdentity, immutableEvidence, reconcileMessageAcceptance, type DraftSource } from '@/features/conversation/draftLifecycle';
import {
  applyRunEvent, isReplayedStreamEvent, latestRunUserMessage, runOutcomeFromError,
  unreadAfterRunAttention, withSessionRunOutcome,
  type RunPresentation, type SessionRunOutcome,
} from '@/features/conversation/runPresentation';
import { EXECUTE_PLAN_INSTRUCTION } from '@/shared/plan';
import { compositePng } from '@/features/diagram/annotations/compositeExport';
import { createUuid } from '@/shared/uuid';
import {
  canvasTargetId, exportSession, findCanvasTarget, getArtifacts, getSketches, hydrateSession,
  loadSelectedCheckoutId, saveSelectedCheckoutId, mergeTurnActivity, reconcileSessionTitles, mergeSessionPage,
} from '@/features/conversation/sessionStore';
import { ProjectPicker } from '@/features/projects/ProjectPicker';
import { NewProjectDialog } from '@/features/projects/NewProjectDialog';
import { ProjectLogoDialog } from '@/features/projects/ProjectLogoDialog';
import { ProjectManagementDialog } from '@/features/projects/ProjectManagementDialog';
import type { ProjectAction } from '@/features/projects/ProjectActions';
import { SessionCreationForm, SessionPicker } from '@/features/conversation/SessionPicker';
import { WorkspaceTabs } from '@/features/conversation/WorkspaceTabs';
import { SessionArchivePicker } from '@/features/conversation/SessionArchivePicker';
import { useSessionLauncher } from '@/features/session-launch/useSessionLauncher';
import { SessionSetupDialog } from '@/features/session-launch/SessionSetupDialog';
import type { LaunchSettings } from '@/features/session-launch/sessionLaunch';
import { Arena } from '@/features/arena/Arena';
import { MachineSettingsDialog } from '@/features/arena/MachineSettingsDialog';
import { ObserverDialog } from '@/features/observer/ObserverDialog';
import { buildMultiMachineInbox, unreadArenaAttention, viewedArenaCompletionIds, type ArenaAttentionItem } from '@/features/arena/arenaModel';
import { ARENA_SECTION_PATHS, arenaSectionForPathname } from '@/features/arena/routes';
import { useArena } from '@/features/arena/useArena';
import { useArenaReplies, type ArenaReplyOptions } from '@/features/arena/useArenaReplies';
import { ConversationDrawer } from '@/features/conversation/ConversationDrawer';
import { DiagramNavigator } from '@/features/diagram/components/DiagramNavigator';
import { CanvasWorkspace, type CanvasSnapshot } from '@/features/diagram/components/CanvasWorkspace';
import { prepareImageForSend } from '@/features/diagram/annotations/imageCanvas';
import { EMPTY_CANVAS_SVG } from '@/features/diagram/components/DiagramCanvas';
import { renderMermaid } from '@/features/diagram/mermaid/mermaidRenderer';
import { useRepositoryChanges } from '@/features/repository/useRepositoryChanges';
import { useRepositoryDiff } from '@/features/repository/useRepositoryDiff';
import { useRepositoryAutoRefresh } from '@/features/repository/useRepositoryAutoRefresh';
import { ReportsPanel } from '@/features/reports/ReportsPanel';
import { REPORT_ONLY_INSTRUCTION, capturedReportTarget, pendingReportLabel } from '@/features/reports/reportModel';
import { useImmersiveReports } from '@/features/reports/useImmersiveReports';
import { useTurnCheckpoint } from '@/features/conversation/useTurnCheckpoint';
import { CodeAiLifecycleDialog, CodeAiLifecycleMenu } from '@/features/lifecycle/CodeAiLifecycleMenu';
import { lifecycleConfirmation } from '@/features/lifecycle/lifecycleFlow';
import { takeRestartProject, useCodeAiLifecycle } from '@/features/lifecycle/useCodeAiLifecycle';
import { immersiveViewKey } from './immersive/workspaceLayout';
import { RepositoryPanel } from '@/features/repository/RepositoryPanel';
import { RepositoryFilePane } from '@/features/repository/RepositoryFilePane';
import { RepositoryFilesProvider, useRepositoryFileWorkspace } from '@/features/repository/RepositoryFilesProvider';
import { WorkspaceShortcuts } from './WorkspaceShortcuts';
import { RepositoryManager } from '@/features/repository/RepositoryManager';
import { DeviceMenu } from '@/features/devices/DeviceMenu';
import { useDeviceAccess } from '@/features/devices/DeviceAccess';
import { machineApiBase, machineApiPath } from '@/features/machines/routes';
import { findAgentParticipant, PROVIDER_LABELS } from '@/shared/participants';
import { instructionsLine, isolatesLocalCodex, LOCAL_CODEX_ISOLATION_MESSAGE, nativeClaudeIsolationIssue } from '@/shared/globalInstructions';
import type { DesktopPopoverHandle } from './DesktopPopover';
import { useTheme, type ThemePreference } from './useTheme';
import { LIGHT_THEMES, type LightThemeName } from '@/shared/design/tokens';
import { usePanelLayout } from './usePanelLayout';
import { ActivityBar, ARENA_SHORTCUT_HINT } from './ActivityBar';
import { ShellIcon } from './ShellIcon';
import { LayoutToggles } from './LayoutToggles';
import { useWorkspaceViews } from './useWorkspaceViews';
import { parseWorkspaceLocation, workspaceHref, type WorkspaceTarget } from './workspaceLocation';
import { useDevicePreferences } from './useDevicePreferences';
import { agentModelSelection, inheritedMode, type LaunchInstructions } from './devicePreferences';
import { changesCheckout, composerMode, unsupportedModes as unsupportedAgentModes } from '@/shared/agentModes';
import {
  parseSpatialView, reconcileSpatialView, replacePendingCanvasRevision, resetSpatialView, withPendingReport, withPendingReports, workspaceScopeKey,
  type CanvasSurface, type SpatialViewState,
} from './workspaceViews';
import { ImmersiveBoundary } from './immersive/ImmersiveBoundary';
import { usePermissionDecisions } from './usePermissionDecisions';
import { permissionKey, type PermissionResult, type PermissionTarget } from './immersive/sessionControls';
import { ToastStack } from './ToastStack';
import { runOutcomeTone, standingToast, type Toast } from './toasts';
import { useToasts } from './useToasts';
import type { ImmersiveSessionChoice } from '@/features/diagram/spatial/immersiveTypes';
import type { ImmersiveReportPlacement, SessionCreation } from './immersive/sessionControls';
import { PaneMaximizeButton } from './PaneMaximizeButton';
import { CONVERSATION_MIN_WIDTH, REPOSITORY_MIN_WIDTH, type Pane, type SideTab } from './panelLayout';

type SessionRead = import('@/shared/types').SessionPage;

interface Health {
  worktrees?: import('@/shared/types').WorktreeCapability;
  securityLevel?: SecurityLevel;
  ok: boolean;
  hostLabel: string;
  repositoriesRootReady: boolean;
  dataDirectoryReady: boolean;
  providers: Record<AgentProvider, ProviderHealth>;
  executions?: ExecutionHealth;
  /** Session files on this machine that only a newer CodeAI can open; absent for a remote machine. */
  newerFormatSessions?: number;
  /** This machine's Global instructions switches and files; absent for a remote machine, whose own they are. */
  instructions?: MachineInstructions;
  message?: string;
}

const AGENT_PROVIDERS: readonly AgentProvider[] = ['claude', 'codex'];
const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];

const NO_IMAGES: PendingImage[] = [];

/** Sent when the user draws and hits send without typing anything. */
const SKETCH_ONLY_INSTRUCTION = 'I drew the attached sketch. Read it as my instruction: say what you understand it to mean, then answer it against this repository.';

function updateArtifact(session: SessionSnapshot, id: string, update: (artifact: DiagramArtifact) => DiagramArtifact): SessionSnapshot {
  return {
    ...session,
    canvases: session.canvases?.map(artifact => artifact.id === id ? update(artifact) : artifact),
    messages: session.messages.map((message) => message.role === 'assistant' ? {
      ...message,
      blocks: message.blocks.map((block) => block.kind === 'diagram' && block.artifact.id === id
        ? { ...block, artifact: update(block.artifact) }
        : block),
    } : message),
  };
}

const emptyDraft = () => '';
const ignoreDraft = () => () => {};

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const location = useMemo(() => parseWorkspaceLocation(new URLSearchParams(search)), [search]);
  const navigationKey = `${pathname}?${search}`;
  const navigationKeyRef = useRef(navigationKey);
  navigationKeyRef.current = navigationKey;
  const [navigationReady, setNavigationReady] = useState(false);
  const [resolvedNavigation, setResolvedNavigation] = useState('');
  const [navigationFailure, setNavigationFailure] = useState<{ key: string; message: string }>();
  const [navigationRetry, setNavigationRetry] = useState(0);
  const arenaSection = arenaSectionForPathname(pathname);
  const arenaOpen = arenaSection !== undefined;
  const { status: deviceAccess, refresh: refreshDeviceAccess } = useDeviceAccess();
  const { preference: themePreference, resolved: theme, setPreference: setThemePreference, lightTheme, setLightTheme } = useTheme();
  const [health, setHealth] = useState<Health>();
  const [localExecutionHealth, setLocalExecutionHealth] = useState<ExecutionHealth>();
  // Kept beside the health of whichever machine is shown: these are the home machine's own.
  const [localInstructions, setLocalInstructions] = useState<MachineInstructions>();
  const [projects, setProjects] = useState<DurableProject[]>([]);
  const [checkouts, setCheckouts] = useState<CheckoutSummary[]>([]);
  const [recentCheckoutIds, setRecentCheckoutIds] = useState<string[]>([]);
  const [hostId, setHostId] = useState<string>();
  const [localMachineId, setLocalMachineId] = useState<string>();
  const navigateWorkspace = useCallback((target: WorkspaceTarget, replace = false) => {
    const href = workspaceHref(target, localMachineId);
    if (window.location.pathname === '/') {
      // These query parameters describe client state; Next integrates native history with its hooks.
      if (`/${window.location.search}` !== href) window.history[replace ? 'replaceState' : 'pushState'](null, '', href);
    } else router[replace ? 'replace' : 'push'](href, { scroll: false });
  }, [localMachineId, router]);
  const [machineId, setMachineId] = useState<string>();
  const [projectId, setProjectId] = useState<string>();
  const [savedCheckoutId, setSavedCheckoutId] = useState<string>();
  const [catalogReady, setCatalogReady] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const arenaLink = useRef<HTMLAnchorElement>(null);
  const moreMenuRef = useRef<DesktopPopoverHandle>(null);
  const [machineSettingsOpen, setMachineSettingsOpen] = useState(false);
  const [observerOpen, setObserverOpen] = useState(false);
  const [providerUpdateCount, setProviderUpdateCount] = useState(0);
  const [sessions, setSessions] = useState<SessionSnapshot[]>([]);
  const [sessionList, setSessionList] = useState<{ scope: string; items: ArenaSessionSummary[] }>({ scope: '', items: [] });
  const workspaceMachineId = machineId && localMachineId && machineId !== localMachineId ? machineId : undefined;
  const workspace = useWorkspaceViews(projectId, workspaceMachineId);
  const { preferences, update: updatePreferences } = useDevicePreferences();
  const arena = useArena();
  const [refreshingArena, setRefreshingArena] = useState(false);
  const [creatingArenaProject, setCreatingArenaProject] = useState(false);
  useEffect(() => { if (!arenaOpen) setCreatingArenaProject(false); }, [arenaOpen]);
  const arenaMachinesRef = useRef(arena.machines);
  arenaMachinesRef.current = arena.machines;
  const apiPath = useCallback(
    (path: string) => machineApiPath(path, machineId, localMachineId),
    [localMachineId, machineId],
  );
  const repositoryApiBase = machineApiBase(machineId, localMachineId);
  const sessionId = !arenaOpen && location.kind === 'project' ? undefined : workspace.scope.focusedSessionId;
  const view = sessionId ? workspace.scope.views[sessionId] : undefined;
  const session = useMemo(() => sessions.find((item) => item.id === sessionId), [sessions, sessionId]);
  const selectedProject = useMemo(() => projects.find((project) => project.id === projectId), [projectId, projects]);
  const projectWorkspace = !sessionId && Boolean(selectedProject);
  const projectScope = JSON.stringify([machineId, projectId]);
  const reconciledArchiveRevisions = useRef(new Map<string, number>());
  const sessionChoicesRef = useRef<ArenaSessionSummary[]>([]);
  const sessionChoicesScope = useRef<string | undefined>(undefined);
  const sessionChoices = useMemo(() => {
    const choices = new Map((sessionList.scope === projectScope ? sessionList.items : []).map(item => [item.id, item]));
    for (const summary of arena.machines.find(item => item.machine.id === machineId)?.sessions || []) {
      const archivedRevision = reconciledArchiveRevisions.current.get(JSON.stringify([machineId, summary.id])) ?? -1;
      if (summary.projectId === projectId && summary.revision >= archivedRevision
        && summary.revision >= (choices.get(summary.id)?.revision ?? -1)) choices.set(summary.id, summary);
    }
    for (const saved of sessions) {
      if (saved.machineId !== machineId || saved.projectId !== projectId || (choices.get(saved.id)?.revision ?? -1) > saved.revision) continue;
      choices.set(saved.id, { ...choices.get(saved.id), id: saved.id, title: saved.title, revision: saved.revision,
        projectId: saved.projectId, execution: saved.execution, updatedAt: saved.updatedAt,
        repositoryCheckoutIds: saved.repositories.map(item => item.checkoutId), primaryAgentId: saved.primaryAgentId,
        agents: saved.participants.flatMap(item => item.kind === 'agent' ? [item] : []),
      });
    }
    // Once the initial catalog arrives, retain displayed order as sessions load or append.
    // Until then, keep the full saved order so an early URL read cannot replace its seed.
    const order = sessionChoicesScope.current === projectScope && sessionChoicesRef.current.length
      ? sessionChoicesRef.current.map(item => item.id) : workspace.scope.openSessionIds;
    return [...new Set([...order, ...choices.keys()])].flatMap(id => choices.has(id) ? [choices.get(id)!] : []);
  }, [arena.machines, machineId, projectId, projectScope, sessionList, sessions, workspace.scope.openSessionIds]);
  sessionChoicesRef.current = sessionChoices;
  sessionChoicesScope.current = sessionList.scope === projectScope ? projectScope : undefined;
  const panelLayout = usePanelLayout(shellRef, Boolean(sessionId) || projectWorkspace, sessionId,
    session ? (session.history?.canvasIds.length ?? getArtifacts(session).length + getSketches(session).length) > 0 : undefined, projectWorkspace ? projectScope : undefined);
  const [projectCheckout, setProjectCheckout] = useState<{ scope: string; id: string }>();
  const projectCheckouts = useMemo(() => (selectedProject?.repositories || [])
    .filter(binding => binding.hostId === hostId)
    .sort((a, b) => Number(b.role === 'primary') - Number(a.role === 'primary'))
    .flatMap(binding => checkouts.filter(checkout => checkout.id === binding.checkoutId)), [selectedProject, hostId, checkouts]);
  const [vrUnavailable, setVrUnavailable] = useState<string>();
  // The creation forms fall back to an available provider when this one is not.
  const newProvider = preferences.provider ?? 'claude';
  const [creatingSession, setCreatingSession] = useState(false);
  const [sessionCreateError, setSessionCreateError] = useState<string>();
  const creatingSessionRef = useRef(false);
  const cancellingRuns = useRef(new Set<string>());
  const [loading, setLoading] = useState(true);
  const [immersiveActive, setImmersiveActive] = useState(false);
  const [immersiveReturnChoice, setImmersiveReturnChoice] = useState<ImmersiveSessionChoice>();
  const [immersivePermissionRequest, setImmersivePermissionRequest] = useState<{ machineId: string; sessionId: string; key: string }>();
  const [runsBySession, setRunsBySession] = useState<Record<string, RunPresentation>>({});
  const [runOutcomesBySession, setRunOutcomesBySession] = useState<Record<string, SessionRunOutcome>>({});
  const [repositoryTree, setRepositoryTree] = useState<GitWorkingTree>();
  const { toasts, latest: latestToast, notify, dismiss: dismissToast, supersede } = useToasts();
  const notifyError = useCallback((error: unknown, fallback: string, key?: string) => {
    notify({ key, tone: 'error', message: error instanceof Error ? error.message : fallback });
  }, [notify]);
  // Kept apart from health, which a remote machine's catalog replaces; the count is this machine's.
  const [newerFormatSessions, setNewerFormatSessions] = useState(0);
  const [newerFormatNoticeDismissed, setNewerFormatNoticeDismissed] = useState(false);
  const [archivingSessionIds, setArchivingSessionIds] = useState<string[]>([]);
  const [inlineSetupRequest, setInlineSetupRequest] = useState<{ machineId: string; projectId: string; sessionId: string }>();
  const [participantBusy, setParticipantBusy] = useState(false);
  const [preparingSends, setPreparingSends] = useState<string[]>([]);
  const sendingSessions = useRef(new Set<string>());
  const [unconfirmedSends, setUnconfirmedSends] = useState<string[]>([]);
  const acceptanceChecks = useRef(new Map<string, { messageId: string; accept(runId?: string): void; check(): Promise<void> }>());
  const [reconnectingSends, setReconnectingSends] = useState<string[]>([]);
  const reconnectingRuns = useRef(new Map<string, { runId?: string; machineId?: string }>());
  const finishReconnect = useCallback((targetSessionId: string) => {
    if (!reconnectingRuns.current.delete(targetSessionId)) return;
    setReconnectingSends((current) => current.filter((id) => id !== targetSessionId));
  }, []);
  const draftIdentities = useRef(new Map<string, DraftIdentity>());
  const draftIdentity = useCallback((targetSessionId: string, scope = { projectId, machineId: workspaceMachineId }) => {
    const key = `${workspaceScopeKey(scope.projectId, scope.machineId)}:${targetSessionId}`;
    let identity = draftIdentities.current.get(key);
    if (!identity) { identity = new DraftIdentity(); draftIdentities.current.set(key, identity); }
    return identity;
  }, [projectId, workspaceMachineId]);
  const runControllers = useRef(new Map<string, AbortController>());
  const recoverRuns = useRef<(targetSessionId?: string, runId?: string, snapshotLoaded?: boolean) => Promise<void>>(async () => undefined);
  const runsBySessionRef = useRef<Record<string, RunPresentation>>({});
  const toolActivityKeyRef = useRef(0);
  const snapshotRef = useRef<CanvasSnapshot | undefined>(undefined);
  const navigationRevisions = useRef(new Map<string, number>());
  const participantRequestIds = useRef(new Map<string, string>());
  const sessionsRef = useRef<SessionSnapshot[]>([]);
  const machineIdRef = useRef(machineId);
  machineIdRef.current = machineId;
  const mutationQueues = useRef(new Map<string, Promise<void>>());
  const canvasLoads = useRef(new Map<string, Promise<import('@/shared/types').SessionCanvases>>());
  const annotationSaves = useRef(new Map<string, {
    sessionId: string;
    timer?: ReturnType<typeof setTimeout>;
    save(): Promise<SessionSnapshot>;
  }>());
  const chatOpenRef = useRef(panelLayout.conversationShown);
  chatOpenRef.current = panelLayout.conversationShown;
  sessionsRef.current = sessions;
  const focusedSessionIdRef = useRef(sessionId);
  focusedSessionIdRef.current = sessionId;
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  // The decisions hook is created from this callback, so its refresh is reached through a ref.
  const refreshPermissionFailures = useRef<() => Promise<string[]>>(async () => []);
  // An unconfirmed decision blocks its card until its status reads, so its toast offers the refresh
  // until then: Refresh keeps it while the status is unknown, and dismissing it then brings it back.
  const onPermissionOutcome = useCallback(function raise(target: PermissionTarget, result: PermissionResult, delivered: boolean) {
    const decision = permissionKey(target);
    const key = `permission:${decision}`;
    const unconfirmed = async () => (await refreshPermissionFailures.current()).includes(decision);
    notify({
      key,
      tone: delivered ? 'success' : 'error',
      message: `${target.sessionTitle}: ${result.message}`,
      ...(result.retryable ? {
        persistent: true,
        actions: [{ label: 'Refresh approval status', onSelect: () => void unconfirmed().then((open) => { if (!open) dismissToast(key); }) }],
        onDismiss: () => void unconfirmed().then((open) => { if (open) raise(target, result, delivered); }),
      } : {}),
    });
  }, [dismissToast, notify]);
  const permissionDecisions = usePermissionDecisions(localMachineId, arena.refresh, refreshDeviceAccess, onPermissionOutcome);
  refreshPermissionFailures.current = permissionDecisions.refreshFailures;

  const putRun = useCallback((run: RunPresentation) => {
    const next = { ...runsBySessionRef.current, [run.sessionId]: run };
    runsBySessionRef.current = next;
    setRunsBySession(next);
    finishReconnect(run.sessionId);
  }, [finishReconnect]);
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

  const composerDraft = useMemo<DraftSource>(() => ({
    getSnapshot: () => sessionId ? workspace.getView(sessionId)?.composer || '' : '',
    subscribe: workspace.subscribeToDraft,
  }), [sessionId, workspace.getView, workspace.subscribeToDraft]);
  // VR keeps its existing shared controls reactive. Desktop subscribes only inside the composer.
  const composer = useSyncExternalStore(immersiveActive ? composerDraft.subscribe : ignoreDraft,
    immersiveActive ? composerDraft.getSnapshot : emptyDraft, emptyDraft);
  const unread = view?.unread || 0;
  const pendingAttachmentIds = view?.pendingAttachmentIds
    ?? (sessions.find((item) => item.id === sessionId)?.activeDiagramId
      ? [sessions.find((item) => item.id === sessionId)!.activeDiagramId!]
      : []);
  const selectedCheckoutId = sessionId ? view?.selectedCheckoutId
    : projectCheckouts.find(checkout => projectCheckout?.scope === projectScope && checkout.id === projectCheckout.id)?.id || projectCheckouts[0]?.id;
  // Reports are this home machine's; a remote executor's project is never CodeAI's own checkout here.
  const reports = useImmersiveReports(workspaceMachineId ? undefined : projectId);
  // Build & restart always operates the home installation, including from an executor's chat or Arena.
  const lifecycle = useCodeAiLifecycle(projectId);
  useEffect(() => {
    if (immersiveActive && lifecycle.error) notify({ key: 'codeai-lifecycle', tone: 'error', message: lifecycle.error });
  }, [immersiveActive, lifecycle.error, notify]);
  const pendingReportIds = view?.pendingReportIds ?? [];
  const setComposer = useCallback((value: SetStateAction<string>) => {
    if (!sessionId) return;
    draftIdentity(sessionId).editText();
    workspace.updateComposer(sessionId, current => typeof value === 'function' ? value(current) : value);
  }, [draftIdentity, sessionId, workspace.updateComposer]);
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
  const setPendingReportIds = useCallback((update: (current: string[]) => string[]) => {
    if (!sessionId) return;
    workspace.updateView(sessionId, (current) => {
      const next = update(current.pendingReportIds ?? []);
      draftIdentity(sessionId).changeReports(next);
      return withPendingReports(current, next);
    });
  }, [draftIdentity, sessionId, workspace.updateView]);
  const setSelectedCheckoutId = useCallback((value?: string) => {
    if (!sessionId) { setProjectCheckout(value ? { scope: projectScope, id: value } : undefined); return; }
    workspace.updateView(sessionId, (current) => ({ ...current, selectedCheckoutId: value }));
  }, [projectScope, sessionId, workspace.updateView]);

  // The headset adds reports while the flat shell is open; showing the tab reads the latest list.
  const reportsShown = panelLayout.repositoryOpen && panelLayout.sideTab === 'reports';
  useEffect(() => {
    if (reportsShown) void reports.refresh();
  }, [reports.refresh, reportsShown]);
  // The side panel starts closed, but a session without a repository needs the one place that attaches it.
  const needsRepository = Boolean(session && !session.repositories.length);
  useEffect(() => {
    if (needsRepository) panelLayout.openRepository();
  }, [needsRepository, panelLayout.openRepository, session?.id]);
  const focusedRun = sessionId ? runsBySession[sessionId] : undefined;
  const focusedRunId = focusedRun?.runId || (sessionId ? reconnectingRuns.current.get(sessionId)?.runId : undefined);
  const focusedRunOutcome = sessionId ? runOutcomesBySession[sessionId] : undefined;
  const sessionRunning = Boolean(focusedRun) || Boolean(sessionId && (preparingSends.includes(sessionId) || reconnectingSends.includes(sessionId)));
  const recovery = useTurnCheckpoint({ sessionId, revision: session?.revision, running: sessionRunning, apiPath,
    onRestored: () => { repositoryChanges.refresh(); notify({ tone: 'success', message: 'Checkout files restored. The conversation stays.' }); },
  });
  const running = Object.keys(runsBySession).length > 0;
  const status = focusedRun?.status || (sessionId && reconnectingSends.includes(sessionId) ? 'Reconnecting to the accepted turn' : 'Ready for an instruction');
  const preview = focusedRun?.preview || '';
  const toolActivity = focusedRun?.toolActivity || [];
  const permissions = focusedRun?.permissions || [];
  const runFailed = focusedRun?.runFailed || false;
  const immersiveRunStatus = permissions.length
    ? `Waiting for approval · ${status}`
    : sessionRunning
      ? status
      : focusedRunOutcome
        ? `Failed · ${focusedRunOutcome.message}`
        : session?.messages.at(-1)?.role === 'assistant'
          ? 'Completed'
          : 'Ready';
  const decidingPermission = permissions.find((request) => {
    if (!focusedRun?.runId) return false;
    const result = permissionDecisions.results[permissionKey({
      machineId: machineId || localMachineId || '', sessionId: sessionId || '', runId: focusedRun.runId, requestId: request.requestId,
    })];
    return result?.pending || result?.retryable;
  })?.requestId;
  const [projectManagementTarget, setProjectManagementTarget] = useState<{ machineId: string; project: DurableProject; action: ProjectAction }>();
  const [projectLogoTarget, setProjectLogoTarget] = useState<{ machineId: string; project: DurableProject }>();
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
  const sessionCheckouts = useMemo(() => session?.repositories.flatMap((binding) => {
    const checkout = checkouts.find((item) => item.id === binding.checkoutId);
    return checkout ? [{ id: checkout.id, name: checkout.name }] : [];
  }) || [], [checkouts, session?.repositories]);
  const fileRepositories = useMemo(() => (session?.repositories || selectedProject?.repositories || []).filter(binding => binding.hostId === hostId)
    .sort((a, b) => Number(b.role === 'primary') - Number(a.role === 'primary'))
    .flatMap(binding => checkouts.filter(checkout => checkout.id === binding.checkoutId).map(checkout => ({ id: checkout.id, name: checkout.name }))), [session?.repositories, selectedProject?.repositories, checkouts, hostId]);
  const repositoryFiles = useRepositoryFileWorkspace({ scope: session?.id || projectScope,
    parentScope: session?.projectId ? JSON.stringify([machineId, session.projectId]) : undefined,
    repositories: fileRepositories, apiBase: repositoryApiBase, docker: session?.execution === 'docker', onOpen: panelLayout.openFiles });
  const repositoryChanges = useRepositoryChanges(loading ? '' : selectedCheckout?.id || '', setRepositoryTree, repositoryApiBase);
  const repositoryDiff = useRepositoryDiff(loading ? '' : selectedCheckout?.id || '', repositoryChanges.selectedPath, repositoryChanges.revision, repositoryApiBase);
  useRepositoryAutoRefresh(Boolean(!loading && !arenaOpen && !immersiveActive && (session || projectWorkspace) && selectedCheckout && panelLayout.sideShown
    && (panelLayout.sideTab === 'changes' || panelLayout.sideTab === 'reports' && !(reports.available && reports.projectId))), repositoryChanges.refresh);
  const repositoryRefreshRef = useRef({ checkoutId: selectedCheckout?.id, apiBase: repositoryApiBase, refresh: repositoryChanges.refresh });
  repositoryRefreshRef.current = { checkoutId: selectedCheckout?.id, apiBase: repositoryApiBase, refresh: repositoryChanges.refresh };
  const pushRepositoryBranch = async (push: () => Promise<string>) => {
    supersede('git-push');
    try { notify({ key: 'git-push', tone: 'success', message: `Pushed to ${await push()}.` }); }
    catch (error) { notifyError(error, 'Could not push this branch.', 'git-push'); }
  };

  const executionProviders = health?.executions?.[session?.execution || 'local'].providers || health?.providers;
  const selectableProviders = useMemo(() => AGENT_PROVIDERS.filter((provider) => executionProviders?.[provider]?.available), [executionProviders]);
  const agents = useMemo(() => session?.participants.filter((participant): participant is AgentParticipant => participant.kind === 'agent') || [], [session]);
  const activeAgent = findAgentParticipant(agents, session?.addressedAgentId)
    || findAgentParticipant(agents, session?.primaryAgentId);
  const activeProvider = activeAgent?.provider || newProvider;
  const repositoryContext = session?.worktree
    ? `Worktree · ${repositoryTree?.branch || selectedCheckout?.branch || 'branch unavailable'} · Source: ${checkouts.find((checkout) => checkout.id === session.worktree!.originCheckoutId)?.name || 'Unavailable source'}. ${selectedCheckout?.unavailableReason || 'New chat shares this worktree.'}`
    : undefined;
  const continuationExecution = session?.execution === 'docker' ? 'local' : 'docker';
  const continuationHealth = continuationExecution === 'docker' ? health?.executions?.docker.providers[activeProvider]
    : health?.executions?.local.providers[activeProvider] || health?.providers[activeProvider];
  const worktreeDockerUnavailable = session?.worktree
    ? checkouts.find((checkout) => checkout.id === session.worktree!.originCheckoutId)?.worktreeCreation?.dockerUnavailableReason : undefined;
  const continuationUnavailable = sessionRunning ? 'Wait for this turn to finish.'
    : continuationExecution === 'docker' && worktreeDockerUnavailable ? worktreeDockerUnavailable
    : continuationExecution === 'docker' && !health?.executions?.docker.enabled ? workspaceMachineId
      ? 'Docker is disabled on this execution machine.' : 'Enable Docker in More → Machine settings to continue there.'
    : !continuationHealth?.available || !continuationHealth.supportedModes.length ? `${PROVIDER_LABELS[activeProvider]} needs ${continuationExecution === 'docker' ? 'Docker' : 'Local'} setup.`
    : continuationExecution === 'docker' && (session?.repositories.length !== 1 || session.repositories[0].role !== 'primary'
      || session.repositories[0].hostId !== hostId || !checkouts.some((checkout) => checkout.id === session.repositories[0].checkoutId))
      ? 'Docker needs exactly one primary repository on this machine.'
    // The new session copies this one's choice, and local Codex cannot be isolated.
    : isolatesLocalCodex(session?.instructions, continuationExecution, activeProvider) ? LOCAL_CODEX_ISOLATION_MESSAGE : undefined;
  const providerHealth = executionProviders?.[activeProvider];
  const unsupportedModes = useMemo(
    () => unsupportedAgentModes(health ? providerHealth?.supportedModes ?? [] : undefined, session?.execution),
    [health, providerHealth, session?.execution],
  );
  // A session without its own mode on this device shows the last one. A mode the installed CLI cannot
  // run falls back to Ask rather than failing at send time.
  const storedMode = focusedRun?.mode || view?.defaultMode || session?.defaultMode || inheritedMode(preferences.mode, session?.execution);
  const mode = composerMode(storedMode, unsupportedModes);
  const securityLevel = health?.securityLevel || 'guarded';
  const nativeIsolation = nativeClaudeIsolationIssue({ provider: activeProvider, execution: session?.execution, level: securityLevel, mode, choice: session?.instructions });
  const composerBlocked = (sessionId && unconfirmedSends.includes(sessionId) ? 'Checking whether the previous instruction was accepted. Use Check delivery before sending again.' : undefined)
    || (recovery.busy && !sessionRunning ? 'Restoring checkout files. Wait for Undo to finish.' : undefined) || nativeIsolation || (health && (!providerHealth?.available || unsupportedModes.includes(mode))
    ? providerHealth?.message || `${PROVIDER_LABELS[activeProvider]} is unavailable for ${mode} mode. Check provider setup.` : undefined);
  const instructionsChoice = activeAgent && instructionsLine({
    provider: activeAgent.provider, execution: session?.execution, choice: session?.instructions,
    machine: workspaceMachineId ? undefined : localInstructions, level: securityLevel, mode,
  });
  // Device state per agent, else this device's last choice for the provider. Whatever the machine no
  // longer lists is shown and sent as Default.
  const modelSelection = offeredModelSelection(agentModelSelection(view, preferences, activeAgent), providerHealth);
  const attachedCanvases = useMemo(() => {
    if (!session) return [];
    return pendingAttachmentIds.flatMap((id) => {
      const target = findCanvasTarget(session, id);
      return target ? [target] : [];
    });
  }, [session, pendingAttachmentIds]);

  const applyServerSnapshot = useCallback((snapshot: PublicSession, sourceMachineId = machineIdRef.current, history?: SessionRead['history']): SessionSnapshot => {
    const pending = acceptanceChecks.current.get(snapshot.id);
    const accepted = pending && snapshot.messages.find((message) => message.role === 'user' && message.id === pending.messageId);
    if (accepted?.role === 'user') pending!.accept(accepted.turn?.runId);
    const current = sessionsRef.current;
    const prior = current.find((item) => item.id === snapshot.id);
    if (prior && prior.machineId === sourceMachineId && snapshot.revision < prior.revision) return prior;
    const hydrated = { ...(history ? mergeSessionPage({ session: snapshot, history }, prior, workspace.getView(snapshot.id))
      : hydrateSession(snapshot, prior, workspace.getView(snapshot.id))), machineId: sourceMachineId };
    const archivedRevision = reconciledArchiveRevisions.current.get(JSON.stringify([sourceMachineId, snapshot.id]));
    // Restore also records its revision here: an active snapshot at that revision is current.
    if (archivedRevision !== undefined && snapshot.revision < archivedRevision) return hydrated;
    if (sourceMachineId !== machineIdRef.current || snapshot.projectId !== projectIdRef.current) return hydrated;
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
    const sourceMachineId = machineId;
    try {
      const response = await fetch(apiPath(`/api/sessions/${encodeURIComponent(targetSessionId)}?view=recent`), { cache: 'no-store' });
      const data = await response.json() as Partial<SessionRead> & { error?: string };
      if (!response.ok || !data.session) return undefined;
      return applyServerSnapshot(data.session, sourceMachineId, data.history);
    } catch {
      return undefined;
    }
  }, [apiPath, applyServerSnapshot, machineId]);

  const refreshFocusedConversation = useCallback(async function refreshFocusedConversation() {
    if (navigationKeyRef.current !== navigationKey) return;
    if (location.kind === 'session' && (location.sessionId !== sessionId || navigationFailure?.key === navigationKey)) {
      setNavigationRetry(value => value + 1);
      return;
    }
    if (!sessionId) return;
    const busy = () => Boolean(runsBySessionRef.current[sessionId] || sendingSessions.current.has(sessionId)
      || reconnectingRuns.current.has(sessionId) || acceptanceChecks.current.has(sessionId));
    if (busy()) return; // The owning send/stream supplies snapshots while a turn is live.
    const prior = sessionsRef.current.find(item => item.id === sessionId);
    try {
      const response = await fetch(apiPath(`/api/sessions/${sessionId}?view=recent`), { cache: 'no-store' });
      const data = await response.json() as Partial<SessionRead> & { error?: string };
      if (navigationKeyRef.current !== navigationKey || machineIdRef.current !== machineId
        || busy() || sessionsRef.current.find(item => item.id === sessionId) !== prior) return;
      if (response.status === 404) {
        setNavigationFailure({ key: navigationKey, message: 'This conversation is unavailable. It may have been archived or deleted.' });
        return;
      }
      if (!response.ok || !data.session) throw new Error(data.error || 'Could not refresh this conversation.');
      if (data.session.revision < (prior?.revision || 0)) return;
      if (data.session.projectId !== projectIdRef.current) {
        // The same conversation may have moved to No project in another browser.
        setNavigationRetry(value => value + 1);
        return;
      }
      applyServerSnapshot(data.session, machineId, data.history);
      setNavigationFailure(undefined);
      void recoverRuns.current(sessionId, undefined, true);
      dismissToast(`conversation-refresh:${sessionId}`);
    } catch (error) {
      if (navigationKeyRef.current !== navigationKey) return;
      notify({ key: `conversation-refresh:${sessionId}`, tone: 'warning', persistent: true,
        message: 'Could not refresh this conversation. Showing the last loaded messages.',
        actions: [{ label: 'Retry', onSelect: () => void refreshFocusedConversation() }] });
    }
  }, [apiPath, applyServerSnapshot, dismissToast, location, machineId, navigationFailure?.key, navigationKey, notify, sessionId]);

  useEffect(() => {
    if (arenaOpen || loading || location.kind !== 'session' || resolvedNavigation !== navigationKey) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let refreshing = false;
    const activate = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'hidden') return;
      timer = setTimeout(() => {
        if (refreshing) return;
        refreshing = true;
        void refreshFocusedConversation().finally(() => { refreshing = false; });
      }, 150);
    };
    window.addEventListener('focus', activate);
    window.addEventListener('pageshow', activate);
    document.addEventListener('visibilitychange', activate);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', activate);
      window.removeEventListener('pageshow', activate);
      document.removeEventListener('visibilitychange', activate);
    };
  }, [arenaOpen, loading, location.kind, navigationKey, refreshFocusedConversation, resolvedNavigation]);

  const enqueueSessionMutation = useCallback((
    targetSessionId: string,
    operation: (current: SessionSnapshot) => Promise<Response>,
  ): Promise<SessionSnapshot> => {
    const sourceMachineId = machineIdRef.current;
    const capturedSession = sessionsRef.current.find((item) => item.id === targetSessionId);
    const prior = mutationQueues.current.get(targetSessionId) || Promise.resolve();
    let result!: Promise<SessionSnapshot>;
    const queued = prior.then(async () => {
      let current = sessionsRef.current.find((item) => item.id === targetSessionId) || capturedSession;
      if (!current) throw new Error('Session is no longer available.');
      if ((current.titleRevision ?? 0) > current.revision) {
        current = await refreshSession(targetSessionId);
        if (!current || (current.titleRevision ?? 0) > current.revision) throw new Error('Could not refresh the session. Try again.');
      }
      const response = await operation(current);
      const data = await response.json().catch(() => ({})) as { session?: PublicSession; error?: string };
      if (!response.ok || !data.session) {
        if (response.status === 409) await refreshSession(targetSessionId);
        throw new Error(data.error || 'Session update failed.');
      }
      return applyServerSnapshot(data.session, sourceMachineId);
    });
    result = queued;
    mutationQueues.current.set(targetSessionId, queued.then(() => undefined, () => undefined));
    return result;
  }, [applyServerSnapshot, refreshSession]);

  const refreshProjects = useCallback(async (): Promise<DurableProject[]> => {
    const response = await fetch(apiPath('/api/projects'), { cache: 'no-store' });
    const data = await response.json() as { projects?: DurableProject[]; error?: string };
    if (!response.ok) throw new Error(data.error || 'Could not load projects.');
    const next = data.projects || [];
    setProjects(next);
    return next;
  }, [apiPath]);

  useEffect(() => {
    try { setSavedCheckoutId(loadSelectedCheckoutId(localStorage, workspaceMachineId)); } catch { /* Device preference is optional. */ }
  }, [workspaceMachineId]);

  const openMachineSettings = () => {
    moreMenuRef.current?.close();
    moreMenuRef.current?.trigger?.focus();
    setMachineSettingsOpen(true);
  };

  const setDockerEnabled = async (enabled: boolean) => {
    const response = await fetch('/api/execution/docker', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    const docker = await response.json() as ExecutionHealth['docker'] & { error?: string };
    if (!response.ok) throw new Error(docker.error || 'Could not save Docker settings.');
    setLocalExecutionHealth((current) => current && ({ ...current, docker }));
    if (!machineIdRef.current || machineIdRef.current === localMachineId) setHealth((current) => current && ({
      ...current,
      executions: {
        local: current.executions?.local || { enabled: true, providers: current.providers },
        docker,
      },
    }));
  };

  const refreshArena = async () => {
    setRefreshingArena(true);
    try {
      const [response] = await Promise.all([
        fetch('/api/health', { cache: 'no-store' }),
        arena.refresh(),
      ]);
      if (!response.ok) throw new Error('Could not refresh machine readiness.');
      const next = await response.json() as Health;
      // Arena refreshes the home machine. An open executor conversation keeps its own readiness.
      if (!machineIdRef.current || machineIdRef.current === localMachineId) setHealth(next);
      setNewerFormatSessions(next.newerFormatSessions || 0);
      setLocalExecutionHealth(next.executions);
      setLocalInstructions(next.instructions);
    } catch (error) {
      notifyError(error, 'Could not refresh machine readiness.');
    } finally {
      setRefreshingArena(false);
    }
  };

  const selectMachineCatalog = useCallback((target: ArenaMachineSnapshot) => {
    if (target.machine.state !== 'online') throw new Error(`${target.machine.label} is offline.`);
    machineIdRef.current = target.machine.id;
    setMachineId(target.machine.id);
    setHostId(target.machine.id);
    setProjects(target.projects);
    setCheckouts(target.checkouts);
    setRecentCheckoutIds(target.recentCheckoutIds);
    setHealth({
      ok: Object.values(target.providers).some((provider) => provider.available),
      hostLabel: target.machine.label,
      repositoriesRootReady: true,
      dataDirectoryReady: true,
      providers: target.providers,
      securityLevel: target.securityLevel || 'guarded',
      worktrees: target.worktrees,
    });
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
      setLocalExecutionHealth(healthResult.executions);
      setLocalInstructions(healthResult.instructions);
      setNewerFormatSessions(healthResult.newerFormatSessions || 0);
      setProjects(projectResult);
      setCheckouts(checkoutResult.checkouts || []);
      setRecentCheckoutIds(checkoutResult.recentCheckoutIds || []);
      setHostId(checkoutResult.hostId);
      setLocalMachineId(checkoutResult.hostId);
      setMachineId(checkoutResult.hostId);
      const restartProject = takeRestartProject();
      setProjectId(projectResult.find((project) => project.id === restartProject)?.id ?? projectResult[0]?.id);
      setCatalogReady(true);
    }).catch((error: unknown) => {
      if (current) {
        notifyError(error, 'Could not start CodeAI.');
        setLoading(false);
      }
    });
    return () => { current = false; };
  }, []);

  // Resolve URL identity before the first project listing can reconcile stored views.
  useEffect(() => {
    if (!catalogReady || !workspace.ready) return;
    if (arenaOpen) { setNavigationReady(true); return; }
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && navigationKeyRef.current === navigationKey;
    setNavigationFailure(undefined);
    void (async () => {
      if (location.kind === 'invalid') throw new Error('This workspace link is invalid.');
      if (location.kind === 'default') {
        setResolvedNavigation(navigationKey);
        setNavigationReady(true);
        return;
      }
      const targetMachineId = location.machineId || localMachineId;
      let catalog: ArenaMachineSnapshot | undefined;
      if (targetMachineId !== machineIdRef.current) {
        catalog = arenaMachinesRef.current.find(entry => entry.machine.id === targetMachineId);
        if (!catalog || catalog.machine.state !== 'online') {
          const response = await fetch('/api/arena', { cache: 'no-store', signal: controller.signal });
          if (!response.ok) throw new Error('Could not reach this conversation’s machine.');
          const data = await response.json() as { machines: ArenaMachineSnapshot[] };
          catalog = data.machines.find(entry => entry.machine.id === targetMachineId);
        }
        if (!catalog || catalog.machine.state !== 'online') throw new Error('This machine is offline or no longer attached.');
      }
      const targetApi = (path: string) => machineApiPath(path, targetMachineId, localMachineId);
      let saved: PublicSession | undefined;
      let history: SessionRead['history'] | undefined;
      let targetProjectId: string | undefined;
      let prior: SessionSnapshot | undefined;
      if (location.kind === 'session') {
        prior = sessionsRef.current.find(item => item.id === location.sessionId);
        const response = await fetch(targetApi(`/api/sessions/${location.sessionId}?view=recent`), { cache: 'no-store', signal: controller.signal });
        const data = await response.json() as Partial<SessionRead> & { error?: string };
        if (!response.ok || !data.session) {
          throw new Error(response.status === 404 ? 'This conversation is unavailable. It may have been archived or deleted.'
            : data.error || 'Could not load this conversation.');
        }
        saved = data.session;
        history = data.history;
        targetProjectId = saved.projectId;
      } else {
        targetProjectId = location.projectId;
        if (targetProjectId) {
          const response = await fetch(targetApi('/api/projects'), { cache: 'no-store', signal: controller.signal });
          if (!response.ok) throw new Error('Could not load this project.');
          const data = await response.json() as { projects: DurableProject[] };
          if (!data.projects.some(project => project.id === targetProjectId)) throw new Error('This project is no longer available.');
          if (current() && !catalog) setProjects(data.projects);
        }
      }
      if (!current()) return;
      const sameScope = targetMachineId === machineIdRef.current && targetProjectId === projectIdRef.current;
      if (catalog) selectMachineCatalog(catalog);
      if (!sameScope) {
        setLoading(true);
        setProjectId(targetProjectId);
        projectIdRef.current = targetProjectId;
        sessionsRef.current = [];
        setSessions([]);
        setRepositoryTree(undefined);
      }
      if (saved) {
        workspace.openInProject(targetProjectId, saved.id, undefined, targetMachineId === localMachineId ? undefined : targetMachineId);
        // The selected conversation is usable before its project catalog finishes.
        if ((!sameScope || !runsBySessionRef.current[saved.id] && !sendingSessions.current.has(saved.id)
          && !reconnectingRuns.current.has(saved.id) && !acceptanceChecks.current.has(saved.id)
          && sessionsRef.current.find(item => item.id === saved.id) === prior) && saved.revision >= (prior?.revision || 0)) {
          applyServerSnapshot(saved, targetMachineId, history);
          setLoading(false);
          void recoverRuns.current(saved.id, undefined, true);
        }
      }
      setResolvedNavigation(navigationKey);
      setNavigationReady(true);
      if (location.machineId === localMachineId) {
        navigateWorkspace({ sessionId: saved?.id, projectId: targetProjectId }, true);
      }
    })().catch((error: unknown) => {
      if (!current()) return;
      setNavigationFailure({ key: navigationKey, message: error instanceof Error ? error.message : 'Could not open this workspace.' });
      setResolvedNavigation(navigationKey);
      setLoading(false);
    });
    return () => controller.abort();
  }, [applyServerSnapshot, arenaOpen, catalogReady, localMachineId, location, navigateWorkspace, navigationKey, navigationRetry, selectMachineCatalog, workspace.openInProject, workspace.ready]);

  useEffect(() => {
    if (!catalogReady || !workspace.ready || !navigationReady) return;
    let current = true;
    if (!sessionsRef.current.some(item => item.id === focusedSessionIdRef.current)) setLoading(true);
    const query = projectId ? `projectId=${encodeURIComponent(projectId)}` : 'loose=true';
    void fetch(apiPath(`/api/sessions?${query}&view=summary`), { cache: 'no-store' })
      .then(async response => {
        const data = await response.json() as { sessions?: ArenaSessionSummary[]; error?: string };
        if (!response.ok) throw new Error(data.error || 'Could not load sessions.');
        return data.sessions || [];
      })
      .then(summaries => {
        if (!current) return;
        const active = summaries.filter(item => item.revision >= (reconciledArchiveRevisions.current.get(JSON.stringify([machineId, item.id])) ?? -1));
        setSessionList({ scope: JSON.stringify([machineId, projectId]), items: active });
        const ids = new Set(active.map(item => item.id));
        // Retain content already loaded by the URL resolver; the list contains no transcripts.
        const retained = sessionsRef.current.filter(item => ids.has(item.id) && item.machineId === machineId && item.projectId === projectId);
        sessionsRef.current = retained;
        setSessions(retained);
        panelLayout.reconcile(workspace.reconcile([...ids]));
        supersede('sessions-load');
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (!current) return;
        notifyError(error, 'Sessions could not be loaded.', 'sessions-load');
        setLoading(false);
      });
    return () => { current = false; };
  }, [apiPath, catalogReady, machineId, navigationReady, panelLayout.reconcile, projectId, workspace.ready, workspace.reconcile]);

  // Legacy `/` has no identity. Once its fallback is loaded, make future reloads deterministic.
  useEffect(() => {
    if (arenaOpen || location.kind !== 'default' || !navigationReady || loading || resolvedNavigation !== navigationKey) return;
    navigateWorkspace({ sessionId: workspace.scope.focusedSessionId, projectId, machineId }, true);
  }, [arenaOpen, loading, location.kind, machineId, navigateWorkspace, navigationKey, navigationReady, projectId, resolvedNavigation, workspace.scope.focusedSessionId]);

  useEffect(() => {
    if (!localMachineId || !workspace.ready) return;
    let archivedFocus: { machineId: string; projectId?: string; sessionId: string } | undefined;
    for (const owner of arena.machines) {
      // Offline projections are cached evidence and cannot confirm a conversation is still archived.
      if (owner.machine.state !== 'online') continue;
      for (const archived of owner.archivedSessions) {
        const key = JSON.stringify([owner.machine.id, archived.id]);
        const loaded = sessionsRef.current.find((item) => item.machineId === owner.machine.id && item.id === archived.id);
        const reconciledRevision = reconciledArchiveRevisions.current.get(key) || 0;
        // A poll started before Restore may finish after its newer response.
        if ((loaded?.revision || 0) > archived.revision
          || reconciledRevision > archived.revision) continue;
        if (reconciledRevision === archived.revision && !loaded) continue;
        reconciledArchiveRevisions.current.set(key, archived.revision);
        workspace.closeInProject(archived.projectId, archived.id,
          owner.machine.id === localMachineId ? undefined : owner.machine.id);
        if (loaded && archived.agentArchiveCheck?.status === 'archived') {
          notify({ key: `archive:${archived.id}`, tone: 'success', message: `Archived by agent: “${archived.title}”.`,
            actions: [{ label: 'Restore', onSelect: () => void restoreSessionRef.current(owner.machine.id, archived) }] });
        }
        if (loaded && owner.machine.id === machineId && focusedSessionIdRef.current === archived.id && navigationKeyRef.current.startsWith('/?')) {
          archivedFocus = { machineId: owner.machine.id, projectId: archived.projectId, sessionId: archived.id };
        }
        if (owner.machine.id === machineId && archived.projectId === projectId) {
          setSessionList(current => current.items.some(item => item.id === archived.id)
            ? { ...current, items: current.items.filter(item => item.id !== archived.id) } : current);
        }
        if (owner.machine.id === machineId && archived.projectId === projectId && loaded) {
          const next = sessionsRef.current.filter((item) => item.id !== archived.id);
          sessionsRef.current = next;
          setSessions(next);
          if (focusedSessionIdRef.current === archived.id) setRepositoryTree(undefined);
        }
        runControllers.current.get(archived.id)?.abort();
        removeRun(archived.id);
        setRunOutcome(archived.id);
      }
    }
    if (archivedFocus) {
      // One snapshot can archive several tabs; choose focus only after reconciling all of them.
      const nextFocus = workspace.getScopeInProject(archivedFocus.projectId,
        archivedFocus.machineId === localMachineId ? undefined : archivedFocus.machineId)?.focusedSessionId;
      navigateWorkspace({ sessionId: nextFocus, projectId: archivedFocus.projectId, machineId: archivedFocus.machineId }, true);
      if (archivedFocus.projectId && !sessionsRef.current.length) setInlineSetupRequest({ ...archivedFocus, projectId: archivedFocus.projectId });
    }
  }, [arena.machines, localMachineId, machineId, projectId, removeRun, setRunOutcome, workspace.closeInProject, workspace.getScopeInProject, workspace.ready, notify, navigateWorkspace]);

  useEffect(() => {
    const current = sessionsRef.current;
    const next = reconcileSessionTitles(current, arena.machines, localMachineId);
    if (next !== current) {
      sessionsRef.current = next;
      setSessions(next);
    }
  }, [arena.machines, localMachineId]);

  useEffect(() => {
    snapshotRef.current = undefined;
  }, [sessionId, session?.activeDiagramId]);

  useEffect(() => {
    if (!session || !hostId) return;
    const local = session.repositories.filter((repository) => (
      repository.hostId === hostId && checkouts.some((checkout) => checkout.id === repository.checkoutId)
    ));
    if (local.some((repository) => repository.checkoutId === selectedCheckoutId)) return;
    const next = local.some((repository) => repository.checkoutId === savedCheckoutId)
      ? savedCheckoutId
      : local.find((repository) => repository.role === 'primary')?.checkoutId || local[0]?.checkoutId;
    setSelectedCheckoutId(next);
  }, [checkouts, hostId, savedCheckoutId, selectedCheckoutId, session]);

  useEffect(() => {
    if (!session?.id) return;
    const canvasIds = [
      ...(session.history?.canvasIds || []),
      ...getArtifacts(session).map((artifact) => artifact.id),
      ...getSketches(session).map((sketch) => sketch.id),
    ];
    workspace.updateView(session.id, (current) => {
      const spatial = reconcileSpatialView(current.spatial, canvasIds);
      return spatial === current.spatial ? current : { ...current, spatial };
    });
  }, [session, workspace.updateView]);

  useEffect(() => {
    if (!session) return;
    workspace.updateView(session.id, (current) => {
      const defaultMode = session.defaultMode ?? current.defaultMode;
      if (
        current.activeDiagramId === session.activeDiagramId
        && current.addressedAgentId === session.addressedAgentId
        && current.defaultMode === defaultMode
      ) return current;
      return {
        ...current,
        activeDiagramId: session.activeDiagramId,
        addressedAgentId: session.addressedAgentId,
        defaultMode,
      };
    });
  }, [session?.activeDiagramId, session?.addressedAgentId, session?.defaultMode, session?.id, workspace.updateView]);

  useEffect(() => {
    if (session && panelLayout.conversationShown && unread) setUnread(0);
  }, [panelLayout.conversationShown, session, setUnread, unread]);

  const mutateSession = useCallback((id: string, operation: (value: SessionSnapshot) => SessionSnapshot) => {
    setSessions((current) => {
      const next = current.map((item) => item.id === id ? operation(item) : item);
      sessionsRef.current = next;
      return next;
    });
  }, []);

  const loadEarlierMessages = useCallback(async () => {
    const saved = sessionsRef.current.find(item => item.id === sessionId);
    const before = saved?.history?.before;
    if (!saved || !before) return;
    const destination = navigationKeyRef.current;
    const response = await fetch(apiPath(`/api/sessions/${saved.id}?view=recent&before=${encodeURIComponent(before)}`), { cache: 'no-store' });
    const data = await response.json() as SessionRead & { error?: string };
    if (!response.ok || !data.session || !data.history) throw new Error(data.error || 'Could not load earlier messages.');
    if (navigationKeyRef.current !== destination || machineIdRef.current !== machineId) return;
    mutateSession(saved.id, current => mergeSessionPage(data, current, undefined, before));
  }, [apiPath, machineId, mutateSession, sessionId]);

  const loadMessageDetails = useCallback(async (messageId: string) => {
    const destination = navigationKeyRef.current;
    const response = await fetch(apiPath(`/api/sessions/${sessionId}?view=message&messageId=${encodeURIComponent(messageId)}`), { cache: 'no-store' });
    const data = await response.json() as { revision: number; message?: import('@/shared/types').ChatMessage; error?: string };
    if (!response.ok || !data.message) throw new Error(data.error || 'Could not load message details.');
    if (navigationKeyRef.current !== destination || machineIdRef.current !== machineId) return;
    const message = data.message;
    const current = sessionsRef.current.find(item => item.id === sessionId);
    if (!current || data.revision < current.revision) throw new Error('This conversation changed. Load details again.');
    mutateSession(current.id, saved => {
      if (saved.revision > data.revision) return saved;
      return hydrateSession({ ...saved, messages: saved.messages.map(item => item.id === message.id ? message : item),
        history: saved.history ? { ...saved.history, deferredMessageIds: saved.history.deferredMessageIds.filter(id => id !== messageId) } : undefined,
      }, saved);
    });
    return message;
  }, [apiPath, machineId, mutateSession, sessionId]);

  const loadCanvases = useCallback(async (targetSessionId: string) => {
    const key = `${machineId}:${targetSessionId}`;
    const existing = canvasLoads.current.get(key);
    if (existing) return existing;
    const operation = (async () => {
      const response = await fetch(apiPath(`/api/sessions/${targetSessionId}?view=canvas`), { cache: 'no-store' });
      const data = await response.json() as import('@/shared/types').SessionCanvases & { error?: string };
      if (!response.ok || !data.canvases) throw new Error(data.error || 'Could not load canvases.');
      if (machineIdRef.current !== machineId) return data;
      mutateSession(targetSessionId, saved => saved.revision > data.revision ? saved : hydrateSession({ ...saved, ...data,
        // A canvas read supplies no transcript or metadata revision.
        revision: saved.revision,
        history: saved.history ? { ...saved.history, canvasesLoaded: true } : undefined,
      }, saved));
      return data;
    })();
    canvasLoads.current.set(key, operation);
    try { return await operation; } finally { canvasLoads.current.delete(key); }
  }, [apiPath, machineId, mutateSession]);

  useEffect(() => {
    if (!session?.history || session.history.canvasesLoaded || !session.history.canvasIds.length || panelLayout.canvasHidden) return;
    void loadCanvases(session.id).catch(error => notify({ key: `canvases:${session.id}`, tone: 'warning', persistent: true,
      message: error instanceof Error ? error.message : 'Could not load canvases.',
      actions: [{ label: 'Retry', onSelect: () => void loadCanvases(session.id).catch(error => notifyError(error, 'Could not load canvases.')) }],
    }));
  }, [loadCanvases, notify, notifyError, panelLayout.canvasHidden, session?.id, session?.revision, session?.history?.canvasesLoaded]);

  const exportCompleteSession = async () => {
    if (!session) return;
    try {
      if (!session.history) { exportSession(session); return; }
      const response = await fetch(apiPath(`/api/sessions/${session.id}`), { cache: 'no-store' });
      const data = await response.json() as { session?: PublicSession; error?: string };
      if (!response.ok || !data.session) throw new Error(data.error || 'Could not export this session.');
      exportSession(hydrateSession(data.session));
    } catch (error) { notifyError(error, 'Could not export this session.'); }
  };

  // Immersive history has its own scrolling renderer and no desktop paging controls. Entering
  // that view deliberately loads the selected complete transcript, preserving its existing UI.
  useEffect(() => {
    if (!immersiveActive || !session?.history) return;
    const controller = new AbortController();
    void fetch(apiPath(`/api/sessions/${session.id}`), { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const data = await response.json() as { session?: PublicSession; error?: string };
        if (!response.ok || !data.session) throw new Error(data.error || 'Could not load immersive history.');
        if (!controller.signal.aborted) applyServerSnapshot(data.session, machineId);
      }).catch(error => { if (!controller.signal.aborted) notifyError(error, 'Could not load immersive history.'); });
    return () => controller.abort();
  }, [apiPath, applyServerSnapshot, immersiveActive, machineId, notifyError, session?.id, Boolean(session?.history)]);


  const createSession = useCallback(async (
    requestedProvider: AgentProvider = newProvider,
    options: {
      checkoutMode?: 'current' | 'worktree'; creationRequestId?: string;
      projectId?: string; mode?: AgentMode; role?: AgentRole; modelSelection?: ModelSelection; fromArena?: boolean; machineId?: string; execution?: AgentExecution; checkoutId?: string; sourceSessionId?: string; initialComposer?: string;
      /** Named by a form that offers the choice; a continuation copies its source's on the server. */
      instructions?: LaunchInstructions;
      allowAgentArchive?: boolean;
    } = {},
  ): Promise<boolean> => {
    if (creatingSessionRef.current) return false;
    creatingSessionRef.current = true;
    supersede('session-create');
    setCreatingSession(true);
    setSessionCreateError(undefined);
    try {
      const requestedProjectId = options.fromArena ? options.projectId : projectId;
      const targetMachineId = options.machineId || machineId;
      const targetMachine = options.fromArena
        ? arena.machines.find((entry) => entry.machine.id === targetMachineId)
        : undefined;
      if (options.fromArena && (!targetMachine || targetMachine.machine.state !== 'online')) {
        throw new Error('That execution machine is offline.');
      }
      const response = await fetch(machineApiPath('/api/sessions', targetMachineId, localMachineId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: requestedProvider, ...(options.execution ? { execution: options.execution } : {}),
          ...(options.checkoutMode ? { checkoutMode: options.checkoutMode } : {}),
          ...(options.creationRequestId ? { creationRequestId: options.creationRequestId } : {}),
          ...(options.role ? { role: options.role } : {}),
          ...(options.instructions && options.instructions !== 'default' ? { instructions: options.instructions } : {}),
          ...(options.allowAgentArchive ? { allowAgentArchive: true } : {}),
          ...(options.sourceSessionId ? { sourceSessionId: options.sourceSessionId }
            : { ...(requestedProjectId ? { projectId: requestedProjectId } : {}), ...(options.checkoutId ? { checkoutId: options.checkoutId } : {}) }) }),
      });
      const data = await response.json() as { session?: PublicSession; error?: string; worktreeConflict?: unknown };
      if (!response.ok || !data.session) throw new Error(worktreeCreationError(data, arena.machines));
      let targetCatalog = targetMachine;
      if (data.session.worktree) {
        try {
          const catalog = await fetch(machineApiPath('/api/checkouts', targetMachineId, localMachineId), { cache: 'no-store' });
          if (catalog.ok) {
            const updated = await catalog.json() as CheckoutsResponse;
            if (targetMachineId === machineId) setCheckouts(updated.checkouts);
            if (targetMachine) targetCatalog = { ...targetMachine, checkouts: updated.checkouts };
          }
        } catch { /* A saved session still opens; its catalog can refresh after reconnecting. */ }
      }
      // What a form created a session with becomes this device's last choice, Default included.
      const named = options.instructions;
      if (named) updatePreferences((current) => ({ ...current, instructions: named === 'default' ? undefined : named }));
      const targetProjectId = data.session.projectId;
      const targetWorkspaceMachineId = targetMachineId && targetMachineId !== localMachineId ? targetMachineId : undefined;
      // The session and its first agent start at the given choices, else this device's last ones,
      // and keep them as their own when the device's last choices change.
      const sessionMode = options.mode ?? inheritedMode(preferences.mode, options.execution);
      const agentSelection = options.modelSelection ?? preferences.models?.[requestedProvider] ?? {};
      const primaryAgentId = data.session.primaryAgentId;
      workspace.openInProject(targetProjectId, data.session.id, (current) => ({
        ...current,
        defaultMode: sessionMode,
        modelSelections: { [primaryAgentId]: agentSelection },
        ...(options.initialComposer !== undefined ? { composer: options.initialComposer } : {}),
      }), targetWorkspaceMachineId);
      if (targetCatalog && targetMachineId !== machineId) selectMachineCatalog(targetCatalog);
      if (targetMachineId === machineId && targetProjectId === projectId) applyServerSnapshot(data.session);
      else {
        setLoading(true);
        setProjectId(targetProjectId);
        sessionsRef.current = [];
        setSessions([]);
        setRepositoryTree(undefined);
      }
      panelLayout.openConversationFor(data.session.id, getArtifacts(data.session).length + getSketches(data.session).length > 0);
      navigateWorkspace({ sessionId: data.session.id, machineId: targetMachineId });
      void arena.refresh();
      return true;
    } catch (error) {
      setSessionCreateError(error instanceof Error ? error.message : 'Could not create a session.');
      notifyError(error, 'Could not create a session.', 'session-create');
      return false;
    } finally {
      creatingSessionRef.current = false;
      setCreatingSession(false);
    }
  }, [applyServerSnapshot, arena.machines, arena.refresh, localMachineId, machineId, navigateWorkspace, newProvider, panelLayout.openConversationFor, preferences, projectId, selectMachineCatalog, updatePreferences, workspace.openInProject]);

  /** The Arena's and VR's New session forms. What a session was created with becomes this device's last choice. */
  const createChosenSession = useCallback(async ({ provider, ...options }: SessionCreation & {
    execution?: AgentExecution; checkoutId?: string; instructions?: LaunchInstructions;
  }) => {
    const created = await createSession(provider, { ...options, fromArena: true });
    if (created) updatePreferences((current) => ({ ...current, provider, mode: options.mode }));
    return created;
  }, [createSession, updatePreferences]);

  const newChat = async () => {
    if (!session || !activeAgent || sessionRunning || creatingSession || participantBusy || recovery.busy) return false;
    const created = await createSession(activeAgent.provider, {
      execution: session.execution || 'local', sourceSessionId: session.id, role: activeAgent.role, mode, modelSelection,
    });
    if (created) workspace.closeInProject(session.projectId, session.id, workspaceMachineId);
    return created;
  };

  const continueSession = (execution: AgentExecution) => {
    if (!session || sessionRunning || creatingSession) return;
    const composer = composerDraft.getSnapshot();
    const recap = session.messages.slice(-6).map((message) => {
      const author = session.participants.find((participant) => participant.id === message.authorId)?.displayName || message.role;
      const text = message.role === 'user' ? message.text : message.rawMarkdown;
      return `${author}: ${text.slice(0, 900)}${text.length > 900 ? '…' : ''}`;
    }).join('\n\n');
    const initialComposer = `Continue from “${session.title.slice(0, 200)}” (${session.execution === 'docker' ? 'Docker' : 'Local'} session ${session.id}). This is a fresh provider session using the same repositories.\n\nRecent visible conversation (may be incomplete):\n${recap || 'No messages yet.'}${composer.trim() ? `\n\nUnsent draft:\n${composer.slice(0, 1_400)}` : ''}\n\nPlease continue from this context.`.slice(0, 7_600);
    // The agent's stored choice, not the one this execution offers: the other execution may list more.
    const agentSelection = agentModelSelection(view, preferences, activeAgent);
    // Accept edits and Full access stay in their session; Local continuations can inherit Auto.
    void createSession(activeProvider, { execution, sourceSessionId: session.id, initialComposer, mode: inheritedMode(mode, execution), modelSelection: agentSelection });
  };

  const switchProject = (next?: string) => {
    if (next === projectId) return;
    const remembered = workspace.getScopeInProject(next, workspaceMachineId);
    const focus = remembered?.focusedSessionId ?? (!remembered
      ? arenaMachinesRef.current.find(entry => entry.machine.id === machineId)?.sessions.find(item => item.projectId === next)?.id
      : undefined);
    navigateWorkspace({ sessionId: focus, projectId: next, machineId });
  };

  const focusSession = (id: string) => {
    setLaunchFocus(undefined);
    workspace.open(id);
    navigateWorkspace({ sessionId: id, machineId });
  };

  const closeSessionView = (id: string) => {
    const next = workspace.close(id);
    if (id !== sessionId) return;
    setRepositoryTree(undefined);
    navigateWorkspace({ sessionId: next, projectId, machineId }, true);
  };

  const createProject = useCallback(async (targetMachineId: string | undefined, name: string, checkoutIds: string[]) => {
    const response = await fetch(machineApiPath('/api/projects', targetMachineId, localMachineId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, checkoutIds }),
    });
    const data = await response.json() as { project?: DurableProject; error?: string };
    if (!response.ok || !data.project) throw new Error(data.error || 'Could not create the project.');
    const created = data.project;
    if (targetMachineId === machineIdRef.current) setProjects((current) => [created, ...current.filter(project => project.id !== created.id)]);
    void arena.refresh();
    return created;
  }, [arena.refresh, localMachineId]);

  const saveProjectLogo = async (targetMachineId: string, project: DurableProject, logo: DurableProject['logo'] | null) => {
    const url = machineApiPath(`/api/projects/${encodeURIComponent(project.id)}`, targetMachineId, localMachineId);
    const response = await fetch(url, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: project.revision, expectedLogo: project.logo ?? null, logo }),
    });
    const data = await response.json() as { project?: DurableProject; error?: string };
    if (!response.ok || !data.project) {
      if (response.status === 409) {
        const latest = await fetch(url, { cache: 'no-store' }).then(result => result.ok ? result.json() : undefined).catch(() => undefined) as { project?: DurableProject } | undefined;
        if (latest?.project) setProjectLogoTarget(current => current?.machineId === targetMachineId && current.project.id === project.id
          ? { ...current, project: latest.project! } : current);
      }
      throw new Error(data.error || 'Could not save the project logo.');
    }
    if (machineIdRef.current === targetMachineId) setProjects(current => current.map(item => item.id === project.id ? data.project! : item));
    void arena.refresh();
  };

  const manageProject = async (targetMachineId: string, project: DurableProject, action: ProjectAction, name?: string) => {
    if (action === 'delete' && projectDeletionBusy) throw new Error('Wait for active conversations to finish before deleting this project.');
    const destination = navigationKeyRef.current;
    const url = machineApiPath(`/api/projects/${encodeURIComponent(project.id)}`, targetMachineId, localMachineId);
    const response = await fetch(url, {
      method: action === 'rename' ? 'PATCH' : 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: project.revision, ...(action === 'rename' ? { name } : {}) }),
    });
    const data = await response.json() as { project?: DurableProject; detachedSessionCount?: number; error?: string };
    // A lost DELETE response can be retried after the record has already gone.
    const alreadyDeleted = action === 'delete' && response.status === 404 && data.error === 'Unknown project';
    if ((!response.ok && !alreadyDeleted) || (action === 'rename' && !data.project)) {
      if (response.status === 409) {
        const latest = await fetch(url, { cache: 'no-store' }).then(result => result.ok ? result.json() : undefined)
          .catch(() => undefined) as { project?: DurableProject } | undefined;
        if (latest?.project) {
          setProjectManagementTarget(current => current?.machineId === targetMachineId && current.project.id === project.id
            ? { ...current, project: latest.project! } : current);
          if (machineIdRef.current === targetMachineId) setProjects(current => current.map(item => item.id === project.id ? latest.project! : item));
        }
      }
      void arena.refresh();
      throw new Error(data.error || `Could not ${action} the project.`);
    }
    if (machineIdRef.current === targetMachineId) {
      setProjects(current => action === 'rename'
        ? current.map(item => item.id === project.id && item.revision <= data.project!.revision ? data.project! : item)
        : current.filter(item => item.id !== project.id));
    }
    if (action === 'delete') {
      if (navigationKeyRef.current === destination && destination.startsWith('/?')
        && machineIdRef.current === targetMachineId && projectIdRef.current === project.id) {
        // Re-resolve the same conversation in No project; its tab-local draft follows its id.
        if (focusedSessionIdRef.current) setNavigationRetry(value => value + 1);
        else navigateWorkspace({ projectId: undefined, machineId: targetMachineId }, true);
      }
      const count = data.detachedSessionCount;
      notify({ tone: 'success', message: count === undefined ? 'Project deleted. Conversations are kept in No project.'
        : `Project deleted. ${count} conversation${count === 1 ? '' : 's'} moved to No project.` });
    }
    void arena.refresh();
  };

  const selectCheckout = useCallback((checkoutId: string) => {
    setSelectedCheckoutId(checkoutId);
    setSavedCheckoutId(checkoutId);
    setRepositoryTree(undefined);
    try { saveSelectedCheckoutId(checkoutId, localStorage, workspaceMachineId); } catch { /* Selection still works without persistence. */ }
  }, [setSelectedCheckoutId, workspaceMachineId]);

  const updateRepositories = useCallback((update: (current: RepositoryBinding[]) => RepositoryBinding[]) => {
    if (!session || sessionRunning) return Promise.resolve();
    return enqueueSessionMutation(session.id, (current) => {
      const repositories = update(current.repositories);
      return fetch(apiPath(`/api/sessions/${encodeURIComponent(session.id)}/repositories`), {
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
      notifyError(error, 'Could not update session repositories.');
    });
  }, [apiPath, enqueueSessionMutation, refreshProjects, selectedCheckoutId, session, sessionRunning]);

  const updateProjectRepositories = async (update: (current: RepositoryBinding[]) => RepositoryBinding[]) => {
    if (!selectedProject) return;
    const project = selectedProject;
    const targetMachineId = machineId;
    const url = apiPath(`/api/projects/${encodeURIComponent(project.id)}`);
    const applyProject = (updated: DurableProject) => {
      if (machineIdRef.current === targetMachineId) {
        setProjects(current => current.map(item => item.id === updated.id && item.revision <= updated.revision ? updated : item));
      }
    };
    const response = await fetch(url, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision: project.revision, repositories: update(project.repositories) }),
    });
    const data = await response.json() as { project?: DurableProject; error?: string };
    if (!response.ok || !data.project) {
      if (response.status === 409) {
        const latest = await fetch(url, { cache: 'no-store' }).then(result => result.ok ? result.json() : undefined)
          .catch(() => undefined) as { project?: DurableProject } | undefined;
        if (latest?.project) applyProject(latest.project);
      }
      throw new Error(data.error || 'Could not update project repositories.');
    }
    applyProject(data.project);
    void arena.refresh();
  };

  const [activeImageIdsBySession, setActiveImageIdsBySession] = useState<Record<string, string | undefined>>({});
  const closeImage = useCallback(() => {
    if (sessionId) setActiveImageIdsBySession((current) => ({ ...current, [sessionId]: undefined }));
  }, [sessionId]);

  const selectDiagram = useCallback((id: string) => {
    if (!sessionId) return;
    navigationRevisions.current.set(sessionId, (navigationRevisions.current.get(sessionId) || 0) + 1);
    setActiveImageIdsBySession((current) => ({ ...current, [sessionId]: undefined }));
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
      apiPath(`/api/sessions/${encodeURIComponent(sessionId)}/sketches`),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sketch }),
      },
    )).then(() => {
      setActiveImageIdsBySession((current) => ({ ...current, [sessionId]: undefined }));
      mutateSession(sessionId, (session) => ({ ...session, activeDiagramId: sketch.id }));
      setPendingAttachmentIds([sketch.id]);
      snapshotRef.current = undefined;
    }).catch((error: unknown) => {
      notifyError(error, 'Could not create the sketch.');
    });
  }, [apiPath, enqueueSessionMutation, mutateSession, sessionId, sessionRunning]);

  const removeAttachment = useCallback((id: string) => setPendingAttachmentIds((current) => current.filter((item) => item !== id)), [setPendingAttachmentIds]);
  /** Explicit composer navigation reveals the requested module on narrow screens too. */
  const openSideFromComposer = (tab: SideTab) => {
    panelLayout.selectSideTab(tab);
  };
  const toggleAttachment = useCallback((id: string) => setPendingAttachmentIds((current) => current.includes(id)
    ? current.filter((item) => item !== id)
    : current.length < 4 ? [...current, id] : current), [setPendingAttachmentIds]);

  const toggleReport = useCallback((id: string) => setPendingReportIds((current) => current.includes(id)
    ? current.filter((item) => item !== id)
    : withPendingReport(current, id)), [setPendingReportIds]);
  const removeReport = useCallback((id: string) => setPendingReportIds((current) => current.filter((item) => item !== id)), [setPendingReportIds]);
  const pendingReportChips = pendingReportIds.map((id) => ({
    id, label: pendingReportLabel(id, reports.reports.find((report) => report.id === id)),
  }));
  // Images for each session's next message. Browser memory only: they are too large for the device
  // record, so a reload drops them.
  const [pendingFilesBySession, setPendingFilesBySession] = useState<Record<string, TextFile[]>>({});
  const pendingFilesRef = useRef<Record<string, TextFile[]>>({});
  const pendingFiles = (sessionId && pendingFilesBySession[sessionId]) || [];
  const updatePendingFiles = useCallback((id: string, update: (files: TextFile[]) => TextFile[]) => {
    const next = { ...pendingFilesRef.current, [id]: update(pendingFilesRef.current[id] ?? []) };
    pendingFilesRef.current = next; setPendingFilesBySession(next);
  }, []);
  const [pendingImagesBySession, setPendingImagesBySession] = useState<Record<string, PendingImage[]>>({});
  const pendingImagesRef = useRef<Record<string, PendingImage[]>>({});
  const pendingImages = (sessionId && pendingImagesBySession[sessionId]) || NO_IMAGES;
  const activeImageIndex = pendingImages.findIndex((image) => image.id === (sessionId && activeImageIdsBySession[sessionId]));
  const activeImage = pendingImages[activeImageIndex];
  const updatePendingImages = useCallback((targetSessionId: string, update: (current: PendingImage[]) => PendingImage[]) => {
    const { [targetSessionId]: current = NO_IMAGES, ...others } = pendingImagesRef.current;
    const images = update(current);
    if (images === current) return;
    const next = images.length ? { ...others, [targetSessionId]: images } : others;
    pendingImagesRef.current = next;
    setPendingImagesBySession(next);
  }, []);
  const openImage = useCallback((id: string) => {
    if (!sessionId || !pendingImagesRef.current[sessionId]?.some((image) => image.id === id)) return;
    setActiveImageIdsBySession((current) => ({ ...current, [sessionId]: id }));
    panelLayout.showCanvas();
  }, [panelLayout.showCanvas, sessionId]);
  const handleImageMarksChange = useCallback((id: string, marks: DrawingMark[]) => {
    if (!sessionId) return;
    updatePendingImages(sessionId, (current) => {
      if (!current.some((image) => image.id === id && JSON.stringify(image.marks || []) !== JSON.stringify(marks))) return current;
      return current.map((image) => image.id === id ? { ...image, marks } : image);
    });
  }, [sessionId, updatePendingImages]);
  /** Pasted or dropped files wait, prepared, in the session that was focused when they arrived. */
  const addImages = useCallback(async (files: File[]) => {
    const targetSessionId = focusedSessionIdRef.current;
    if (!targetSessionId) return;
    supersede('attach-image');
    const images = files.filter((file) => file.type.startsWith('image/'));
    for (const file of files.filter((file) => !file.type.startsWith('image/'))) {
      try {
        const prepared = await prepareTextFile(file);
        updatePendingFiles(targetSessionId, (current) => { const next = [...current, prepared]; validateTextFiles(next); return next; });
      } catch (error) { notifyError(error, 'Could not attach text files.', 'attach-file'); }
    }

    const refuseIfFull = () => {
      if ((pendingImagesRef.current[targetSessionId] ?? NO_IMAGES).length < MAX_IMAGES_PER_MESSAGE) return false;
      notify({ key: 'attach-image', tone: 'warning', message: `A message carries at most ${MAX_IMAGES_PER_MESSAGE} images. Remove one to attach another.` });
      return true;
    };
    for (const file of images) {
      // Counted before preparing, which is work, and again after: another paste may have taken the
      // last place meanwhile.
      if (refuseIfFull()) return;
      try {
        const image = { id: createUuid(), ...await prepareImage(file) };
        if (refuseIfFull()) return;
        updatePendingImages(targetSessionId, (current) => [...current, image]);
      } catch (error) {
        notifyError(error, 'That image could not be read.', 'attach-image');
      }
    }
  }, [notify, notifyError, supersede, updatePendingImages, updatePendingFiles]);
  const removeImage = useCallback((id: string) => {
    const targetSessionId = focusedSessionIdRef.current;
    if (targetSessionId) updatePendingImages(targetSessionId, (current) => current.filter((image) => image.id !== id));
  }, [updatePendingImages]);
  // A file dropped anywhere but on the composer is refused, open conversation or not: the browser
  // would replace CodeAI with the file, and the images waiting here with it. The composer's own
  // handlers run first, from React's root, and have cancelled theirs.
  useEffect(() => {
    const refuse = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer) || event.defaultPrevented) return;
      event.preventDefault();
      event.dataTransfer!.dropEffect = 'none';
    };
    window.addEventListener('dragover', refuse);
    window.addEventListener('drop', refuse);
    return () => {
      window.removeEventListener('dragover', refuse);
      window.removeEventListener('drop', refuse);
    };
  }, []);
  /** A deliberate capture waits in exactly its capture-time session's next message, wherever the user is now. */
  const placeCapturedReport = useCallback((summary: ImmersiveReportSummary): ImmersiveReportPlacement => {
    void reports.refresh();
    const target = capturedReportTarget(summary, localMachineId, reports.isSelfProject);
    if (!target) return 'saved';
    let attached = false;
    workspace.updateViewInProject(target.projectId, target.sessionId, (current) => {
      const pending = withPendingReport(current.pendingReportIds, summary.id);
      draftIdentity(target.sessionId, { projectId: target.projectId, machineId: undefined }).changeReports(pending);
      attached = pending.includes(summary.id);
      return withPendingReports(current, pending);
    });
    if (!attached) return 'saved';
    const active = machineIdRef.current === localMachineId && projectIdRef.current === target.projectId
      && focusedSessionIdRef.current === target.sessionId;
    return active ? 'active' : 'attached';
  }, [draftIdentity, localMachineId, reports.isSelfProject, reports.refresh, workspace.updateViewInProject]);

  const togglePin = useCallback((canvasId: string) => {
    if (!sessionId) return;
    void enqueueSessionMutation(sessionId, (current) => {
      const pinnedDiagramIds = current.pinnedDiagramIds.includes(canvasId)
        ? current.pinnedDiagramIds.filter((item) => item !== canvasId)
        : [...current.pinnedDiagramIds, canvasId];
      return fetch(apiPath(`/api/sessions/${encodeURIComponent(sessionId)}/pins`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: current.revision, pinnedDiagramIds }),
      });
    }).catch((error: unknown) => {
      notifyError(error, 'Could not update the pinned canvases.');
    });
  }, [apiPath, enqueueSessionMutation, sessionId]);

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
    const prior = annotationSaves.current.get(key);
    if (prior?.timer) clearTimeout(prior.timer);
    let result: Promise<SessionSnapshot> | undefined;
    const pending = {
      sessionId,
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
      save: () => {
        if (pending.timer) { clearTimeout(pending.timer); pending.timer = undefined; }
        result ??= enqueueSessionMutation(sessionId, (current) => fetch(apiPath(`/api/sessions/${encodeURIComponent(sessionId)}/annotations`), {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedRevision: current.revision, annotation }),
        })).finally(() => {
          if (annotationSaves.current.get(key) === pending) annotationSaves.current.delete(key);
        });
        return result;
      },
    };
    pending.timer = setTimeout(() => { void pending.save().catch((error: unknown) => notifyError(error, 'Could not save the drawing.')); }, 250);
    annotationSaves.current.set(key, pending);
  }, [apiPath, enqueueSessionMutation, mutateSession, sessionId]);

  const flushAnnotations = useCallback(async (targetSessionId: string) => {
    // A send appends a canonical message/revision. Commit drawings first, including a debounce
    // or save that was already in flight, so that append cannot invalidate the drawing's revision.
    for (;;) {
      const pending = [...annotationSaves.current.values()].filter(item => item.sessionId === targetSessionId);
      await Promise.all(pending.map(item => item.save()));
      await mutationQueues.current.get(targetSessionId);
      if (![...annotationSaves.current.values()].some(item => item.sessionId === targetSessionId)) return;
    }
  }, []);

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

  const handleSurfaceChange = useCallback((surface: CanvasSurface) => {
    if (!sessionId) return;
    workspace.updateView(sessionId, (current) => {
      if (surface === 'flat') {
        if (!current.surface) return current;
        const { surface: _surface, ...rest } = current;
        return rest;
      }
      return current.surface === surface ? current : { ...current, surface };
    });
  }, [sessionId, workspace.updateView]);

  const handleSpatialChange = useCallback((spatial: SpatialViewState) => {
    if (!sessionId) return;
    workspace.updateView(sessionId, (current) => ({ ...current, spatial: parseSpatialView(spatial) || resetSpatialView() }));
  }, [sessionId, workspace.updateView]);

  const handleResetSpatial = useCallback(() => {
    if (!sessionId) return;
    workspace.updateView(sessionId, (current) => ({ ...current, spatial: resetSpatialView() }));
  }, [sessionId, workspace.updateView]);

  const setMode = useCallback((next: AgentMode) => {
    if (!sessionId) return;
    const run = runsBySessionRef.current[sessionId];
    if (run || preparingSends.includes(sessionId)) {
      if (!run?.runId) {
        notify({ tone: 'info', message: 'The turn is still being accepted. Choose the mode again once it starts.' });
        return;
      }
      void fetch(apiPath('/api/agent/mode'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: run.runId, mode: next }),
      }).then(async (response) => {
        const data = await response.json() as { error?: string };
        if (!response.ok) throw new Error(data.error || 'The mode could not be changed.');
      }).catch((error: unknown) => notifyError(error, 'The mode could not be changed.', 'mode'));
      return;
    }
    mutateSession(sessionId, (current) => ({ ...current, defaultMode: next }));
    updatePreferences((current) => ({ ...current, mode: next }));
  }, [apiPath, mutateSession, preparingSends, sessionId, updatePreferences]);

  const activeAgentId = activeAgent?.id;
  const activeAgentProvider = activeAgent?.provider;
  const setModelSelection = useCallback((next: ModelSelection) => {
    if (!sessionId || !activeAgentId || !activeAgentProvider) return;
    // Default is stored too, so this agent stays on it when another agent's choice moves the device's.
    workspace.updateView(sessionId, ({ modelSelections: { [activeAgentId]: _prior, ...others } = {}, ...current }) => (
      { ...current, modelSelections: { ...others, [activeAgentId]: next } }
    ));
    updatePreferences((current) => ({ ...current, models: { ...current.models, [activeAgentProvider]: next } }));
  }, [activeAgentId, activeAgentProvider, sessionId, updatePreferences, workspace.updateView]);

  const chooseNewProvider = useCallback((provider: AgentProvider) => {
    updatePreferences((current) => ({ ...current, provider }));
  }, [updatePreferences]);

  const chooseNewRole = useCallback((role: AgentRole) => {
    updatePreferences((current) => ({ ...current, role }));
  }, [updatePreferences]);

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
    supersede('participants');
    const requestKey = `${session.id}:${provider}:${role}`;
    const requestId = participantRequestIds.current.get(requestKey) || createUuid();
    participantRequestIds.current.set(requestKey, requestId);
    try {
      const updated = await enqueueSessionMutation(session.id, () => fetch(
        apiPath(`/api/sessions/${encodeURIComponent(session.id)}/participants`),
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
        // A new agent starts at this device's last choice for its provider and keeps it as its own.
        const selection = preferences.models?.[provider] ?? {};
        workspace.updateView(session.id, (current) => ({ ...current, modelSelections: { ...current.modelSelections, [added.id]: selection } }));
      }
    } catch (error) {
      notifyError(error, 'Could not add that agent.', 'participants');
    } finally {
      setParticipantBusy(false);
    }
  }, [apiPath, enqueueSessionMutation, mutateSession, participantBusy, preferences.models, session, sessionRunning, workspace.updateView]);

  const setPrimaryAgent = useCallback(async (participantId: string) => {
    if (!session || sessionRunning || participantBusy) return;
    setParticipantBusy(true);
    supersede('participants');
    try {
      await enqueueSessionMutation(session.id, (current) => fetch(
        apiPath(`/api/sessions/${encodeURIComponent(session.id)}/participants`),
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
      notifyError(error, 'Could not change the main agent.', 'participants');
    } finally {
      setParticipantBusy(false);
    }
  }, [apiPath, enqueueSessionMutation, mutateSession, participantBusy, session, sessionRunning]);

  const prefillHandoff = useCallback((participantId: string, text: string, handoffMode?: AgentMode) => {
    selectAgent(participantId);
    setComposer((current) => current.trim() ? `${current.trimEnd()}\n\n${text}` : text);
    if (handoffMode && sessionId) mutateSession(sessionId, (current) => ({ ...current, defaultMode: handoffMode }));
  }, [mutateSession, selectAgent, sessionId]);
  /** Retry prepares a draft; replacing another draft is always an explicit action. */
  const retryMessage = useCallback((participantId: string, text: string, retryMode: AgentMode | undefined, reportIds: readonly string[], imageCount = 0, files: TextFile[] = [], uncertain = false, activeFile?: ActiveFileContext) => {
    if (!sessionId) return;
    const targetId = sessionId;
    const key = `retry:${targetId}`;
    const live = () => Boolean(runsBySessionRef.current[targetId] || sendingSessions.current.has(targetId) || reconnectingRuns.current.has(targetId)
      || acceptanceChecks.current.has(targetId) || arena.discovery.active.some((run) => run.sessionId === targetId && run.machineId === machineId));
    if (live()) return;
    const replace = () => {
      if (live()) return;
      try { validateTextFiles(files); } catch (error) { notifyError(error, 'The retried files are unavailable.'); return; }
      const availableReports = reportIds.filter((id) => reports.reports.some((report) => report.id === id)).slice(0, MAX_REPORTS_PER_MESSAGE);
      const identity = draftIdentity(targetId);
      identity.editText();
      identity.changeReports(availableReports);
      workspace.updateView(targetId, (current) => withPendingReports({ ...current, composer: text, addressedAgentId: participantId,
        ...(retryMode ? { defaultMode: retryMode } : {}) }, availableReports));
      updatePendingFiles(targetId, () => structuredClone(files));
      updatePendingImages(targetId, () => []);
      repositoryFiles.restoreContext(activeFile);
      mutateSession(targetId, (current) => ({ ...current, addressedAgentId: participantId,
        ...(retryMode ? { defaultMode: retryMode } : {}) }));
      dismissToast(key);
      const recovery: string[] = [];
      if (uncertain) recovery.push('This instruction may already have run. Review its effects before sending the retry.');
      if (imageCount) recovery.push(`${imageCount === 1 ? 'The original image is' : `The ${imageCount} original images are`} not stored. Attach ${imageCount === 1 ? 'it' : 'them'} again.`);
      if (availableReports.length !== reportIds.length) recovery.push('Some original reports are unavailable. Attach available reports again if needed.');
      if (recovery.length) notify({ tone: uncertain ? 'warning' : 'info', message: recovery.join(' ') });
    };
    const current = workspace.getView(targetId);
    if (current?.composer || current?.pendingReportIds?.length || pendingFilesRef.current[targetId]?.length || pendingImagesRef.current[targetId]?.length) {
      notify({ key, tone: 'warning', message: 'Retry will replace the text and evidence in this draft.', persistent: true,
        actions: [{ label: 'Replace draft', onSelect: replace }, { label: 'Keep draft', onSelect: () => dismissToast(key) }] });
    } else replace();
  }, [arena.discovery.active, dismissToast, draftIdentity, machineId, mutateSession, notify, notifyError, reports.reports, repositoryFiles.restoreContext, sessionId, updatePendingFiles, updatePendingImages, workspace.getView, workspace.updateView]);

  const focusedPermissionTargets: PermissionTarget[] = (focusedRun?.runId ? permissions.map((request) => ({
    ...request, runId: focusedRun.runId!,
  })) : arena.discovery.active.filter((run) => run.machineId === machineId && run.sessionId === sessionId)
    .flatMap((run) => run.pendingPermissions.map((request) => ({ ...request, runId: run.runId })))).map((request) => {
      const agent = agents.find((item) => item.id === request.participantId);
      return { ...request, machineId: machineId || localMachineId || '', sessionId: sessionId || '',
        sessionTitle: session?.title || 'Session', machineLabel: arena.machines.find((item) => item.machine.id === machineId)?.machine.label || 'This machine',
        agentLabel: agent ? `${agent.displayName} (${PROVIDER_LABELS[agent.provider]})` : 'Agent',
      };
    });
  const permissionFeedback = Object.fromEntries(focusedPermissionTargets.flatMap((target) => {
    const result = permissionDecisions.results[permissionKey(target)];
    return result ? [[target.requestId, result]] : [];
  }));
  const decidePermission = (requestId: string, decision: 'allow' | 'deny') => {
    const target = focusedPermissionTargets.find((item) => item.requestId === requestId);
    if (target) void permissionDecisions.decide(target, decision);
  };

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
    onAccepted?(runId: string): void;
  }) => {
    let receivedFinal = false;
    let suspended = false;
    let streamError: Extract<AgentEvent, { type: 'error' }> | undefined;
    let userMessageId = turn.userMessageId;
    let streamRunId = turn.runId;
    let terminalUnreadRecorded = false;
    // Completed replay restores outcomes, while idle composer choices belong to the next turn.
    const finishedReplay = turn.recovering && response.headers.get('X-CodeAI-Run-Finished') === 'true';
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
      if (event.type === 'turn-activity' && event.turn.runId === event.runId) {
        if (event.turn.userMessageId === userMessageId) turn.onAccepted?.(event.runId);
        mutateSession(turn.sessionId, (current) => mergeTurnActivity(current, event.turn));
      }
      if (event.type === 'done' && event.suspended) {
        suspended = true;
        await refreshSession(turn.sessionId);
      }
      if (event.type === 'context-usage') {
        mutateSession(turn.sessionId, (current) => ({ ...current, participants: current.participants.map(participant =>
          participant.kind === 'agent' && participant.id === event.participantId ? { ...participant, contextUsage: event.usage } : participant) }));
      }
      if (event.type === 'mode-changed') {
        turn.mode = event.mode;
        if (!finishedReplay) {
          mutateSession(turn.sessionId, (current) => ({ ...current, defaultMode: event.mode }));
          updatePreferences((current) => ({ ...current, mode: event.mode }));
        }
      }
      if (event.type === 'run-started') {
        userMessageId ||= event.messageId;
        if (userMessageId === event.messageId) turn.onAccepted?.(event.runId);
        if (!finishedReplay) mutateSession(turn.sessionId, (current) => ({ ...current, addressedAgentId: event.participantId }));
        await refreshSession(turn.sessionId);
      }
      if (event.type === 'permission-request') {
        if (!replayed && (focusedSessionIdRef.current !== turn.sessionId || !chatOpenRef.current)) {
          workspace.updateView(turn.sessionId, (current) => ({ ...current, unread: current.unread + 1 }));
        }
      }
      if (event.type === 'permission-resolved') {
        if (event.decision === 'timeout' && focusedSessionIdRef.current === turn.sessionId) {
          notify({ tone: 'warning', message: 'An approval request expired and was denied automatically.' });
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
        if (ready.length > 1) notify({ tone: 'info', message: `${ready.length} diagram results are ready in history. The active canvas was preserved.` });
        await refreshSession(turn.sessionId);
      }
    }
    // Stream closure follows checkpoint cleanup and checkout release. Intermediate output and
    // a disconnected stream do not promise that the repository is ready to read.
    const target = repositoryRefreshRef.current;
    if ((receivedFinal || streamError) && target.apiBase === repositoryApiBase
      && sessionsRef.current.find((item) => item.id === turn.sessionId)?.repositories.some((binding) => binding.checkoutId === target.checkoutId)) {
      target.refresh();
    }
    return { receivedFinal, suspended, streamError, userMessageId, runId: streamRunId };
  }, [mutateSession, refreshSession, repositoryApiBase, setRunOutcome, updatePreferences, updateRun, workspace.updateView]);

  const send = useCallback(async (override?: { text: string; mode: AgentMode; participantId?: string }) => {
    if (!session || runsBySessionRef.current[session.id] || sendingSessions.current.has(session.id) || reconnectingRuns.current.has(session.id) || acceptanceChecks.current.has(session.id) || recovery.busy) return;
    if (lifecycle.busy) {
      notify({ key: 'send', tone: 'warning', message: 'CodeAI is building a new release of itself. Send again once it has restarted; your draft is kept.' });
      return;
    }
    if (!session.repositories.some((repository) => repository.role === 'primary')) {
      notify({ key: 'send', tone: 'warning', message: 'Attach a repository and make it primary before running an agent turn. The canvas and participant setup remain available.' });
      panelLayout.openRepository();
      return;
    }
    const turnAgent = findAgentParticipant(session.participants, override?.participantId) || activeAgent;
    if (!turnAgent) return;
    const sentCanvasIds = [...pendingAttachmentIds];
    const selectedAtSend = structuredClone(sentCanvasIds.flatMap(id => {
      const canvas = findCanvasTarget(session, id);
      return canvas ? [canvas] : [];
    }));
    const annotationsAtSend = structuredClone(session.annotations);
    // Reports and images belong to the composed draft; an Execute plan or Continue turn does not carry them.
    const sentReportIds = override ? [] : [...pendingReportIds];
    const filesSnapshot = immutableEvidence(override ? [] : pendingFilesRef.current[session.id] ?? []);
    const imagesSnapshot = immutableEvidence(override ? NO_IMAGES : pendingImagesRef.current[session.id] ?? NO_IMAGES);
    const sentFiles = filesSnapshot.payload;
    const sentImages = imagesSnapshot.payload;
    const sentActiveFile = override ? undefined : repositoryFiles.activeFile;
    const identity = draftIdentity(session.id);
    const submittedDraft = identity.capture(sentReportIds);
    // Export may outlive navigation to another session; keep this session's own canvas frame.
    const snapshotAtSend = snapshotRef.current;
    // A sketch, a report, or an image is itself the instruction, so an empty composer still makes a valid turn.
    const typed = (override?.text ?? composerDraft.getSnapshot()).trim();
    const turnMode: AgentMode = override?.mode ?? mode;
    const isolationIssue = nativeClaudeIsolationIssue({ provider: turnAgent.provider, execution: session.execution, level: securityLevel, mode: turnMode, choice: session.instructions });
    if (isolationIssue) {
      notify({ key: 'send', tone: 'warning', message: isolationIssue });
      return;
    }
    const turnProviderHealth = executionProviders?.[turnAgent.provider];
    if (!turnProviderHealth?.available || !turnProviderHealth.supportedModes.includes(turnMode)) {
      notify({ key: 'send', tone: 'warning', message: turnProviderHealth?.message || `${PROVIDER_LABELS[turnAgent.provider]} is not available for ${turnMode} mode.` });
      return;
    }
    // Each agent's own choice: an Execute plan turn may address an agent other than the selected one.
    const turnModel = offeredModelSelection(agentModelSelection(view, preferences, turnAgent), turnProviderHealth);
    supersede('send');
    sendingSessions.current.add(session.id);
    setPreparingSends((current) => [...current, session.id]);
    let reconnectAfterSend = false;
    let acceptedRunId: string | undefined;
    try {
      setRunOutcome(session.id);
      const canvasData = selectedAtSend.length < sentCanvasIds.length ? await loadCanvases(session.id) : undefined;
      const canvasSession = canvasData ? { ...session, ...canvasData } : session;
      const selected = sentCanvasIds.flatMap(id => {
        const canvas = selectedAtSend.find(item => canvasTargetId(item) === id) || findCanvasTarget(canvasSession, id);
        return canvas ? [canvas] : [];
      });
      if (selected.length !== sentCanvasIds.length) throw new Error('Could not load all attached canvases. Your draft and attachments are kept. Reopen the canvas and retry.');
      const sentAnnotations = { ...canvasSession.annotations, ...annotationsAtSend };
      const text = typed || (selected.some(canvas => canvas.kind === 'sketch') ? SKETCH_ONLY_INSTRUCTION
        : sentReportIds.length ? REPORT_ONLY_INSTRUCTION : sentImages.length ? IMAGE_ONLY_INSTRUCTION : sentFiles.length ? FILE_ONLY_INSTRUCTION : '');
      if (!text) return;
      const imagePayload = await Promise.all(sentImages.map(prepareImageForSend));
      const attachmentPayload: DiagramMessageAttachment[] = [];
      let compositeWarning = false;
      for (const canvas of selected) {
        const id = canvasTargetId(canvas);
        const marks = sentAnnotations[id]?.marks || [];
        const snapshot = id === session.activeDiagramId ? snapshotAtSend : undefined;
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
      if (attachmentPayload.some((item) => item.marks.length > 0 && !item.compositePngDataUrl)) {
        throw new Error('The marked canvas could not be exported. Your draft and attachment are preserved; retry after reopening the canvas.');
      }
      if (compositeWarning) {
        notify({ key: 'send', tone: 'warning', message: selected.every((canvas) => canvas.kind === 'sketch')
          ? 'Composite image export was unavailable; the vector marks are still attached.'
          : 'Composite image export was unavailable; Mermaid source and vector marks are still attached.' });
      }

      await flushAnnotations(session.id);
      const userId = createUuid();
      const createdAt = new Date().toISOString();
      // Shown until the canonical message arrives; omitted unless every attached report is listed here.
      const reportRecords = sentReportIds.flatMap((reportId): ReportAttachmentRecord[] => {
        const summary = reports.reports.find((report) => report.id === reportId);
        return summary ? [{
          reportId, receivedAt: summary.receivedAt, kind: summary.kind,
          screenshotIncluded: summary.screenshot, errorCount: summary.errorCount,
        }] : [];
      });
      const human = session.participants.find((participant) => participant.kind === 'human');
      if (!human) {
        notify({ key: 'send', tone: 'error', message: 'This session has no local user identity.' });
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
        ...(reportRecords.length && reportRecords.length === sentReportIds.length ? { reportAttachments: reportRecords } : {}),
        ...(sentImages.length ? { imageAttachments: imagePayload.map(({ mediaType, bytes }) => ({ mediaType, bytes })) } : {}),
        ...(sentActiveFile ? { activeFile: sentActiveFile } : {}),
        mode: turnMode,
        ...(securityLevel === 'native' && session.execution !== 'docker' && (turnMode === 'agent' || turnMode === 'auto') ? { level: 'native' as const } : {}),
      };
      const activeAtSend = session.activeDiagramId;
      const navigationAtSend = navigationRevisions.current.get(session.id) || 0;
      mutateSession(session.id, (current) => ({
        ...current,
        // A sketch-only turn would otherwise title the session with the whole synthesized instruction.
        title: current.messages.length === 0 ? (typed ? typed.slice(0, 56) : 'Sketch session') : current.title,
        messages: [...current.messages, userMessage],
      }));
      putRun({
        sessionId: session.id,
        participantId: turnAgent.id,
        userMessageId: userId,
        mode: turnMode,
        state: 'running',
        status: changesCheckout(turnMode)
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
      let blockingRun: RunDescriptor | undefined;
      let accepted = false;
      let response: Response | undefined;
      const sessionUrl = apiPath(`/api/sessions/${encodeURIComponent(session.id)}`);
      const acknowledge = (runId?: string) => {
        if (runId) {
          streamRunId = runId;
          acceptedRunId = runId;
          updateRun(session.id, (run) => ({ ...run, runId, userMessageId: userId }));
        }
        if (accepted) return;
        accepted = true;
        mutateSession(session.id, (current) => ({ ...current, messages: current.messages.map((message) => message.id === userId && message.role === 'user' && message.status === 'sending'
          ? { ...message, status: 'sent' } : message) }));
        if (override) return;
        workspace.updateView(session.id, (current) => withPendingReports(
          { ...current, composer: identity.remainingText(submittedDraft, current.composer) },
          identity.remainingReports(submittedDraft, current.pendingReportIds ?? []),
        ));
        updatePendingFiles(session.id, filesSnapshot.remaining);
        updatePendingImages(session.id, imagesSnapshot.remaining);
      };
      const resolveAcceptance = async () => {
        const result = await reconcileMessageAcceptance(sessionUrl, userId);
        if (result.state === 'accepted') {
          const message = result.session.messages.find((message) => message.id === userId);
          acknowledge(message?.role === 'user' ? message.turn?.runId : undefined);
          applyServerSnapshot(result.session, machineId);
        }
        return result;
      };

      // An uncertain transport outcome may only retry this exact identity and evidence snapshot.
      // Absence in a snapshot cannot prove that an earlier POST has finished preflight.
      const requestBody = JSON.stringify({
        sessionId: session.id,
        messageId: userId,
        participantId: turnAgent.id,
        text,
        diagramAttachments: attachmentPayload,
        reportAttachments: sentReportIds.map((reportId) => ({ reportId })),
        // Named only when there are some, so an executor on an older CodeAI still takes every other message.
        ...(sentImages.length ? { imageAttachments: imagePayload.map(({ dataUrl }) => ({ dataUrl })) } : {}),
        ...(sentFiles.length ? { fileAttachments: sentFiles } : {}),
        ...(sentActiveFile ? { activeFile: sentActiveFile } : {}),
        mode: turnMode,
        ...turnModel,
      });
      try {
        response = await fetch(apiPath('/api/agent/message'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody,
          signal: controller.signal,
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({})) as { error?: string; activeRun?: RunDescriptor };
          blockingRun = data.activeRun;
          throw new Error(data.error || `Agent request failed (${response.status}).`);
        }
        const runId = response.headers.get('X-CodeAI-Run-Id') || undefined;
        if (runId) acknowledge(runId);
        else await resolveAcceptance();
        const outcome = await consumeStream(response, {
          sessionId: session.id,
          mode: turnMode,
          userMessageId: userId,
          activeAtSend,
          navigationAtSend,
          runId,
          attachmentIds: sentCanvasIds,
          onAccepted: acknowledge,
        });
        streamError = outcome.streamError;
        streamRunId = outcome.runId;
        if (!outcome.receivedFinal && !outcome.suspended && !streamError) throw new Error('Agent stream ended without a final response.');
        if (outcome.receivedFinal) acknowledge(outcome.runId);
      } catch (error) {
        const cancelled = controller.signal.aborted;
        if (!streamError) {
          const reconciliation = accepted ? undefined : await resolveAcceptance();
          // A gateway's 5xx can hide an executor that is still accepting the original POST.
          const definitelyRejected = !accepted && response && [400, 401, 403, 404, 409, 413, 429].includes(response.status)
            && reconciliation?.state === 'absent';
          if (!accepted && !definitelyRejected) {
            const key = `acceptance:${session.id}`;
            let checking = false;
            let retryAvailable = false;
            const acceptDelivery = (runId?: string) => {
              acknowledge(runId);
              reconnectAfterSend = true;
              reconnectingRuns.current.set(session.id, { runId: streamRunId, machineId });
              setReconnectingSends((current) => current.includes(session.id) ? current : [...current, session.id]);
              acceptanceChecks.current.delete(session.id);
              setUnconfirmedSends((current) => current.filter((id) => id !== session.id));
              dismissToast(key);
              setRunOutcome(session.id, { runId: streamRunId, missingProviderSession: false,
                message: 'The instruction was accepted. Reconnecting to its saved activity and execution status.' });
              if (!sendingSessions.current.has(session.id) && machineIdRef.current === machineId && projectIdRef.current === projectId) {
                void recoverRuns.current(session.id, streamRunId);
              }
            };
            const check = async () => {
              if (checking) return;
              checking = true;
              try {
                const result = await resolveAcceptance();
                retryAvailable ||= result.state === 'absent';
                if (!accepted) announce();
              } catch { announce(); }
              finally { checking = false; }
            };
            const retryDelivery = async () => {
              if (checking || accepted) return;
              checking = true;
              try {
                const retried = await fetch(apiPath('/api/agent/message'), {
                  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: requestBody,
                });
                const runId = retried.ok ? retried.headers.get('X-CodeAI-Run-Id') || undefined : undefined;
                if (runId) acceptDelivery(runId);
                else await resolveAcceptance();
                // Reattach through the shared run owner; cancelling this subscriber leaves execution running.
                void retried.body?.cancel().catch(() => undefined);
              } catch { await resolveAcceptance(); }
              finally {
                checking = false;
                if (!accepted) announce();
              }
            };
            const announce = () => notify({ key, tone: 'warning', persistent: true,
              message: retryAvailable
                ? 'Delivery is still unconfirmed. Retry delivery sends the original instruction and attachments with the same message identity.'
                : 'Delivery is unconfirmed. The original instruction may have been accepted. Check delivery before sending again.',
              actions: [{ label: 'Check delivery', onSelect: () => void check() },
                ...(retryAvailable ? [{ label: 'Retry delivery', onSelect: () => void retryDelivery() }] : [])],
              onDismiss: () => { if (acceptanceChecks.current.has(session.id)) announce(); },
            });
            acceptanceChecks.current.set(session.id, { messageId: userId, check, accept: acceptDelivery });
            setUnconfirmedSends((current) => current.includes(session.id) ? current : [...current, session.id]);
            announce();
          }
          if (accepted) {
            reconnectAfterSend = true;
            reconnectingRuns.current.set(session.id, { runId: streamRunId, machineId });
            setReconnectingSends((current) => current.includes(session.id) ? current : [...current, session.id]);
          }
          if (!cancelled) updateRun(session.id, (run) => ({ ...run, runFailed: true }));
          const message = accepted
            ? 'The instruction was accepted. Reconnecting to its saved activity and execution status.'
            : !definitelyRejected ? 'Delivery is unconfirmed. Check delivery before sending this instruction again.'
            : cancelled
            ? 'The request was cancelled. Earlier conversation and diagrams are unchanged.'
            : error instanceof Error ? error.message : 'Agent request failed.';
          setRunOutcome(session.id, {
            runId: streamRunId,
            message,
            missingProviderSession: false,
            ...(cancelled ? { cancelled: true } : {}),
            ...(blockingRun ? { blockingRun } : {}),
          });
          if (focusedSessionIdRef.current !== session.id || !chatOpenRef.current) {
            workspace.updateView(session.id, (current) => ({ ...current, unread: current.unread + 1 }));
          }
          if (!accepted) mutateSession(session.id, (current) => ({ ...current, messages: current.messages.map((message) => message.id === userId && message.role === 'user'
            ? { ...message, status: cancelled ? 'cancelled' : 'failed', delivery: definitelyRejected ? 'not-sent' : 'possibly-sent' }
            : message) }));
          await refreshSession(session.id);
        }
      } finally {
        removeRun(session.id, streamRunId);
      }
    } catch (error) {
      notifyError(error, 'Could not prepare this instruction. The draft is preserved.', 'send');
    } finally {
      sendingSessions.current.delete(session.id);
      setPreparingSends((current) => current.filter((id) => id !== session.id));
      if (reconnectAfterSend && machineIdRef.current === machineId && projectIdRef.current === projectId) void recoverRuns.current(session.id, acceptedRunId);
    }
  }, [activeAgent, apiPath, applyServerSnapshot, composerDraft, consumeStream, loadCanvases, dismissToast, draftIdentity, flushAnnotations, health, lifecycle.busy, machineId, mode, mutateSession, notify, panelLayout.openRepository, pendingAttachmentIds, pendingReportIds, projectId, putRun, recovery.busy, refreshSession, removeRun, reports.reports, repositoryFiles.activeFile, session, setRunOutcome, updatePendingImages, updatePendingFiles, updateRun, view?.modelSelections, preferences, workspace.updateView]);

  const newerFormatNotice = newerFormatSessions > 0 && !workspaceMachineId && !newerFormatNoticeDismissed
    ? `${newerFormatSessions} ${newerFormatSessions === 1 ? 'session was' : 'sessions were'} written by a newer CodeAI and ${newerFormatSessions === 1 ? 'is' : 'are'} hidden here.`
    : undefined;
  const unreadBySession = Object.fromEntries(Object.entries(workspace.scope.views).map(([id, state]) => [id, state.unread]));
  const runTabsBySession = Object.fromEntries([
    ...(arena.machines.find(item => item.machine.id === machineId)?.runs.active || []).map(run => [run.sessionId, {
      state: run.state, status: run.status, queuePosition: run.queuePosition, pendingApprovals: run.pendingPermissionCount,
    }]),
    ...Object.entries(runsBySession).map(([id, run]) => [id, {
      state: run.state,
      status: run.status,
      queuePosition: run.queuePosition,
      pendingApprovals: Math.max(run.pendingPermissionCount || 0, run.permissions.length),
    }]),
  ]);
  const arenaInbox = buildMultiMachineInbox(arena.machines, arena.deviceState);
  const arenaUnread = unreadArenaAttention(arenaInbox);
  const arenaReplies = useArenaReplies(localMachineId, lifecycle.busy ? 'CodeAI is restarting. Your draft is kept.' : undefined, {
    archive: (targetMachineId, target) => archiveArenaSession(targetMachineId, target),
    newChat: async (targetMachineId, target, options) => {
      const agent = findAgentParticipant(target.participants, target.primaryAgentId);
      if (!agent) return false;
      const created = await createSession(agent.provider, {
        fromArena: true, machineId: targetMachineId, projectId: target.projectId,
        sourceSessionId: target.id, execution: target.execution || 'local', role: agent.role,
        mode: options.mode, modelSelection: options.modelSelection,
      });
      if (created) workspace.closeInProject(target.projectId, target.id, targetMachineId === localMachineId ? undefined : targetMachineId);
      return created;
    },
    saved: (targetMachineId, saved) => { applyServerSnapshot(saved, targetMachineId); void arena.refresh(); },
  });
  const replyOptionsFor = (machine: ArenaMachineSnapshot, target: ArenaSessionSummary, recipientId = target.primaryAgentId): ArenaReplyOptions => {
    const agent = target.agents.find(agent => agent.id === recipientId);
    const providers = machine.machine.kind === 'local'
      ? (target.execution === 'docker' ? localExecutionHealth?.docker.providers : localExecutionHealth?.local.providers) ?? machine.providers
      : machine.providers;
    const provider = agent && providers[agent.provider];
    const unsupported = unsupportedAgentModes(provider?.supportedModes ?? [], target.execution);
    const modes = provider?.available ? provider.supportedModes.filter(mode => !unsupported.includes(mode)) : [];
    const saved = workspace.getScopeInProject(target.projectId, machine.machine.id === localMachineId ? undefined : machine.machine.id)?.views[target.id];
    const preferred = saved?.defaultMode ?? inheritedMode(preferences.mode, target.execution);
    return { modes, mode: composerMode(preferred, unsupported),
      ...(!agent ? { unavailableReason: 'Open this session to reply. Its executor needs an update for quick replies.' }
        : !provider?.available ? { unavailableReason: provider?.message || 'This provider is unavailable.' } : {}),
      modelSelection: offeredModelSelection(agentModelSelection(saved, preferences, agent), provider) };
  };
  const arenaReplyOptions = (machine: ArenaMachineSnapshot, target: ArenaSessionSummary) =>
    replyOptionsFor(machine, target, arenaReplies.get(machine.machine.id, target.id).delivery?.participantId);
  const observerProviders = localExecutionHealth?.local.providers ?? arena.machines.find(m => m.machine.kind === 'local')?.providers;
  const observerProvider = preferences.provider ?? (observerProviders?.claude.available ? 'claude' : 'codex');
  const availableProviderUpdateCount = localExecutionHealth?.docker.enabled && localExecutionHealth.docker.providers.claude.available
    ? providerUpdateCount : 0;

  const openArenaSession = useCallback((targetMachine: ArenaMachineSnapshot, target: ArenaSessionSummary) => {
    if (targetMachine.machine.state !== 'online') return;
    const targetWorkspaceMachineId = targetMachine.machine.id !== localMachineId ? targetMachine.machine.id : undefined;
    workspace.openInProject(target.projectId, target.id, undefined, targetWorkspaceMachineId);
    navigateWorkspace({ sessionId: target.id, machineId: targetMachine.machine.id });
    if (targetMachine.machine.id === machineId && target.projectId === projectId) return;
    selectMachineCatalog(targetMachine);
    setLoading(true);
    setProjectId(target.projectId);
    sessionsRef.current = [];
    setSessions([]);
    setRepositoryTree(undefined);
  }, [localMachineId, machineId, navigateWorkspace, projectId, selectMachineCatalog, workspace.openInProject]);

  const [launchFocus, setLaunchFocus] = useState<{ sessionId: string; request: string }>();
  const launchNavigation = useRef('');
  launchNavigation.current = JSON.stringify([pathname, machineId, projectId, sessionId]);
  const announceLaunch = (result: import('@/features/session-launch/sessionLaunch').LaunchResult, settings: LaunchSettings) => notify({
    key: `launch:${result.session.id}`, tone: 'success', message: result.queued ? 'Session queued. It will start after earlier sessions are archived.'
      : result.started && settings.waitForCheckout && result.queued === undefined ? 'Session submitted. Open it to check progress.'
      : result.started ? 'Session started in the background.' : 'Session created.',
    actions: [{ label: 'Open session', onSelect: () => { void openLaunchedSession(result.session, settings); } }],
  });
  const openLaunchedSession = async (saved: PublicSession, settings: LaunchSettings, expectedNavigation?: string) => {
    try {
      const target = arena.machines.find((entry) => entry.machine.id === settings.machineId);
      if (!target || target.machine.state !== 'online') throw new Error('The session’s machine is offline. Find it in Arena when it reconnects.');
      if (saved.archivedAt) { router.push('/arena/archived'); return; }
      const api = (path: string) => machineApiPath(path, settings.machineId, localMachineId);
      const [sessionResponse, projectsResponse, checkoutsResponse] = await Promise.all([
        fetch(api(`/api/sessions/${saved.id}`), { cache: 'no-store' }),
        fetch(api('/api/projects'), { cache: 'no-store' }), fetch(api('/api/checkouts'), { cache: 'no-store' }),
      ]);
      const data = await sessionResponse.json() as { session?: PublicSession; error?: string };
      if (!sessionResponse.ok || !data.session) throw new Error(data.error || 'Could not open the session.');
      const catalog = { ...target,
        projects: projectsResponse.ok ? (await projectsResponse.json()).projects : target.projects,
        checkouts: checkoutsResponse.ok ? (await checkoutsResponse.json()).checkouts : target.checkouts };
      const summary: ArenaSessionSummary = { id: data.session.id, revision: data.session.revision, title: data.session.title,
        projectId: data.session.projectId, updatedAt: data.session.updatedAt, repositoryCheckoutIds: data.session.repositories.map((binding) => binding.checkoutId), agents: [] };
      if (expectedNavigation !== undefined && launchNavigation.current !== expectedNavigation) {
        announceLaunch({ session: data.session, started: false }, settings); return;
      }
      if (settings.machineId === machineId && saved.projectId === projectId) applyServerSnapshot(data.session, settings.machineId);
      openArenaSession(catalog, summary);
      if (settings.machineId === machineId && saved.projectId === projectId) {
        setProjects(catalog.projects); setCheckouts(catalog.checkouts);
      }
      panelLayout.openConversationFor(saved.id, getArtifacts(data.session).length + getSketches(data.session).length > 0);
      setLaunchFocus({ sessionId: saved.id, request: createUuid() });
    } catch (error) { notifyError(error, 'Could not open the new session.'); }
  };
  const preserveCurrentChoices = () => {
    if (session) workspace.updateView(session.id, (current) => ({ ...current, defaultMode: current.defaultMode ?? mode,
      modelSelections: { ...Object.fromEntries(agents.map((agent) => [agent.id,
        offeredModelSelection(agentModelSelection(current, preferences, agent), executionProviders?.[agent.provider])])), ...current.modelSelections } }));
  };
  const rememberLaunchChoices = (created: PublicSession, settings: LaunchSettings) => {
    preserveCurrentChoices();
    workspace.updateViewInProject(created.projectId, created.id, (current) => ({ ...current, defaultMode: settings.mode,
      modelSelections: { [created.primaryAgentId]: settings.modelSelection } }), settings.machineId === localMachineId ? undefined : settings.machineId);
    updatePreferences((current) => ({ ...current, provider: settings.provider, role: settings.role ?? current.role, mode: settings.mode, instructions: settings.instructions,
      machineId: settings.codeai ? current.machineId : settings.machineId,
      models: { ...current.models, [settings.provider]: settings.modelSelection } }));
  };
  const launchOrigin = JSON.stringify([pathname, machineId, projectId, sessionId]);
  const launcher = useSessionLauncher({
    authorized: deviceAccess.authenticated, localMachineId, machines: arena.machines, executions: localExecutionHealth,
    preferences, currentMachineId: machineId, currentProjectId: projectId,
    origin: launchOrigin,
    // Pin the origin before awaiting creation, and the current task before remembering defaults.
    onSubmit: preserveCurrentChoices,
    onQueuePending: () => notify({ key: 'queue-session', tone: 'info', persistent: true, message: 'Queueing session…' }),
    onQueueError: (error) => notify({ key: 'queue-session', tone: 'error', message: error,
      actions: [{ label: 'Review setup', onSelect: () => { dismissToast('queue-session'); launcher.open(); } }],
    }),
    onCreated: (created, settings) => {
      rememberLaunchChoices(created, settings);
      void arena.refresh();
    },
    onResult: (result, settings, autoOpen) => {
      dismissToast('queue-session');
      rememberLaunchChoices(result.session, settings);
      void arena.refresh();
      if (settings.machineId === machineId && result.session.projectId === projectId) {
        if (result.started) void recoverRuns.current(result.session.id, result.runId);
        else applyServerSnapshot(result.session, settings.machineId);
      }
      if (autoOpen) void openLaunchedSession(result.session, settings, launchNavigation.current);
      else announceLaunch(result, settings);
    },
    onOpen: (created, settings) => { void openLaunchedSession(created, settings); },
  });

  useEffect(() => {
    if (!launcher.busy && (launcher.isOpen || !launcher.error)) dismissToast('queue-session');
  }, [launcher.busy, launcher.isOpen, launcher.error, dismissToast]);

  useEffect(() => {
    if (!inlineSetupRequest) return;
    const owner = arena.machines.find(entry => entry.machine.id === inlineSetupRequest.machineId);
    const hasSibling = owner?.sessions.some(item => item.projectId === inlineSetupRequest.projectId && item.id !== inlineSetupRequest.sessionId);
    if (arenaOpen || inlineSetupRequest.machineId !== machineId || inlineSetupRequest.projectId !== projectId) {
      setInlineSetupRequest(undefined);
    } else if (hasSibling || sessionChoices.length) {
      setInlineSetupRequest(undefined);
    } else if (!loading && !sessionId && selectedProject && owner?.machine.state === 'online' && owner.snapshotFresh !== false
      && owner.archivedSessions.some(item => item.id === inlineSetupRequest.sessionId)) {
      panelLayout.showCanvas();
      launcher.openForProject(inlineSetupRequest.machineId, inlineSetupRequest.projectId, true);
      setInlineSetupRequest(undefined);
    }
  }, [arena.machines, arenaOpen, inlineSetupRequest, launcher.openForProject, loading, machineId, panelLayout.showCanvas, projectId, selectedProject, sessionId, sessionChoices.length]);

  const handleImmersiveActive = useCallback((active: boolean) => { if (!active) launcher.invalidateCapture(); setImmersiveActive(active); }, [launcher.invalidateCapture]);

  const archiveArenaSession = useCallback(async (
    targetMachineId: string, target: Pick<ArenaSessionSummary, 'id' | 'revision' | 'title' | 'projectId'>,
  ): Promise<boolean> => {
    try {
      const response = await fetch(machineApiPath(`/api/sessions/${encodeURIComponent(target.id)}/archive`, targetMachineId, localMachineId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: target.revision }),
      });
      const data = await response.json().catch(() => ({})) as { session?: ArenaSessionSummary; error?: string };
      if (!response.ok || !data.session) {
        await arena.refresh();
        throw new Error(data.error || 'Could not archive the session.');
      }
      const archiveKey = JSON.stringify([targetMachineId, target.id]);
      const latestRevision = Math.max(reconciledArchiveRevisions.current.get(archiveKey) ?? 0,
        sessionsRef.current.find(item => item.machineId === targetMachineId && item.id === target.id)?.revision ?? 0);
      // A Restore on another view may already have superseded a delayed archive response.
      if (data.session.revision < latestRevision) { await arena.refresh(); return true; }
      reconciledArchiveRevisions.current.set(archiveKey, data.session.revision);
      const targetWorkspaceMachineId = targetMachineId !== localMachineId ? targetMachineId : undefined;
      workspace.closeInProject(target.projectId, target.id, targetWorkspaceMachineId);
      if (targetMachineId === machineIdRef.current && target.id === focusedSessionIdRef.current && navigationKeyRef.current.startsWith('/?')) {
        // Visible tabs include unvisited sessions; choose a neighbour from that same list.
        const choices = sessionChoicesRef.current;
        const index = choices.findIndex(item => item.id === target.id);
        const remaining = choices.filter(item => item.id !== target.id);
        const nextFocus = remaining[Math.min(Math.max(index, 0), remaining.length - 1)]?.id;
        if (nextFocus) workspace.openInProject(target.projectId, nextFocus, undefined, targetWorkspaceMachineId);
        navigateWorkspace({ sessionId: nextFocus, projectId: target.projectId, machineId: targetMachineId }, true);
      }
      if (targetMachineId === machineIdRef.current && target.projectId === projectIdRef.current) {
        const next = sessionsRef.current.filter((item) => item.id !== target.id);
        if (!next.length && target.projectId && focusedSessionIdRef.current === target.id && navigationKeyRef.current.startsWith('/?')) {
          setInlineSetupRequest({ machineId: targetMachineId, projectId: target.projectId, sessionId: target.id });
        }
        sessionsRef.current = next;
        setSessions(next);
        setSessionList(current => ({ ...current, items: current.items.filter(item => item.id !== target.id) }));
        if (focusedSessionIdRef.current === target.id) setRepositoryTree(undefined);
      }
      removeRun(target.id);
      setRunOutcome(target.id);
      const archived = { ...data.session, machineId: targetMachineId };
      notify({
        key: `archive:${target.id}`,
        tone: 'success',
        message: `Archived “${target.title}”. You can restore it from the Arena archive.`,
        actions: [{ label: 'Undo archive', onSelect: () => void restoreSessionRef.current(targetMachineId, archived) }],
      });
      await arena.refresh();
      return true;
    } catch (error) {
      notifyError(error, 'Could not archive the session.');
      return false;
    }
  }, [arena.refresh, localMachineId, machineId, navigateWorkspace, projectId, removeRun, setRunOutcome, workspace.closeInProject, workspace.openInProject]);

  const restoreArenaSession = useCallback(async (targetMachineId: string, target: ArenaSessionSummary): Promise<boolean> => {
    try {
      const response = await fetch(machineApiPath(`/api/sessions/${encodeURIComponent(target.id)}/restore`, targetMachineId, localMachineId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: target.revision }),
      });
      const data = await response.json().catch(() => ({})) as { session?: ArenaSessionSummary; error?: string };
      if (!response.ok || !data.session) {
        await arena.refresh();
        throw new Error(data.error || 'Could not restore the session.');
      }
      reconciledArchiveRevisions.current.set(JSON.stringify([targetMachineId, data.session.id]), data.session.revision);
      if (targetMachineId === machineId && data.session.projectId === projectId) await refreshSession(data.session.id);
      notify({ key: `archive:${target.id}`, tone: 'success', message: `Restored “${data.session.title}”.` });
      await arena.refresh();
      return true;
    } catch (error) {
      notifyError(error, 'Could not restore the session.');
      return false;
    }
  }, [arena.refresh, localMachineId, machineId, projectId, refreshSession]);
  // Undo runs seconds after the archive, so it reaches the restore of that moment, not of the archive's.
  const restoreSessionRef = useRef(restoreArenaSession);
  restoreSessionRef.current = restoreArenaSession;

  const decideArenaPermission = async (targetMachineId: string, runId: string, requestId: string, decision: 'allow' | 'deny') => {
    const machine = arena.machines.find((item) => item.machine.id === targetMachineId);
    const run = machine?.runs.active.find((item) => item.runId === runId);
    const request = run?.pendingPermissions.find((item) => item.requestId === requestId);
    if (!run || !request) return;
    await permissionDecisions.decide({ ...request, machineId: targetMachineId, sessionId: run.sessionId, runId,
      machineLabel: machine!.machine.label, sessionTitle: machine!.sessions.find((item) => item.id === run.sessionId)?.title || 'Session', agentLabel: 'Agent',
    }, decision);
  };

  const runSessionLabel = (run: RunDescriptor) => sessions.find((item) => item.id === run.sessionId)?.title
    || `session ${run.sessionId.slice(0, 8)}`;
  /** Cancels the run that refused a send; the refused session's outcome goes once the request is made. */
  const cancelBlockingRun = useCallback(async (refusedSessionId: string, run: RunDescriptor, label: string) => {
    try {
      const response = await fetch(apiPath('/api/agent/cancel'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: run.runId }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || 'That agent run could not be cancelled.');
      setRunOutcomesBySession((current) => current[refusedSessionId]?.blockingRun?.runId === run.runId
        ? withSessionRunOutcome(current, refusedSessionId) : current);
      notify({ key: 'cancel', tone: 'success', message: `Cancellation requested for ${label}.` });
    } catch (error) {
      notifyError(error, 'That agent run could not be cancelled.', 'cancel');
    }
  }, [apiPath, notify, notifyError]);

  /** Cancelling is explicit now: a closed tab detaches, only this stops the run. */
  const cancelRun = useCallback(async (target?: { machineId?: string; sessionId: string; runId: string }) => {
    const targetSessionId = target?.sessionId || focusedSessionIdRef.current;
    if (!targetSessionId) return;
    const ownedRunId = runsBySessionRef.current[targetSessionId]?.runId || reconnectingRuns.current.get(targetSessionId)?.runId;
    const runId = target?.runId || ownedRunId;
    if (target && ownedRunId !== runId) return;
    if (!runId) {
      runControllers.current.get(targetSessionId)?.abort();
      return;
    }
    const targetMachineId = target?.machineId || machineId;
    const key = JSON.stringify([targetMachineId, targetSessionId, runId]);
    if (cancellingRuns.current.has(key)) return;
    cancellingRuns.current.add(key);
    try {
      const response = await fetch(machineApiPath('/api/agent/cancel', targetMachineId, localMachineId), {
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
    } finally {
      cancellingRuns.current.delete(key);
      await arena.refresh();
    }
  }, [arena.refresh, localMachineId, machineId, setRunOutcome]);

  // Recover every active turn in this project's workspace. Each attachment owns its controller and
  // presentation, so one stale or failed stream cannot disturb another session's live work.
  useEffect(() => {
    if (loading || !workspace.ready) return;
    const discoveryController = new AbortController();
    const attachmentControllers = new Map<string, AbortController>();
    const completedRunIds = new Set<string>();
    const recover = async (targetSessionId?: string, targetRunId?: string, snapshotLoaded = false) => {
      try {
        // A targeted launch/open also reloads terminal messages when the retained run has expired.
        if (targetSessionId && !snapshotLoaded) await refreshSession(targetSessionId);
        if (discoveryController.signal.aborted) return;
        const query = targetSessionId ? `?sessionId=${encodeURIComponent(targetSessionId)}` : '';
        const response = await fetch(apiPath(`/api/agent/runs${query}`), {
          cache: 'no-store',
          signal: discoveryController.signal,
        });
        const data = await response.json().catch(() => ({})) as RunDiscovery & { error?: string };
        if (!response.ok) throw new Error(data.error || 'Could not discover running turns.');
        if (discoveryController.signal.aborted) return;
        for (const [id, reconnecting] of reconnectingRuns.current) {
          if (reconnecting.machineId === machineId && (!targetSessionId || id === targetSessionId)
            && !data.active.some((run) => run.sessionId === id)) finishReconnect(id);
        }
        // Acceptance can arrive after a fast failure/completion. Replay that exact run, or the
        // latest retained turn when deliberately opening a session with no active work.
        const openedSessionId = targetSessionId ?? focusedSessionIdRef.current;
        const retained = targetRunId ? data.recent.filter((run) => run.runId === targetRunId)
          : openedSessionId && !data.active.some((run) => run.sessionId === openedSessionId)
            ? data.recent.filter((run) => run.sessionId === openedSessionId).slice(-1) : [];

        const relevant: Array<{ run: RunDescriptor; session: SessionSnapshot }> = [];
        for (const run of [...data.active.filter(run => run.sessionId === openedSessionId
          || sessionsRef.current.some(item => item.id === run.sessionId)), ...retained]) {
          // A local send already owns this session's response stream. Never replace its subscriber.
          if (runsBySessionRef.current[run.sessionId] || sendingSessions.current.has(run.sessionId)
            || attachmentControllers.has(run.runId) || completedRunIds.has(run.runId)
            || run.state === 'finished' && run.outcome === 'suspended') continue;
          // Reserve before any await so overlapping launch/open discovery cannot attach twice.
          const controller = new AbortController();
          attachmentControllers.set(run.runId, controller);
          let owningSession = sessionsRef.current.find((item) => item.id === run.sessionId);
          if (!owningSession) {
            try {
              const sessionResponse = await fetch(apiPath(`/api/sessions/${encodeURIComponent(run.sessionId)}?view=recent`), {
                cache: 'no-store', signal: discoveryController.signal,
              });
              const sessionData = await sessionResponse.json().catch(() => ({})) as Partial<SessionRead> & { error?: string };
              if (discoveryController.signal.aborted) return;
              if (!sessionResponse.ok || !sessionData.session || sessionData.session.projectId !== projectId) {
                attachmentControllers.delete(run.runId); continue;
              }
              owningSession = applyServerSnapshot(sessionData.session, machineId, sessionData.history);
            } catch (error) {
              attachmentControllers.delete(run.runId);
              if (!discoveryController.signal.aborted) notifyError(error, 'Could not recover that session.');
              continue;
            }
          }
          if (owningSession.projectId !== projectId) { attachmentControllers.delete(run.runId); continue; }
          relevant.push({ run, session: owningSession });
        }

        const activeCount = relevant.filter(({ run }) => run.state !== 'finished').length;
        if (activeCount) notify({ tone: 'info', message: `Reconnected to ${activeCount} active turn${activeCount === 1 ? '' : 's'}.` });
        await Promise.allSettled(relevant.map(async ({ run, session: owningSession }) => {
          workspace.ensure(run.sessionId);
          const recoveredSession = await refreshSession(run.sessionId) || owningSession;
          const controller = attachmentControllers.get(run.runId)!;
          const latestUser = recoveredSession.messages.findLast((message) => message.role === 'user');
          const superseded = run.state === 'finished' && latestUser
            && Date.parse(latestUser.createdAt) > (run.finishedAt ?? run.enqueuedAt);
          if (discoveryController.signal.aborted || runsBySessionRef.current[run.sessionId]
            || sendingSessions.current.has(run.sessionId) || superseded) {
            attachmentControllers.delete(run.runId); return;
          }
          setRunOutcome(run.sessionId);
          const participant = findAgentParticipant(recoveredSession.participants, run.participantId);
          const acceptedMessage = latestRunUserMessage(recoveredSession.messages, run.participantId);
          const recoveredMode = run.mode || acceptedMessage?.mode || participant?.defaultMode || 'agent';
          putRun({
            runId: run.runId,
            userMessageId: acceptedMessage?.id,
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
          runControllers.current.set(run.sessionId, controller);
          try {
            const stream = await fetch(apiPath(`/api/agent/stream?runId=${encodeURIComponent(run.runId)}`), {
              cache: 'no-store',
              signal: controller.signal,
            });
            if (stream.status === 404) return;
            if (!stream.ok) throw new Error('Could not attach to the running turn.');
            if (stream.headers.get('X-CodeAI-Run-Finished') !== 'true') {
              mutateSession(run.sessionId, (current) => ({ ...current, addressedAgentId: run.participantId }));
            }
            const result = await consumeStream(stream, {
              sessionId: run.sessionId,
              runId: run.runId,
              mode: recoveredMode,
              recovering: true,
              userMessageId: acceptedMessage?.id,
            });
            if (!result.receivedFinal && !result.suspended && !result.streamError && stream.headers.get('X-CodeAI-Run-Finished') !== 'true') {
              throw new Error('The run stream ended before its result.');
            }
            if (!result.suspended) completedRunIds.add(run.runId);
          } catch {
            if (!controller.signal.aborted) {
              reconnectingRuns.current.set(run.sessionId, { runId: run.runId, machineId });
              setReconnectingSends((current) => current.includes(run.sessionId) ? current : [...current, run.sessionId]);
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
            if (!discoveryController.signal.aborted) await refreshSession(run.sessionId);
            removeRun(run.sessionId, run.runId);
            attachmentControllers.delete(run.runId);
          }
        }));
      } catch (error) {
        if (!discoveryController.signal.aborted) {
          notifyError(error, 'Could not recover running turns.');
        }
      }
    };
    recoverRuns.current = recover;
    void recover();
    return () => {
      if (recoverRuns.current === recover) recoverRuns.current = async () => undefined;
      discoveryController.abort();
      for (const controller of attachmentControllers.values()) controller.abort();
    };
  }, [apiPath, applyServerSnapshot, consumeStream, finishReconnect, loading, machineId, mutateSession, projectId, putRun, refreshSession, removeRun, setRunOutcome, updateRun, workspace.ensure, workspace.ready, workspace.updateView]);

  const executePlan = useCallback((participantId: string) => {
    const planAgent = findAgentParticipant(session?.participants || [], participantId);
    const planHealth = planAgent && executionProviders?.[planAgent.provider];
    if (!planAgent || !planHealth?.supportedModes.includes('agent')) {
      notify({ key: 'send', tone: 'warning', message: planHealth?.message || 'That agent cannot execute in Agent mode.' });
      return;
    }
    // Always Agent, never Auto.
    void send({ text: EXECUTE_PLAN_INSTRUCTION, mode: 'agent', participantId });
  }, [health, send, session?.participants]);

  const immersiveChoices: ImmersiveSessionChoice[] = arena.machines.flatMap((entry) => entry.sessions.map((item) => ({
    machineId: entry.machine.id,
    projectId: item.projectId,
    sessionId: item.id,
    title: item.title,
    updatedAt: item.updatedAt,
    detail: `${entry.projects.find((project) => project.id === item.projectId)?.name || 'No project'} · ${entry.machine.label} · ${entry.machine.state === 'online' ? 'Online' : 'Offline'}`,
  })));
  const openImmersiveSession = (choice: ImmersiveSessionChoice) => {
    const targetMachine = arena.machines.find((entry) => entry.machine.id === choice.machineId);
    const target = targetMachine?.sessions.find((item) => item.id === choice.sessionId && item.projectId === choice.projectId);
    if (!targetMachine || targetMachine.machine.state !== 'online') {
      notify({ key: 'open-session', tone: 'warning', message: `${targetMachine?.machine.label || 'Machine'} is Offline. Choose another session or reconnect the machine.` });
      return;
    }
    if (!target) {
      notify({ key: 'open-session', tone: 'warning', message: 'That session is unavailable. Choose another session.' });
      return;
    }
    supersede('open-session');
    openArenaSession(targetMachine, target);
  };
  const clearImmersiveAttentionRoute = () => {
    setImmersiveReturnChoice(undefined);
    setImmersivePermissionRequest(undefined);
  };
  const inspectImmersiveAttention = (item: ArenaAttentionItem) => {
    if (item.kind !== 'permission' || !item.machineId || !item.runId || !item.requestId) return;
    const targetMachine = arena.machines.find((entry) => entry.machine.id === item.machineId);
    const targetSession = targetMachine?.sessions.find((entry) => entry.id === item.sessionId && entry.projectId === item.projectId);
    const run = targetMachine?.runs.active.find((entry) => entry.runId === item.runId && entry.sessionId === item.sessionId);
    const request = run?.pendingPermissions.find((entry) => entry.requestId === item.requestId);
    if (!targetMachine || targetMachine.machine.state !== 'online' || !targetSession || !run || !request) {
      notify({ tone: 'warning', message: 'That permission request is no longer available. Refresh the Arena.' });
      void arena.refresh();
      return;
    }
    const current = immersiveChoices.find((choice) => choice.machineId === (machineId || localMachineId)
      && choice.sessionId === sessionId && choice.projectId === projectId);
    if (current && (current.machineId !== item.machineId || current.sessionId !== item.sessionId || current.projectId !== item.projectId)) {
      setImmersiveReturnChoice(current);
    }
    const target: PermissionTarget = {
      ...request, machineId: item.machineId, sessionId: item.sessionId, runId: item.runId,
      sessionTitle: targetSession.title, machineLabel: targetMachine.machine.label, agentLabel: 'Agent',
    };
    setImmersivePermissionRequest({ machineId: item.machineId, sessionId: item.sessionId, key: permissionKey(target) });
    openImmersiveSession({
      machineId: item.machineId, projectId: targetSession.projectId, sessionId: targetSession.id,
      title: targetSession.title, updatedAt: targetSession.updatedAt,
      detail: `${targetMachine.machine.label} · Needs you`,
    });
  };
  const returnFromImmersiveAttention = () => {
    const target = immersiveReturnChoice;
    clearImmersiveAttentionRoute();
    if (target) openImmersiveSession(target);
  };
  const immersiveMachine = arena.machines.find((entry) => entry.machine.id === machineId);
  // A turn another device started reaches this one only through the Arena poll. The server refuses
  // an archive during any live turn; this keeps the control from offering one.
  const closeSessionDisabledReasons = Object.fromEntries(sessionChoices.flatMap(item => {
    const live = Boolean(runsBySession[item.id]) || preparingSends.includes(item.id) || reconnectingSends.includes(item.id)
      || immersiveMachine?.runs.active.some(run => run.sessionId === item.id);
    const reason = live ? 'Wait for this turn to finish.'
      : archivingSessionIds.includes(item.id) ? 'Archiving this session…' : undefined;
    return reason ? [[item.id, reason]] : [];
  }));
  const archiveSessionDisabledReasons = Object.fromEntries(sessionChoices.flatMap(item => {
    const reason = closeSessionDisabledReasons[item.id]
      || (immersiveMachine?.machine.state !== 'online' ? 'This execution machine is offline.' : undefined);
    return reason ? [[item.id, reason]] : [];
  }));
  const archiveSessionDisabledReason = sessionId ? archiveSessionDisabledReasons[sessionId] : undefined;
  const canArchiveSession = Boolean(session) && !archiveSessionDisabledReason;
  const archiveOpenSession = async (targetSessionId = sessionId) => {
    const target = sessionChoices.find(item => item.id === targetSessionId);
    const targetMachineId = machineId || localMachineId;
    if (!target || !targetMachineId || archiveSessionDisabledReasons[target.id]) return false;
    // Nothing refetches an open session that another device changed; the Arena poll carries its newer revision.
    const revision = Math.max(target.revision, immersiveMachine?.sessions.find((item) => item.id === target.id)?.revision ?? 0);
    setArchivingSessionIds(current => [...current, target.id]);
    try {
      return await archiveArenaSession(targetMachineId, { ...target, revision });
    } finally {
      setArchivingSessionIds(current => current.filter(id => id !== target.id));
    }
  };
  // Only the session workspace has a canvas to hide; the Arena and the welcome screen keep the frame.
  const canvasHidden = !loading && !arenaOpen && Boolean(session || projectWorkspace) && panelLayout.canvasHidden;
  const reportsOffered = Boolean(reports.available && reports.projectId);
  // The side panel shows Changes where a remembered Reports view is unavailable; the bar marks what it shows.
  const sideView: SideTab = panelLayout.sideTab === 'reports' && !reportsOffered ? 'changes' : panelLayout.sideTab;
  /** From the flat shell: opening a canvas, or starting one, brings a hidden canvas back. */
  const selectShownDiagram = (id: string) => { selectDiagram(id); panelLayout.showCanvas(); };
  const createShownSketch = () => { createSketch(); panelLayout.showCanvas(); };
  // Oldest first, so on screen the raised toasts sit above the focused session's outcome, and that
  // above the explanation for hidden sessions.
  const blockingRun = focusedRunOutcome?.blockingRun;
  const compact = panelLayout.dockCapacity === 0;
  const maximized = !arenaOpen && (session || projectWorkspace) ? panelLayout.maximized : null;
  const paneControl = (pane: Pane, label: string) => maximized === pane || panelLayout.canMaximize ? <PaneMaximizeButton
    label={label} maximized={maximized === pane}
    approvals={pane === 'conversation' ? 0 : permissions.length}
    unread={pane === 'conversation' ? 0 : unread}
    onToggle={() => panelLayout.toggleMaximized(pane)}
    onOpenConversation={panelLayout.openConversation}
  /> : null;
  const shownToasts: Toast[] = [
    ...(newerFormatNotice ? [standingToast('newer-format', {
      tone: 'info', message: newerFormatNotice, onDismiss: () => setNewerFormatNoticeDismissed(true),
    })] : []),
    ...(focusedRunOutcome && sessionId ? [standingToast(`run-outcome:${sessionId}`, {
      tone: runOutcomeTone(focusedRunOutcome),
      message: focusedRunOutcome.message,
      onDismiss: () => setRunOutcome(sessionId),
      actions: [
        ...(reconnectingSends.includes(sessionId) ? [{ label: 'Reconnect',
          onSelect: () => void recoverRuns.current(sessionId, reconnectingRuns.current.get(sessionId)?.runId),
        }] : []),
        ...(blockingRun ? [{
          label: `Cancel ${runSessionLabel(blockingRun)}`,
          onSelect: () => void cancelBlockingRun(sessionId, blockingRun, runSessionLabel(blockingRun)),
        }] : []),
        ...(focusedRunOutcome.missingProviderSession ? [{
          label: 'Continue in new session',
          disabled: sessionRunning || creatingSession,
          onSelect: () => continueSession(session?.execution || 'local'),
        }] : []),
        ...(focusedRunOutcome.continueMode && !sessionRunning ? [{
          label: 'Continue',
          onSelect: () => void send({ text: 'Continue where you stopped.', mode: focusedRunOutcome.continueMode! }),
        }] : []),
      ],
    })] : []),
    ...toasts,
  ];
  // In the session workspace the stack keeps clear of a docked conversation, and of the spatial controls.
  const toastPlacement = loading || arenaOpen || !session ? undefined
    : view?.surface === 'spatial' && session.activeDiagramId ? 'in-workspace beside-spatial' : 'in-workspace';
  const immersiveStatus = loading ? 'Loading session…'
    : immersiveMachine && immersiveMachine.machine.state !== 'online' ? `${immersiveMachine.machine.label} is Offline`
      : latestToast?.message || (session ? immersiveRunStatus : arena.refreshError || 'Choose a session to open');

  // Keep an already loaded, explicitly selected conversation mounted during its query update.
  // Remounting its composer would autofocus it after a tab's Delete/archive restored header focus.
  const selectedDestinationLoaded = location.kind === 'session' && session?.id === location.sessionId
    && machineId === (location.machineId || localMachineId);
  const openingSummary = location.kind === 'session' ? arena.machines
    .find(item => item.machine.id === (location.machineId || localMachineId))?.sessions.find(item => item.id === location.sessionId) : undefined;
  const openingWorkspace = loading || (!arenaOpen && resolvedNavigation !== navigationKey && !selectedDestinationLoaded);
  const navigationError = !arenaOpen && (navigationFailure?.key === navigationKey ? navigationFailure.message
    : !openingWorkspace && location.kind === 'session' && !sessions.some(item => item.id === location.sessionId)
      ? 'This conversation is unavailable. It may have been archived or deleted.' : undefined);
  useEffect(() => {
    if (arenaOpen || openingWorkspace || resolvedNavigation !== navigationKey || navigationError || !panelLayout.conversationShown || !session || !machineId
      || (location.kind === 'session' && !selectedDestinationLoaded)) return;
    const acknowledge = () => {
      if (document.visibilityState === 'hidden') return;
      const ids = viewedArenaCompletionIds(arenaInbox, machineId, session);
      if (ids.length) arena.acknowledge(ids);
    };
    acknowledge();
    document.addEventListener('visibilitychange', acknowledge);
    return () => document.removeEventListener('visibilitychange', acknowledge);
  }, [arenaOpen, openingWorkspace, resolvedNavigation, navigationKey, navigationError, panelLayout.conversationShown, session, machineId, location.kind, selectedDestinationLoaded, arenaInbox, arena.acknowledge]);

  const managementMachine = arena.machines.find(machine => machine.machine.id === projectManagementTarget?.machineId);
  const managedSessions = [...(managementMachine?.sessions ?? []), ...sessions.filter(item => item.machineId === projectManagementTarget?.machineId)]
    .filter(item => item.projectId === projectManagementTarget?.project.id);
  const projectDeletionBusy = projectManagementTarget?.action === 'delete' && managedSessions.some(item =>
    sendingSessions.current.has(item.id) || acceptanceChecks.current.has(item.id) || reconnectingRuns.current.has(item.id)
    || Boolean(runsBySession[item.id]) || managementMachine?.runs.active.some(run => run.sessionId === item.id));
  const canJumpToArena = Boolean(session) && !openingWorkspace && !navigationError && !arenaOpen && !immersiveActive;
  const arenaShortcutHint = canJumpToArena ? ARENA_SHORTCUT_HINT : undefined;

  return (
    <RepositoryFilesProvider value={repositoryFiles}>
    {!loading && !arenaOpen && !immersiveActive && (session || projectWorkspace) && <WorkspaceShortcuts
      key={`${repositoryApiBase}:${session?.id || projectScope}`} shellRef={shellRef} layout={panelLayout}
      arenaLink={canJumpToArena ? arenaLink : undefined} />}
    <div
      ref={shellRef}
      className={`app-shell dock-capacity-${panelLayout.dockCapacity} ${projectWorkspace && !arenaOpen ? 'project-workspace' : ''} ${maximized ? `pane-maximized maximized-${maximized}` : ''} ${arenaOpen ? 'arena-mode' : ''} ${canvasHidden ? 'canvas-hidden' : ''}`}
      style={panelLayout.shellStyle}
    >
      <header className="app-header">
        <Link ref={arenaLink} className="brand" href={ARENA_SECTION_PATHS.sessions} scroll={false} {...arenaShortcutHint}
          aria-label="CodeAI Arena" aria-current={arenaSection === 'sessions' ? 'page' : undefined}>
          <span className="brand-mark" aria-hidden="true" /><strong>CodeAI</strong>
        </Link>
        <nav className="header-breadcrumbs" aria-label="Current project and session">
          {!loading && <>
            {arenaOpen ? <h1 className="arena-breadcrumb">Arena</h1> : (
              <>
                <ProjectPicker
                  projects={projects}
                  value={projectId}
                  apiBase={machineApiBase(machineId, localMachineId)}
                  onChange={switchProject}
                  onCreate={(name) => { void createProject(machineId, name, []).then(project => switchProject(project.id)).catch(error => notifyError(error, 'Could not create the project.')); }}
                  onManage={(project, action) => { if (machineId) setProjectManagementTarget({ machineId, project, action }); }}
                  onLogo={project => { if (machineId) setProjectLogoTarget({ machineId, project }); }}
                />
                <WorkspaceTabs
                  sessions={sessionChoices}
                  focusedSessionId={sessionId}
                  runsBySession={runTabsBySession}
                  unreadBySession={unreadBySession}
                  onFocus={focusSession}
                  sessionHref={(id) => workspaceHref({ sessionId: id, machineId }, localMachineId)}
                  onClose={closeSessionView}
                  onArchive={archiveOpenSession}
                  closeDisabledReasons={closeSessionDisabledReasons}
                  archiveDisabledReasons={archiveSessionDisabledReasons}
                />
                <SessionPicker
                  archiveControl={<SessionArchivePicker key={projectScope}
                    sessions={immersiveMachine?.archivedSessions.filter(item => item.projectId === projectId) ?? []}
                    online={immersiveMachine?.machine.state === 'online'} refreshError={arena.refreshError} onRefresh={arena.refresh}
                    onRestore={async target => {
                      if (!machineId) return false;
                      const restored = await restoreArenaSession(machineId, target);
                      // A late Restore must not take the user away from a newer destination.
                      if (!restored || navigationKeyRef.current !== navigationKey) return false;
                      focusSession(target.id);
                      return true;
                    }} />}
                  onOpenMachineSettings={workspaceMachineId ? undefined : openMachineSettings}
                  worktrees={health?.worktrees}
                  value={sessionId}
                  initialExecution={session?.execution}
                  executionHealth={health?.executions}
                  providerHealth={health?.providers}
                  project={selectedProject}
                  checkouts={orderedCheckouts}
                  hostId={hostId}
                  creating={creatingSession}
                  error={sessionCreateError}
                  newProvider={newProvider}
                  preferredRole={preferences.role}
                  onNewRole={chooseNewRole}
                  preferredInstructions={preferences.instructions}
                  onQueueSetup={machineId && selectedProject ? () => launcher.openForProject(machineId, selectedProject.id) : undefined}
                  onNewProvider={chooseNewProvider}
                  onNew={createSession}
                />
              </>
            )}
          </>}
        </nav>
        {/* VR entry, then readiness and paired devices, then the layout icons at the end. */}
        <div className="header-actions">
          {!openingWorkspace && arenaOpen && health && <div className="arena-navbar-actions">
            <Button type="button" variant="text" color="inherit" startIcon={<ShellIcon name="refresh" />}
              aria-label={refreshingArena ? 'Refreshing…' : 'Refresh'} title={compact ? 'Refresh' : undefined}
              disabled={refreshingArena} onClick={() => { void refreshArena(); }}>
              <span className="arena-action-label">{refreshingArena ? 'Refreshing…' : 'Refresh'}</span>
            </Button>
            <Button type="button" variant="outlined" startIcon={<ShellIcon name="folder" />}
              aria-label="New project" title={compact ? 'New project' : undefined}
              disabled={!arena.machines.some(machine => machine.machine.state === 'online')}
              onClick={() => setCreatingArenaProject(true)}><span className="arena-action-label">New project</span></Button>
            <Button type="button" variant="contained" startIcon={<ShellIcon name="newChat" />}
              aria-label="New session" title={compact ? 'New session' : undefined}
              disabled={!arena.machines.some(machine => machine.machine.state === 'online')}
              onClick={launcher.open}><span className="arena-action-label">New session</span></Button>
          </div>}
          <ImmersiveBoundary
            canvasReview={!loading && session ? {
              attachmentIds: pendingAttachmentIds,
              canCreateSketch: !sessionRunning,
              onMarksChange: handleMarksChange,
              onCreateSketch: createSketch,
              onToggleAttachment: toggleAttachment,
            } : undefined}
            launcher={launcher}
            sessionControls={{
              repositoryContext,
              machines: arena.machines, machineId, sessionId: session?.id, sessionTitle: session?.title, projectId: session?.projectId,
              creating: creatingSession,
              creationError: sessionCreateError,
              status: immersiveStatus, permissions: focusedPermissionTargets, results: permissionDecisions.results,
              online: immersiveMachine?.machine.state === 'online', checkouts: orderedCheckouts,
              needsRepository: Boolean(session && !session.repositories.some((item) => item.role === 'primary')),
              canAttach: Boolean(session && !session.worktree && !sessionRunning && session.execution !== 'docker' && immersiveMachine?.machine.state === 'online'),
              canCancel: Boolean(focusedRunId),
              cancelKey: JSON.stringify([machineId, sessionId, focusedRunId]),
              canArchive: canArchiveSession,
              canRetry: Boolean(session?.messages.some((item) => item.role === 'user') && !sessionRunning),
              recovery,
              requestedPermissionKey: immersivePermissionRequest
                && immersivePermissionRequest.machineId === (machineId || localMachineId)
                && immersivePermissionRequest.sessionId === sessionId ? immersivePermissionRequest.key : undefined,
              reports: reports.available && reports.projectId ? {
                projectId: reports.projectId, reports: reports.reports, loading: reports.loading, error: reports.error,
                pendingIds: pendingReportIds,
                canAttach: Boolean(session) && pendingReportIds.length < MAX_REPORTS_PER_MESSAGE,
                onRefresh: () => { void reports.refresh(); },
                onAttach: (id) => setPendingReportIds((current) => withPendingReport(current, id)),
                onRemove: removeReport,
              } : undefined,
              codeai: lifecycle.available ? {
                status: lifecycle.status || '', confirmation: lifecycleConfirmation(),
                confirming: lifecycle.confirming, canRequest: lifecycle.canRequest,
                onAsk: lifecycle.ask, onConfirm: lifecycle.confirm, onDismiss: lifecycle.dismiss,
              } : undefined,
              preferredProvider: preferences.provider,
              preferredMode: preferences.mode,
              onNewSetup: launcher.open, codeAiSetupStatus: launcher.availabilityError || (launcher.availability?.available ? launcher.availability.phase : launcher.availability?.message),
              onRefreshCodeAiSetup: () => { void launcher.refreshAvailability(); }, onCodeAiSetup: launcher.availability?.available ? () => { void launcher.openCodeAi(); } : undefined,
              onCreate: createChosenSession,
              onAttach: (checkoutId) => updateRepositories((current) => [
                ...current.filter((item) => item.checkoutId !== checkoutId).map((item) => ({ ...item, role: 'reference' as const })),
                { id: crypto.randomUUID(), checkoutId, hostId: hostId!, role: 'primary' },
              ]),
              onDecide: (target, decision) => { void permissionDecisions.decide(target, decision); },
              onRefresh: () => {
                if (session) void recoverRuns.current(session.id, focusedRunId);
                void permissionDecisions.refreshFailures(); void refreshDeviceAccess(); void lifecycle.refresh();
              },
              onCancel: () => { if (session && focusedRunId) void cancelRun({ machineId, sessionId: session.id, runId: focusedRunId }); },
              onArchive: archiveOpenSession,
              onRetry: () => {
                const message = session?.messages.findLast((item) => item.role === 'user');
                if (message?.role === 'user') {
                  retryMessage(message.addressedParticipantId, message.text, message.mode,
                    message.reportAttachments?.map((report) => report.reportId) || [], message.imageAttachments?.length, message.fileAttachments?.map(({ name, text }) => ({ name, text })), message.status === 'sending' || message.delivery === 'possibly-sent', message.activeFile);
                }
              },
              onReturn: immersiveReturnChoice ? returnFromImmersiveAttention : undefined,
              onRevoke: () => {
                if (!deviceAccess.device) { notify({ tone: 'warning', message: 'This browser is not a paired device.' }); return; }
                void fetch('/api/auth/devices', { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ deviceId: deviceAccess.device.id }),
                }).then(async (response) => {
                  if (!response.ok) notify({ tone: 'error', message: 'Could not forget this device. Try again.' });
                  await refreshDeviceAccess();
                }).catch(() => notify({ tone: 'error', message: 'Could not forget this device. Try again.' }));
              },
            }}
            arenaControls={{
              machines: arena.machines,
              deviceState: arena.deviceState,
              active: sessionId && (machineId || localMachineId) ? {
                machineId: machineId || localMachineId!, projectId, sessionId,
              } : undefined,
              onOpen: (choice) => { clearImmersiveAttentionRoute(); openImmersiveSession(choice); },
              onInspect: inspectImmersiveAttention,
              onArchive: archiveArenaSession,
              onRestore: restoreArenaSession,
              onAcknowledge: arena.acknowledge,
              onRefresh: arena.refresh,
            }}
            conversation={!loading && session ? {
              draft: composer,
              target: `${session.title} · ${activeAgent?.displayName || 'No agent'} · ${PROVIDER_LABELS[activeProvider]} · ${mode}`,
              attachments: [...attachedCanvases.map((canvas) => {
                const id = canvasTargetId(canvas);
                return `${canvas.kind === 'diagram' ? `Diagram ${canvas.artifact.ordinal}` : 'Sketch'} · ${session.annotations[id]?.marks.length || 0} marks`;
              }), ...pendingReportChips.map((report) => report.label), ...pendingImages.map((_, index) => `Image ${index + 1}`), ...pendingFiles.map((file) => file.name)],
              canSend: !composerBlocked && !sessionRunning && !participantBusy && !lifecycle.busy && Boolean(activeAgent && providerHealth?.available)
                && !unsupportedModes.includes(mode) && session.repositories.some((repository) => repository.role === 'primary')
                && (Boolean(composer.trim()) || attachedCanvases.some((canvas) => canvas.kind === 'sketch') || pendingReportIds.length > 0
                  || pendingImages.length > 0 || pendingFiles.length > 0),
              sendBlocked: composerBlocked || (session.repositories.some((repository) => repository.role === 'primary')
                ? undefined : 'To send, attach a repository in Session tools.'),
              running: sessionRunning, runStatus: immersiveRunStatus, runId: focusedRunId, busy: participantBusy,
              cancelKey: JSON.stringify([machineId, sessionId, focusedRunId]),
              agents, activeAgentId: activeAgent?.id, primaryAgentId: session.primaryAgentId,
              providers: selectableProviders, mode, unsupportedModes, securityLevel, execution: session.execution, isolated: session.instructions === 'isolated',
              onDraft: setComposer, onSend: () => { void send(); },
              onCancel: () => { if (focusedRunId) void cancelRun({ machineId, sessionId: session.id, runId: focusedRunId }); },
              onMode: setMode, onSelectAgent: selectAgent,
              onAddAgent: (provider, role) => { void addAgent(provider, role); },
              onMakePrimary: (id) => { void setPrimaryAgent(id); },
            } : undefined}
            authorized={deviceAccess.authenticated && deviceAccess.transportSecure}
            reportContext={{ machineId: machineId || localMachineId, projectId, sessionId }}
            onReportCaptured={placeCapturedReport}
            session={loading ? undefined : session}
            viewKey={immersiveViewKey(machineId || localMachineId, projectId, sessionId)}
            evidence={{ ...repositoryDiff, machineLabel: immersiveMachine?.machine.label || health?.hostLabel || 'This machine',
              checkoutId: selectedCheckout?.id, checkoutName: selectedCheckout?.name, checkouts: sessionCheckouts,
              tree: repositoryChanges.tree, selectedPath: repositoryChanges.selectedPath,
              status: loading ? 'Loading session…' : !selectedCheckout ? 'No repository attached' : repositoryChanges.error
                || (repositoryChanges.loading ? 'Reading changes…' : repositoryChanges.tree?.isRepository === false ? 'Not a Git repository' : 'Choose a changed file'),
              onSelectPath: repositoryChanges.selectPath, onSelectCheckout: selectCheckout, onRefresh: repositoryChanges.refresh }}
            theme={theme} preview={preview} runStatus={immersiveRunStatus}
            pendingApprovals={permissions.length} unread={unread}
            choices={immersiveChoices} workspaceStatus={immersiveStatus}
            onOpenSession={openImmersiveSession} onSelectCanvas={selectDiagram}
            onActiveChange={handleImmersiveActive}
            onUnavailable={setVrUnavailable}
          />
          {!loading && <>
            {/* Readiness is news only when something is wrong or the provider has something to say. */}
            {(!providerHealth?.available || providerHealth.message) && (
              <Chip className="health-pill" variant="outlined" color="warning" title={providerHealth?.message || health?.message || 'Local readiness'} label={providerHealth?.available ? `${PROVIDER_LABELS[activeProvider]} ready` : 'Setup needed'} />
            )}
            {!compact && <DeviceMenu />}
            {!compact && !arenaOpen && session && (
              <LayoutToggles
                filesShown={panelLayout.filesShown} onToggleFiles={panelLayout.toggleFiles}
                canvasShown={!panelLayout.canvasHidden}
                canvasToggleable={panelLayout.dockCapacity > 0}
                conversationShown={panelLayout.conversationShown}
                approvals={permissions.length}
                unread={unread}
                onToggleCanvas={panelLayout.toggleCanvas}
                onToggleConversation={panelLayout.toggleConversation}
              />
            )}
          </>}
        </div>
      </header>

      {!launcher.inline && <SessionSetupDialog launcher={launcher} immersive={immersiveActive} />}
      {arenaOpen && creatingArenaProject && <NewProjectDialog machines={arena.machines}
        onCreate={async (machineId, name, checkoutIds) => {
          await createProject(machineId, name, checkoutIds);
          if (arenaSection !== 'sessions') router.push('/arena', { scroll: false });
        }} onClose={() => setCreatingArenaProject(false)} />}
      {!loading && !immersiveActive && <CodeAiLifecycleDialog lifecycle={lifecycle} />}
      <ObserverDialog open={observerOpen && !immersiveActive} compact={compact} location={`${pathname}?${searchParams}`}
        machines={arena.machines} localMachineId={localMachineId} options={replyOptionsFor}
        provider={observerProvider} providers={observerProviders}
        selection={offeredModelSelection(preferences.models?.[observerProvider], observerProviders?.[observerProvider])}
        onProvider={provider => updatePreferences(current => ({ ...current, provider }))}
        blockedReason={lifecycle.busy ? 'CodeAI is restarting. The message is kept.' : undefined}
        canBuildRestart={lifecycle.canRequest}
        onBuildRestart={() => {
          if (!lifecycle.canRequest) throw new Error(lifecycle.status || 'Build & restart requires CodeAI to be running with npm run start:managed on the home machine.');
          setObserverOpen(false); lifecycle.ask();
        }}
        onClose={() => setObserverOpen(false)} />
      {!loading && <MachineSettingsDialog
        open={machineSettingsOpen}
        securityLevel={arena.machines.find((entry) => entry.machine.kind === 'local')?.securityLevel || 'guarded'}
        executionHealth={localExecutionHealth}
        onClose={() => setMachineSettingsOpen(false)}
        onRefresh={refreshArena}
        onSetDockerEnabled={setDockerEnabled}
        onAvailableUpdates={setProviderUpdateCount}
      />}
      {!loading && (
        <ActivityBar
          compact={compact}
          workspace={compact && !arenaOpen && session ? <LayoutToggles compact
            filesShown={panelLayout.filesShown} onToggleFiles={panelLayout.toggleFiles}
            canvasShown={!panelLayout.canvasHidden} canvasToggleable
            conversationShown={panelLayout.conversationShown}
            approvals={permissions.length} unread={unread}
            onToggleCanvas={panelLayout.showCanvas} onToggleConversation={panelLayout.openConversation}
          /> : undefined}
          views={!arenaOpen && session ? ['files', 'changes', 'history', ...(!compact && reportsOffered ? ['reports' as const] : [])] : !arenaOpen && projectWorkspace ? ['files', 'changes'] : []}
          shownView={panelLayout.sideShown ? sideView : undefined}
          changeCount={repositoryTree?.files.length}
          arenaSection={arenaSection}
          arenaShortcutHint={arenaShortcutHint}
          unread={arenaUnread.length}
          updateCount={availableProviderUpdateCount}
          moreRef={moreMenuRef}
          onMoreToggle={(open) => { if (open) { void lifecycle.refresh(); void launcher.refreshAvailability(); } }}
          onToggleView={(view) => panelLayout.toggleSide(view, sideView)}
          more={<>
            <Button onClick={() => { moreMenuRef.current?.close(); setObserverOpen(true); }}>Observer</Button>
            {compact && <>
              {!arenaOpen && session && <>
                <Button component={Link} href={ARENA_SECTION_PATHS.sessions} {...arenaShortcutHint} onClick={() => moreMenuRef.current?.close()}>Arena</Button>
                <Button component={Link} href="/arena/inbox" onClick={() => moreMenuRef.current?.close()}>Inbox{arenaUnread.length ? ` · ${arenaUnread.length} unread` : ''}</Button>
                {reportsOffered && <Button onClick={() => { moreMenuRef.current?.close(); panelLayout.selectSideTab('reports'); }}>Reports</Button>}
              </>}
              <DeviceMenu />
              {providerHealth && (!providerHealth.available || providerHealth.message) && <p>{providerHealth.message || 'Provider setup needed'}</p>}
            </>}
            <Button type="button" variant="text" color="inherit" onClick={openMachineSettings} aria-description={availableProviderUpdateCount > 0 ? 'Docker agent updates available' : undefined}>
              Machine settings
              {availableProviderUpdateCount > 0 && <span className="settings-update-dot" aria-hidden="true" />}
            </Button>
            {launcher.availabilityError && <Button type="button" variant="text" color="inherit" onClick={() => void launcher.refreshAvailability()}>{launcher.availabilityError}</Button>}
            {launcher.availability && (launcher.availability.available || launcher.availability.reason === 'checkout-unavailable') && <Button type="button" variant="text" color="inherit" disabled={!launcher.availability.available || launcher.availability.phase !== 'idle'} title={!launcher.availability.available ? launcher.availability.message : launcher.availability.phase !== 'idle' ? `CodeAI is ${launcher.availability.phase}. Retry after it is ready.` : undefined} onClick={() => {
              const source = moreMenuRef.current?.trigger;
              moreMenuRef.current?.close(); void launcher.openCodeAi(source);
            }}>New CodeAI session</Button>}
            {launcher.availability && !launcher.availability.available && launcher.availability.message && <p>{launcher.availability.message}</p>}
            <ToggleButtonGroup exclusive fullWidth color="primary" value={themePreference} aria-label="Theme"
              onChange={(_, choice: ThemePreference | null) => { if (choice) setThemePreference(choice); }}>
              {THEME_PREFERENCES.map((choice) => (
                <ToggleButton key={choice} value={choice}>
                  {choice[0].toUpperCase() + choice.slice(1)}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            {themePreference !== 'dark' && <FormControl fullWidth variant="standard">
              <InputLabel htmlFor="light-theme">Light palette</InputLabel>
              <NativeSelect value={lightTheme} onChange={(event) => setLightTheme(event.target.value as LightThemeName)}
                inputProps={{ id: 'light-theme' }}>
                {Object.entries(LIGHT_THEMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </NativeSelect>
            </FormControl>}
            {!arenaOpen && session && <Button type="button" variant="text" color="inherit" onClick={() => void exportCompleteSession()}>Export session</Button>}
            {!arenaOpen && session && (
              <Button
                type="button" variant="text" color="inherit" disabled={!canArchiveSession} title={archiveSessionDisabledReason} onClick={() => {
                  moreMenuRef.current?.close();
                  void archiveOpenSession();
                }}
              >Archive session</Button>
            )}
            {vrUnavailable && <><Divider /><p><strong>VR unavailable</strong>{vrUnavailable}</p></>}
            {lifecycle.available && <CodeAiLifecycleMenu lifecycle={lifecycle} onRequest={() => {
              moreMenuRef.current?.close();
              lifecycle.ask();
            }} />}
          </>}
        />
      )}

      {!loading && !arenaOpen && (session || projectWorkspace) && (
        <div className="repository-region" hidden={!panelLayout.sideShown}>
          <RepositoryPanel
            apiBase={repositoryApiBase}
            checkoutId={selectedCheckout?.id}
            repositoryName={selectedCheckout?.name || 'No repository'}
            changes={repositoryChanges}
            onPush={repositoryChanges.push && (() => void pushRepositoryBranch(repositoryChanges.push!))}
            manager={session ? (
              <RepositoryManager
                key={session.id}
                repositories={session.repositories}
                checkouts={orderedCheckouts}
                hostId={hostId}
                selectedCheckoutId={selectedCheckoutId}
                disabled={sessionRunning || session.execution === 'docker' || Boolean(session.worktree)}
                fixedWorktree={Boolean(session.worktree)}
                onSelect={selectCheckout}
                onChange={updateRepositories}
              />
            ) : selectedProject ? <RepositoryManager
              key={projectScope}
              scope="project"
              repositories={selectedProject.repositories}
              checkouts={orderedCheckouts}
              hostId={hostId}
              selectedCheckoutId={selectedCheckoutId}
              onSelect={selectCheckout}
              onChange={updateProjectRepositories}
            /> : undefined}
            history={session ? (
              <DiagramNavigator
                session={session}
                theme={theme}
                pendingAttachmentIds={pendingAttachmentIds}
                // Docked, the list stays for browsing unless a hidden canvas returns to its dock; as a
                // phone overlay it would hide what was chosen.
                onSelect={(id) => { selectShownDiagram(id); if (panelLayout.dockCapacity === 0) panelLayout.closeRepository(); }}
                onPin={togglePin}
                onToggleAttachment={toggleAttachment}
              />
            ) : null}
            reports={reports.available && reports.projectId ? (
              <ReportsPanel
                owner={{ ...reports, projectId: reports.projectId }}
                machines={arena.machines}
                pendingIds={pendingReportIds}
                canAttach={pendingReportIds.length < MAX_REPORTS_PER_MESSAGE}
                onToggleAttachment={toggleReport}
              />
            ) : undefined}
            open={panelLayout.repositoryOpen || maximized === 'side'}
            visible={panelLayout.sideShown && !immersiveActive}
            paneControl={paneControl('side', sideView === 'changes' ? 'Repository' : sideView[0].toUpperCase() + sideView.slice(1))}
            tab={panelLayout.sideTab}
          />
          {panelLayout.sideShown && !maximized && !compact && (
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

      {!loading && !arenaOpen && (session || projectWorkspace) && <div className="file-view-region" hidden={!panelLayout.filesShown}>
        <RepositoryFilePane visible={panelLayout.filesShown} paneControl={paneControl('files', 'File view')} onHide={panelLayout.closeFiles} revision={repositoryChanges.revision} />
        {panelLayout.filesShown && !maximized && !compact && (!panelLayout.canvasHidden || panelLayout.conversationShown) && <div
          className="panel-resize-handle repository-resize-handle" role="separator" tabIndex={0}
          aria-label="Resize file view" aria-orientation="vertical" aria-valuemin={320}
          aria-valuemax={panelLayout.filesMaximum} aria-valuenow={Math.round(panelLayout.filesPanelWidth)}
          onPointerDown={event => panelLayout.beginResize('files', event)} onKeyDown={event => panelLayout.resizeByKeyboard('files', event)} />}
      </div>}

      <ToastStack toasts={shownToasts} className={toastPlacement} onRemove={dismissToast} />
      {projectManagementTarget && <ProjectManagementDialog key={`${projectManagementTarget.machineId}:${projectManagementTarget.project.id}:${projectManagementTarget.action}`}
        project={projectManagementTarget.project} action={projectManagementTarget.action}
        online={arena.machines.some(machine => machine.machine.id === projectManagementTarget.machineId && machine.machine.state === 'online')}
        blockedReason={projectDeletionBusy ? 'Wait for active conversations to finish before deleting this project.' : undefined}
        onSubmit={name => manageProject(projectManagementTarget.machineId, projectManagementTarget.project, projectManagementTarget.action, name)}
        onClose={() => setProjectManagementTarget(undefined)} />}
      {projectLogoTarget && <ProjectLogoDialog key={`${projectLogoTarget.machineId}:${projectLogoTarget.project.id}`}
        project={projectLogoTarget.project} machineId={projectLogoTarget.machineId}
        checkouts={arena.machines.find(machine => machine.machine.id === projectLogoTarget.machineId)?.checkouts ?? []}
        apiBase={machineApiBase(projectLogoTarget.machineId, localMachineId)}
        online={arena.machines.some(machine => machine.machine.id === projectLogoTarget.machineId && machine.machine.state === 'online')}
        onSave={logo => saveProjectLogo(projectLogoTarget.machineId, projectLogoTarget.project, logo)}
        onClose={() => setProjectLogoTarget(undefined)} />}

      {openingWorkspace ? (
        <div className="app-loading" role="status"><div className="brand-mark" aria-hidden="true" />
          {openingSummary && <strong>{openingSummary.title}</strong>}
          <p>{openingSummary ? 'Loading recent messages…' : 'Opening your code canvas…'}</p>
        </div>
      ) : arenaOpen && health ? (
        <Arena
          machines={arena.machines}
          activeOrder={arena.activeOrder}
          onMoveProject={arena.moveProject}
          deviceState={arena.deviceState}
          section={arenaSection}
          refreshError={arena.refreshError}
          refreshing={refreshingArena}
          onRefresh={refreshArena}
          onOpenSession={openArenaSession}
          onNewProjectSession={launcher.openForProject}
          onProjectLogo={(machineId, project) => setProjectLogoTarget({ machineId, project })}
          onManageProject={(machineId, project, action) => setProjectManagementTarget({ machineId, project, action })}
          onArchiveSession={archiveArenaSession}
          onRestoreSession={restoreArenaSession}
          onDecidePermission={decideArenaPermission}
          onAcknowledge={arena.acknowledge}
          replies={arenaReplies}
          replyOptions={arenaReplyOptions}
        />
      ) : navigationError ? (
        <div className="welcome-screen" role="region" aria-label="Workspace unavailable">
          <div className="welcome-intro">
            <h1>Workspace unavailable</h1>
            <p role="alert">{navigationError}</p>
            <Button onClick={() => { setResolvedNavigation(''); setNavigationRetry(value => value + 1); }}>Retry</Button>
            <Button component={Link} href="/arena">Arena</Button>
            <Button component={Link} href="/arena/archived">Archive</Button>
          </div>
        </div>
      ) : !session && launcher.isOpen && launcher.inline && launcher.inlineOrigin === launchOrigin ? (
        <div className="welcome-screen" hidden={projectWorkspace && (canvasHidden || Boolean(maximized))}>
          <SessionSetupDialog launcher={launcher} immersive={immersiveActive} inline />
        </div>
      ) : !session ? (
        <div className="welcome-screen" hidden={projectWorkspace && (canvasHidden || Boolean(maximized))}>
          <div className="welcome-intro">
            <div className="brand-mark" aria-hidden="true" />
            <span className="eyebrow">Your local workspace</span>
            <h1>{sessionChoices.length ? 'No open sessions' : 'Good ideas start here.'}</h1>
            <p>{sessionChoices.length
              ? 'Choose a session tab, or start something new.'
              : `Explore, plan, and build${selectedProject ? ` in ${selectedProject.name}` : ' with your agents'}. Choose your setup to get started.`}</p>
            {selectedProject && <Button variant="contained" onClick={() => launcher.openForProject(machineId!, selectedProject.id)}>New session</Button>}
          </div>
          {!sessionChoices.length && !selectedProject && <SessionCreationForm
            onOpenMachineSettings={workspaceMachineId ? undefined : openMachineSettings}
            worktrees={health?.worktrees}
            key={projectId || 'loose'}
            submitLabel="Create and open"
            executionHealth={health?.executions}
            providerHealth={health?.providers}
            project={selectedProject}
            checkouts={orderedCheckouts}
            hostId={hostId}
            newProvider={newProvider}
            preferredRole={preferences.role}
            onNewRole={chooseNewRole}
            preferredInstructions={preferences.instructions}
            creating={creatingSession}
            error={sessionCreateError}
            onNewProvider={chooseNewProvider}
            onNew={createSession}
          />}
        </div>
      ) : (
        <>
          <CanvasWorkspace
            hidden={canvasHidden}
            session={session}
            image={activeImage}
            imageNumber={activeImageIndex + 1}
            onCloseImage={closeImage}
            onImageMarksChange={handleImageMarksChange}
            theme={theme}
            pendingApprovals={sessionRunning ? permissions.length : 0}
            running={sessionRunning}
            runFailed={sessionRunning && runFailed}
            immersiveActive={immersiveActive}
            toolActivity={sessionRunning ? toolActivity : []}
            paneControl={paneControl('canvas', 'Canvas')}
            canvasView={session.activeDiagramId ? view?.canvasViews[session.activeDiagramId] : undefined}
            surface={view?.surface || 'flat'}
            spatial={view?.spatial}
            onComposer={setComposer}
            onOpenChat={() => { panelLayout.openConversation(); setUnread(0); }}
            onSelectDiagram={selectDiagram}
            onNewSketch={createSketch}
            onMarksChange={handleMarksChange}
            onCanvasViewChange={handleCanvasViewChange}
            onSurfaceChange={handleSurfaceChange}
            onSpatialChange={handleSpatialChange}
            onResetSpatial={handleResetSpatial}
            onSnapshot={handleSnapshot}
            onArtifactError={handleArtifactError}
          />
          <div className="conversation-region" hidden={!panelLayout.conversationShown}>
            <ConversationDrawer
              agentChoice={preferences}
              onAgentChoiceChange={(change) => updatePreferences((current) => ({ ...current, ...change }))}
              repositoryContext={repositoryContext}
              focusRequest={launchFocus?.sessionId === session?.id ? launchFocus.request : undefined}
              onFocusRequestHandled={() => setLaunchFocus(undefined)}
              open={panelLayout.conversationOpen || maximized === 'conversation'}
              visible={panelLayout.conversationShown}
              paneControl={paneControl('conversation', 'Conversation')}
              session={session}
              onLoadEarlier={loadEarlierMessages}
              onLoadMessage={loadMessageDetails}
              theme={theme}
              agents={agents}
              activeAgent={activeAgent}
              turn={focusedRun?.turn}
              liveMessageId={focusedRun?.userMessageId}
              liveState={focusedRun?.state}
              onEditQueuedMessage={async (messageId, text, expectedText) => {
                if (!focusedRunId || !sessionId) throw new Error('Reload the session to check its queued turn.');
                const response = await fetch(apiPath('/api/agent/queued-message'), {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ runId: focusedRunId, text, expectedText }),
                });
                const data = await response.json() as { error?: string };
                if (!response.ok) throw new Error(data.error || 'Could not save. Your edit is kept.');
                mutateSession(sessionId, current => ({ ...current, messages: current.messages.map(message =>
                  message.id === messageId && message.role === 'user' ? { ...message, text } : message) }));
                await refreshSession(sessionId);
              }}
              retryBlocked={Boolean(sessionId && (sessionRunning || unconfirmedSends.includes(sessionId)
                || arena.discovery.active.some(run => run.sessionId === sessionId && run.machineId === machineId)))}
              healthyProviders={selectableProviders}
              participantBusy={participantBusy}
              preview={sessionRunning ? preview : ''}
              toolActivity={sessionRunning ? toolActivity : []}
              permissions={sessionRunning ? permissions : []}
              decidingPermission={decidingPermission}
              permissionFeedback={permissionFeedback}
              onRefreshPermissions={() => void permissionDecisions.refreshFailures()}
              running={sessionRunning}
              cancelReady={Boolean(focusedRunId)}
              continuing={creatingSession}
              continuationUnavailable={continuationUnavailable}
              instructions={instructionsChoice}
              onContinue={() => continueSession(continuationExecution)}
              onNewChat={newChat}
              onArchive={() => archiveOpenSession()}
              onArchiveAllowedChange={async (allowed) => {
                const response = await fetch(apiPath(`/api/sessions/${session.id}`), {
                  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ allowAgentArchive: allowed, expectedAllowAgentArchive: Boolean(session.allowAgentArchive) }),
                });
                const data = await response.json() as { session?: PublicSession; error?: string };
                if (!response.ok || !data.session) {
                  await refreshSession(session.id);
                  throw new Error(data.error || 'Could not save archive permission. Try again.');
                }
                applyServerSnapshot(data.session, machineId);
              }}
              archiveDisabledReason={archiveSessionDisabledReason}
              sendBlocked={composerBlocked}
              securityLevel={securityLevel}
              recovery={recovery}
              status={sessionRunning ? status : ''}
              composer={composerDraft}
              mode={mode}
              unsupportedModes={unsupportedModes}
              modelChoices={providerHealth}
              modelSelection={modelSelection}
              onModelSelectionChange={setModelSelection}
              attached={attachedCanvases}
              reports={pendingReportChips}
              images={pendingImages} files={pendingFiles}
              onRemoveFile={(index) => { if (sessionId) updatePendingFiles(sessionId, (current) => current.filter((_, i) => i !== index)); }}
              markCounts={Object.fromEntries(attachedCanvases.map((canvas) => [canvasTargetId(canvas), session.annotations[canvasTargetId(canvas)]?.marks.length || 0]))}
              onSelectDiagram={selectShownDiagram}
              onRetry={(text, participantId, retryMode, reportIds, imageCount, files, uncertain, activeFile) => retryMessage(participantId, text, retryMode, reportIds, imageCount, files, uncertain, activeFile)}
              onComposer={setComposer}
              onModeChange={setMode}
              onSelectAgent={selectAgent}
              onMakePrimary={(participantId) => void setPrimaryAgent(participantId)}
              onAddAgent={(provider, role) => void addAgent(provider, role)}
              onHandoff={prefillHandoff}
              onSend={() => void send()}
              onCancel={() => void cancelRun()}
              onRemoveAttachment={removeAttachment}
              onRemoveReport={removeReport}
              onAddImages={(files) => void addImages(files)}
              onRemoveImage={removeImage}
              onOpenImage={openImage}
              onDecidePermission={(requestId, decision) => void decidePermission(requestId, decision)}
              onExecutePlan={executePlan}
              onToggleAttachment={toggleAttachment}
              onOpenHistory={() => openSideFromComposer('history')}
              onNewSketch={createShownSketch}
              onOpenReports={reports.available && reports.projectId ? () => openSideFromComposer('reports') : undefined}
            />
            {panelLayout.conversationShown && !canvasHidden && !maximized && !compact && (
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
      {children}
    </div>
    </RepositoryFilesProvider>
  );
}
