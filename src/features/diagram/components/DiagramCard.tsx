'use client';

import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Paper from '@mui/material/Paper';

import { useEffect, useState } from 'react';
import type { ThemeName } from '@/shared/design/tokens';
import type { DiagramArtifact } from '@/shared/types';
import { renderMermaid } from '@/features/diagram/mermaid/mermaidRenderer';
import { EvidencePanel } from './EvidencePanel';

export function DiagramCard({ artifact, active, theme, onSelect }: {
  artifact: DiagramArtifact;
  active: boolean;
  theme: ThemeName;
  onSelect(): void;
}) {
  const [svg, setSvg] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let current = true;
    setSvg(undefined);
    setError(undefined);
    if (artifact.status !== 'ready') return;
    void renderMermaid(`card-${artifact.id.replaceAll('-', '')}`, artifact.source, theme).then((result) => {
      if (current) setSvg(result.svg);
    }).catch((reason: unknown) => {
      if (current) setError(reason instanceof Error ? reason.message.slice(0, 200) : 'Render failed');
    });
    return () => { current = false; };
  }, [artifact.id, artifact.source, artifact.status, theme]);

  return (
    <Paper component="section" className={`diagram-card ${active ? 'active' : ''}`}>
      <ButtonBase type="button" className="diagram-card-preview" onClick={onSelect}>
        <span className="diagram-card-label">Diagram {artifact.ordinal}{active ? ' · active' : ''}</span>
        {svg && <span className="diagram-card-svg" data-mermaid-theme={theme} dangerouslySetInnerHTML={{ __html: svg }} />}
        {!svg && !error && artifact.status === 'ready' && <span className="card-loading">Rendering…</span>}
        {(error || artifact.status !== 'ready') && (
          <span className="diagram-card-error">{artifact.error || error || 'Diagram unavailable'}</span>
        )}
      </ButtonBase>
      <div className="diagram-card-actions">
        <Button type="button" onClick={onSelect}>Open on canvas</Button>
        <Button type="button" onClick={() => navigator.clipboard.writeText(artifact.source)}>Copy source</Button>
      </div>
      <EvidencePanel evidence={artifact.evidence} />
    </Paper>
  );
}
