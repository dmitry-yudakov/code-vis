import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { drawingReducer } from '@/features/diagram/annotations/drawingReducer';
import { createPanelResources, type PanelResource } from '@/features/diagram/spatial/panelResources';
import { RetiredLedgers, SpatialResourceLedger } from '@/features/diagram/spatial/resourceLedger';
import { canvasTargetId, findCanvasTarget, getArtifacts, getSketches } from '@/features/conversation/sessionStore';
import { createUuid } from '@/shared/uuid';
import type { CanvasTarget, DrawingMark, DrawingTool, Point, SessionSnapshot } from '@/shared/types';
import type { ThemeName } from '@/shared/design/tokens';
import { canvasCanHeal, canvasPointFromUv, canvasRenderKey, createCanvasMark, findCanvasMarkAt, updateCanvasMark } from './canvasReviewModel';
import {
  CANVAS_REVIEW_ACTIONS,
  type CanvasReviewActionName,
  type ImmersiveCanvasReviewControls,
} from './canvasReviewControls';
import { createWorkspaceIconResource, isWorkspaceIconAction } from './workspaceIcons';
import { createWorkspaceButtonResource, createWorkspaceTextResource } from './workspaceResources';
import { useRetiredLedgerFlush, useTextureResource } from './useTextureResource';
import { ControlGroupSurface, WorkspacePager, WorldButton } from './WorkspacePanel';
import { InlineConversationInput } from './InlineConversationInput';
import { immersiveTheme } from './immersiveTheme';
import { parseSpatialDiagram, type SpatialDiagramResult } from '@/features/diagram/spatial/spatialDiagramModel';
import { SpatialDiagram, type SpatialDiagramController } from './SpatialDiagram';

const DRAWING_TOOLS = ['pen', 'rectangle', 'arrow', 'text', 'eraser'] as const;

export interface CanvasReviewController {
  perform(action: CanvasReviewActionName): void;
}

function targetLabel(target: CanvasTarget): string {
  return target.kind === 'diagram' ? `Diagram ${target.artifact.ordinal}` : `Sketch ${target.sketch.ordinal}`;
}

interface DraftPreview {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  base: HTMLCanvasElement;
  viewBox: [number, number, number, number];
  minFilter: THREE.MinificationTextureFilter;
  generateMipmaps: boolean;
}

function createDraftPreview(resource: PanelResource): DraftPreview | undefined {
  try {
    const texture = (resource.material as THREE.MeshBasicMaterial).map;
    const canvas = texture?.image;
    if (!(texture instanceof THREE.CanvasTexture) || !(canvas instanceof HTMLCanvasElement)) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const base = document.createElement('canvas');
    base.width = canvas.width; base.height = canvas.height;
    const baseContext = base.getContext('2d');
    if (!baseContext) return;
    baseContext.drawImage(canvas, 0, 0);
    const preview = { canvas, context, texture, base, viewBox: resource.viewBox,
      minFilter: texture.minFilter, generateMipmaps: texture.generateMipmaps };
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    return preview;
  } catch {
    // A missing live preview must never prevent the controller gesture from being committed.
    return;
  }
}

