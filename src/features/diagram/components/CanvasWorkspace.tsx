'use client';

import { useCallback, useEffect, useMemo } from 'react';
import type { ToolActivityEntry } from '@/features/agents/toolActivity';
import type { ThemeName } from '@/shared/design/tokens';
import type { SessionSnapshot, DrawingMark } from '@/shared/types';
import { canvasTargetId, findCanvasTarget, getArtifacts } from '@/features/conversation/sessionStore';
import { DiagramCanvas, type CanvasViewState, type DrawingCanvasTarget } from './DiagramCanvas';
import { RunRibbon } from './RunRibbon';
import type { PendingImage } from '@/features/conversation/imageAttachments';
import { SpatialBoundary } from '@/features/diagram/spatial/SpatialBoundary';
import type { CanvasSurface, SpatialViewState } from '@/features/shell/workspaceViews';

export interface CanvasSnapshot {
  svg: string;
  viewBox: [number, number, number, number];
}

export function CanvasWorkspace({
  session,
  image,
  imageNumber,
  onCloseImage,
  onImageMarksChange,
  hidden = false,
  theme,
  pendingApprovals,
  running,
  runFailed,
  toolActivity,
  focusMode,
  immersiveActive,
  canvasView,
  surface,
  spatial,
  onComposer,
  onOpenChat,
  onToggleFocus,
  onSelectDiagram,
  onNewSketch,
  onMarksChange,
  onCanvasViewChange,
  onSurfaceChange,
  onSpatialChange,
  onResetSpatial,
  onSnapshot,
  onArtifactError,
}: {
  session: SessionSnapshot;
  image?: PendingImage;
  imageNumber?: number;
  onCloseImage(): void;
  onImageMarksChange(id: string, marks: DrawingMark[]): void;
  /** The user hid the canvas: its tab panel stays, empty, and the canvas mounts afresh on return. */
  hidden?: boolean;
  theme: ThemeName;
  pendingApprovals: number;
  running: boolean;
  runFailed: boolean;
  toolActivity: ToolActivityEntry[];
  focusMode: boolean;
  immersiveActive: boolean;
  canvasView?: CanvasViewState;
  surface: CanvasSurface;
  spatial?: SpatialViewState;
  onComposer(value: string): void;
  onOpenChat(): void;
  onToggleFocus(): void;
  onSelectDiagram(id: string): void;
  onNewSketch(): void;
  onMarksChange(diagramId: string, marks: DrawingMark[]): void;
  onCanvasViewChange(diagramId: string, view: CanvasViewState): void;
  onSurfaceChange(surface: CanvasSurface): void;
  onSpatialChange(spatial: SpatialViewState): void;
  onResetSpatial(): void;
  onSnapshot(snapshot?: CanvasSnapshot): void;
  onArtifactError(id: string, status: 'parse-error' | 'render-error', error: string): void;
}) {
  const artifacts = useMemo(() => getArtifacts(session), [session]);
  const durableTarget = useMemo(() => findCanvasTarget(session, session.activeDiagramId), [session]);
  const target: DrawingCanvasTarget | undefined = image ? { kind: 'image', image } : durableTarget;
  const imageId = image?.id;
  const activeId = target?.kind === 'image' ? target.image.id : target && canvasTargetId(target);
  const marks = image ? image.marks || [] : activeId ? session.annotations[activeId]?.marks || [] : [];
  const artifactOrdinals = useMemo(
    () => new Map(artifacts.map((artifact) => [artifact.id, artifact.ordinal])),
    [artifacts],
  );
  const lineage = target?.kind === 'diagram'
    ? target.artifact.derivedFromDiagramIds
      .map((id) => artifactOrdinals.get(id))
      .filter((ordinal): ordinal is number => ordinal !== undefined)
    : [];
  const handleMarks = useCallback((next: DrawingMark[]) => {
    if (imageId) onImageMarksChange(imageId, next);
    else if (activeId) onMarksChange(activeId, next);
  }, [activeId, imageId, onImageMarksChange, onMarksChange]);
  // A pending image's frame must never be used to export the durable active sketch.
  const handleSnapshot = useCallback((next?: CanvasSnapshot) => onSnapshot(imageId ? undefined : next), [imageId, onSnapshot]);
  const handleError = useCallback((statusValue: 'parse-error' | 'render-error', error: string) => {
    if (activeId) onArtifactError(activeId, statusValue, error);
  }, [activeId, onArtifactError]);
  const handleView = useCallback((view: CanvasViewState) => {
    if (activeId && !imageId) onCanvasViewChange(activeId, view);
  }, [activeId, imageId, onCanvasViewChange]);

  useEffect(() => {
    if (surface === 'spatial') onSnapshot(undefined);
  }, [onSnapshot, surface]);

  // Unmounted rather than hidden, so its drawing shortcuts cannot act unseen and a fitted view
  // fits the canvas it returns to.
  if (hidden) return <main id="active-session-view" role="tabpanel" className="canvas-workspace" hidden />;

  return (
    <main id="active-session-view" role="tabpanel" className={`canvas-workspace ${focusMode ? 'focus-mode' : ''} ${target ? 'has-diagram' : 'empty-canvas'}`}>
      <div className="canvas-topbar">
        {target && !image && (
          <div className="canvas-surface-control" role="group" aria-label="Canvas surface">
            <button type="button" aria-pressed={surface === 'flat'} onClick={() => onSurfaceChange('flat')}>Flat</button>
            <button type="button" aria-pressed={surface === 'spatial'} onClick={() => onSurfaceChange('spatial')}>Spatial</button>
          </div>
        )}
        <div className="canvas-top-actions">
          {image && <button type="button" onClick={onCloseImage}>Back to canvas</button>}
          {session.previousDiagramId && target && !image && (
            <button type="button" onClick={() => onSelectDiagram(session.previousDiagramId!)}>← Previous version</button>
          )}
          {target && <button type="button" onClick={onNewSketch}>New sketch</button>}
          <button type="button" onClick={onToggleFocus}>{focusMode ? 'Exit focus' : 'Focus'}</button>
        </div>
      </div>

      <div className="canvas-stage">
        <RunRibbon
          running={running}
          failed={runFailed}
          pendingApprovals={pendingApprovals}
          activity={toolActivity}
        />
        {target && activeId && !image && surface === 'spatial' ? (
          immersiveActive ? <div className="spatial-status">Canvas open in VR</div> : <SpatialBoundary
            session={session}
            theme={theme}
            activeId={activeId}
            spatial={spatial}
            onSelect={onSelectDiagram}
            onOpenFlat={() => onSurfaceChange('flat')}
            onViewChange={onSpatialChange}
            onReset={onResetSpatial}
            onFailure={() => undefined}
          />
        ) : target ? (
          <DiagramCanvas
            key={activeId}
            target={target}
            readOnly={Boolean(image && running)}
            theme={theme}
            initialMarks={marks}
            initialView={image ? undefined : canvasView}
            onMarksChange={handleMarks}
            onViewChange={handleView}
            onSnapshot={handleSnapshot}
            onArtifactError={handleError}
          />
        ) : (
          <div className="empty-canvas-content">
            <div className="empty-mark">C</div>
            <p className="eyebrow">Conversational code canvas</p>
            <h1>Start with a question.<br />Or draw what you mean.</h1>
            <p>Claude can read and search this repository, explain it in prose, or create a Mermaid diagram when a visual would help. You can also sketch first and send the drawing as the instruction.</p>
            <button type="button" className="primary-cta sketch-cta" onClick={onNewSketch}>Start a sketch <span>✎</span></button>
            <div className="quick-prompts">
              {[
                'Map the architecture of this project',
                'Visualize working changes',
                'Visualize staged changes',
                'Visualize the last commit',
              ].map((prompt) => (
                <button type="button" key={prompt} onClick={() => { onComposer(prompt); onOpenChat(); }}>{prompt}<span>↗</span></button>
              ))}
            </div>
          </div>
        )}
        {target && (
          <div className="canvas-titleblock">
            <strong>{target.kind === 'image' ? `Image ${imageNumber}` : target.kind === 'diagram' ? `Diagram ${target.artifact.ordinal}` : `Sketch ${target.sketch.ordinal}`}</strong>
            {lineage.length > 0 && (
              <span>derived from {lineage.length === 1 ? 'Diagram' : 'Diagrams'} {lineage.join(', ')}</span>
            )}
            {marks.length > 0 && <span>{marks.length} {marks.length === 1 ? 'mark' : 'marks'}</span>}
          </div>
        )}
      </div>

    </main>
  );
}
