'use client';

import type { ChatThread, DiagramArtifact } from '@/lib/shared/types';
import { getArtifacts, getSketches } from '@/lib/client/conversationStore';

export function DiagramNavigator({
  open, thread, pendingAttachmentIds, onClose, onSelect, onPin, onToggleAttachment,
}: {
  open: boolean;
  thread: ChatThread;
  pendingAttachmentIds: string[];
  onClose(): void;
  onSelect(id: string): void;
  onPin(id: string): void;
  onToggleAttachment(id: string): void;
}) {
  if (!open) return null;
  const artifacts = getArtifacts(thread);
  const sketches = getSketches(thread);
  const byId = new Map<string, DiagramArtifact>(artifacts.map((item) => [item.id, item]));
  // One list, newest concern first: both kinds share the canvas id space and the same actions.
  const entries = [
    ...artifacts.map((artifact, index) => ({
      id: artifact.id,
      badge: String(index + 1).padStart(2, '0'),
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
          <div className={`navigator-item ${thread.activeDiagramId === entry.id ? 'active' : ''}`} key={entry.id}>
            <button type="button" className="navigator-select" onClick={() => onSelect(entry.id)}>
              <span className="version-number">{entry.badge}</span>
              <span><strong>{entry.title}</strong><small>{new Date(entry.createdAt).toLocaleString()}</small></span>
            </button>
            {entry.lineage && <div className="lineage">{entry.lineage}</div>}
            <div className="navigator-actions">
              <button type="button" onClick={() => onPin(entry.id)}>{thread.pinnedDiagramIds.includes(entry.id) ? 'Unpin' : 'Pin'}</button>
              <button type="button" onClick={() => onToggleAttachment(entry.id)}>{pendingAttachmentIds.includes(entry.id) ? 'Remove attachment' : 'Attach next'}</button>
            </div>
          </div>
        ))}
        {!entries.length && <p>No diagrams or sketches yet.</p>}
      </div>
    </aside>
  );
}
