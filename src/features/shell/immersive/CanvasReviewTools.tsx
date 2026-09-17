import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { drawingReducer } from '@/features/diagram/annotations/drawingReducer';
import { createPanelResources, type PanelResource } from '@/features/diagram/spatial/panelResources';
import { SpatialResourceLedger } from '@/features/diagram/spatial/resourceLedger';
import { canvasTargetId, findCanvasTarget, getArtifacts, getSketches } from '@/features/conversation/sessionStore';
import { createUuid } from '@/shared/uuid';
import type { CanvasTarget, DrawingMark, DrawingTool, Point, SessionSnapshot } from '@/shared/types';
import type { ThemeName } from '@/shared/design/tokens';
import { canvasPointFromUv, createCanvasMark, findCanvasMarkAt, updateCanvasMark } from './canvasReviewModel';
import {
  CANVAS_REVIEW_ACTIONS,
  type CanvasReviewActionName,
  type ImmersiveCanvasReviewControls,
} from './canvasReviewControls';
import { createWorkspaceIconResource, type WorkspaceIcon } from './workspaceIcons';
import { createWorkspaceTextResource } from './workspaceResources';
import { useTextureResource } from './useTextureResource';
import { WorldButton } from './WorkspacePanel';
import { InlineConversationInput } from './InlineConversationInput';

const ICONS: Record<CanvasReviewActionName, WorkspaceIcon> = {
  pen: 'edit', rectangle: 'canvas', arrow: 'replace', text: 'spell', eraser: 'trash',
  undo: 'undo', redo: 'refresh', clear: 'close', attach: 'plus', sketch: 'canvas', compare: 'history',
  'previous-compare': 'chevron-left', 'next-compare': 'chevron-right',
  'commit-label': 'check', 'cancel-label': 'close',
};
const DRAWING_TOOLS = ['pen', 'rectangle', 'arrow', 'text', 'eraser'] as const;
const MARK_COLOR = '#c67139';

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
  base: ImageData;
  viewBox: [number, number, number, number];
}

function createDraftPreview(resource: PanelResource): DraftPreview | undefined {
  const texture = (resource.material as THREE.MeshBasicMaterial).map;
  const canvas = texture?.image;
  if (!(texture instanceof THREE.CanvasTexture) || !(canvas instanceof HTMLCanvasElement)) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  return { canvas, context, texture, base: context.getImageData(0, 0, canvas.width, canvas.height), viewBox: resource.viewBox };
}

