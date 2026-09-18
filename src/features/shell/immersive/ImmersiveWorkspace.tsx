'use client';

import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IMMERSIVE_ACTION_LABELS,
  type ImmersiveAction,
} from '@/features/diagram/spatial/immersiveResources';
import { recordImmersiveFrame } from '@/features/diagram/spatial/resourceLedger';
import type { ImmersiveSemanticAction, ImmersiveWorkspaceProps } from '@/features/diagram/spatial/immersiveTypes';
import { createEvidenceResource, createPanelControlResources, createWorkspaceButtonResource, createWorkspaceTextResource } from './workspaceResources';
import { createWorkspaceIconResource, isWorkspaceIconAction } from './workspaceIcons';
import { ImmersiveEnvironment } from './ImmersiveEnvironment';
import { PANEL_IDS, PANEL_TITLES, parsePanelAction } from './workspaceLayout';
import { evidencePages, repositoryStatusLines, workspaceTextLines } from './workspaceText';
import { useTextureResource } from './useTextureResource';
import { roundedGeometry, WorkspacePager, WorkspacePanel, WorldButton } from './WorkspacePanel';
import { SessionTools } from './SessionTools';
import type { SessionActionName } from './sessionControls';
import { ConversationTools } from './ConversationTools';
import { ConversationList, type ConversationListController } from './ConversationList';
import type { ConversationActionName } from './conversationControls';
import { ConversationHistory, type ConversationHistoryController, type ConversationHistoryScrollState } from './ConversationHistory';
import { CanvasReviewTools, type CanvasReviewController } from './CanvasReviewTools';
import type { CanvasReviewActionName } from './canvasReviewControls';
import { canvasTargetId, getArtifacts, getSketches } from '@/features/conversation/sessionStore';
import { immersiveTheme } from './immersiveTheme';

function middleTruncate(value: string, limit = 46): string {
  if (value.length <= limit) return value;
  const side = Math.floor((limit - 1) / 2);
  return `${value.slice(0, side)}…${value.slice(-side)}`;
}

