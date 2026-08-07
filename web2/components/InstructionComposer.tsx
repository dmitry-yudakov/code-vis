'use client';

import { useEffect, useRef } from 'react';
import type { AgentMode, DiagramArtifact } from '@/lib/shared/types';
import { AGENT_MODE_HINTS, AGENT_MODE_LABELS, AGENT_MODE_TOOLTIPS } from '@/lib/client/toolActivity';

const MODES: AgentMode[] = ['ask', 'plan', 'agent'];

export function InstructionComposer({
  value, running, autoFocus, attached, activeDiagramId, markCounts, mode, unsupportedModes,
  onChange, onModeChange, onSend, onCancel, onRemoveAttachment,
}: {
  value: string;
  running: boolean;
  autoFocus?: boolean;
  attached: DiagramArtifact[];
  activeDiagramId?: string;
  markCounts: Record<string, number>;
  mode: AgentMode;
  unsupportedModes: AgentMode[];
  onChange(value: string): void;
  onModeChange(mode: AgentMode): void;
  onSend(): void;
  onCancel(): void;
  onRemoveAttachment(id: string): void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  useEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, 260)}px`;
  }, [value]);
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
      <div className="composer-actions">
        <div className={`mode-selector mode-${mode}`} role="radiogroup" aria-label="Agent mode">
          {MODES.map((item) => {
            const unsupported = unsupportedModes.includes(item);
            return (
              <button
                key={item}
                type="button"
                role="radio"
                aria-checked={mode === item}
                className={mode === item ? 'active' : ''}
                disabled={running || unsupported}
                title={unsupported ? `${AGENT_MODE_LABELS[item]} needs a newer Claude Code. Run \`claude update\`.` : AGENT_MODE_TOOLTIPS[item]}
                onClick={() => onModeChange(item)}
              >
                {AGENT_MODE_LABELS[item]}
              </button>
            );
          })}
        </div>
        <span className="composer-hint">{AGENT_MODE_HINTS[mode]}</span>
        <button
          type="button"
          className={running ? 'cancel-button' : 'send-button'}
          aria-label={running ? 'Cancel' : 'Send'}
          title={running ? 'Cancel the running turn' : 'Send'}
          disabled={!running && !value.trim()}
          onClick={running ? onCancel : onSend}
        >
          <span aria-hidden="true">{running ? '■' : '↑'}</span>
        </button>
      </div>
    </div>
  );
}
