'use client';

import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IMMERSIVE_ACTION_LABELS,
  type ImmersiveAction,
} from '@/features/diagram/spatial/immersiveResources';
import { recordImmersiveFrame, SpatialResourceLedger } from '@/features/diagram/spatial/resourceLedger';
import type { ImmersiveSemanticAction, ImmersiveWorkspaceProps } from '@/features/diagram/spatial/immersiveTypes';
import { createPanelResources, type PanelResource } from '@/features/diagram/spatial/panelResources';
import { canvasTargetId } from '@/features/conversation/sessionStore';
import { createEvidenceResource, createPanelControlResources, createWorkspaceTextResource } from './workspaceResources';
import { createWorkspaceIconResource, type WorkspaceIcon } from './workspaceIcons';
import { ImmersiveEnvironment } from './ImmersiveEnvironment';
import { PANEL_IDS, PANEL_TITLES, parsePanelAction } from './workspaceLayout';
import { evidencePages, workspaceTextLines } from './workspaceText';
import { useTextureResource } from './useTextureResource';
import { WorkspacePanel, WorldButton } from './WorkspacePanel';
import { ConversationTools } from './ConversationTools';
import { ConversationList, type ConversationListController } from './ConversationList';
import type { ConversationActionName } from './conversationControls';
import { ConversationHistory, type ConversationHistoryController, type ConversationHistoryScrollState } from './ConversationHistory';

const WORKSPACE_ICONS: Record<ImmersiveAction, WorkspaceIcon> = {
  exit: 'exit', 'reset-workspace': 'reset', 'reset-view': 'reset',
  'previous-file': 'chevron-left', 'next-file': 'chevron-right',
  'previous-evidence': 'chevron-left', 'next-evidence': 'chevron-right', 'refresh-evidence': 'refresh',
  'load-more-sessions': 'plus',
  'previous-canvas': 'chevron-left', 'next-canvas': 'chevron-right',
  larger: 'zoom-in', smaller: 'zoom-out', older: 'chevron-left', newer: 'chevron-right',
};

function CanvasSurface({ activeTarget, session, theme, scale }: Pick<ImmersiveWorkspaceProps, 'activeTarget' | 'session' | 'theme'> & { scale: number }) {
  const [resource, setResource] = useState<PanelResource>();
  const [failure, setFailure] = useState<string>();
  useEffect(() => {
    setResource(undefined);
    setFailure(undefined);
    if (!activeTarget || !session) return;
    const ledger = new SpatialResourceLedger('immersive');
    const id = canvasTargetId(activeTarget);
    void createPanelResources([activeTarget], session.annotations, id, theme, ledger, 1_100_000).then((resources) => {
      if (!ledger.isDisposed()) setResource(resources[id]);
    }).catch((error: unknown) => {
      if (!ledger.isDisposed()) setFailure(error instanceof Error ? error.message : 'Canvas unavailable');
    });
    return () => ledger.dispose();
  }, [JSON.stringify(activeTarget), JSON.stringify(activeTarget && session?.annotations[canvasTargetId(activeTarget)]), theme]);
  const label = useTextureResource((ledger) => createWorkspaceTextResource(
    !activeTarget ? 'Empty canvas' : !resource ? failure ? 'Canvas unavailable' : 'Loading canvas…'
      : resource.status === 'ready' ? activeTarget.kind === 'diagram' ? `Diagram ${activeTarget.artifact.ordinal}` : 'Sketch' : 'Canvas unavailable',
    resource?.detail || failure || (!activeTarget ? 'Create a diagram in the conversation.' : 'Active canvas'), theme, ledger,
  ), [activeTarget, resource?.detail, resource?.status, failure, theme]);
  const height = resource ? Math.min(0.9, 1.28 / resource.aspectRatio) * scale / 1.3 : 1;
  return <>
    {resource && <group scale={[height * resource.aspectRatio / resource.size[0], height / resource.size[1], 1]} position-y={0.04}>
      <mesh name="Active canvas" geometry={resource.geometry} material={resource.material}
        userData={{ canvasTarget: resource.id, canvasStatus: resource.status }} />
    </group>}
    {label && <mesh geometry={label.geometry} material={label.material} scale={0.8} position={[0, -0.48, 0.01]} />}
  </>;
}

