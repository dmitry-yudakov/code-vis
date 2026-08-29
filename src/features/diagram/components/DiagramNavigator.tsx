'use client';

import type { SessionSnapshot, DiagramArtifact } from '@/shared/types';
import { getArtifacts, getSketches } from '@/features/conversation/sessionStore';

// Seconds never tell a reader which canvas is which, and the full locale string spends the card's
// whole second line saying it.
function formatCreated(createdAt: string): string {
  return new Date(createdAt).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function DiagramNavigator({
  open, session, pendingAttachmentIds, onClose, onSelect, onPin, onToggleAttachment,
}: {
  open: boolean;
  session: SessionSnapshot;
  pendingAttachmentIds: string[];
  onClose(): void;
  onSelect(id: string): void;
  onPin(id: string): void;
  onToggleAttachment(id: string): void;
}) {
  if (!open) return null;
  const artifacts = getArtifacts(session);
  const sketches = getSketches(session);
  const byId = new Map<string, DiagramArtifact>(artifacts.map((item) => [item.id, item]));
  // One list, newest concern first: both kinds share the canvas id space and the same actions.
  // The badge marks which kind a card is. It used to be a running 01…05 taken from the artifact's
  // position, which sat beside titles reading "Diagram 1 … Diagram 1" and numbered an order the
  // list does not have — the cards are chronological, and each already names its own ordinal.
  const entries = [
    ...artifacts.map((artifact) => ({
      id: artifact.id,
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
      badge: '✎',
      title: `Sketch ${sketch.ordinal}`,
      createdAt: sketch.createdAt,
      lineage: 'drawn by you',
    })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <aside className="diagram-navigator" aria-label="Canvas history">
      <header>
        <div>
          <span className="eyebrow">Canvas history</span>
          <strong>{entries.length} canvas{entries.length === 1 ? '' : 'es'}</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="Close canvas history">×</button>
      </header>
      <div className="navigator-list">
        {entries.map((entry) => (
          <div className={`navigator-item ${session.activeDiagramId === entry.id ? 'active' : ''}`} key={entry.id}>
            <button type="button" className="navigator-select" onClick={() => onSelect(entry.id)}>
              <span className="version-number">{entry.badge}</span>
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
    </aside>
  );
}
