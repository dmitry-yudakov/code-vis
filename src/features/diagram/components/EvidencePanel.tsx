'use client';

import { Disclosure } from '@/features/shell/Disclosure';
import Button from '@mui/material/Button';

import type { EvidenceResult } from '@/shared/types';

const LABELS: Record<EvidenceResult['status'], string> = {
  observed: 'Observed location exists',
  inferred: 'Inferred from location',
  invalid: 'Invalid evidence',
  'missing-file': 'Invalid evidence',
  'outside-repository': 'Invalid evidence',
  'invalid-range': 'Invalid evidence',
};

export function EvidencePanel({ evidence }: { evidence: EvidenceResult[] }) {
  if (!evidence.length) return <div className="evidence-empty">No evidence · agent-generated/unverified</div>;
  return (
    <Disclosure className="evidence-panel" title={<>{evidence.length} evidence {evidence.length === 1 ? 'reference' : 'references'}</>}>

      <div>
        {evidence.map((item, index) => (
          <div className={`evidence-item ${item.status}`} key={`${item.elementId}-${index}`}>
            <span>{LABELS[item.status]}</span>
            {item.path && item.startLine && (
              <Button
                type="button" onClick={() => navigator.clipboard.writeText(`${item.path}:${item.startLine}${item.endLine !== item.startLine ? `-${item.endLine}` : ''}`)} title="Copy repository-relative location"
              >
                {item.path}:{item.startLine}{item.endLine !== item.startLine ? `–${item.endLine}` : ''}
              </Button>
            )}
            <small>{item.message}</small>
          </div>
        ))}
      </div>
    </Disclosure>
  );
}
