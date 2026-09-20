'use client';

import type { ThemeName } from '@/shared/design/tokens';
import type { SessionSnapshot, DiagramArtifact } from '@/shared/types';
import { getArtifacts, getSketches } from '@/features/conversation/sessionStore';
import { CanvasThumbnail } from './CanvasThumbnail';

// Seconds never tell a reader which canvas is which, and the full locale string spends the card's
// whole second line saying it.
function formatCreated(createdAt: string): string {
  return new Date(createdAt).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/** The History tab of the side panel: every canvas of the session, oldest first. */
export function DiagramNavigator({
  session, theme, pendingAttachmentIds, onSelect, onPin, onToggleAttachment,
}: {
  session: SessionSnapshot;
  theme: ThemeName;
  pendingAttachmentIds: string[];
  onSelect(id: string): void;
  onPin(id: string): void;
  onToggleAttachment(id: string): void;
}) {
  const artifacts = getArtifacts(session);
  const sketches = getSketches(session);
  const byId = new Map<string, DiagramArtifact>(artifacts.map((item) => [item.id, item]));
  // One chronological list: both kinds share the canvas id space and the same actions. The picture
  // tells two canvases apart where "Diagram 1 … Diagram 1" cannot; the badge stands in for a
  // diagram that has not rendered, or cannot.
  const entries = [
    ...artifacts.map((artifact) => ({
      id: artifact.id,
      artifact,
      sketch: undefined,
      badge: '◇',
      title: `Diagram ${artifact.ordinal}`,
      createdAt: artifact.createdAt,
      lineage: artifact.derivedFromDiagramIds.length > 0
        ? `from ${artifact.derivedFromDiagramIds.map((id) => {
          const parent = byId.get(id);
          return parent ? `v${artifacts.indexOf(parent) + 1}` : 'attached canvas';
        }).join(', ')}`
        : undefined,
    })),
    ...sketches.map((sketch) => ({
      id: sketch.id,
      artifact: undefined,
      sketch,
      badge: '✎',
      title: `Sketch ${sketch.ordinal}`,
      createdAt: sketch.createdAt,
      lineage: 'drawn by you',
    })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <div className="navigator-list">
      {entries.map((entry) => (
        <div className={`navigator-item ${session.activeDiagramId === entry.id ? 'active' : ''}`} key={entry.id}>
          <button type="button" className="navigator-select" onClick={() => onSelect(entry.id)}>
            <CanvasThumbnail
              artifact={entry.artifact}
              sketch={entry.sketch}
              marks={session.annotations[entry.id]?.marks || []}
              theme={theme}
              fallback={entry.badge}
            />
            <span><strong>{entry.title}</strong><small>{formatCreated(entry.createdAt)}</small></span>
          </button>
          {entry.lineage && <div className="lineage">{entry.lineage}</div>}
          <div className="navigator-actions">
            <button type="button" onClick={() => onPin(entry.id)}>{session.pinnedDiagramIds.includes(entry.id) ? 'Unpin' : 'Pin'}</button>
            <button type="button" onClick={() => onToggleAttachment(entry.id)}>{pendingAttachmentIds.includes(entry.id) ? 'Remove attachment' : 'Attach next'}</button>
          </div>
        </div>
      ))}
      {!entries.length && <p>No diagrams or sketches yet.</p>}
    </div>
  );
}