function EvidenceSurface({ evidence, pages, page, theme }: {
  evidence: ImmersiveWorkspaceProps['evidence']; pages: string[][]; page: number; theme: ImmersiveWorkspaceProps['theme'];
}) {
  const resource = useTextureResource((ledger) => createEvidenceResource(
    evidence.selectedPath || 'Repository changes',
    evidence.loading ? ['Reading patch…'] : evidence.error ? workspaceTextLines(evidence.error).slice(0, 16)
      : evidence.diff ? pages[page] : workspaceTextLines(evidence.tree?.files.length === 0 ? 'Working tree clean' : evidence.status).slice(0, 16),
    evidence.diff ? `Page ${page + 1} of ${pages.length} · read only` : `${evidence.tree?.files.length || 0} changed files`, theme, ledger,
  ), [evidence.diff, evidence.loading, evidence.error, evidence.selectedPath, evidence.status, evidence.tree?.files.length, pages, page, theme]);
  const fallback = useTextureResource((ledger) => resource ? undefined : createWorkspaceTextResource('Evidence unavailable', 'Reopen this panel to retry.', theme, ledger), [Boolean(resource), theme]);
  return resource ? <mesh geometry={resource.geometry} material={resource.material} position-y={0.02} />
    : fallback ? <mesh geometry={fallback.geometry} material={fallback.material} /> : null;
}

