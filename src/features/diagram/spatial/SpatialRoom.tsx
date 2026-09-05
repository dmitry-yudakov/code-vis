'use client';

import dynamic from 'next/dynamic';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import {
  Component, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
  type ErrorInfo, type ReactNode,
} from 'react';
import { palette } from '@/shared/design/tokens';
import type { CanvasTarget } from '@/shared/types';
import { canvasTargetId, getArtifacts, getSketches } from '@/features/conversation/sessionStore';
import { SPATIAL_ROOM_BOUNDS, type SpatialCameraState, type SpatialPose } from '@/features/shell/workspaceViews';
import {
  defaultSpatialArrangement, defaultSpatialCamera, resolvedSpatialArrangement, selectSpatialTargets,
  spatialTargetLabel,
} from './spatialModel';
import type { SpatialRoomProps, SpatialSceneHandle } from './spatialTypes';
import { createPanelResources, type PanelResource } from './panelResources';
import { recordSpatialFrame, SpatialResourceLedger } from './resourceLedger';
import { probeImmersiveCapability } from './immersiveCapability';
import { immersiveConversationVersion } from './immersiveTranscript';
import type {
  ImmersiveAvailability, ImmersiveController, ImmersiveSemanticAction,
} from './immersiveTypes';

const ImmersiveBridge = dynamic(
  () => {
    if (typeof window !== 'undefined' && window.__CODEAI_XR_TEST__?.failXRImport) {
      return Promise.reject(new Error('Injected immersive bundle failure.'));
    }
    return import('./ImmersiveBridge').then((module) => module.ImmersiveBridge);
  },
  { ssr: false, loading: () => null },
);

class ImmersiveImportBoundary extends Component<{
  children: ReactNode;
  onError(message: string): void;
}, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: unknown, _info: ErrorInfo) {
    this.props.onError(error instanceof Error ? error.message : 'The immersive renderer could not load.');
  }

  render() { return this.state.failed ? null : this.props.children; }
}

function allTargets(session: SpatialRoomProps['session']): CanvasTarget[] {
  return [
    ...getArtifacts(session).map((artifact) => ({ kind: 'diagram' as const, artifact })),
    ...getSketches(session).map((sketch) => ({ kind: 'sketch' as const, sketch })),
  ];
}

function samePose(left: SpatialPose | undefined, right: SpatialPose): boolean {
  return Boolean(left && left.rotationY === right.rotationY && left.position.every((value, index) => value === right.position[index]));
}

function clamp(value: number, bounds: readonly [number, number]): number {
  return Math.max(bounds[0], Math.min(bounds[1], value));
}

function translatedPose(pose: SpatialPose, delta: SpatialPose): SpatialPose {
  return {
    position: [
      clamp(pose.position[0] + delta.position[0], SPATIAL_ROOM_BOUNDS.x),
      clamp(pose.position[1] + delta.position[1], SPATIAL_ROOM_BOUNDS.y),
      clamp(pose.position[2] + delta.position[2], SPATIAL_ROOM_BOUNDS.z),
    ],
    rotationY: clamp(pose.rotationY + delta.rotationY, [-Math.PI, Math.PI]),
  };
}

function usePanelResources(
  targets: readonly CanvasTarget[],
  session: SpatialRoomProps['session'],
  activeId: string,
  theme: SpatialRoomProps['theme'],
  owner: 'desktop' | 'immersive' = 'desktop',
) {
  const [resources, setResources] = useState<Record<string, PanelResource>>({});
  const [loading, setLoading] = useState(true);
  const generationRef = useRef<SpatialResourceLedger | undefined>(undefined);
  const targetKey = targets.map(canvasTargetId).join(':');
  const annotationKey = targets.map((target) => {
    const id = canvasTargetId(target);
    return `${id}:${session.annotations[id]?.updatedAt || ''}`;
  }).join(':');

  useEffect(() => {
    setResources({});
    setLoading(true);
    generationRef.current?.dispose();
    const generation = new SpatialResourceLedger(owner);
    generationRef.current = generation;
    void createPanelResources(targets, session.annotations, activeId, theme, generation).then((next) => {
      if (generationRef.current !== generation || generation.isDisposed()) return;
      setResources(next);
      setLoading(false);
    });
    return () => {
      if (generationRef.current === generation) generationRef.current = undefined;
      generation.dispose();
    };
  }, [activeId, annotationKey, owner, session.annotations, targetKey, targets, theme]);

  return { resources, loading };
}

