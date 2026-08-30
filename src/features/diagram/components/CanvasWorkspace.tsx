'use client';

import { useCallback, useMemo } from 'react';
import type { ToolActivityEntry } from '@/features/agents/toolActivity';
import type { ThemeName } from '@/shared/design/tokens';
import type { SessionSnapshot, DrawingMark } from '@/shared/types';
import { canvasTargetId, findCanvasTarget, getArtifacts, getSketches } from '@/features/conversation/sessionStore';
import { DiagramCanvas, type CanvasViewState } from './DiagramCanvas';
import { RunRibbon } from './RunRibbon';

export interface CanvasSnapshot {
  svg: string;
  viewBox: [number, number, number, number];
}

export function CanvasWorkspace({
  session,
  theme,
  unread,
  pendingApprovals,
  running,
  runFailed,
  toolActivity,
  focusMode,
  canvasView,
  onComposer,
  onOpenChat,
  onOpenHistory,
  onToggleFocus,
  onSelectDiagram,
  onNewSketch,
  onMarksChange,
  onCanvasViewChange,
  onSnapshot,
  onArtifactError,
}: {
  session: SessionSnapshot;
  theme: ThemeName;
  unread: number;
  pendingApprovals: number;
  running: boolean;
  runFailed: boolean;
  toolActivity: ToolActivityEntry[];
  focusMode: boolean;
  canvasView?: CanvasViewState;
  onComposer(value: string): void;
  onOpenChat(): void;
  onOpenHistory(): void;
  onToggleFocus(): void;
  onSelectDiagram(id: string): void;
  onNewSketch(): void;
  onMarksChange(diagramId: string, marks: DrawingMark[]): void;
  onCanvasViewChange(diagramId: string, view: CanvasViewState): void;
  onSnapshot(snapshot?: CanvasSnapshot): void;
  onArtifactError(id: string, status: 'parse-error' | 'render-error', error: string): void;
}) {
  const artifacts = useMemo(() => getArtifacts(session), [session]);
  const sketches = useMemo(() => getSketches(session), [session]);
  const target = useMemo(() => findCanvasTarget(session, session.activeDiagramId), [session]);
  const activeId = target && canvasTargetId(target);
  const marks = activeId ? session.annotations[activeId]?.marks || [] : [];
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
    if (activeId) onMarksChange(activeId, next);
  }, [activeId, onMarksChange]);
  const handleSnapshot = useCallback((next?: CanvasSnapshot) => onSnapshot(next), [onSnapshot]);
  const handleError = useCallback((statusValue: 'parse-error' | 'render-error', error: string) => {
    if (activeId) onArtifactError(activeId, statusValue, error);
  }, [activeId, onArtifactError]);
  const handleView = useCallback((view: CanvasViewState) => {
    if (activeId) onCanvasViewChange(activeId, view);
  }, [activeId, onCanvasViewChange]);

  return (
    <main id="active-session-view" role="tabpanel" className={`canvas-workspace ${focusMode ? 'focus-mode' : ''} ${target ? 'has-diagram' : 'empty-canvas'}`}>
      <div className="canvas-topbar">
        <div className="canvas-top-actions">
          {session.previousDiagramId && target && (
            <button type="button" onClick={() => onSelectDiagram(session.previousDiagramId!)}>← Previous version</button>
          )}
          {target && <button type="button" onClick={onNewSketch}>New sketch</button>}
          <button type="button" onClick={onOpenHistory}>History <span className="button-count">{artifacts.length + sketches.length}</span></button>
          <button type="button" onClick={onOpenChat}>
            Chat
            {pendingApprovals > 0 && <span className="approval-badge">{pendingApprovals}</span>}
            {unread > 0 && <span className="unread-badge">{unread}</span>}
          </button>
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
        {target ? (
          <DiagramCanvas
            key={activeId}
            target={target}
            theme={theme}
            initialMarks={marks}
            initialView={canvasView}
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
            <strong>{target.kind === 'diagram' ? `Diagram ${target.artifact.ordinal}` : `Sketch ${target.sketch.ordinal}`}</strong>
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
