'use client';

import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useXR } from '@react-three/xr';
import * as THREE from 'three';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createImmersiveControlResources, createImmersiveConversationResource, IMMERSIVE_ACTION_LABELS,
  type ImmersiveAction,
} from '@/features/diagram/spatial/immersiveResources';
import { projectImmersiveConversation } from '@/features/diagram/spatial/immersiveTranscript';
import { recordImmersiveFrame, SpatialResourceLedger } from '@/features/diagram/spatial/resourceLedger';
import type { ImmersiveSemanticAction, ImmersiveWorkspaceProps } from '@/features/diagram/spatial/immersiveTypes';
import { createPanelResources, type PanelResource } from '@/features/diagram/spatial/panelResources';
import { canvasTargetId } from '@/features/conversation/sessionStore';
import { createEvidenceResource, createPanelControlResources, createWorkspaceButtonResource, createWorkspaceTextResource } from './workspaceResources';
import { ImmersiveEnvironment } from './ImmersiveEnvironment';
import { PANEL_IDS, PANEL_TITLES, parsePanelAction } from './workspaceLayout';
import { evidencePages, workspaceTextLines } from './workspaceText';
import { useTextureResource } from './useTextureResource';
import { WorkspacePanel, WorldButton } from './WorkspacePanel';

function ThumbstickPaging({ enabled, onOlder, onNewer }: { enabled: boolean; onOlder(): void; onNewer(): void }) {
  const controllers = useXR((state) => state.inputSourceStates.filter((source) => source.type === 'controller'));
  const cooldown = useRef(0);
  useFrame((_state, delta) => {
    cooldown.current = Math.max(0, cooldown.current - delta);
    if (!enabled || cooldown.current > 0) return;
    for (const controller of controllers) {
      if (controller.type !== 'controller') continue;
      const axis = controller.gamepad['xr-standard-thumbstick']?.yAxis;
      if (axis === undefined || Math.abs(axis) < 0.72) continue;
      if (axis > 0) onOlder(); else onNewer();
      cooldown.current = 0.42;
      return;
    }
  });
  return null;
}

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

function ConversationSurface({ projectionPage, theme, newActivity }: {
  projectionPage: ReturnType<typeof projectImmersiveConversation>;
  theme: ImmersiveWorkspaceProps['theme']; newActivity: boolean;
}) {
  const resource = useTextureResource((ledger) => createImmersiveConversationResource(
    projectionPage.projection, theme, `Page ${projectionPage.pageFromNewest + 1} of ${projectionPage.pageCount}`, newActivity, ledger,
  ), [projectionPage, theme, newActivity]);
  const fallback = useTextureResource((ledger) => resource ? undefined : createWorkspaceTextResource('Conversation unavailable', 'Reopen this panel to retry.', theme, ledger), [Boolean(resource), theme]);
  return resource ? <mesh geometry={resource.geometry} material={resource.material} scale={0.58} position-y={-0.08} />
    : fallback ? <mesh geometry={fallback.geometry} material={fallback.material} /> : null;
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

function SessionChoices({ choices, launcherPage, theme, onOpenSession }: Pick<ImmersiveWorkspaceProps, 'choices' | 'launcherPage' | 'theme' | 'onOpenSession'>) {
  const visible = choices.slice(launcherPage * 4, launcherPage * 4 + 4);
  const resources = useTextureResource((ledger) => visible.map((choice) => ({ choice,
    resource: createWorkspaceTextResource(choice.title, choice.detail, theme, ledger),
  })), [JSON.stringify(visible), theme]);
  const empty = useTextureResource((ledger) => visible.length ? undefined : createWorkspaceTextResource('No sessions', 'Open or create a session to begin.', theme, ledger), [visible.length, theme]);
  return <>
    {empty && <mesh geometry={empty.geometry} material={empty.material} />}
    {resources?.map(({ choice, resource }, index) => <mesh key={`${choice.machineId}:${choice.sessionId}`}
      name={choice.title} geometry={resource.geometry} material={resource.material} position={[0, 0.38 - index * 0.29, 0.01]}
      userData={{ immersiveSession: choice }} onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onOpenSession(choice); }} />)}
  </>;
}