function SpatialPanel({
  target,
  resource,
  pose,
  selected,
  arranging,
  theme,
  markCount,
  onSelect,
  onFocus,
  onPoseChange,
}: {
  target: CanvasTarget;
  resource: PanelResource;
  pose: SpatialPose;
  selected: boolean;
  arranging: boolean;
  theme: SpatialRoomProps['theme'];
  markCount: number;
  onSelect(): void;
  onFocus(): void;
  onPoseChange(pose: SpatialPose): void;
}) {
  const drag = useRef<{ x: number; y: number; pose: SpatialPose; moved: boolean } | undefined>(undefined);

  const pointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onSelect();
    if (!arranging || !selected) return;
    (event.nativeEvent.target as Element).setPointerCapture?.(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, pose, moved: false };
  };
  const pointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (!drag.current || !arranging || !selected) return;
    event.stopPropagation();
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    drag.current.moved ||= Math.abs(dx) + Math.abs(dy) > 3;
    if (event.shiftKey) onPoseChange(translatedPose(drag.current.pose, { position: [0, 0, 0], rotationY: dx * 0.01 }));
    else if (event.altKey) onPoseChange(translatedPose(drag.current.pose, { position: [0, 0, dy * 0.025], rotationY: 0 }));
    else onPoseChange(translatedPose(drag.current.pose, { position: [dx * 0.025, -dy * 0.025, 0], rotationY: 0 }));
  };
  const pointerUp = (event: ThreeEvent<PointerEvent>) => {
    if (drag.current) (event.nativeEvent.target as Element).releasePointerCapture?.(event.pointerId);
    drag.current = undefined;
  };

  return (
    <group position={pose.position} rotation={[0, pose.rotationY, 0]}>
      <mesh geometry={resource.frameGeometry} material={resource.frameMaterial} position={[0, 0, -0.025]} />
      <mesh
        geometry={resource.geometry}
        material={resource.material}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onDoubleClick={(event) => { event.stopPropagation(); onFocus(); }}
      />
      <Html center position={[0, -resource.size[1] / 2 - 0.28, 0.04]} distanceFactor={8}>
        <div className={`spatial-world-label ${selected ? 'selected' : ''}`}>
          <strong>{spatialTargetLabel(target)}</strong>
          <span>{resource.status === 'ready'
            ? markCount ? `${markCount} ${markCount === 1 ? 'mark' : 'marks'}` : 'Ready'
            : resource.status === 'omitted' ? 'Preview omitted' : 'Preview error'}</span>
        </div>
      </Html>
      {resource.status !== 'ready' && (
        <Html center position={[0, 0, 0.05]} distanceFactor={8}>
          <div className={`spatial-panel-placeholder ${resource.status}`}>
            <strong>{resource.status === 'omitted' ? 'Preview omitted' : 'Could not render'}</strong>
            <span>{resource.detail || (resource.status === 'omitted' ? 'Texture pixel budget' : 'This artifact is not ready.')}</span>
          </div>
        </Html>
      )}
      {selected && (
        <Html center position={[resource.size[0] / 2 - 0.16, resource.size[1] / 2 - 0.16, 0.06]} distanceFactor={8}>
          <span className="spatial-selected-badge" style={{ background: palette[theme].plot }}>Selected</span>
        </Html>
      )}
    </group>
  );
}