export function ImmersiveWorkspace(props: ImmersiveWorkspaceProps & { onActionController(perform?: (action: ImmersiveSemanticAction) => void): void }) {
  const {
    session, theme, activeTarget, preview, runStatus, pendingApprovals, unread, choices,
    workspaceStatus, onOpenSession, onConversationScroll,
    onPreviousCanvas, onNextCanvas, onExit, onActionController, layout, editing,
    onPanelAction, onPanelPlacement, onResetWorkspace, evidence, viewKey,
  } = props;
  const state = useThree();
  const { camera, gl } = state;
  useEffect(() => {
    window.__CODEAI_XR_TEST__?.onWorkspace?.(state);
    return () => window.__CODEAI_XR_TEST__?.onWorkspace?.();
  }, [state]);
  const [diagramScale, setDiagramScale] = useState(1);
  const [evidencePage, setEvidencePage] = useState(0);
  const [conversationTab, setConversationTab] = useState<'read' | 'compose' | 'agents'>('read');
  const conversationAction = useRef<((action: ConversationActionName) => void) | undefined>(undefined);
  const setConversationController = useCallback((perform?: (action: ConversationActionName) => void) => { conversationAction.current = perform; }, []);
  const [listOpen, setListOpen] = useState(!session);
  const listController = useRef<ConversationListController | undefined>(undefined);
  const setListController = useCallback((controller?: ConversationListController) => { listController.current = controller; }, []);
  const [atBottom, setAtBottom] = useState(true);
  const [voicePending, setVoicePending] = useState(false);
  const history = useRef<ConversationHistoryController | undefined>(undefined);
  const setHistoryController = useCallback((controller?: ConversationHistoryController) => { history.current = controller; }, []);
  const handleScrollState = useCallback((value: ConversationHistoryScrollState) => {
    setAtBottom(value.atBottom); onConversationScroll(value);
  }, [onConversationScroll]);
  const activeChoice = choices.find((choice) => choice.sessionId === session?.id && (!session.machineId || choice.machineId === session.machineId));
  useEffect(() => { setConversationTab('read'); setListOpen(!session); }, [viewKey, session?.id]);
  const pages = useMemo(() => evidencePages(evidence.diff), [evidence.diff]);
  const page = Math.min(evidencePage, pages.length - 1);
  useEffect(() => { setEvidencePage(0); }, [evidence.selectedPath, viewKey]);
  const contentOrigin = useRef<THREE.Group>(null);
  const needsRecenter = useRef(true);
  const controls = useTextureResource((ledger) => Object.fromEntries(Object.entries(WORKSPACE_ICONS).map(([action, icon]) =>
    [action, createWorkspaceIconResource(icon, theme, ledger)])), [theme]);
  const panelControls = useTextureResource((ledger) => createPanelControlResources(theme, ledger), [theme]);
  const headerControls = useTextureResource((ledger) => ({
    history: createWorkspaceIconResource('history', theme, ledger),
    agents: createWorkspaceIconResource('agents', theme, ledger),
  }), [theme]);
  const toolLabels = useTextureResource((ledger) => Object.fromEntries(PANEL_IDS.map((id) => [id,
    createWorkspaceIconResource(id === 'conversation' ? 'chat' : id, theme, ledger),
  ])), [theme, ...PANEL_IDS.map((id) => layout.panels[id].open)]);
  const status = useTextureResource((ledger) => createWorkspaceTextResource(session?.title || 'Session launcher',
    pendingApprovals ? `${pendingApprovals} approval waiting · ${workspaceStatus}` : workspaceStatus, theme, ledger), [session?.title, workspaceStatus, pendingApprovals, theme]);

  const recenter = useCallback(() => {
    const origin = contentOrigin.current;
    if (!origin) return;
    const viewingCamera = gl.xr.isPresenting ? gl.xr.getCamera() : camera;
    const position = viewingCamera.getWorldPosition(new THREE.Vector3());
    const direction = viewingCamera.getWorldDirection(new THREE.Vector3());
    direction.y = 0;
    if (direction.lengthSq() < 0.0001) direction.set(0, 0, -1);
    direction.normalize();
    origin.parent?.worldToLocal(position);
    origin.position.copy(position);
    origin.rotation.set(0, Math.atan2(-direction.x, -direction.z), 0);
  }, [camera, gl.xr]);
  useFrame((_state, delta) => {
    recordImmersiveFrame(delta * 1_000);
    if (needsRecenter.current) { recenter(); needsRecenter.current = false; }
  });
  const contentEnabled = (id: typeof PANEL_IDS[number]) => layout.panels[id].open && editing?.mode !== 'drag' && editing?.id !== id;
  const perform = useCallback((action: ImmersiveSemanticAction) => {
    const panelAction = parsePanelAction(action);
    if (panelAction) {
      if (panelAction.id === 'conversation' && (panelAction.command === 'close'
        || panelAction.command === 'toggle' && layout.panels.conversation.open)) setConversationTab('read');
      onPanelAction(panelAction.id, panelAction.command); return;
    }
    if (action.startsWith('conversation:')) {
      if (!contentEnabled('conversation')) return;
      if (voicePending && (action === 'conversation:list' || action === 'conversation:agents')) return;
      if (action === 'conversation:list') {
        setListOpen((value) => session ? !value : true); onPanelAction('conversation', 'focus');
      }
      else if (action === 'conversation:back' && session) setListOpen(false);
      else if (action === 'conversation:agents') {
        setListOpen(false);
        if (listOpen) setConversationTab('agents');
        else conversationAction.current?.(conversationTab === 'agents' ? 'read' : 'agents');
      }
      else if (!listOpen) conversationAction.current?.(action.slice('conversation:'.length) as ConversationActionName);
      return;
    }
    if (action === 'exit') onExit();
    else if (action === 'reset-workspace') { onResetWorkspace(); setDiagramScale(1); recenter(); }
    else if (action === 'reset-view') { setDiagramScale(1); recenter(); }
    else if (action === 'previous-canvas' && contentEnabled('canvas')) onPreviousCanvas();
    else if (action === 'next-canvas' && contentEnabled('canvas')) onNextCanvas();
    else if (action === 'load-more-sessions' && contentEnabled('conversation') && listOpen) listController.current?.loadMore();
    else if (action === 'older' && contentEnabled('conversation') && !listOpen) history.current?.scroll(-400);
    else if (action === 'newer' && contentEnabled('conversation') && !listOpen) history.current?.scroll(400);
    else if (action === 'larger' && contentEnabled('canvas')) setDiagramScale((value) => Math.min(1.3, value + 0.1));
    else if (action === 'smaller' && contentEnabled('canvas')) setDiagramScale((value) => Math.max(0.7, value - 0.1));
    else if (contentEnabled('evidence')) {
      if (action === 'refresh-evidence') evidence.onRefresh();
      else if (action === 'previous-evidence') setEvidencePage(Math.max(0, page - 1));
      else if (action === 'next-evidence') setEvidencePage(Math.min(pages.length - 1, page + 1));
      else if (action === 'previous-file' || action === 'next-file') {
        const files = evidence.tree?.files || [];
        const index = files.findIndex((file) => file.path === evidence.selectedPath);
        const next = files[(index + (action === 'next-file' ? 1 : -1) + files.length) % files.length];
        if (next) evidence.onSelectPath(next.path);
      }
    }
  }, [onPanelAction, onResetWorkspace, onExit, recenter, layout, editing, onPreviousCanvas, onNextCanvas,
    listOpen, conversationTab, voicePending, session, evidence, page, pages.length]);
  useEffect(() => { onActionController(perform); return () => onActionController(undefined); }, [onActionController, perform]);
  const button = (action: ImmersiveAction, position: [number, number, number], disabled = false) => <WorldButton
    action={action} label={IMMERSIVE_ACTION_LABELS[action]} resource={controls?.[action]} iconTheme={theme} position={position} disabled={disabled} onAction={() => perform(action)} />;
  return <>
    <ImmersiveEnvironment theme={theme} />
    <group ref={contentOrigin} name="Workspace origin">
      {PANEL_IDS.filter((id) => layout.panels[id].open).map((id) => <WorkspacePanel key={`${viewKey}:${id}`}
        id={id} layout={layout.panels[id]} focused={layout.focused === id} editing={editing}
        heading={id === 'conversation' ? listOpen ? 'Conversations' : session?.title || 'Conversation' : id === 'evidence' ? 'Repository changes' : undefined}
        headerBack={id === 'conversation' && listOpen}
        detail={id === 'conversation' ? listOpen ? 'Newest first' : activeChoice?.detail || props.conversation?.target : undefined}
        theme={theme} controls={panelControls} perform={perform} onPlacement={onPanelPlacement}>
        {id === 'canvas' && <>
          <CanvasSurface activeTarget={activeTarget} session={session} theme={theme} scale={diagramScale} />
          {button('previous-canvas', [-0.36, -0.78, 0.02])}{button('next-canvas', [-0.12, -0.78, 0.02])}
          {button('smaller', [0.12, -0.78, 0.02], diagramScale <= 0.7)}{button('larger', [0.36, -0.78, 0.02], diagramScale >= 1.3)}
        </>}
        {id === 'conversation' && <>
          <WorldButton action="conversation:list" label="Conversation history" resource={headerControls?.history} iconTheme={theme}
            position={[0.35, 0.82, 0.04]} selected={listOpen} disabled={voicePending || !contentEnabled('conversation')}
            onAction={() => perform('conversation:list')} />
          <WorldButton action="conversation:agents" label="Agents" resource={headerControls?.agents} iconTheme={theme}
            position={[0.56, 0.82, 0.04]} selected={!listOpen && conversationTab === 'agents'}
            disabled={voicePending || !session || !contentEnabled('conversation')} onAction={() => perform('conversation:agents')} />
          {listOpen && <group name="Conversation list">
            <ConversationList choices={choices} theme={theme} enabled={contentEnabled('conversation')}
              focused={layout.focused === 'conversation'} onController={setListController}
              onOpenSession={(choice) => { if (contentEnabled('conversation')) { setListOpen(false); onOpenSession(choice); } }} />
            <WorldButton action="conversation:back" label="Back to conversation" resource={controls?.older} iconTheme={theme}
              position={[-0.56, 0.82, 0.04]} disabled={!session || !contentEnabled('conversation')}
              onAction={() => setListOpen(false)} />
          </group>}
          <ConversationTools controls={props.conversation} theme={theme} tab={conversationTab} visible={!listOpen}
            enabled={contentEnabled('conversation')} atBottom={atBottom}
            onVoicePending={setVoicePending}
            renderHistory={(visible) => <ConversationHistory session={session} preview={preview} theme={theme} runStatus={runStatus}
              pendingApprovals={pendingApprovals} unread={unread} enabled={contentEnabled('conversation')}
              focused={layout.focused === 'conversation'} visible={visible}
              onController={setHistoryController} onScrollState={handleScrollState} />}
            onTab={(tab) => { setConversationTab(tab); onPanelAction('conversation', 'focus'); }}
            onLatest={() => history.current?.latest()} onController={setConversationController} />
        </>}
        {id === 'evidence' && <>
          <EvidenceSurface evidence={evidence} pages={pages} page={page} theme={theme} />
          {button('previous-file', [-0.48, -0.78, 0.02], !evidence.tree?.files.length)}{button('next-file', [-0.24, -0.78, 0.02], !evidence.tree?.files.length)}
          {button('refresh-evidence', [0, -0.78, 0.02])}
          {button('previous-evidence', [0.24, -0.78, 0.02], page === 0)}{button('next-evidence', [0.48, -0.78, 0.02], page >= pages.length - 1)}
        </>}
      </WorkspacePanel>)}
      <group name="Workspace controls" position={[0, -1.45, -1.3]}>
        {status && <mesh name="Workspace status" geometry={status.geometry} material={status.material} position={[0, 0.24, 0]} />}
        {PANEL_IDS.map((id, index) => <group key={id} position={[(index - 2) * 0.24, 0, 0]} >
          <WorldButton action={`panel:${id}:toggle`} label={`${layout.panels[id].open ? 'Hide' : 'Show'} ${PANEL_TITLES[id]}`} resource={toolLabels?.[id]}
            selected={layout.panels[id].open} iconTheme={theme} position={[0, 0, 0]} onAction={() => perform(`panel:${id}:toggle`)} />
        </group>)}
        {button('reset-workspace', [0.24, 0, 0.01])}{button('exit', [0.48, 0, 0.01])}
      </group>
    </group>
  </>;
}
