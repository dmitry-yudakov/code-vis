'use client';

import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useXR } from '@react-three/xr';
import * as THREE from 'three';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createImmersiveControlResources, createImmersiveConversationResource,
  createImmersiveDiagramLabel, IMMERSIVE_ACTION_LABELS,
  type ImmersiveAction, type ImmersiveTexturePanel,
} from '@/features/diagram/spatial/immersiveResources';
import {
  projectImmersiveConversation,
} from '@/features/diagram/spatial/immersiveTranscript';
import {
  recordImmersiveFrame, SpatialResourceLedger,
} from '@/features/diagram/spatial/resourceLedger';
import type {
  ImmersiveSemanticAction, ImmersiveWorkspaceProps,
} from '@/features/diagram/spatial/immersiveTypes';

import { createPanelResources, type PanelResource } from '@/features/diagram/spatial/panelResources';
import { canvasTargetId } from '@/features/conversation/sessionStore';
import { createWorkspaceTextResource } from './workspaceResources';
import { ImmersiveEnvironment } from './ImmersiveEnvironment';

function useTextureResource<T>(
  create: (ledger: SpatialResourceLedger) => T,
  dependencies: readonly unknown[],
  onFailure: (error: unknown) => void,
): T | undefined {
  const [resource, setResource] = useState<T>();
  useEffect(() => {
    const ledger = new SpatialResourceLedger('immersive');
    try {
      setResource(create(ledger));
    } catch (error) {
      ledger.dispose();
      setResource(undefined);
      onFailure(error);
    }
    return () => {
      setResource(undefined);
      ledger.dispose();
    };
    // The caller supplies the exact raster-generation dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
  return resource;
}

function WorldActionButton({
  action,
  resource,
  position,
  disabled = false,
  onAction,
}: {
  action: ImmersiveAction;
  resource?: ImmersiveTexturePanel;
  position: [number, number, number];
  disabled?: boolean;
  onAction(): void;
}) {
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    if (!resource) return;
    resource.material.transparent = true;
    resource.material.opacity = disabled ? 0.46 : 1;
    resource.material.needsUpdate = true;
  }, [disabled, resource]);
  if (!resource) return null;
  return (
    <mesh
      name={IMMERSIVE_ACTION_LABELS[action]}
      geometry={resource.geometry}
      material={resource.material}
      position={position}
      scale={hovered && !disabled ? 1.06 : 1}
      onPointerOver={(event: ThreeEvent<PointerEvent>) => { event.stopPropagation(); setHovered(true); }}
      onPointerOut={() => setHovered(false)}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        if (!disabled) onAction();
      }}
      userData={{ immersiveAction: action, disabled }}
    />
  );
}

function ThumbstickPaging({ onOlder, onNewer }: { onOlder(): void; onNewer(): void }) {
  const controllers = useXR((state) => state.inputSourceStates.filter((source) => source.type === 'controller'));
  const cooldown = useRef(0);
  useFrame((_state, delta) => {
    cooldown.current = Math.max(0, cooldown.current - delta);
    if (cooldown.current > 0) return;
    for (const controller of controllers) {
      if (controller.type !== 'controller') continue;
      const axis = controller.gamepad['xr-standard-thumbstick']?.yAxis;
      if (axis === undefined || Math.abs(axis) < 0.72) continue;
      if (axis > 0) onOlder();
      else onNewer();
      cooldown.current = 0.42;
      return;
    }
  });
  return null;
}

function FrameRecorder() {
  useFrame((_state, delta) => recordImmersiveFrame(delta * 1_000));
  return null;
}