function EvidenceSurface({ evidence, pages, page, theme }: {
  evidence: ImmersiveWorkspaceProps['evidence']; pages: string[][]; page: number; theme: ImmersiveWorkspaceProps['theme'];
}) {
  const resource = useTextureResource((ledger) => createEvidenceResource(
    evidence.loading ? ['Reading patch…'] : evidence.error ? workspaceTextLines(evidence.error).slice(0, 16)
      : evidence.diff ? pages[page] : repositoryStatusLines(evidence.tree, evidence.status),
    theme, ledger,
  ), [evidence.diff, evidence.loading, evidence.error, evidence.selectedPath, evidence.status, evidence.tree, evidence.checkoutName, evidence.machineLabel, pages, page, theme]);
  const fallback = useTextureResource((ledger) => resource ? undefined : createWorkspaceTextResource('Evidence unavailable', 'Reopen this panel to retry.', theme, ledger), [Boolean(resource), theme]);
  return resource ? <mesh name="Repository evidence" geometry={resource.geometry} material={resource.material} position-y={0.02}
    userData={{ checkoutId: evidence.checkoutId, checkoutName: evidence.checkoutName, machineLabel: evidence.machineLabel,
      checkouts: evidence.checkouts, path: evidence.selectedPath, branch: evidence.tree?.branch,
      loading: evidence.loading, error: evidence.error }} />
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
  const canvasReview = useRef<CanvasReviewController | undefined>(undefined);
  const setCanvasReviewController = useCallback((controller?: CanvasReviewController) => { canvasReview.current = controller; }, []);
  const [evidencePage, setEvidencePage] = useState(0);
  const [conversationTab, setConversationTab] = useState<'read' | 'compose' | 'agents'>('read');
  const conversationAction = useRef<((action: ConversationActionName) => void) | undefined>(undefined);
  const setConversationController = useCallback((perform?: (action: ConversationActionName) => void) => { conversationAction.current = perform; }, []);
  const [sessionToolsOpen, setSessionToolsOpen] = useState(false);
  const sessionAction = useRef<((action: SessionActionName) => void) | undefined>(undefined);
  const setSessionController = useCallback((perform?: (action: SessionActionName) => void) => { sessionAction.current = perform; }, []);
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
  useEffect(() => { setConversationTab('read'); setListOpen(!session); setSessionToolsOpen(false); }, [viewKey, session?.id]);
  const pages = useMemo(() => evidencePages(evidence.diff), [evidence.diff]);
  const page = Math.min(evidencePage, pages.length - 1);
  const files = evidence.tree?.files || [];
  const fileIndex = Math.max(0, files.findIndex((file) => file.path === evidence.selectedPath));
  const checkoutIndex = Math.max(0, evidence.checkouts.findIndex((checkout) => checkout.id === evidence.checkoutId));
  const canvasTargets = session ? [...getArtifacts(session).map((artifact) => artifact.id), ...getSketches(session).map((sketch) => sketch.id)] : [];
  const canvasIndex = Math.max(0, activeTarget ? canvasTargets.indexOf(canvasTargetId(activeTarget)) : 0);
  useEffect(() => { setEvidencePage(0); }, [evidence.selectedPath, viewKey]);
  const contentOrigin = useRef<THREE.Group>(null);
  const needsRecenter = useRef(true);
  const controls = useTextureResource((ledger) => Object.fromEntries(Object.entries(IMMERSIVE_ACTION_LABELS).map(([action, label]) =>
    [action, isWorkspaceIconAction(action) ? createWorkspaceIconResource(action, theme, ledger)
      : createWorkspaceButtonResource(label, theme, ledger)])), [theme]);
  const panelControls = useTextureResource((ledger) => createPanelControlResources(theme, ledger), [theme]);
  const headerControls = useTextureResource((ledger) => ({
    tools: createWorkspaceIconResource('session:tools', theme, ledger),
    history: createWorkspaceIconResource('conversation:list', theme, ledger),
    agents: createWorkspaceIconResource('conversation:agents', theme, ledger),
    back: createWorkspaceIconResource('conversation:back', theme, ledger),
  }), [theme]);
  const toolLabels = useTextureResource((ledger) => Object.fromEntries(PANEL_IDS.map((id) => [id,
    createWorkspaceButtonResource(PANEL_TITLES[id], theme, ledger),
  ])), [theme, ...PANEL_IDS.map((id) => layout.panels[id].open)]);
  const status = useTextureResource((ledger) => createWorkspaceTextResource(session?.title || 'Session launcher',
    pendingApprovals ? `${pendingApprovals} approval waiting · ${workspaceStatus}` : workspaceStatus, theme, ledger), [session?.title, workspaceStatus, pendingApprovals, theme]);
  const recoveryChrome = useTextureResource((ledger) => ({
    geometry: ledger.trackGeometry(roundedGeometry(1.62, 0.19, 0.095)),
    material: ledger.trackMaterial(new THREE.MeshBasicMaterial({
      color: immersiveTheme[theme].raised, depthWrite: false, toneMapped: false,
    })),
  }), [theme]);

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
    if (action.startsWith('session:')) {
      if (!contentEnabled('conversation') || voicePending) return;
      if (action === 'session:tools') {
        setSessionToolsOpen((value) => !value); setListOpen(false); onPanelAction('conversation', 'focus');
      } else if (sessionToolsOpen) sessionAction.current?.(action.slice('session:'.length) as SessionActionName);
      return;
    }
    if (action.startsWith('conversation:')) {
      if (sessionToolsOpen) {
        if (action === 'conversation:list' || action === 'conversation:back' || action === 'conversation:agents') setSessionToolsOpen(false);
        else return;
      }
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
    if (action.startsWith('canvas:')) {
      if (contentEnabled('canvas')) canvasReview.current?.perform(action.slice('canvas:'.length) as CanvasReviewActionName);
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
      else if (action === 'previous-checkout' || action === 'next-checkout') {
        const index = evidence.checkouts.findIndex((checkout) => checkout.id === evidence.checkoutId);
        const next = evidence.checkouts[(Math.max(0, index) + (action === 'next-checkout' ? 1 : -1) + evidence.checkouts.length) % evidence.checkouts.length];
        if (next) evidence.onSelectCheckout(next.id);
      }
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
    listOpen, sessionToolsOpen, conversationTab, voicePending, session, evidence, page, pages.length]);
  useEffect(() => { onActionController(perform); return () => onActionController(undefined); }, [onActionController, perform]);
  const button = (action: ImmersiveAction, position: [number, number, number], disabled = false,
    variant: 'secondary' | 'primary' | 'destructive' = 'secondary') => <WorldButton
    action={action} label={IMMERSIVE_ACTION_LABELS[action]} resource={controls?.[action]} iconTheme={theme}
    position={position} disabled={disabled} variant={variant} onAction={() => perform(action)} />;
  return <>
    <ImmersiveEnvironment theme={theme} />
    <group ref={contentOrigin} name="Workspace origin">
      {PANEL_IDS.filter((id) => layout.panels[id].open).map((id) => <WorkspacePanel key={`${viewKey}:${id}`}
        id={id} layout={layout.panels[id]} focused={layout.focused === id} editing={editing}
        heading={id === 'conversation' ? sessionToolsOpen ? 'Session tools' : listOpen ? 'Conversations' : session?.title || 'Conversation'
          : id === 'canvas' ? activeTarget ? activeTarget.kind === 'diagram' ? `Diagram ${activeTarget.artifact.ordinal}` : `Sketch ${activeTarget.sketch.ordinal}` : 'Canvas'
            : middleTruncate(evidence.selectedPath || evidence.checkoutName || 'Repository changes')}
        headerBack={id === 'conversation' && listOpen}
        detail={id === 'conversation' ? listOpen ? 'Newest first' : activeChoice?.detail || props.conversation?.target
          : id === 'canvas' ? activeTarget ? 'Hold trigger to draw' : 'Create or attach a canvas'
            : `${evidence.checkoutName || 'No repository'} · ${evidence.machineLabel}`}
        theme={theme} controls={panelControls} perform={perform} onPlacement={onPanelPlacement}>
        {id === 'canvas' && <>
          <CanvasReviewTools key={activeTarget ? `${activeTarget.kind}:${activeTarget.kind === 'diagram' ? activeTarget.artifact.id : activeTarget.sketch.id}` : 'empty'}
            activeTarget={activeTarget} session={session} theme={theme} scale={diagramScale}
            enabled={contentEnabled('canvas')} controls={props.canvasReview} onController={setCanvasReviewController} />
          <WorkspacePager label={`${canvasIndex + 1} of ${Math.max(1, canvasTargets.length)}`}
            previousAction="previous-canvas" nextAction="next-canvas" previousLabel="Previous canvas" nextLabel="Next canvas"
            position={[-0.25, -0.78, 0]} theme={theme} previousDisabled={canvasTargets.length < 2} nextDisabled={canvasTargets.length < 2} onAction={perform} />
          {button('smaller', [0.38, -0.78, 0], diagramScale <= 0.7)}{button('larger', [0.55, -0.78, 0], diagramScale >= 1.3)}
        </>}
        {id === 'conversation' && <>
          <WorldButton action="session:tools" label="Session tools" resource={headerControls?.tools} iconTheme={theme}
            position={[0.20, 0.81, 0]} selected={sessionToolsOpen} disabled={voicePending || !contentEnabled('conversation')}
            onAction={() => perform('session:tools')} />
          {sessionToolsOpen && props.sessionControls && <SessionTools controls={props.sessionControls} theme={theme}
            enabled={contentEnabled('conversation')} onController={setSessionController} />}
          <WorldButton action="conversation:list" label="Conversation history" resource={headerControls?.history} iconTheme={theme}
            position={[0.38, 0.81, 0]} selected={listOpen} disabled={voicePending || !contentEnabled('conversation')}
            onAction={() => perform('conversation:list')} />
          <WorldButton action="conversation:agents" label="Agents" resource={headerControls?.agents} iconTheme={theme}
            position={[0.56, 0.81, 0]} selected={!listOpen && conversationTab === 'agents'}
            disabled={voicePending || !session || !contentEnabled('conversation')} onAction={() => perform('conversation:agents')} />
          {listOpen && !sessionToolsOpen && <group name="Conversation list">
            <ConversationList choices={choices} theme={theme} enabled={contentEnabled('conversation')}
              focused={layout.focused === 'conversation'} onController={setListController}
              onOpenSession={(choice) => { if (contentEnabled('conversation')) { setListOpen(false); onOpenSession(choice); } }} />
            <WorldButton action="conversation:back" label="Back to conversation" resource={headerControls?.back} iconTheme={theme}
              position={[-0.56, 0.81, 0]} disabled={!session || !contentEnabled('conversation')}
              onAction={() => setListOpen(false)} />
          </group>}
          <ConversationTools controls={props.conversation} theme={theme} tab={conversationTab} visible={!listOpen && !sessionToolsOpen}
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
          {evidence.checkouts.length > 1 && <WorkspacePager label={`Repository ${checkoutIndex + 1} of ${evidence.checkouts.length}`}
            previousAction="previous-checkout" nextAction="next-checkout" previousLabel="Previous repository" nextLabel="Next repository"
            position={[-0.27, -0.58, 0]} theme={theme} onAction={perform} />}
          <WorkspacePager label={`File ${fileIndex + 1} of ${Math.max(1, files.length)}`}
            previousAction="previous-file" nextAction="next-file" previousLabel="Previous file" nextLabel="Next file"
            position={[-0.36, -0.78, 0]} theme={theme} previousDisabled={!files.length} nextDisabled={!files.length} onAction={perform} />
          <WorkspacePager label={`Page ${page + 1} of ${pages.length}`}
            previousAction="previous-evidence" nextAction="next-evidence" previousLabel="Previous page" nextLabel="Next page"
            position={[0.30, -0.78, 0]} theme={theme} previousDisabled={page === 0} nextDisabled={page >= pages.length - 1} onAction={perform} />
          {button('refresh-evidence', [0.56, 0.81, 0])}
        </>}
      </WorkspacePanel>)}
      <group name="Workspace controls" position={[0, -1.45, -1.3]}>
        {status && <mesh name="Workspace status" geometry={status.geometry} material={status.material} position={[0, 0.24, 0]} />}
        {recoveryChrome && <mesh name="Workspace control pill" geometry={recoveryChrome.geometry} material={recoveryChrome.material}
          position-z={-0.001} renderOrder={10} pointerEvents="none" raycast={() => undefined} />}
        {PANEL_IDS.map((id, index) => <group key={id} position={([[-0.62, 0, 0], [-0.28, 0, 0], [0.02, 0, 0]] as [number, number, number][])[index]} >
          <WorldButton action={`panel:${id}:toggle`} label={`${layout.panels[id].open ? 'Hide' : 'Show'} ${PANEL_TITLES[id]}`} resource={toolLabels?.[id]}
            selected={layout.panels[id].open} iconTheme={theme} position={[0, 0, 0]} onAction={() => perform(`panel:${id}:toggle`)} />
        </group>)}
        {button('reset-workspace', [0.34, 0, 0.01])}{button('exit', [0.64, 0, 0.01], false, 'destructive')}
      </group>
    </group>
  </>;
}