export function ImmersiveWorkspace(props: ImmersiveWorkspaceProps & { onActionController(perform?: (action: ImmersiveSemanticAction) => void): void }) {
  const {
    session, theme, activeTarget, preview, runStatus, pendingApprovals, unread, choices, launcherPage,
    workspaceStatus, onOpenSession, onLauncherPage, pageFromNewest, newActivity, onOlder, onNewer,
    onPreviousCanvas, onNextCanvas, onExit, onPageCount, onActionController, layout, editing,
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
  const pages = useMemo(() => evidencePages(evidence.diff), [evidence.diff]);
  const page = Math.min(evidencePage, pages.length - 1);
  useEffect(() => { setEvidencePage(0); }, [evidence.selectedPath, viewKey]);
  const contentOrigin = useRef<THREE.Group>(null);
  const needsRecenter = useRef(true);
  const newestSessionRef = useRef(session);
  const newestPreviewRef = useRef(preview);
  useEffect(() => {
    if (pageFromNewest === 0 || newestSessionRef.current?.id !== session?.id
      || newestSessionRef.current?.machineId !== session?.machineId) {
      newestSessionRef.current = session;
      newestPreviewRef.current = preview;
    }
  }, [pageFromNewest, session, preview]);
  const transcriptSession = pageFromNewest > 0 && newestSessionRef.current?.id === session?.id
    && newestSessionRef.current?.machineId === session?.machineId ? newestSessionRef.current : session;
  const projectionPage = useMemo(() => transcriptSession ? projectImmersiveConversation({
    session: transcriptSession, preview: pageFromNewest > 0 ? newestPreviewRef.current : preview, runStatus, pendingApprovals, unread, pageFromNewest,
  }) : { pageCount: 1, pageFromNewest: 0, hasOlder: false, hasNewer: false, projection: {
    sessionTitle: 'CodeAI', entries: [], runStatus: workspaceStatus, pendingApprovals: 0, unread: 0,
  } }, [workspaceStatus, pageFromNewest, pendingApprovals, preview, runStatus, transcriptSession, unread]);
  useEffect(() => onPageCount(projectionPage.pageCount), [onPageCount, projectionPage.pageCount]);
  const controls = useTextureResource((ledger) => createImmersiveControlResources(theme, ledger), [theme]);
  const panelControls = useTextureResource((ledger) => createPanelControlResources(theme, ledger), [theme]);
  const toolLabels = useTextureResource((ledger) => Object.fromEntries(PANEL_IDS.map((id) => [id,
    createWorkspaceButtonResource(PANEL_TITLES[id], theme, ledger),
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
    if (panelAction) { onPanelAction(panelAction.id, panelAction.command); return; }
    if (action === 'exit') onExit();
    else if (action === 'reset-workspace') { onResetWorkspace(); setDiagramScale(1); recenter(); }
    else if (action === 'reset-view') { setDiagramScale(1); recenter(); }
    else if (action === 'previous-canvas' && contentEnabled('canvas')) onPreviousCanvas();
    else if (action === 'next-canvas' && contentEnabled('canvas')) onNextCanvas();
    else if (action === 'previous-sessions' && contentEnabled('sessions')) onLauncherPage(launcherPage - 1);
    else if (action === 'next-sessions' && contentEnabled('sessions')) onLauncherPage(launcherPage + 1);
    else if (action === 'older' && contentEnabled('conversation')) onOlder();
    else if (action === 'newer' && contentEnabled('conversation')) onNewer();
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
  }, [onPanelAction, onResetWorkspace, onExit, recenter, layout, editing, onPreviousCanvas, onNextCanvas, launcherPage, onLauncherPage,
    onOlder, onNewer, evidence, page, pages.length]);
  useEffect(() => { onActionController(perform); return () => onActionController(undefined); }, [onActionController, perform]);
  const button = (action: ImmersiveAction, position: [number, number, number], disabled = false) => <WorldButton
    action={action} label={IMMERSIVE_ACTION_LABELS[action]} resource={controls?.[action]} position={position} disabled={disabled} onAction={() => perform(action)} />;
  return <>
    <ImmersiveEnvironment theme={theme} />
    <group ref={contentOrigin} name="Workspace origin">
      {PANEL_IDS.filter((id) => layout.panels[id].open).map((id) => <WorkspacePanel key={`${viewKey}:${id}`}
        id={id} layout={layout.panels[id]} focused={layout.focused === id} editing={editing}
        theme={theme} controls={panelControls} perform={perform} onPlacement={onPanelPlacement}>
        {id === 'canvas' && <>
          <CanvasSurface activeTarget={activeTarget} session={session} theme={theme} scale={diagramScale} />
          {button('previous-canvas', [-0.34, -0.65, 0.02])}{button('next-canvas', [0.34, -0.65, 0.02])}
          {button('smaller', [-0.34, -0.82, 0.02], diagramScale <= 0.7)}{button('larger', [0.34, -0.82, 0.02], diagramScale >= 1.3)}
        </>}
        {id === 'conversation' && <>
          <ConversationSurface projectionPage={projectionPage} theme={theme} newActivity={newActivity} />
          {button('older', [-0.34, -0.82, 0.02], !projectionPage.hasOlder)}{button('newer', [0.34, -0.82, 0.02], !projectionPage.hasNewer)}
        </>}
        {id === 'sessions' && <>
          <SessionChoices choices={choices} launcherPage={launcherPage} theme={theme}
            onOpenSession={(choice) => { if (contentEnabled('sessions')) onOpenSession(choice); }} />
          {button('previous-sessions', [-0.34, -0.82, 0.02], launcherPage === 0)}
          {button('next-sessions', [0.34, -0.82, 0.02], (launcherPage + 1) * 4 >= choices.length)}
        </>}
        {id === 'evidence' && <>
          <EvidenceSurface evidence={evidence} pages={pages} page={page} theme={theme} />
          {button('refresh-evidence', [0, -0.46, 0.02])}
          {button('previous-file', [-0.34, -0.65, 0.02], !evidence.tree?.files.length)}{button('next-file', [0.34, -0.65, 0.02], !evidence.tree?.files.length)}
          {button('previous-evidence', [-0.34, -0.82, 0.02], page === 0)}{button('next-evidence', [0.34, -0.82, 0.02], page >= pages.length - 1)}
        </>}
      </WorkspacePanel>)}
      <group name="Workspace controls" position={[0, -1.45, -1.3]}>
        {status && <mesh name="Workspace status" geometry={status.geometry} material={status.material} position={[0, 0.24, 0]} />}
        {PANEL_IDS.map((id, index) => <group key={id} position={[(index - 1.5) * 0.45, 0, 0]} >
          <WorldButton action={`panel:${id}:open`} label={`Open ${PANEL_TITLES[id]}`} resource={toolLabels?.[id]}
            position={[0, 0, 0]} onAction={() => perform(`panel:${id}:open`)} />
        </group>)}
        {button('reset-workspace', [-0.34, -0.2, 0.01])}{button('exit', [0.34, -0.2, 0.01])}
      </group>
    </group>
    <ThumbstickPaging enabled={layout.focused === 'conversation' && contentEnabled('conversation')}
      onOlder={() => perform('older')} onNewer={() => perform('newer')} />
  </>;
}