const SpatialScene = forwardRef<SpatialSceneHandle, {
  targets: readonly CanvasTarget[];
  resources: Readonly<Record<string, PanelResource>>;
  activeId: string;
  arrangement: Readonly<Record<string, SpatialPose>>;
  cameraState: SpatialCameraState;
  defaultCamera: SpatialCameraState;
  arranging: boolean;
  theme: SpatialRoomProps['theme'];
  annotations: SpatialRoomProps['session']['annotations'];
  onSelect(id: string): void;
  onCameraChange(camera: SpatialCameraState): void;
  onPoseChange(id: string, pose: SpatialPose): void;
  onFailure(message: string): void;
}>(({
  targets, resources, activeId, arrangement, cameraState, defaultCamera, arranging, theme, annotations,
  onSelect, onCameraChange, onPoseChange, onFailure,
}, ref) => {
  const { camera, gl, invalidate } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const transitionRef = useRef<number | undefined>(undefined);
  useFrame(recordSpatialFrame);

  const readCamera = useCallback((): SpatialCameraState => ({
    position: camera.position.toArray() as [number, number, number],
    target: (controlsRef.current?.target || new THREE.Vector3()).toArray() as [number, number, number],
  }), [camera]);

  const setCamera = useCallback((next: SpatialCameraState, animate = false, persist = true) => {
    if (transitionRef.current !== undefined) cancelAnimationFrame(transitionRef.current);
    const controls = controlsRef.current;
    if (!controls) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!animate || reduced) {
      camera.position.fromArray(next.position);
      controls.target.fromArray(next.target);
      controls.update();
      invalidate();
      if (persist) onCameraChange(next);
      return;
    }
    const startPosition = camera.position.clone();
    const startTarget = controls.target.clone();
    const endPosition = new THREE.Vector3(...next.position);
    const endTarget = new THREE.Vector3(...next.target);
    const startedAt = performance.now();
    const tick = (time: number) => {
      const progress = Math.min(1, (time - startedAt) / 260);
      const eased = 1 - Math.pow(1 - progress, 3);
      camera.position.lerpVectors(startPosition, endPosition, eased);
      controls.target.lerpVectors(startTarget, endTarget, eased);
      controls.update();
      invalidate();
      if (progress < 1) transitionRef.current = requestAnimationFrame(tick);
      else {
        transitionRef.current = undefined;
        if (persist) onCameraChange(next);
      }
    };
    transitionRef.current = requestAnimationFrame(tick);
  }, [camera, invalidate, onCameraChange]);

  useEffect(() => {
    setCamera(cameraState, false, false);
  }, [cameraState, setCamera]);

  useEffect(() => {
    const canvas = gl.domElement;
    const contextLost = (event: Event) => {
      event.preventDefault();
      onFailure('The WebGL context was lost. Your spatial layout remains saved on this device.');
    };
    canvas.addEventListener('webglcontextlost', contextLost);
    return () => canvas.removeEventListener('webglcontextlost', contextLost);
  }, [gl, onFailure]);

  useEffect(() => () => {
    if (transitionRef.current !== undefined) cancelAnimationFrame(transitionRef.current);
  }, []);

  useImperativeHandle(ref, () => ({
    focus(id) {
      const pose = arrangement[id];
      if (!pose) return;
      const distance = 6.2;
      setCamera({
        position: [
          pose.position[0] + Math.sin(pose.rotationY) * distance,
          pose.position[1] + 0.1,
          pose.position[2] + Math.cos(pose.rotationY) * distance,
        ],
        target: pose.position,
      }, true);
    },
    reset() { setCamera(defaultCamera, false, false); },
    moveCamera(kind) {
      const current = readCamera();
      const position = new THREE.Vector3(...current.position);
      const target = new THREE.Vector3(...current.target);
      const offset = position.clone().sub(target);
      if (kind.startsWith('orbit-')) {
        const spherical = new THREE.Spherical().setFromVector3(offset);
        if (kind === 'orbit-left') spherical.theta += 0.16;
        if (kind === 'orbit-right') spherical.theta -= 0.16;
        if (kind === 'orbit-up') spherical.phi = Math.max(0.2, spherical.phi - 0.12);
        if (kind === 'orbit-down') spherical.phi = Math.min(Math.PI - 0.2, spherical.phi + 0.12);
        position.copy(target).add(new THREE.Vector3().setFromSpherical(spherical));
      } else if (kind.startsWith('pan-')) {
        const delta = new THREE.Vector3(
          kind === 'pan-left' ? -0.6 : kind === 'pan-right' ? 0.6 : 0,
          kind === 'pan-down' ? -0.45 : kind === 'pan-up' ? 0.45 : 0,
          0,
        );
        position.add(delta);
        target.add(delta);
      } else {
        offset.multiplyScalar(kind === 'dolly-in' ? 0.82 : 1.22);
        position.copy(target).add(offset);
      }
      setCamera({ position: position.toArray(), target: target.toArray() });
    },
    nudgePanel(id, delta) {
      const pose = arrangement[id];
      if (pose) onPoseChange(id, translatedPose(pose, delta));
    },
  }), [arrangement, defaultCamera, onPoseChange, readCamera, setCamera]);

  return (
    <>
      <color attach="background" args={[palette[theme].shellSunk]} />
      <ambientLight intensity={1.6} />
      <directionalLight position={[4, 8, 8]} intensity={1.1} />
      {targets.map((target) => {
        const id = canvasTargetId(target);
        const resource = resources[id];
        const pose = arrangement[id];
        if (!resource || !pose) return null;
        return (
          <SpatialPanel
            key={id}
            target={target}
            resource={resource}
            pose={pose}
            selected={id === activeId}
            arranging={arranging}
            theme={theme}
            markCount={annotations[id]?.marks.length || 0}
            onSelect={() => onSelect(id)}
            onFocus={() => ref && typeof ref !== 'function' && ref.current?.focus(id)}
            onPoseChange={(next) => onPoseChange(id, next)}
          />
        );
      })}
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping={false}
        enablePan
        minDistance={2.5}
        maxDistance={38}
        target={cameraState.target}
        onChange={() => invalidate()}
        onEnd={() => onCameraChange(readCamera())}
      />
    </>
  );
});
SpatialScene.displayName = 'SpatialScene';

