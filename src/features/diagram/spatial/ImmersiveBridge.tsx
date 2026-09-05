'use client';

import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { createXRStore, useXR, XR } from '@react-three/xr';
import * as THREE from 'three';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { palette } from '@/shared/design/tokens';
import {
  createImmersiveControlResources, createImmersiveConversationResource,
  createImmersiveDiagramLabel, IMMERSIVE_ACTION_LABELS,
  type ImmersiveAction, type ImmersiveTexturePanel,
} from './immersiveResources';
import {
  projectImmersiveConversation,
} from './immersiveTranscript';
import {
  recordImmersiveFrame, setImmersiveSessionActive, SpatialResourceLedger,
} from './resourceLedger';
import type {
  ImmersiveAvailability, ImmersiveController, ImmersiveSessionAdapter,
  ImmersiveSemanticAction, ImmersiveWorkspaceProps,
} from './immersiveTypes';

if (typeof window !== 'undefined') {
  window.__CODEAI_XR_BUNDLE_EVALUATIONS__ = (window.__CODEAI_XR_BUNDLE_EVALUATIONS__ || 0) + 1;
}

export interface ImmersiveBridgeProps extends ImmersiveWorkspaceProps {
  active: boolean;
  onController(controller?: ImmersiveController): void;
  onAvailability(availability: ImmersiveAvailability, reason?: string): void;
}

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Immersive entry was denied. Focus this page, allow headset access, and try again.';
  }
  if (error instanceof DOMException && error.name === 'InvalidStateError') {
    return 'Immersive entry needs this page to be focused and activated by the Enter VR button.';
  }
  return error instanceof Error ? error.message : 'The immersive session could not start.';
}

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