function paintDraft(preview: DraftPreview, mark: DrawingMark): void {
  const { canvas, context, texture, base, viewBox: [x, y, viewWidth, viewHeight] } = preview;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(base, 0, 0);
  context.setTransform(canvas.width / viewWidth, 0, 0, canvas.height / viewHeight,
    -x * canvas.width / viewWidth, -y * canvas.height / viewHeight);
  context.strokeStyle = mark.color;
  context.fillStyle = mark.color;
  context.lineWidth = Math.max(viewWidth / canvas.width, viewHeight / canvas.height) * 4;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  if (mark.kind === 'pen') {
    if (mark.points.length === 1) {
      context.arc(mark.points[0].x, mark.points[0].y, context.lineWidth, 0, Math.PI * 2);
      context.fill();
    } else {
      context.moveTo(mark.points[0].x, mark.points[0].y);
      for (const point of mark.points.slice(1)) context.lineTo(point.x, point.y);
      context.stroke();
    }
  } else if (mark.kind === 'rectangle') {
    if (!mark.width && !mark.height) {
      context.arc(mark.x, mark.y, context.lineWidth, 0, Math.PI * 2); context.fill();
    } else { context.rect(mark.x, mark.y, mark.width, mark.height); context.stroke(); }
  } else if (mark.kind === 'arrow') {
    const angle = Math.atan2(mark.end.y - mark.start.y, mark.end.x - mark.start.x);
    const size = 12;
    context.moveTo(mark.start.x, mark.start.y); context.lineTo(mark.end.x, mark.end.y);
    context.moveTo(mark.end.x - size * Math.cos(angle - Math.PI / 6), mark.end.y - size * Math.sin(angle - Math.PI / 6));
    context.lineTo(mark.end.x, mark.end.y);
    context.lineTo(mark.end.x - size * Math.cos(angle + Math.PI / 6), mark.end.y - size * Math.sin(angle + Math.PI / 6));
    context.stroke();
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  texture.needsUpdate = true;
}

function CanvasResource({ target, resource, active, comparison, enabled, tool, theme, scale, onPointerDown, onPointerMove, onPointerFinish }: {
  target: CanvasTarget;
  resource: PanelResource;
  active: boolean;
  comparison: boolean;
  enabled: boolean;
  tool: DrawingTool;
  theme: ThemeName;
  scale: number;
  onPointerDown(event: ThreeEvent<PointerEvent>, resource: PanelResource): void;
  onPointerMove(event: ThreeEvent<PointerEvent>, resource: PanelResource): void;
  onPointerFinish(event: ThreeEvent<PointerEvent>, resource: PanelResource, cancelled: boolean): void;
}) {
  const availableWidth = comparison ? 0.61 : 1.22;
  const availableHeight = comparison ? 0.58 : 0.72;
  const height = Math.min(availableHeight, availableWidth / Math.max(0.1, resource.aspectRatio)) * scale;
  const width = height * resource.aspectRatio;
  const label = targetLabel(target);
  const positionX = comparison ? active ? -0.34 : 0.34 : 0;
  // The XR pointer releases capture before emitting its normal pointerup. Its pointercancel is the
  // cancellation signal; handling lostpointercapture would discard every controller stroke.
  return <group position={[positionX, -0.08, 0.001]}>
    <mesh name={active ? 'Active canvas' : 'Comparison canvas'} geometry={resource.geometry} material={resource.material}
      renderOrder={10}
      scale={[width / resource.size[0], height / resource.size[1], 1]}
      pointerEvents={active && enabled && resource.status === 'ready' ? 'auto' : 'none'}
      userData={{ canvasReviewSurface: canvasTargetId(target), canvasTarget: canvasTargetId(target), active,
        status: resource.status, canvasStatus: resource.status, viewBox: resource.viewBox, tool }}
      onPointerDown={(event) => onPointerDown(event, resource)}
      onPointerMove={(event) => onPointerMove(event, resource)}
      onPointerUp={(event) => onPointerFinish(event, resource, false)}
      onPointerCancel={(event) => onPointerFinish(event, resource, true)} />
  </group>;
}

export function CanvasReviewTools({ session, activeTarget, theme, enabled, scale, controls, onController }: {
  session?: SessionSnapshot;
  activeTarget?: CanvasTarget;
  theme: ThemeName;
  enabled: boolean;
  scale: number;
  controls?: ImmersiveCanvasReviewControls;
  onController(controller?: CanvasReviewController): void;
}) {
  const activeId = activeTarget && canvasTargetId(activeTarget);
  const initialMarks = activeId ? session?.annotations[activeId]?.marks || [] : [];
  const [drawing, dispatch] = useReducer(drawingReducer, { marks: initialMarks, past: [], future: [] });
  const [tool, setTool] = useState<DrawingTool>('pen');
  const [compareId, setCompareId] = useState<string>();
  const [comparing, setComparing] = useState(false);
  const [labelPoint, setLabelPoint] = useState<Point>();
  const [label, setLabel] = useState('');
  const [clearPending, setClearPending] = useState(false);
  const [resources, setResources] = useState<Record<string, PanelResource>>({});
  const [retired] = useState(() => new RetiredLedgers());
  const [draft, setDraft] = useState<DrawingMark>();
  const [projection, setProjection] = useState<'2d' | 'spatial'>('2d');
  const [spatial, setSpatial] = useState<SpatialDiagramResult>();
  const [selectedSpatialKey, setSelectedSpatialKey] = useState<string>();
  const spatialController = useRef<SpatialDiagramController | undefined>(undefined);
  const gesture = useRef<{
    pointerId: number;
    start: Point;
    mark: DrawingMark;
    capture: Pick<Element, 'hasPointerCapture' | 'releasePointerCapture'>;
    inputSource?: XRInputSource;
    triggerWasPressed: boolean;
    preview?: DraftPreview;
  } | undefined>(undefined);
  const drawingRef = useRef(drawing);
  const marksReady = useRef(false);
  drawingRef.current = drawing;
  const ids = useMemo(() => session
    ? [...getArtifacts(session).map((artifact) => artifact.id), ...getSketches(session).map((sketch) => sketch.id)]
    : [], [session]);
  const comparisonIds = ids.filter((id) => id !== activeId);
  const comparisonId = comparisonIds.includes(compareId || '') ? compareId
    : comparisonIds.includes(session?.previousDiagramId || '') ? session?.previousDiagramId : comparisonIds[0];
  const comparisonTarget = comparing && session ? findCanvasTarget(session, comparisonId) : undefined;
  const comparisonAnnotation = comparisonTarget && session?.annotations[canvasTargetId(comparisonTarget)];
  const spatialActive = projection === 'spatial' && Boolean(spatial?.supported);
  const activeKey = canvasRenderKey(activeTarget);
  const comparisonKey = canvasRenderKey(comparisonTarget, comparisonAnnotation?.updatedAt);
  // Every session mutation (a message, a poll-applied snapshot, this panel's own saved stroke)
  // rebuilds equal targets and annotations. The raster inputs are held until one of their keys
  // changes, so only a change that reaches the pixels restarts the texture pipeline.
  const rendered = useMemo(() => ({
    targets: [spatialActive ? undefined : activeTarget, comparisonTarget].filter((target): target is CanvasTarget => Boolean(target)),
    annotations: comparisonTarget && comparisonAnnotation ? { [canvasTargetId(comparisonTarget)]: comparisonAnnotation } : {},
  }), [activeKey, comparisonKey, spatialActive]); // eslint-disable-line react-hooks/exhaustive-deps
  // Only a canvas that failed follows the session again, which is how it used to retry.
  const retryOn = rendered.targets.some((target) => canvasCanHeal(target, resources[canvasTargetId(target)]?.status))
    ? session : undefined;

  useEffect(() => {
    let current = true;
    setSpatial(undefined);
    if (activeTarget?.kind !== 'diagram') return () => { current = false; };
    void parseSpatialDiagram(activeTarget.artifact.id, activeTarget.artifact.source, theme)
      .then((result) => { if (current) setSpatial(result); });
    return () => { current = false; };
  }, [activeTarget?.kind, activeTarget?.kind === 'diagram' ? activeTarget.artifact.id : activeTarget?.sketch.id,
    activeTarget?.kind === 'diagram' ? activeTarget.artifact.source : undefined]);

  useEffect(() => {
    if (!marksReady.current) { marksReady.current = true; return; }
    if (activeId) controls?.onMarksChange(activeId, drawing.marks);
  }, [activeId, controls?.onMarksChange, drawing.marks]);

  useEffect(() => {
    const { targets } = rendered;
    if (!activeId || !targets.length) {
      setResources((shown) => Object.keys(shown).length ? {} : shown);
      return;
    }
    const ledger = new SpatialResourceLedger('immersive');
    let generation: Record<string, PanelResource> | undefined;
    const annotations = { ...rendered.annotations, [activeId]: { marks: drawing.marks } };
    // Reserve room for chat, repository evidence, controls, and a second comparison canvas under
    // the workspace-wide 5.59 MP mipmapped budget. Each comparison gets an equal readable share; treating each
    // as active also upscales small Mermaid viewBoxes past the allocator's legibility floor.
    const perTargetPixels = Math.floor(800_000 / targets.length);
    void Promise.all(targets.map((target) => createPanelResources(
      [target], annotations, canvasTargetId(target), theme, ledger, perTargetPixels, true,
    ))).then((parts) => {
      if (ledger.isDisposed()) return;
      const next: Record<string, PanelResource> = Object.assign({}, ...parts);
      generation = next;
      setResources(next);
    });
    // The shown generation stays on the canvas until the next one is bound, so a stroke swaps
    // textures instead of blanking the canvas. Retiring frees its budget for that next generation.
    return () => retired.add(ledger, generation);
  }, [activeId, drawing.marks, rendered, retired, retryOn, theme]);
  useRetiredLedgerFlush(retired, resources);

  const cycleComparison = (delta: number) => {
    if (!comparisonIds.length) return;
    const index = Math.max(0, comparisonIds.indexOf(comparisonId || ''));
    setCompareId(comparisonIds[(index + delta + comparisonIds.length) % comparisonIds.length]);
    setComparing(true);
  };
  const commitLabel = () => {
    if (!labelPoint || !label.trim()) return;
    const mark = createCanvasMark('text', labelPoint, immersiveTheme[theme].annotation, createUuid(), new Date().toISOString(), label);
    if (mark) dispatch({ type: 'add', mark });
    setLabelPoint(undefined); setLabel('');
  };
  const perform = useCallback((action: CanvasReviewActionName) => {
    if (!enabled || !activeId) return;
    if (action !== 'clear') setClearPending(false);
    if (action === 'spatial' && spatial?.supported) {
      setComparing(false); setProjection('spatial'); return;
    }
    if (action === 'projection') { setProjection('2d'); return; }
    if (['rotate-left', 'rotate-right', 'focus-selection', 'toggle-group', 'previous-detail', 'next-detail', 'reset-spatial'].includes(action)) {
      spatialController.current?.perform(action); return;
    }
    if (!controls) return;
    if (DRAWING_TOOLS.includes(action as typeof DRAWING_TOOLS[number])) {
      setTool(action as DrawingTool); return;
    }
    if (action === 'undo') dispatch({ type: 'undo' });
    else if (action === 'redo') dispatch({ type: 'redo' });
    else if (action === 'clear') {
      if (clearPending) { dispatch({ type: 'clear' }); setClearPending(false); }
      else if (drawingRef.current.marks.length) setClearPending(true);
    } else if (action === 'attach') controls.onToggleAttachment(activeId);
    else if (action === 'sketch' && controls.canCreateSketch) controls.onCreateSketch();
    else if (action === 'compare') setComparing((value) => comparisonIds.length ? !value : false);
    else if (action === 'previous-compare') cycleComparison(-1);
    else if (action === 'next-compare') cycleComparison(1);
    else if (action === 'commit-label') commitLabel();
    else if (action === 'cancel-label') { setLabelPoint(undefined); setLabel(''); }
  }, [activeId, clearPending, comparisonId, comparisonIds, controls, enabled, label, labelPoint, spatial?.supported]);
  useEffect(() => { onController({ perform }); return () => onController(undefined); }, [onController, perform]);

  const endGesture = useCallback((cancelled: boolean) => {
    const current = gesture.current;
    if (!current) return;
    gesture.current = undefined;
    if (cancelled && current.preview) {
      current.preview.context.setTransform(1, 0, 0, 1, 0, 0);
      current.preview.context.clearRect(0, 0, current.preview.canvas.width, current.preview.canvas.height);
      current.preview.context.drawImage(current.preview.base, 0, 0);
      current.preview.texture.needsUpdate = true;
    } else if (!cancelled) dispatch({ type: 'add', mark: current.mark });
    if (current.preview) {
      current.preview.texture.generateMipmaps = current.preview.generateMipmaps;
      current.preview.texture.minFilter = current.preview.minFilter;
      current.preview.texture.needsUpdate = true;
    }
    setDraft(undefined);
    try {
      if (current.capture.hasPointerCapture(current.pointerId)) current.capture.releasePointerCapture(current.pointerId);
    } catch { /* The interaction surface or XR pointer has already released capture. */ }
  }, []);
  useFrame(() => {
    const current = gesture.current;
    const trigger = current?.inputSource?.gamepad?.buttons[0];
    if (!current || !trigger) return;
    const pressed = trigger.pressed || trigger.value >= 0.5;
    if (pressed) current.triggerWasPressed = true;
    else if (current.triggerWasPressed) endGesture(false);
  });
  const pointFromEvent = (event: ThreeEvent<PointerEvent>, resource: PanelResource) => event.uv
    ? canvasPointFromUv(resource.viewBox, event.uv)
    : undefined;
  // The previous stroke's texture can replace the canvas while the next stroke is being drawn.
  const paintGesture = (current: NonNullable<typeof gesture.current>, resource: PanelResource) => {
    if (current.preview?.texture !== (resource.material as THREE.MeshBasicMaterial).map) current.preview = createDraftPreview(resource);
    if (current.preview) paintDraft(current.preview, current.mark);
  };
  const pointerDown = (event: ThreeEvent<PointerEvent>, resource: PanelResource) => {
    event.stopPropagation();
    if (!enabled || event.button !== 0 || !activeId || gesture.current) return;
    const point = pointFromEvent(event, resource);
    if (!point) return;
    if (tool === 'text') { setLabelPoint(point); setLabel(''); return; }
    if (tool === 'eraser') {
      const mark = findCanvasMarkAt(drawingRef.current.marks, point, resource.viewBox);
      if (mark) dispatch({ type: 'remove', id: mark.id });
      return;
    }
    const mark = createCanvasMark(tool, point, immersiveTheme[theme].annotation, createUuid(), new Date().toISOString());
    if (!mark) return;
    const capture = event.target as Element;
    capture.setPointerCapture(event.pointerId);
    const inputSource = (event as ThreeEvent<PointerEvent> & { pointerState?: { inputSource?: XRInputSource } }).pointerState?.inputSource;
    const trigger = inputSource?.gamepad?.buttons[0];
    const preview = createDraftPreview(resource);
    if (preview) paintDraft(preview, mark);
    gesture.current = { pointerId: event.pointerId, start: point, mark, capture, inputSource, preview,
      triggerWasPressed: Boolean(trigger?.pressed || trigger && trigger.value >= 0.5) };
    setDraft(mark);
  };
  const pointerMove = (event: ThreeEvent<PointerEvent>, resource: PanelResource) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const point = pointFromEvent(event, resource);
    if (!point) return;
    const mark = updateCanvasMark(current.mark, current.start, point);
    current.mark = mark;
    paintGesture(current, resource);
    setDraft(mark);
  };
  const pointerFinish = (event: ThreeEvent<PointerEvent>, resource: PanelResource, cancelled: boolean) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (!cancelled) {
      const point = pointFromEvent(event, resource);
      current.mark = point ? updateCanvasMark(current.mark, current.start, point) : current.mark;
      paintGesture(current, resource);
    }
    endGesture(cancelled);
  };
  useEffect(() => {
    if (enabled) return;
    endGesture(true);
  }, [enabled, endGesture]);

  const activeResource = activeId && resources[activeId];
  const compareResource = comparisonTarget && resources[canvasTargetId(comparisonTarget)];
  const visibleActions: CanvasReviewActionName[] = labelPoint ? ['commit-label', 'cancel-label'] : [
    'pen', 'rectangle', 'arrow', 'text', 'eraser', 'undo', 'redo', 'clear', 'attach', 'sketch', 'compare',
    ...(spatial?.supported ? ['spatial' as const] : []),
  ];
  const icons = useTextureResource((ledger) => Object.fromEntries(visibleActions.map((action) => {
    const iconAction = `canvas:${action}`;
    return [action, isWorkspaceIconAction(iconAction) ? createWorkspaceIconResource(iconAction, theme, ledger)
      : createWorkspaceButtonResource(CANVAS_REVIEW_ACTIONS[action], theme, ledger)];
  })), [visibleActions.join(','), theme]);
  const status = useTextureResource((ledger) => clearPending
    ? createWorkspaceTextResource('Clear every mark?', 'Choose Clear marks again to confirm.', theme, ledger)
    : undefined, [clearPending, theme]);
  const button = (action: CanvasReviewActionName) => {
    const positions: Partial<Record<CanvasReviewActionName, [number, number, number]>> = labelPoint ? {
      'commit-label': [-0.16, -0.50, 0], 'cancel-label': [0.20, -0.50, 0],
    } : {
      pen: [-0.52, 0.58, 0], rectangle: [-0.36, 0.58, 0], arrow: [-0.20, 0.58, 0],
      text: [-0.04, 0.58, 0], eraser: [0.12, 0.58, 0], undo: [0.38, 0.58, 0], redo: [0.54, 0.58, 0],
      attach: [-0.46, 0.38, 0], compare: [-0.15, 0.38, 0], sketch: [0.18, 0.38, 0], clear: [0.50, 0.38, 0],
      spatial: [0.48, 0.18, 0],
    };
    return <WorldButton key={action} action={`canvas:${action}`} label={CANVAS_REVIEW_ACTIONS[action]}
      resource={icons?.[action]} iconTheme={theme}
      position={positions[action] || [0, 0, 0]}
      selected={action === tool || action === 'attach' && controls?.attachmentIds.includes(activeId || '') || action === 'compare' && comparing}
      variant={action === 'commit-label' ? 'primary' : action === 'clear' || action === 'cancel-label' ? 'destructive' : 'secondary'}
      disabled={!enabled || !activeId || action === 'undo' && !drawing.past.length || action === 'redo' && !drawing.future.length
        || action === 'clear' && !drawing.marks.length || action === 'sketch' && !controls?.canCreateSketch
        || (action === 'compare' || action.endsWith('compare')) && !comparisonIds.length
        || action === 'commit-label' && !label.trim()}
      onAction={() => perform(action)} />;
  };
  return <group name="Canvas review tools" userData={{ activeId, comparisonId: comparing ? comparisonId : undefined,
    tool, marks: drawing.marks, drawing: Boolean(draft), drawingPointerId: gesture.current?.pointerId,
    previewVersion: gesture.current?.preview?.texture.version, clearPending, labelPoint,
    attached: controls?.attachmentIds.includes(activeId || ''), projection,
    spatialSupported: spatial?.supported, spatialReason: spatial && !spatial.supported ? spatial.reason : undefined,
    selectedSpatialKey }}>
    {!activeTarget && <CanvasEmpty theme={theme} />}
    {projection === '2d' && activeTarget && activeResource && <CanvasResource target={activeTarget} resource={activeResource} active comparison={Boolean(comparisonTarget)}
      theme={theme} scale={scale}
      enabled={enabled && !labelPoint} tool={tool}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerFinish={pointerFinish} />}
    {projection === '2d' && comparisonTarget && compareResource && <CanvasResource target={comparisonTarget} resource={compareResource} active={false} comparison
      theme={theme} scale={scale}
      enabled={false} tool={tool}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerFinish={pointerFinish} />}
    {projection === 'spatial' && spatial?.supported && <SpatialDiagram graph={spatial.graph} theme={theme} enabled={enabled}
      scale={scale} selectedKey={selectedSpatialKey} onSelectedKey={setSelectedSpatialKey} onProjection={() => setProjection('2d')}
      onController={(controller) => { spatialController.current = controller; }} />}
    {projection === '2d' && labelPoint && <InlineConversationInput draft={label} theme={theme} enabled={enabled} onDraft={setLabel}
      ariaLabel="VR canvas label" dataAttribute="data-immersive-canvas-label" placeholder="Label…"
      meshName="Canvas label input" maxLength={500} position={[0, -0.28, 0.0015]} />}
    {projection === '2d' && status && <mesh geometry={status.geometry} material={status.material} position={[0, -0.53, 0]}
      pointerEvents="none" raycast={() => undefined} />}
    {projection === '2d' && !labelPoint && <ControlGroupSurface name="Drawing tool selector" width={0.78} position={[-0.20, 0.58, 0]} theme={theme} />}
    {projection === '2d' && visibleActions.map(button)}
    {projection === '2d' && spatial && !spatial.supported && <SpatialFallback reason={spatial.reason} theme={theme} />}
    {projection === '2d' && comparing && <WorkspacePager label={`Compare ${Math.max(1, comparisonIds.indexOf(comparisonId || '') + 1)} of ${comparisonIds.length}`}
      previousAction="canvas:previous-compare" nextAction="canvas:next-compare"
      previousLabel="Previous comparison" nextLabel="Next comparison" position={[0, -0.61, 0]} theme={theme}
      previousDisabled={!comparisonIds.length} nextDisabled={!comparisonIds.length}
      onAction={(action) => perform(action.slice('canvas:'.length) as CanvasReviewActionName)} />}
  </group>;
}

function SpatialFallback({ reason, theme }: { reason: string; theme: ThemeName }) {
  const resource = useTextureResource((ledger) => createWorkspaceTextResource('Spatial view unavailable', reason, theme, ledger, true, true), [reason, theme]);
  return resource ? <mesh name="Spatial fallback explanation" geometry={resource.geometry} material={resource.material}
    position={[0, -0.49, 0.002]} pointerEvents="none" raycast={() => undefined} /> : null;
}

function CanvasEmpty({ theme }: { theme: ThemeName }) {
  const resource = useTextureResource((ledger) => createWorkspaceTextResource(
    'Empty canvas', 'Create a sketch here or ask an agent for a diagram.', theme, ledger,
  ), [theme]);
  return resource ? <mesh geometry={resource.geometry} material={resource.material} /> : null;
}
