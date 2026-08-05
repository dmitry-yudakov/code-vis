'use client';

import type { ChatThread, DiagramArtifact } from '@/lib/shared/types';
import { getArtifacts } from '@/lib/client/conversationStore';

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
  const byId = new Map<string, DiagramArtifact>(artifacts.map((item) => [item.id, item]));
  return (
    <aside className="diagram-navigator" aria-label="Diagram history">
      <header><div><span className="eyebrow">Diagram history</span><strong>{artifacts.length} immutable versions</strong></div><button type="button" onClick={onClose}>×</button></header>
      <div className="navigator-list">
        {artifacts.map((artifact, index) => (
          <div className={`navigator-item ${thread.activeDiagramId === artifact.id ? 'active' : ''}`} key={artifact.id}>
            <button type="button" className="navigator-select" onClick={() => onSelect(artifact.id)}>
              <span className="version-number">{String(index + 1).padStart(2, '0')}</span>
              <span><strong>Diagram {artifact.ordinal}</strong><small>{new Date(artifact.createdAt).toLocaleString()}</small></span>
            </button>
            {artifact.derivedFromDiagramIds.length > 0 && (
              <div className="lineage">from {artifact.derivedFromDiagramIds.map((id) => {
                const parent = byId.get(id);
                return parent ? `v${artifacts.indexOf(parent) + 1}` : 'attached diagram';
              }).join(', ')}</div>
            )}
            <div className="navigator-actions">
              <button type="button" onClick={() => onPin(artifact.id)}>{thread.pinnedDiagramIds.includes(artifact.id) ? 'Unpin' : 'Pin'}</button>
              <button type="button" onClick={() => onToggleAttachment(artifact.id)}>{pendingAttachmentIds.includes(artifact.id) ? 'Remove attachment' : 'Attach next'}</button>
            </div>
          </div>
        ))}
        {!artifacts.length && <p>No diagrams yet.</p>}
      </div>
    </aside>
  );
}