const CAMERA_CONTROLS: Array<[Parameters<SpatialSceneHandle['moveCamera']>[0], string]> = [
  ['orbit-left', 'Orbit left'], ['orbit-right', 'Orbit right'], ['orbit-up', 'Orbit up'], ['orbit-down', 'Orbit down'],
  ['pan-left', 'Pan left'], ['pan-right', 'Pan right'], ['pan-up', 'Pan up'], ['pan-down', 'Pan down'],
  ['dolly-in', 'Dolly in'], ['dolly-out', 'Dolly out'],
];

const PANEL_NUDGES: Array<[string, SpatialPose]> = [
  ['Left', { position: [-0.35, 0, 0], rotationY: 0 }],
  ['Right', { position: [0.35, 0, 0], rotationY: 0 }],
  ['Up', { position: [0, 0.3, 0], rotationY: 0 }],
  ['Down', { position: [0, -0.3, 0], rotationY: 0 }],
  ['Forward', { position: [0, 0, -0.35], rotationY: 0 }],
  ['Back', { position: [0, 0, 0.35], rotationY: 0 }],
  ['Rotate left', { position: [0, 0, 0], rotationY: -0.12 }],
  ['Rotate right', { position: [0, 0, 0], rotationY: 0.12 }],
];

export function SpatialRoom({
  session, theme, activeId, immersiveAuthorized, preview, runStatus, pendingApprovals, unread,
  spatial, onSelect, onOpenFlat, onViewChange, onReset, onFailure,
}: SpatialRoomProps) {
  const [immersiveAvailability, setImmersiveAvailability] = useState<ImmersiveAvailability>('checking');
  const [immersiveReason, setImmersiveReason] = useState<string>();
  const [xrBundleEnabled, setXrBundleEnabled] = useState(false);
  const [xrController, setXrController] = useState<ImmersiveController>();
  const [pageFromNewest, setPageFromNewest] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [newActivity, setNewActivity] = useState(false);
  const conversationVersion = immersiveConversationVersion(session, preview);
  const observedConversationVersion = useRef(conversationVersion);
  const xrActive = immersiveAvailability === 'active';

  const targets = useMemo(() => allTargets(session), [session]);
  const selection = useMemo(() => selectSpatialTargets(targets, activeId), [activeId, targets]);
  const selectedIds = selection.targets.map(canvasTargetId).join(':');
  const selectedContent = selection.targets.map((target) => target.kind === 'diagram'
    ? `${target.artifact.status}:${target.artifact.source}:${target.artifact.error || ''}`
    : target.sketch.viewBox.join(',')).join(':');
  const selectedTargets = useMemo(
    () => selection.targets,
    [selectedContent, selectedIds], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const activeTarget = selectedTargets.find((target) => canvasTargetId(target) === activeId);
  const resourceTargets = useMemo(
    () => xrActive && activeTarget ? [activeTarget] : selectedTargets,
    [activeTarget, selectedTargets, xrActive],
  );
  const defaultArrangement = useMemo(() => defaultSpatialArrangement(selectedTargets), [selectedTargets]);
  const arrangement = useMemo(
    () => resolvedSpatialArrangement(selectedTargets, spatial?.placements || {}),
    [selectedTargets, spatial?.placements],
  );
  const initialCamera = useMemo(
    () => defaultSpatialCamera(selectedTargets, activeId, spatial?.placements),
    [activeId, selectedTargets, spatial?.placements],
  );
  const resetCamera = useMemo(
    () => defaultSpatialCamera(selectedTargets, activeId),
    [activeId, selectedTargets],
  );
  const cameraState = spatial?.camera || initialCamera;
  const { resources, loading } = usePanelResources(
    resourceTargets,
    session,
    activeId,
    theme,
    xrActive ? 'immersive' : 'desktop',
  );
  const sceneRef = useRef<SpatialSceneHandle>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [arranging, setArranging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setImmersiveAvailability('checking');
    setImmersiveReason(undefined);
    setXrBundleEnabled(false);
    void probeImmersiveCapability({ authorized: immersiveAuthorized }).then((result) => {
      if (cancelled) return;
      setImmersiveAvailability(result.availability);
      setImmersiveReason(result.reason);
      setXrBundleEnabled(result.availability === 'available');
    });
    return () => { cancelled = true; };
  }, [immersiveAuthorized, session.id]);

  useEffect(() => {
    if (observedConversationVersion.current !== conversationVersion && pageFromNewest > 0) {
      setNewActivity(true);
    }
    observedConversationVersion.current = conversationVersion;
  }, [conversationVersion, pageFromNewest]);

  useEffect(() => {
    if (immersiveAvailability === 'active' || immersiveAvailability === 'entering') return;
    setPageFromNewest(0);
    setNewActivity(false);
  }, [immersiveAvailability]);

  const handleImmersiveAvailability = useCallback((availability: ImmersiveAvailability, reason?: string) => {
    setImmersiveAvailability(availability);
    setImmersiveReason(reason);
  }, []);
  const handlePageCount = useCallback((count: number) => {
    setPageCount(count);
    setPageFromNewest((current) => Math.max(0, Math.min(current, count - 1)));
  }, []);
  const older = useCallback(() => setPageFromNewest((current) => Math.min(pageCount - 1, current + 1)), [pageCount]);
  const newer = useCallback(() => setPageFromNewest((current) => {
    const next = Math.max(0, current - 1);
    if (next === 0) setNewActivity(false);
    return next;
  }), []);

  const updateCamera = useCallback((camera: SpatialCameraState) => {
    onViewChange({ camera, placements: spatial?.placements || {} });
  }, [onViewChange, spatial?.placements]);
  const updatePose = useCallback((id: string, pose: SpatialPose) => {
    const prior = spatial?.placements[id];
    if (samePose(prior, pose)) return;
    onViewChange({
      ...(spatial?.camera ? { camera: spatial.camera } : {}),
      placements: { ...(spatial?.placements || {}), [id]: pose },
    });
  }, [onViewChange, spatial]);
  const reset = () => {
    onReset();
    sceneRef.current?.reset();
  };
  const focus = () => sceneRef.current?.focus(activeId);
  const selectRelative = useCallback((delta: number) => {
    const index = selectedTargets.findIndex((target) => canvasTargetId(target) === activeId);
    const next = selectedTargets[(Math.max(0, index) + delta + selectedTargets.length) % selectedTargets.length];
    if (next) onSelect(canvasTargetId(next));
  }, [activeId, onSelect, selectedTargets]);

  useEffect(() => {
    const shortcuts: Record<string, Parameters<SpatialSceneHandle['moveCamera']>[0]> = {
      'alt+arrowleft': 'orbit-left',
      'alt+arrowright': 'orbit-right',
      'alt+arrowup': 'orbit-up',
      'alt+arrowdown': 'orbit-down',
      'shift+arrowleft': 'pan-left',
      'shift+arrowright': 'pan-right',
      'shift+arrowup': 'pan-up',
      'shift+arrowdown': 'pan-down',
      '+': 'dolly-in',
      '=': 'dolly-in',
      '-': 'dolly-out',
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      const modified = `${event.altKey ? 'alt+' : event.shiftKey ? 'shift+' : ''}${event.key.toLowerCase()}`;
      const movement = shortcuts[modified];
      if (movement) {
        event.preventDefault();
        sceneRef.current?.moveCamera(movement);
      } else if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        focus();
      } else if (event.key === '0') {
        event.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });

  return (
    <section className="spatial-room" aria-label="Spatial canvas projection">
      <div className="spatial-viewport">
        <Canvas
          aria-label="Spatial room containing session diagrams and sketches"
          role="img"
          frameloop={xrActive ? 'always' : 'demand'}
          dpr={[1, 2]}
          camera={{ position: cameraState.position, fov: 46, near: 0.1, far: 120 }}
          gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => {
            gl.domElement.setAttribute('aria-label', 'Spatial room containing session diagrams and sketches');
            gl.domElement.setAttribute('role', 'img');
          }}
          onPointerMissed={() => setArranging(false)}
        >
          {!xrActive && (
            <SpatialScene
              ref={sceneRef}
              targets={selectedTargets}
              resources={resources}
              activeId={activeId}
              arrangement={arrangement}
              cameraState={cameraState}
              defaultCamera={resetCamera}
              arranging={arranging}
              theme={theme}
              annotations={session.annotations}
              onSelect={onSelect}
              onCameraChange={updateCamera}
              onPoseChange={updatePose}
              onFailure={onFailure}
            />
          )}
          {xrBundleEnabled && activeTarget && (
            <ImmersiveImportBoundary
              onError={(message) => handleImmersiveAvailability(
                'failed',
                `The immersive renderer could not load: ${message}. Desktop Spatial remains available.`,
              )}
            >
              <ImmersiveBridge
                active={xrActive}
                session={session}
                theme={theme}
                activeTarget={activeTarget}
                activeResource={resources[activeId]}
                preview={preview}
                runStatus={runStatus}
                pendingApprovals={pendingApprovals}
                unread={unread}
                pageFromNewest={pageFromNewest}
                newActivity={newActivity}
                onOlder={older}
                onNewer={newer}
                onPreviousCanvas={() => selectRelative(-1)}
                onNextCanvas={() => selectRelative(1)}
                onExit={() => undefined}
                onPageCount={handlePageCount}
                onController={setXrController}
                onAvailability={handleImmersiveAvailability}
              />
            </ImmersiveImportBoundary>
          )}
        </Canvas>
        {loading && <div className="spatial-preparing" role="status">Preparing panel previews…</div>}
        <p className="spatial-instructions">Drag the background to orbit; wheel or pinch to dolly. F focuses, 0 resets, Alt+arrows orbit, Shift+arrows pan, and +/− dollies. In Arrange, drag to move, Shift-drag to rotate, or Alt-drag for depth.</p>
      </div>

      <aside className="spatial-controls" aria-label="Spatial room controls">
        <header>
          <div><strong>Room panels</strong><span>{selectedTargets.length} shown{selection.omitted ? ` · ${selection.omitted} omitted` : ''}</span></div>
          <button type="button" onClick={onOpenFlat}>Open in Flat</button>
        </header>
        <div className={`immersive-entry ${immersiveAvailability}`} aria-live="polite">
          {immersiveAvailability === 'checking' && <span>Checking this browser for immersive VR…</span>}
          {(immersiveAvailability === 'available' || immersiveAvailability === 'failed' || immersiveAvailability === 'entering') && (
            <button
              type="button"
              className="immersive-enter"
              disabled={!xrController || immersiveAvailability === 'entering'}
              onClick={() => void xrController?.enter()}
            >
              {immersiveAvailability === 'entering' ? 'Entering VR…' : 'Enter VR'}
            </button>
          )}
          {immersiveAvailability === 'active' && <strong>Immersive workspace active</strong>}
          {immersiveReason && <span role={immersiveAvailability === 'failed' ? 'alert' : undefined}>{immersiveReason}</span>}
        </div>
        {xrActive && (
          <div className="immersive-semantic-controls" role="group" aria-label="Immersive workspace controls">
            {newActivity && <strong className="immersive-new-activity">New activity</strong>}
            {([
              ['exit', 'Exit VR'],
              ['previous-canvas', 'Previous canvas'],
              ['next-canvas', 'Next canvas'],
              ['larger', 'Larger'],
              ['smaller', 'Smaller'],
              ['reset-view', 'Reset view'],
              ['older', 'Older'],
              ['newer', 'Newer'],
            ] as Array<[ImmersiveSemanticAction, string]>).map(([action, label]) => (
              <button
                key={action}
                type="button"
                data-immersive-action={action}
                disabled={(action === 'older' && pageFromNewest >= pageCount - 1) || (action === 'newer' && pageFromNewest === 0)}
                onClick={() => xrController?.perform(action)}
              >{label}</button>
            ))}
          </div>
        )}
        <div
          ref={listRef}
          className="spatial-panel-list"
          role="listbox"
          aria-label="Panels in chronological room order"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); selectRelative(1); }
            if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); selectRelative(-1); }
            if (event.key === 'Enter') { event.preventDefault(); focus(); }
          }}
        >
          {selectedTargets.map((target) => {
            const id = canvasTargetId(target);
            const resource = resources[id];
            return (
              <div
                key={id}
                role="option"
                aria-selected={id === activeId}
                data-canvas-id={id}
                className={id === activeId ? 'selected' : ''}
                onClick={() => onSelect(id)}
              >
                <span>{spatialTargetLabel(target)}</span>
                <small>{resource?.status === 'omitted' ? 'Preview omitted' : resource?.status === 'error' ? 'Preview error' : `${session.annotations[id]?.marks.length || 0} marks`}</small>
              </div>
            );
          })}
        </div>
        {selection.omitted > 0 && <p className="spatial-omitted">{selection.omitted} older {selection.omitted === 1 ? 'target is' : 'targets are'} omitted. Use History to open one.</p>}
        <div className="spatial-control-section">
          <strong>Camera</strong>
          <div className="spatial-button-grid">
            {CAMERA_CONTROLS.map(([kind, label]) => <button type="button" key={kind} onClick={() => sceneRef.current?.moveCamera(kind)}>{label}</button>)}
          </div>
          <div className="spatial-primary-controls">
            <button type="button" onClick={focus}>Focus selected</button>
            <button type="button" onClick={reset}>Reset room</button>
          </div>
        </div>
        <div className="spatial-control-section">
          <label className="spatial-arrange-toggle"><input type="checkbox" checked={arranging} onChange={(event) => setArranging(event.target.checked)} /> Arrange selected panel</label>
          {arranging && (
            <div className="spatial-button-grid panel-nudges">
              {PANEL_NUDGES.map(([label, delta]) => <button type="button" key={label} onClick={() => sceneRef.current?.nudgePanel(activeId, delta)}>{label}</button>)}
            </div>
          )}
        </div>
      </aside>
    </section>
  );
}
