'use client';

import { useEffect, useState } from 'react';
import type { DiagramArtifact } from '@/lib/shared/types';
import { renderMermaid } from '@/lib/diagram/mermaidRenderer';
import { EvidencePanel } from './EvidencePanel';

export function DiagramCard({ artifact, active, onSelect }: {
  artifact: DiagramArtifact;
  active: boolean;
  onSelect(): void;
}) {
  const [svg, setSvg] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let current = true;
    if (artifact.status !== 'ready') return;
    void renderMermaid(`card-${artifact.id.replaceAll('-', '')}`, artifact.source).then((result) => {
      if (current) setSvg(result.svg);
    }).catch((reason: unknown) => {
      if (current) setError(reason instanceof Error ? reason.message.slice(0, 200) : 'Render failed');
    });
    return () => { current = false; };
  }, [artifact.id, artifact.source, artifact.status]);

  return (
    <section className={`diagram-card ${active ? 'active' : ''}`}>
      <button type="button" className="diagram-card-preview" onClick={onSelect}>
        <span className="diagram-card-label">Diagram {artifact.ordinal}{active ? ' · active' : ''}</span>
        {svg && <span className="diagram-card-svg" dangerouslySetInnerHTML={{ __html: svg }} />}
        {!svg && !error && artifact.status === 'ready' && <span className="card-loading">Rendering…</span>}
        {(error || artifact.status !== 'ready') && (
          <span className="diagram-card-error">{artifact.error || error || 'Diagram unavailable'}</span>
        )}
      </button>
      <div className="diagram-card-actions">
        <button type="button" onClick={onSelect}>Open on canvas</button>
        <button type="button" onClick={() => navigator.clipboard.writeText(artifact.source)}>Copy source</button>
      </div>
      <EvidencePanel evidence={artifact.evidence} />
    </section>
  );
}