function paintDraft(preview: DraftPreview, mark: DrawingMark): void {
  const { canvas, context, texture, base, viewBox: [x, y, viewWidth, viewHeight] } = preview;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.putImageData(base, 0, 0);
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
  const title = useTextureResource((ledger) => createWorkspaceTextResource(
    label,
    resource.status === 'ready' ? active ? 'Hold trigger to draw' : 'Comparison'
      : resource.detail || (resource.status === 'omitted' ? 'Preview omitted by resource budget' : 'Preview unavailable'),
    theme, ledger,
  ), [label, resource.status, resource.detail, active, theme]);
  const positionX = comparison ? active ? -0.34 : 0.34 : 0;
  // The XR pointer releases capture before emitting its normal pointerup. Its pointercancel is the
  // cancellation signal; handling lostpointercapture would discard every controller stroke.
  return <group position={[positionX, -0.08, 0.02]}>
    <mesh name={active ? 'Active canvas' : 'Comparison canvas'} geometry={resource.geometry} material={resource.material}
      scale={[width / resource.size[0], height / resource.size[1], 1]}
      pointerEvents={active && enabled && resource.status === 'ready' ? 'auto' : 'none'}
      userData={{ canvasReviewSurface: canvasTargetId(target), canvasTarget: canvasTargetId(target), active,
        status: resource.status, canvasStatus: resource.status, viewBox: resource.viewBox, tool }}
      onPointerDown={(event) => onPointerDown(event, resource)}
      onPointerMove={(event) => onPointerMove(event, resource)}
      onPointerUp={(event) => onPointerFinish(event, resource, false)}
      onPointerCancel={(event) => onPointerFinish(event, resource, true)} />
    {title && <mesh geometry={title.geometry} material={title.material} scale={comparison ? 0.43 : 0.7}
      position={[0, -height / 2 - 0.13, 0.02]} pointerEvents="none" raycast={() => undefined} />}
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
  const [draft, setDraft] = useState<DrawingMark>();
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

  useEffect(() => {
    if (!marksReady.current) { marksReady.current = true; return; }
    if (activeId) controls?.onMarksChange(activeId, drawing.marks);
  }, [activeId, controls?.onMarksChange, drawing.marks]);

  useEffect(() => {
    setResources({});
    const targets = [activeTarget, comparisonTarget].filter((target): target is CanvasTarget => Boolean(target));
    if (!activeTarget || !session || !targets.length) return;
    const ledger = new SpatialResourceLedger('immersive');
    const annotations = { ...session.annotations, [activeId!]: { ...session.annotations[activeId!], marks: drawing.marks } };
    // Reserve room for chat, repository evidence, controls, and a second comparison canvas under
    // the workspace-wide 4 MP budget. Each comparison gets an equal readable share; treating each
    // as active also upscales small Mermaid viewBoxes past the allocator's legibility floor.
    const perTargetPixels = Math.floor(800_000 / targets.length);
    void Promise.all(targets.map((target) => createPanelResources(
      [target], annotations, canvasTargetId(target), theme, ledger, perTargetPixels,
    ))).then((parts) => {
      if (!ledger.isDisposed()) setResources(Object.assign({}, ...parts));
    });
    return () => ledger.dispose();
  }, [activeId, activeTarget, comparisonTarget, drawing.marks, session, theme]);

  const cycleComparison = (delta: number) => {
    if (!comparisonIds.length) return;
    const index = Math.max(0, comparisonIds.indexOf(comparisonId || ''));
    setCompareId(comparisonIds[(index + delta + comparisonIds.length) % comparisonIds.length]);
    setComparing(true);
  };
  const commitLabel = () => {
    if (!labelPoint || !label.trim()) return;
    const mark = createCanvasMark('text', labelPoint, MARK_COLOR, createUuid(), new Date().toISOString(), label);
    if (mark) dispatch({ type: 'add', mark });
    setLabelPoint(undefined); setLabel('');
  };
  const perform = useCallback((action: CanvasReviewActionName) => {
    if (!enabled || !activeId || !controls) return;
    if (action !== 'clear') setClearPending(false);
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
  }, [activeId, clearPending, comparisonId, comparisonIds, controls, enabled, label, labelPoint]);
  useEffect(() => { onController({ perform }); return () => onController(undefined); }, [onController, perform]);

  const endGesture = useCallback((cancelled: boolean) => {
    const current = gesture.current;
    if (!current) return;
    gesture.current = undefined;
    if (cancelled && current.preview) {
      current.preview.context.setTransform(1, 0, 0, 1, 0, 0);
      current.preview.context.putImageData(current.preview.base, 0, 0);
      current.preview.texture.needsUpdate = true;
    } else if (!cancelled) dispatch({ type: 'add', mark: current.mark });
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
    const mark = createCanvasMark(tool, point, MARK_COLOR, createUuid(), new Date().toISOString());
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
    if (current.preview) paintDraft(current.preview, mark);
    setDraft(mark);
  };
  const pointerFinish = (event: ThreeEvent<PointerEvent>, resource: PanelResource, cancelled: boolean) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (!cancelled) {
      const point = pointFromEvent(event, resource);
      current.mark = point ? updateCanvasMark(current.mark, current.start, point) : current.mark;
      if (current.preview) paintDraft(current.preview, current.mark);
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
    ...(comparing ? ['previous-compare' as const, 'next-compare' as const] : []),
  ];
  const icons = useTextureResource((ledger) => Object.fromEntries(visibleActions.map((action) => [action,
    createWorkspaceIconResource(ICONS[action], theme, ledger)])), [visibleActions.join(','), theme]);
  const status = useTextureResource((ledger) => clearPending
    ? createWorkspaceTextResource('Clear every mark?', 'Choose Clear marks again to confirm.', theme, ledger)
    : undefined, [clearPending, theme]);
  const button = (action: CanvasReviewActionName, index: number) => {
    const topRow = index < 7;
    const rowIndex = topRow ? index : index - 7;
    const rowCount = topRow ? Math.min(7, visibleActions.length) : visibleActions.length - 7;
    return <WorldButton key={action} action={`canvas:${action}`} label={CANVAS_REVIEW_ACTIONS[action]}
      resource={icons?.[action]} iconTheme={theme}
      position={[(rowIndex - (rowCount - 1) / 2) * 0.19, topRow ? 0.58 : 0.37, 0.06]}
      selected={action === tool || action === 'attach' && controls?.attachmentIds.includes(activeId || '') || action === 'compare' && comparing}
      disabled={!enabled || !activeId || action === 'undo' && !drawing.past.length || action === 'redo' && !drawing.future.length
        || action === 'clear' && !drawing.marks.length || action === 'sketch' && !controls?.canCreateSketch
        || (action === 'compare' || action.endsWith('compare')) && !comparisonIds.length
        || action === 'commit-label' && !label.trim()}
      onAction={() => perform(action)} />;
  };
  return <group name="Canvas review tools" userData={{ activeId, comparisonId: comparing ? comparisonId : undefined,
    tool, marks: drawing.marks, drawing: Boolean(draft), drawingPointerId: gesture.current?.pointerId,
    previewVersion: gesture.current?.preview?.texture.version, clearPending, labelPoint,
    attached: controls?.attachmentIds.includes(activeId || '') }}>
    {!activeTarget && <CanvasEmpty theme={theme} />}
    {activeTarget && activeResource && <CanvasResource target={activeTarget} resource={activeResource} active comparison={Boolean(comparisonTarget)}
      theme={theme} scale={scale}
      enabled={enabled && !labelPoint} tool={tool}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerFinish={pointerFinish} />}
    {comparisonTarget && compareResource && <CanvasResource target={comparisonTarget} resource={compareResource} active={false} comparison
      theme={theme} scale={scale}
      enabled={false} tool={tool}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerFinish={pointerFinish} />}
    {labelPoint && <InlineConversationInput draft={label} theme={theme} enabled={enabled} onDraft={setLabel}
      ariaLabel="VR canvas label" dataAttribute="data-immersive-canvas-label" placeholder="Label…"
      meshName="Canvas label input" maxLength={500} position={[0, -0.28, 0.07]} />}
    {status && <mesh geometry={status.geometry} material={status.material} scale={0.72} position={[0, -0.53, 0.06]} />}
    {visibleActions.map(button)}
  </group>;
}

function CanvasEmpty({ theme }: { theme: ThemeName }) {
  const resource = useTextureResource((ledger) => createWorkspaceTextResource(
    'Empty canvas', 'Create a sketch here or ask an agent for a diagram.', theme, ledger,
  ), [theme]);
  return resource ? <mesh geometry={resource.geometry} material={resource.material} position={[0, 0, 0.02]} /> : null;
}
