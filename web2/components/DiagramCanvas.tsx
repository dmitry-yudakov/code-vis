'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { CanvasTarget, DrawingMark, DrawingTool, Point } from '@/lib/shared/types';
import { drawingReducer } from '@/lib/client/drawingReducer';
import { createUuid } from '@/lib/client/uuid';
import { canvasTargetId } from '@/lib/client/conversationStore';
import { renderMermaid } from '@/lib/diagram/mermaidRenderer';
import { DrawingToolbar } from './DrawingToolbar';

interface Snapshot {
  svg: string;
  viewBox: [number, number, number, number];
}

/**
 * A sketch has nothing to render, so it starts from an empty SVG of the sheet's size. The same
 * markup is what the composite exporter draws the marks onto, so a sketch exports like a diagram.
 */
export const EMPTY_CANVAS_SVG = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function markElement(mark: DrawingMark) {
  const common = { 'data-mark-id': mark.id, stroke: mark.color, strokeWidth: 3, vectorEffect: 'non-scaling-stroke' as const };
  if (mark.kind === 'pen') {
    return <polyline key={mark.id} {...common} points={mark.points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
  }
  if (mark.kind === 'rectangle') {
    return <rect key={mark.id} {...common} x={mark.x} y={mark.y} width={mark.width} height={mark.height} rx={5} fill="none" />;
  }
  if (mark.kind === 'arrow') {
    const angle = Math.atan2(mark.end.y - mark.start.y, mark.end.x - mark.start.x);
    const size = 12;
    const a = { x: mark.end.x - size * Math.cos(angle - Math.PI / 6), y: mark.end.y - size * Math.sin(angle - Math.PI / 6) };
    const b = { x: mark.end.x - size * Math.cos(angle + Math.PI / 6), y: mark.end.y - size * Math.sin(angle + Math.PI / 6) };
    return <path key={mark.id} {...common} d={`M ${mark.start.x} ${mark.start.y} L ${mark.end.x} ${mark.end.y} M ${a.x} ${a.y} L ${mark.end.x} ${mark.end.y} L ${b.x} ${b.y}`} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
  }
  return <text key={mark.id} data-mark-id={mark.id} x={mark.x} y={mark.y} fill={mark.color} fontSize="18" fontWeight="600">{mark.text}</text>;
}

export function DiagramCanvas({
  target,
  initialMarks,
  onMarksChange,
  onSnapshot,
  onArtifactError,
}: {
  target: CanvasTarget;
  initialMarks: DrawingMark[];
  onMarksChange(marks: DrawingMark[]): void;
  onSnapshot(snapshot?: Snapshot): void;
  onArtifactError(status: 'parse-error' | 'render-error', error: string): void;
}) {
  const canvasId = canvasTargetId(target);
  const artifact = target.kind === 'diagram' ? target.artifact : undefined;
  const sketch = target.kind === 'sketch' ? target.sketch : undefined;
  const viewportRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [renderError, setRenderError] = useState<string>();
  const [tool, setTool] = useState<DrawingTool>('pointer');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [state, dispatch] = useReducer(drawingReducer, { marks: initialMarks, past: [], future: [] });
  const gesture = useRef<{ mode: DrawingTool; start: Point; panStart: Point; markId?: string } | undefined>(undefined);
  const color = '#c67139';

  useEffect(() => {
    dispatch({ type: 'reset', marks: initialMarks });
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [canvasId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => onMarksChange(state.marks), [state.marks, onMarksChange]);

  const sketchSheet = sketch?.viewBox.join(' ');
  useEffect(() => {
    let current = true;
    setRenderError(undefined);
    setSnapshot(undefined);
    onSnapshot(undefined);
    if (sketchSheet) {
      // Nothing to render: the sheet is ready the moment it exists.
      const sheet: Snapshot = {
        svg: EMPTY_CANVAS_SVG,
        viewBox: sketchSheet.split(' ').map(Number) as [number, number, number, number],
      };
      setSnapshot(sheet);
      onSnapshot(sheet);
      return;
    }
    if (!artifact || artifact.status !== 'ready') return;
    void renderMermaid(`cartograph-${artifact.id.replaceAll('-', '')}`, artifact.source).then((result) => {
      if (!current) return;
      setSnapshot(result);
      onSnapshot(result);
    }).catch((error: unknown) => {
      if (!current) return;
      const message = error instanceof Error ? error.message.replaceAll(/\s+/g, ' ').slice(0, 300) : 'Mermaid could not render this diagram.';
      setRenderError(message);
      onArtifactError('parse-error', message);
    });
    return () => { current = false; };
  }, [artifact?.id, artifact?.source, artifact?.status, sketchSheet, onArtifactError, onSnapshot]);

  const fit = useCallback(() => {
    if (!snapshot || !viewportRef.current) return;
    const bounds = viewportRef.current.getBoundingClientRect();
    setZoom(Math.max(0.08, Math.min(4, Math.min(bounds.width / snapshot.viewBox[2], bounds.height / snapshot.viewBox[3]) * 0.86)));
    setPan({ x: 0, y: 0 });
  }, [snapshot]);

  useEffect(() => { if (snapshot) fit(); }, [snapshot, fit]);

  useEffect(() => {
    const shortcuts: Record<string, DrawingTool> = { v: 'pointer', h: 'pan', p: 'pen', r: 'rectangle', a: 'arrow', t: 'text', e: 'eraser' };
    const keydown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      } else if (shortcuts[event.key.toLowerCase()]) setTool(shortcuts[event.key.toLowerCase()]);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);

  const pointFromEvent = (event: React.PointerEvent): Point => {
    const bounds = overlayRef.current!.getBoundingClientRect();
    const viewBox = snapshot!.viewBox;
    return {
      x: viewBox[0] + ((event.clientX - bounds.left) / bounds.width) * viewBox[2],
      y: viewBox[1] + ((event.clientY - bounds.top) / bounds.height) * viewBox[3],
      pressure: event.pressure || undefined,
    };
  };

  const pointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!snapshot || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = pointFromEvent(event);
    if (tool === 'eraser') {
      const target = (event.target as SVGElement).closest<SVGElement>('[data-mark-id]');
      const id = target?.dataset.markId;
      if (id) dispatch({ type: 'remove', id });
      return;
    }
    gesture.current = { mode: tool, start, panStart: { x: event.clientX - pan.x, y: event.clientY - pan.y } };
    if (tool === 'pen') {
      const mark: DrawingMark = { id: createUuid(), origin: 'user', color, createdAt: new Date().toISOString(), kind: 'pen', points: [start] };
      gesture.current.markId = mark.id;
      dispatch({ type: 'add', mark });
    }
    if (tool === 'rectangle') {
      const mark: DrawingMark = { id: createUuid(), origin: 'user', color, createdAt: new Date().toISOString(), kind: 'rectangle', x: start.x, y: start.y, width: 0, height: 0 };
      gesture.current.markId = mark.id;
      dispatch({ type: 'add', mark });
    }
    if (tool === 'arrow') {
      const mark: DrawingMark = { id: createUuid(), origin: 'user', color, createdAt: new Date().toISOString(), kind: 'arrow', start, end: start };
      gesture.current.markId = mark.id;
      dispatch({ type: 'add', mark });
    }
  };

  const pointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const current = gesture.current;
    if (!current || !snapshot) return;
    if (current.mode === 'pointer' || current.mode === 'pan') {
      setPan({ x: event.clientX - current.panStart.x, y: event.clientY - current.panStart.y });
      return;
    }
    const point = pointFromEvent(event);
    const existing = state.marks.find((mark) => mark.id === current.markId);
    if (!existing) return;
    if (existing.kind === 'pen') dispatch({ type: 'replace', mark: { ...existing, points: [...existing.points, point].slice(-5_000) } });
    if (existing.kind === 'rectangle') dispatch({
      type: 'replace', mark: { ...existing, x: Math.min(current.start.x, point.x), y: Math.min(current.start.y, point.y), width: Math.abs(point.x - current.start.x), height: Math.abs(point.y - current.start.y) },
    });
    if (existing.kind === 'arrow') dispatch({ type: 'replace', mark: { ...existing, end: point } });
  };

  const pointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    const current = gesture.current;
    gesture.current = undefined;
    if (current?.mode === 'text' && snapshot) {
      const value = window.prompt('Label text');
      if (value?.trim()) dispatch({ type: 'add', mark: {
        id: createUuid(), origin: 'user', color, createdAt: new Date().toISOString(), kind: 'text',
        x: current.start.x, y: current.start.y, text: value.trim().slice(0, 500),
      } });
    }
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  };

  const sceneStyle = snapshot ? {
    width: snapshot.viewBox[2],
    height: snapshot.viewBox[3],
    transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
  } : undefined;
  const cursor = useMemo(() => tool === 'pan' || tool === 'pointer' ? 'grab' : 'crosshair', [tool]);

  if (artifact && (artifact.status !== 'ready' || renderError)) {
    return (
      <div className="diagram-error-state">
        <div><strong>Diagram unavailable</strong><p>{artifact.error || renderError}</p></div>
        <pre>{artifact.source}</pre>
        <button type="button" onClick={() => navigator.clipboard.writeText(artifact.source)}>Copy Mermaid source</button>
      </div>
    );
  }

  return (
    <div className="diagram-canvas-shell">
      <DrawingToolbar
        tool={tool}
        onTool={setTool}
        canUndo={state.past.length > 0}
        canRedo={state.future.length > 0}
        onUndo={() => dispatch({ type: 'undo' })}
        onRedo={() => dispatch({ type: 'redo' })}
        onClear={() => state.marks.length && window.confirm(`Clear all ink from this ${target.kind}?`) && dispatch({ type: 'clear' })}
      />
      <div
        ref={viewportRef}
        className="diagram-viewport"
        onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.max(0.08, Math.min(8, value * (event.deltaY > 0 ? 0.9 : 1.1)))); }}
      >
        {!snapshot && <div className="canvas-loading"><span className="pulse-dot" /> Rendering diagram…</div>}
        {snapshot && (
          <div className="diagram-scene" style={sceneStyle}>
            {sketch
              ? <div className="sketch-sheet" aria-label="Blank sketch sheet" />
              : <div className="mermaid-layer" dangerouslySetInnerHTML={{ __html: snapshot.svg }} />}
            <svg
              ref={overlayRef}
              className="ink-layer"
              viewBox={snapshot.viewBox.join(' ')}
              style={{ cursor }}
              aria-label={`Drawing layer with ${state.marks.length} marks`}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={() => { gesture.current = undefined; }}
            >
              {state.marks.map(markElement)}
            </svg>
          </div>
        )}
      </div>
      <div className="canvas-controls" aria-label="Canvas view controls">
        <button type="button" onClick={() => setZoom((value) => Math.max(0.08, value / 1.2))} aria-label="Zoom out">−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((value) => Math.min(8, value * 1.2))} aria-label="Zoom in">+</button>
        <button type="button" onClick={fit}>Fit</button>
        <button type="button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Reset</button>
        {artifact && <button type="button" onClick={() => download(`diagram-${artifact.ordinal}.mmd`, artifact.source, 'text/plain')}>.mmd</button>}
        <button
          type="button"
          onClick={() => download(
            `${target.kind}-${artifact?.ordinal ?? sketch?.ordinal}-marks.json`,
            JSON.stringify({ version: 1, ...target, marks: state.marks, viewBox: snapshot?.viewBox }, null, 2),
            'application/json',
          )}
        >JSON</button>
      </div>
    </div>
  );
}
