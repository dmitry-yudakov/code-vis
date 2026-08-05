'use client';

import { useRef } from 'react';
import type { DiagramArtifact } from '@/lib/shared/types';

export function InstructionComposer({
  value, running, attached, activeDiagramId, markCounts, onChange, onSend, onCancel, onRemoveAttachment,
}: {
  value: string;
  running: boolean;
  attached: DiagramArtifact[];
  activeDiagramId?: string;
  markCounts: Record<string, number>;
  onChange(value: string): void;
  onSend(): void;
  onCancel(): void;
  onRemoveAttachment(id: string): void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="instruction-composer">
      {attached.length > 0 && (
        <div className="attachment-chips" aria-label="Diagram attachments">
          {attached.map((artifact) => (
            <span className="attachment-chip" key={artifact.id}>
              <span>{artifact.id === activeDiagramId ? 'Active diagram' : 'Additional diagram'} included · {markCounts[artifact.id] || 0} marks</span>
              <button type="button" aria-label="Remove diagram attachment" onClick={() => onRemoveAttachment(artifact.id)}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="composer-row">
        <textarea
          ref={ref}
          value={value}
          disabled={running}
          rows={1}
          maxLength={8_000}
          placeholder={attached.length ? 'Ask about or revise the attached diagram…' : 'Ask anything about this project…'}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (value.trim() && !running) onSend();
            }
          }}
        />
        <button type="button" className={running ? 'cancel-button' : 'send-button'} disabled={!running && !value.trim()} onClick={running ? onCancel : onSend}>
          {running ? 'Cancel' : 'Send'}
        </button>
      </div>
      <div className="composer-hint">Enter to send · Shift+Enter for a new line · read-only agent</div>
    </div>
  );
}