export function ImmersiveWorkspace({
  session, theme, activeTarget, preview, runStatus, pendingApprovals, unread,
  choices, launcherPage, workspaceStatus, onOpenSession, onLauncherPage,
  pageFromNewest, newActivity, onOlder, onNewer, onPreviousCanvas, onNextCanvas, onExit, onPageCount,
  onActionController,
}: ImmersiveWorkspaceProps & { onActionController(perform?: (action: ImmersiveSemanticAction) => void): void }) {
  const { camera, gl } = useThree();
  const [diagramScale, setDiagramScale] = useState(1);
  const contentOrigin = useRef<THREE.Group>(null);
  const [activeResource, setActiveResource] = useState<PanelResource>();
  useEffect(() => {
    setActiveResource(undefined);
    if (!activeTarget || !session) return;
    const ledger = new SpatialResourceLedger('immersive');
    const id = canvasTargetId(activeTarget);
    void createPanelResources([activeTarget], session.annotations, id, theme, ledger, 1_600_000).then((resources) => {
      if (!ledger.isDisposed()) setActiveResource(resources[id]);
    }).catch((error: unknown) => {
      if (!ledger.isDisposed()) setResourceFailure(error instanceof Error ? error.message : 'Canvas unavailable');
    });
    return () => ledger.dispose();
  }, [JSON.stringify(activeTarget), JSON.stringify(activeTarget && session?.annotations[canvasTargetId(activeTarget)]), theme]);
  const newestSessionRef = useRef(session);
  useEffect(() => {
    if (pageFromNewest === 0 || newestSessionRef.current?.id !== session?.id
      || newestSessionRef.current?.machineId !== session?.machineId) newestSessionRef.current = session;
  }, [pageFromNewest, session]);
  const transcriptSession = pageFromNewest > 0 && newestSessionRef.current?.id === session?.id
    && newestSessionRef.current?.machineId === session?.machineId ? newestSessionRef.current : session;
  const projectionPage = useMemo(() => transcriptSession ? projectImmersiveConversation({
    session: transcriptSession, preview, runStatus, pendingApprovals, unread, pageFromNewest,
  }) : { pageCount: 1, pageFromNewest: 0, hasOlder: false, hasNewer: false, projection: {
    sessionTitle: 'CodeAI', entries: [], runStatus: workspaceStatus, pendingApprovals: 0, unread: 0,
  } }, [workspaceStatus, pageFromNewest, pendingApprovals, preview, runStatus, transcriptSession, unread]);
  const failureRef = useRef<(error: unknown) => void>(() => undefined);
  const [resourceFailure, setResourceFailure] = useState<string>();
  failureRef.current = (error) => setResourceFailure(error instanceof Error ? error.message : 'The workspace surface could not render.');

  useEffect(() => onPageCount(projectionPage.pageCount), [onPageCount, projectionPage.pageCount]);

  const conversation = useTextureResource(
    (ledger) => createImmersiveConversationResource(
      projectionPage.projection,
      theme,
      `Page ${projectionPage.pageFromNewest + 1} of ${projectionPage.pageCount}`,
      newActivity,
      ledger,
    ),
    [projectionPage, theme, newActivity],
    (error) => failureRef.current(error),
  );
  const controls = useTextureResource(
    (ledger) => createImmersiveControlResources(theme, ledger),
    [theme],
    (error) => failureRef.current(error),
  );
  const diagramLabel = useTextureResource(
    (ledger) => activeTarget ? createImmersiveDiagramLabel(
      activeTarget,
      activeResource?.status || 'error',
      activeResource?.detail || (resourceFailure ? `Immersive controls unavailable: ${resourceFailure}` : undefined),
      theme,
      ledger,
    ) : createWorkspaceTextResource('Empty canvas', 'Open a session or create a diagram in the conversation.', theme, ledger),
    [activeResource?.detail, activeResource?.status, activeTarget, resourceFailure, theme],
    (error) => failureRef.current(error),
  );

  const visibleChoices = choices.slice(launcherPage * 4, launcherPage * 4 + 4);
  const navigation = useTextureResource(
    (ledger) => visibleChoices.map((choice) => ({ choice, resource: createWorkspaceTextResource(choice.title, choice.detail, theme, ledger) })),
    [JSON.stringify(visibleChoices), theme],
    (error) => failureRef.current(error),
  );
  const workspaceLabel = useTextureResource(
    (ledger) => createWorkspaceTextResource(session?.title || 'Session launcher', workspaceStatus, theme, ledger),
    [session?.title, workspaceStatus, theme],
    (error) => failureRef.current(error),
  );

  const recenter = useCallback(() => {
    const origin = contentOrigin.current;
    if (!origin) return;
    const viewingCamera = gl.xr.isPresenting ? gl.xr.getCamera() : camera;
    const position = viewingCamera.getWorldPosition(new THREE.Vector3());
    const direction = viewingCamera.getWorldDirection(new THREE.Vector3());
    direction.y = 0;
    if (direction.lengthSq() < 0.0001) direction.set(0, 0, -1);
    direction.normalize();
    origin.position.set(position.x, 0, position.z);
    origin.rotation.set(0, Math.atan2(-direction.x, -direction.z), 0);
  }, [camera, gl.xr]);

  const perform = useCallback((action: ImmersiveSemanticAction) => {
    if (action === 'exit') onExit();
    else if (action === 'previous-canvas') onPreviousCanvas();
    else if (action === 'next-canvas') onNextCanvas();
    else if (action === 'previous-sessions') onLauncherPage(launcherPage - 1);
    else if (action === 'next-sessions') onLauncherPage(launcherPage + 1);
    else if (action === 'older') onOlder();
    else if (action === 'newer') onNewer();
    else if (action === 'larger') setDiagramScale((value) => Math.min(1.3, value + 0.1));
    else if (action === 'smaller') setDiagramScale((value) => Math.max(0.7, value - 0.1));
    else {
      setDiagramScale(1);
      recenter();
    }
  }, [launcherPage, onLauncherPage, onExit, onNewer, onNextCanvas, onOlder, onPreviousCanvas, recenter]);
  useEffect(() => {
    onActionController(perform);
    return () => onActionController(undefined);
  }, [onActionController, perform]);

  return (
    <>
      <FrameRecorder />
      <ImmersiveEnvironment theme={theme} />
      <group ref={contentOrigin}>
        <group position={[-2.7, 0, -3]} rotation={[0, 0.5, 0]}>
          {workspaceLabel && <mesh name="Workspace status" geometry={workspaceLabel.geometry} material={workspaceLabel.material} position={[0, 1, 0]} />}
          {navigation?.map(({ choice, resource }, index) => {
            return <mesh key={`${choice.machineId}:${choice.sessionId}`} name={choice.title}
              geometry={resource.geometry} material={resource.material} position={[0, 0.5 - index * 0.4, 0]}
              userData={{ immersiveSession: choice }}
              onClick={(event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onOpenSession(choice); }} />;
          })}
          <WorldActionButton action="previous-sessions" resource={controls?.['previous-sessions']} position={[-0.48, -1.2, 0]} disabled={launcherPage === 0} onAction={() => perform('previous-sessions')} />
          <WorldActionButton action="next-sessions" resource={controls?.['next-sessions']} position={[0.48, -1.2, 0]} disabled={(launcherPage + 1) * 4 >= choices.length} onAction={() => perform('next-sessions')} />
        </group>
        <group position={[0, 0, -3.4]}>
          <group scale={diagramScale}>
            {activeResource && (
              <>
                <mesh geometry={activeResource.frameGeometry} material={activeResource.frameMaterial} position={[0, 0, -0.025]} />
                <mesh geometry={activeResource.geometry} material={activeResource.material} />
              </>
            )}
            {diagramLabel && <mesh geometry={diagramLabel.geometry} material={diagramLabel.material} position={[0, -(activeResource?.size[1] || 2.4) / 2 - 0.25, 0.03]} />}
          </group>
          {controls && (
            <group position={[0, -(activeResource?.size[1] || 2.4) / 2 - 0.66, 0.04]}>
              <WorldActionButton action="previous-canvas" resource={controls['previous-canvas']} position={[-1.35, 0, 0]} onAction={() => perform('previous-canvas')} />
              <WorldActionButton action="smaller" resource={controls.smaller} position={[-0.45, 0, 0]} disabled={diagramScale <= 0.7} onAction={() => perform('smaller')} />
              <WorldActionButton action="reset-view" resource={controls['reset-view']} position={[0.45, 0, 0]} onAction={() => perform('reset-view')} />
              <WorldActionButton action="larger" resource={controls.larger} position={[1.35, 0, 0]} disabled={diagramScale >= 1.3} onAction={() => perform('larger')} />
              <WorldActionButton action="next-canvas" resource={controls['next-canvas']} position={[2.25, 0, 0]} onAction={() => perform('next-canvas')} />
            </group>
          )}
        </group>
        <group position={[3.4, 0, -3]} rotation={[0, -0.55, 0]}>
          {conversation && <mesh geometry={conversation.geometry} material={conversation.material} />}
          {controls && (
            <>
              <WorldActionButton action="exit" resource={controls.exit} position={[0.64, 1.28, 0.03]} onAction={() => perform('exit')} />
              <WorldActionButton action="older" resource={controls.older} position={[-0.48, -1.28, 0.03]} disabled={!projectionPage.hasOlder} onAction={() => perform('older')} />
              <WorldActionButton action="newer" resource={controls.newer} position={[0.48, -1.28, 0.03]} disabled={!projectionPage.hasNewer} onAction={() => perform('newer')} />
            </>
          )}
        </group>
      </group>
      <ThumbstickPaging onOlder={() => perform('older')} onNewer={() => perform('newer')} />
    </>
  );
}
