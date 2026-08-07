'use client';

import { useCallback, useMemo, useState } from 'react';
import type { ChatThread, DrawingMark } from '@/lib/shared/types';
import { getArtifacts } from '@/lib/client/conversationStore';
import { DiagramCanvas } from './DiagramCanvas';

export interface CanvasSnapshot {
  svg: string;
  viewBox: [number, number, number, number];
}

export function CanvasWorkspace({
  thread,
  running,
  status,
  unread,
  pendingApprovals,
  markCount,
  onComposer,
  onOpenChat,
  onOpenHistory,
  onSelectDiagram,
  onMarksChange,
  onSnapshot,
  onArtifactError,
}: {
  thread: ChatThread;
  running: boolean;
  status: string;
  unread: number;
  pendingApprovals: number;
  markCount: number;
  onComposer(value: string): void;
  onOpenChat(): void;
  onOpenHistory(): void;
  onSelectDiagram(id: string): void;
  onMarksChange(diagramId: string, marks: DrawingMark[]): void;
  onSnapshot(snapshot?: CanvasSnapshot): void;
  onArtifactError(id: string, status: 'parse-error' | 'render-error', error: string): void;
}) {
  const [focusMode, setFocusMode] = useState(false);
  const artifacts = useMemo(() => getArtifacts(thread), [thread]);
  const active = artifacts.find((artifact) => artifact.id === thread.activeDiagramId);
  const marks = active ? thread.annotations[active.id]?.marks || [] : [];
  const handleMarks = useCallback((next: DrawingMark[]) => {
    if (active) onMarksChange(active.id, next);
  }, [active?.id, onMarksChange]);
  const handleSnapshot = useCallback((next?: CanvasSnapshot) => onSnapshot(next), [onSnapshot]);
  const handleError = useCallback((statusValue: 'parse-error' | 'render-error', error: string) => {
    if (active) onArtifactError(active.id, statusValue, error);
  }, [active?.id, onArtifactError]);

  return (
    <main className={`canvas-workspace ${focusMode ? 'focus-mode' : ''} ${active ? 'has-diagram' : 'empty-canvas'}`}>
      <div className="canvas-topbar">
        <div className="canvas-context">
          {active ? (
            <>
              <span className="canvas-kicker">Active canvas</span>
              <strong>Diagram {artifacts.indexOf(active) + 1} of {artifacts.length}</strong>
              {active.derivedFromDiagramIds.length > 0 && <span className="lineage-pill">derived revision</span>}
            </>
          ) : <><span className="canvas-kicker">Project canvas</span><strong>No diagram yet</strong></>}
        </div>
        <div className="canvas-top-actions">
          {thread.previousDiagramId && active && (
            <button type="button" onClick={() => onSelectDiagram(thread.previousDiagramId!)}>← Previous version</button>
          )}
          <button type="button" onClick={onOpenHistory}>History <span className="button-count">{artifacts.length}</span></button>
          <button type="button" onClick={onOpenChat}>
            Chat
            {pendingApprovals > 0 && <span className="approval-badge">{pendingApprovals}</span>}
            {unread > 0 && <span className="unread-badge">{unread}</span>}
          </button>
          <button type="button" onClick={() => setFocusMode((value) => !value)}>{focusMode ? 'Exit focus' : 'Focus'}</button>
        </div>
      </div>

      <div className="canvas-stage">
        {active ? (
          <DiagramCanvas
            key={active.id}
            artifact={active}
            initialMarks={marks}
            onMarksChange={handleMarks}
            onSnapshot={handleSnapshot}
            onArtifactError={handleError}
          />
        ) : (
          <div className="empty-canvas-content">
            <div className="empty-mark">C</div>
            <p className="eyebrow">Conversational code canvas</p>
            <h1>Start with a question.<br />Let the map emerge.</h1>
            <p>Claude can read and search this repository, explain it in prose, or create a Mermaid diagram when a visual would help.</p>
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
      </div>

      <button
        type="button"
        className={`canvas-ask ${running ? 'working' : ''} ${pendingApprovals > 0 ? 'awaiting-approval' : ''}`}
        aria-label={pendingApprovals > 0
          ? `${pendingApprovals} action${pendingApprovals === 1 ? '' : 's'} waiting for your approval. Open conversation`
          : running ? `Agent working: ${status}. Open conversation` : 'Open conversation'}
        onClick={onOpenChat}
      >
        <span className="canvas-ask-dot" aria-hidden="true" />
        <span className="canvas-ask-label">
          {pendingApprovals > 0
            ? `${pendingApprovals} approval${pendingApprovals === 1 ? '' : 's'} pending`
            : running ? status || 'Working…' : 'Ask Claude…'}
        </span>
        {!running && active && <span className="canvas-ask-chip">diagram attached · {markCount} marks</span>}
        {pendingApprovals > 0 && <span className="approval-badge">{pendingApprovals}</span>}
        {unread > 0 && <span className="unread-badge">{unread}</span>}
      </button>
    </main>
  );
}
