'use client';

import { useEffect, useRef } from 'react';
import type { AgentMode, CanvasTarget } from '@/shared/types';
import { canvasTargetId } from '@/features/conversation/sessionStore';
import { AGENT_MODE_HINTS, AGENT_MODE_LABELS, AGENT_MODE_TOOLTIPS } from '@/features/agents/toolActivity';

const MODES: AgentMode[] = ['ask', 'plan', 'agent'];

export function InstructionComposer({
  value, running, cancelReady = true, turnBlocked, autoFocus, attached, activeDiagramId, markCounts, mode, unsupportedModes,
  onChange, onModeChange, onSend, onCancel, onRemoveAttachment,
}: {
  value: string;
  running: boolean;
  cancelReady?: boolean;
  turnBlocked?: boolean;
  autoFocus?: boolean;
  attached: CanvasTarget[];
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
  // A drawing is an instruction in itself, so a sketch turn does not need typed text.
  const canSend = Boolean(value.trim()) || attached.some((canvas) => canvas.kind === 'sketch');
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
        <div className="attachment-chips" aria-label="Canvas attachments">
          {attached.map((canvas) => {
            const id = canvasTargetId(canvas);
            const label = canvas.kind === 'sketch'
              ? 'Your sketch'
              : id === activeDiagramId ? 'Active diagram' : 'Additional diagram';
            const marks = markCounts[id] || 0;
            return (
              <span className={`attachment-chip ${canvas.kind}`} key={id}>
                <span>{label} included{marks > 0 ? ` · ${marks} ${marks === 1 ? 'mark' : 'marks'}` : ''}</span>
                <button type="button" aria-label={`Remove ${canvas.kind} attachment`} onClick={() => onRemoveAttachment(id)}>×</button>
              </span>
            );
          })}
        </div>
      )}
      <textarea
        ref={ref}
        value={value}
        disabled={running}
        rows={1}
        maxLength={8_000}
        placeholder={attached.some((canvas) => canvas.kind === 'sketch')
          ? 'Describe what you drew, or just send the sketch…'
          : attached.length ? 'Ask about or revise the attached diagram…' : 'Ask anything about this project…'}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (canSend && !running) onSend();
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
          title={running ? cancelReady ? 'Cancel the active turn' : 'Waiting for the run to be accepted' : 'Send'}
          disabled={running ? !cancelReady : turnBlocked || !canSend}
          onClick={running ? onCancel : onSend}
        >
          <span aria-hidden="true">{running ? '■' : '↑'}</span>
        </button>
      </div>
    </div>
  );
}