function ImmersiveWorkspace({
  session, theme, activeTarget, activeResource, preview, runStatus, pendingApprovals, unread,
  pageFromNewest, newActivity, onOlder, onNewer, onPreviousCanvas, onNextCanvas, onExit, onPageCount,
  onActionController,
}: ImmersiveWorkspaceProps & { onActionController(perform?: (action: ImmersiveSemanticAction) => void): void }) {
  const { camera, gl } = useThree();
  const [diagramScale, setDiagramScale] = useState(1);
  const contentOrigin = useRef<THREE.Group>(null);
  const newestSessionRef = useRef(session);
  useEffect(() => {
    if (pageFromNewest === 0) newestSessionRef.current = session;
  }, [pageFromNewest, session]);
  const transcriptSession = pageFromNewest > 0 ? newestSessionRef.current : session;
  const projectionPage = useMemo(() => projectImmersiveConversation({
    session: transcriptSession, preview, runStatus, pendingApprovals, unread, pageFromNewest,
  }), [pageFromNewest, pendingApprovals, preview, runStatus, transcriptSession, unread]);
  const failureRef = useRef<(error: unknown) => void>(() => undefined);
  const [resourceFailure, setResourceFailure] = useState<string>();
  failureRef.current = (error) => setResourceFailure(errorMessage(error));

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
    (ledger) => createImmersiveDiagramLabel(
      activeTarget,
      activeResource?.status || 'error',
      activeResource?.detail || (resourceFailure ? `Immersive controls unavailable: ${resourceFailure}` : undefined),
      theme,
      ledger,
    ),
    [activeResource?.detail, activeResource?.status, activeTarget, resourceFailure, theme],
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
    else if (action === 'older') onOlder();
    else if (action === 'newer') onNewer();
    else if (action === 'larger') setDiagramScale((value) => Math.min(1.3, value + 0.1));
    else if (action === 'smaller') setDiagramScale((value) => Math.max(0.7, value - 0.1));
    else {
      setDiagramScale(1);
      recenter();
    }
  }, [onExit, onNewer, onNextCanvas, onOlder, onPreviousCanvas, recenter]);
  useEffect(() => {
    onActionController(perform);
    return () => onActionController(undefined);
  }, [onActionController, perform]);

  return (
    <>
      <FrameRecorder />
      <color attach="background" args={[palette[theme].shellSunk]} />
      <ambientLight intensity={1.7} />
      <directionalLight position={[3, 6, 4]} intensity={1.1} />
      <group ref={contentOrigin}>
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

export function ImmersiveBridge({
  active, onController, onAvailability, onExit, ...workspaceProps
}: ImmersiveBridgeProps) {
  const gl = useThree((state) => state.gl);
  const store = useMemo(() => createXRStore({
    offerSession: false,
    emulate: false,
    enterGrantedSession: false,
    anchors: false,
    handTracking: false,
    bodyTracking: false,
    layers: false,
    meshDetection: false,
    planeDetection: false,
    hitTest: false,
    domOverlay: false,
    customSessionInit: { optionalFeatures: ['local-floor'] },
    controller: {
      model: false,
      grabPointer: false,
      rayPointer: { rayModel: { color: '#7d9df5' } },
    },
    hand: false,
    transientPointer: false,
    gaze: false,
    screenInput: false,
    frameBufferScaling: 'mid',
  }), []);
  const sessionRef = useRef<ImmersiveSessionAdapter | undefined>(undefined);
  const enteringRef = useRef<Promise<void> | undefined>(undefined);
  const endingRef = useRef<Promise<void> | undefined>(undefined);
  const mountedRef = useRef(true);
  const sessionIdRef = useRef(workspaceProps.session.id);
  const [floorBased, setFloorBased] = useState(false);
  const actionRef = useRef<((action: ImmersiveSemanticAction) => void) | undefined>(undefined);

  const bindSession = useCallback((session: ImmersiveSessionAdapter) => {
    sessionRef.current = session;
    let requestedOutcome: { availability: ImmersiveAvailability; reason?: string } | undefined;
    const ended = () => finishSession(
      requestedOutcome?.availability || 'available',
      requestedOutcome?.reason,
    );
    const visibilityChanged = () => {
      if (session.visibilityState === 'hidden') void endSession('available', 'The headset hid the immersive session; return to Spatial and enter again.');
    };
    const cleanupListeners = () => {
      session.removeEventListener?.('end', ended);
      session.removeEventListener?.('visibilitychange', visibilityChanged);
    };
    const finishSession = (availability: ImmersiveAvailability, reason?: string) => {
      if (sessionRef.current !== session) return;
      cleanupListeners();
      sessionRef.current = undefined;
      endingRef.current = undefined;
      setImmersiveSessionActive(false);
      setFloorBased(false);
      if (mountedRef.current) onAvailability(availability, reason);
    };
    const endSession = (availability: ImmersiveAvailability, reason?: string) => {
      if (sessionRef.current !== session) return Promise.resolve();
      if (!endingRef.current) {
        requestedOutcome = { availability, reason };
        // Assign the operation before invoking `end()`: test adapters and some runtimes dispatch
        // the end event synchronously, and that event must not leave a settled promise behind.
        const operation = Promise.resolve()
          .then(() => session.end())
          .catch((error) => {
            requestedOutcome = { availability: 'failed', reason: errorMessage(error) };
          })
          .finally(() => finishSession(
            requestedOutcome?.availability || availability,
            requestedOutcome?.reason || reason,
          ));
        endingRef.current = operation;
      }
      return endingRef.current;
    };
    session.addEventListener?.('end', ended);
    session.addEventListener?.('visibilitychange', visibilityChanged);
    return { finishSession, endSession, cleanupListeners };
  }, [onAvailability]);

  const lifecycleRef = useRef<ReturnType<typeof bindSession> | undefined>(undefined);
  const enter = useCallback(() => {
    if (sessionRef.current || enteringRef.current || endingRef.current) return Promise.resolve();
    const operation = (async () => {
      onAvailability('entering');
      setFloorBased(false);
      try {
        let session: ImmersiveSessionAdapter | undefined;
        let nativeSession: XRSession | undefined;
        const injected = window.__CODEAI_XR_TEST__?.adapter;
        if (injected?.enterVR) {
          session = await injected.enterVR();
        } else {
          // `local` is universally available. Promote to local-floor after entry when the headset
          // grants it, which gives a safe fallback without making floor support session-fatal.
          gl.xr.setReferenceSpaceType('local');
          nativeSession = await store.enterVR();
          session = nativeSession as unknown as ImmersiveSessionAdapter | undefined;
        }
        if (!session) throw new Error('The browser did not create an immersive VR session.');
        if (!mountedRef.current) {
          await Promise.resolve(session.end()).catch(() => undefined);
          return;
        }
        lifecycleRef.current = bindSession(session);
        if (nativeSession) {
          try {
            const floor = await nativeSession.requestReferenceSpace('local-floor');
            if (mountedRef.current && sessionRef.current === session) {
              gl.xr.setReferenceSpace(floor);
              setFloorBased(true);
            }
          } catch {
            // The local reference space selected above remains active.
          }
        }
        if (!mountedRef.current) {
          await lifecycleRef.current?.endSession('available');
          return;
        }
        if (sessionRef.current !== session) return;
        setImmersiveSessionActive(true);
        onAvailability('active');
      } catch (error) {
        setImmersiveSessionActive(false);
        if (mountedRef.current) onAvailability('failed', errorMessage(error));
      }
    })();
    enteringRef.current = operation;
    void operation.finally(() => {
      if (enteringRef.current === operation) enteringRef.current = undefined;
    });
    return operation;
  }, [bindSession, gl.xr, onAvailability, store]);

  const exit = useCallback(async () => {
    if (!sessionRef.current) {
      onAvailability('available');
      return;
    }
    await lifecycleRef.current?.endSession('available');
  }, [onAvailability]);

  useEffect(() => {
    onController({ enter, exit, perform: (action) => {
      if (action === 'exit' && !actionRef.current) void exit();
      else actionRef.current?.(action);
    } });
    return () => onController(undefined);
  }, [enter, exit, onController]);

  useEffect(() => {
    if (sessionIdRef.current === workspaceProps.session.id) return;
    sessionIdRef.current = workspaceProps.session.id;
    void exit();
  }, [exit, workspaceProps.session.id]);

  useEffect(() => {
    const contextLost = (event: Event) => {
      if (!sessionRef.current) return;
      event.preventDefault();
      const reason = 'The WebGL context was lost. Immersive VR ended; the desktop Spatial view is still available.';
      void lifecycleRef.current?.endSession('failed', reason);
    };
    gl.domElement.addEventListener('webglcontextlost', contextLost);
    return () => gl.domElement.removeEventListener('webglcontextlost', contextLost);
  }, [gl.domElement]);

  useEffect(() => {
    let sawController = false;
    return store.subscribe((state, previous) => {
      const controllerCount = state.inputSourceStates.filter((source) => source.type === 'controller').length;
      const previousCount = previous.inputSourceStates.filter((source) => source.type === 'controller').length;
      if (controllerCount > 0) sawController = true;
      if (!sawController || controllerCount >= previousCount || !sessionRef.current) return;
      void lifecycleRef.current?.endSession(
        'failed',
        'A headset controller disconnected. Immersive VR ended; reconnect it and enter again.',
      );
    });
  }, [store]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // React development mode verifies effect cleanup by immediately mounting again. Deferring
      // irreversible store destruction keeps that check from ending a real session spuriously.
      queueMicrotask(() => {
        if (mountedRef.current) return;
        const finish = async () => {
          const pendingEntry = enteringRef.current;
          const activeLifecycle = lifecycleRef.current;
          await activeLifecycle?.endSession('available');
          await pendingEntry?.catch(() => undefined);
          if (lifecycleRef.current !== activeLifecycle) {
            await lifecycleRef.current?.endSession('available');
          }
          setImmersiveSessionActive(false);
          store.destroy();
          window.__CODEAI_XR_TEST__?.adapter?.destroy?.();
        };
        void finish();
      });
    };
  }, [store]);

  return (
    <XR store={store}>
      {active && (
        <group position-y={floorBased ? 1.45 : 0}>
          <ImmersiveWorkspace
            {...workspaceProps}
            onExit={() => { onExit(); void exit(); }}
            onActionController={(perform) => { actionRef.current = perform; }}
          />
        </group>
      )}
    </XR>
  );
}
