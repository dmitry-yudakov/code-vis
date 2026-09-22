'use client';

import { useEffect, useRef } from 'react';
import type { AgentExecution, AgentMode, CanvasTarget, ModelChoices, ModelSelection } from '@/shared/types';
import { canvasTargetId } from '@/features/conversation/sessionStore';
import { AGENT_MODE_HINTS, AGENT_MODE_LABELS, AGENT_MODE_TOOLTIPS, effortLabel } from '@/features/agents/toolActivity';
import { useMenuDismiss } from '@/features/agents/useMenuDismiss';
import { offeredEfforts, offeredModelSelection } from '@/shared/modelChoices';

const MODES: AgentMode[] = ['ask', 'plan', 'agent'];

const DEFAULT_MODEL_TITLE = 'No override. A machine that sets a default model sends it; otherwise a new agent starts on the provider default and an agent that already ran keeps its last model.';
const DEFAULT_EFFORT_TITLE = 'No override. A new agent starts on the model default; an agent that already ran keeps its last effort.';

/** The model and effort the machine lists for the addressed agent's provider. Absent when it lists none. */
function ModelMenu({ choices, selection, disabled, onChange }: {
  choices?: ModelChoices;
  selection: ModelSelection;
  disabled: boolean;
  onChange(selection: ModelSelection): void;
}) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  useMenuDismiss(menuRef);
  // A turn streams in just above the composer, so a running turn closes the menu.
  useEffect(() => {
    if (disabled) menuRef.current?.removeAttribute('open');
  }, [disabled]);
  const models = choices?.models ?? [];
  if (!models.length && !choices?.efforts?.length) return null;
  const efforts = offeredEfforts(choices, selection.model);
  const modelLabel = models.find((item) => item.id === selection.model)?.label ?? 'Default';
  const label = selection.effort ? `${modelLabel} · ${effortLabel(selection.effort)}` : modelLabel;
  // Offered-only: a model that does not allow the current effort resets it to Default.
  const choose = (next: ModelSelection) => onChange(offeredModelSelection(next, choices));
  const option = (key: string, label: string, checked: boolean, title: string | undefined, next: ModelSelection) => (
    <button key={key} type="button" role="radio" aria-checked={checked} className={checked ? 'active' : ''}
      disabled={disabled} title={title} onClick={() => choose(next)}>{label}</button>
  );
  return (
    <details ref={menuRef} className="model-menu">
      <summary aria-disabled={disabled || undefined} title={`Model and effort for this agent's next turn: ${label}`}
        onClick={disabled ? (event) => event.preventDefault() : undefined}>
        {label}
      </summary>
      <div>
        <span>Model</span>
        <div role="radiogroup" aria-label="Model">
          {option(':default', 'Default', !selection.model, DEFAULT_MODEL_TITLE, { effort: selection.effort })}
          {models.map((item) => option(item.id, item.label, selection.model === item.id, undefined, { model: item.id, effort: selection.effort }))}
        </div>
        {efforts.length > 0 && <>
          <span>Effort</span>
          <div role="radiogroup" aria-label="Effort">
            {option(':default', 'Default', !selection.effort, DEFAULT_EFFORT_TITLE, { model: selection.model })}
            {efforts.map((effort) => option(effort, effortLabel(effort), selection.effort === effort, undefined, { model: selection.model, effort }))}
          </div>
        </>}
      </div>
    </details>
  );
}

export function InstructionComposer({
  value, running, cancelReady = true, turnBlocked, autoFocus, attached, activeDiagramId, markCounts, mode, unsupportedModes,
  modelChoices, modelSelection, onChange, onModeChange, onModelSelectionChange, onSend, onCancel, onRemoveAttachment, execution = 'local',
}: {
  value: string;
  execution?: AgentExecution;
  running: boolean;
  cancelReady?: boolean;
  turnBlocked?: boolean;
  autoFocus?: boolean;
  attached: CanvasTarget[];
  activeDiagramId?: string;
  markCounts: Record<string, number>;
  mode: AgentMode;
  unsupportedModes: AgentMode[];
  /** Server-owned choices for the addressed agent's provider on the executing machine. */
  modelChoices?: ModelChoices;
  /** Already reduced to what the provider lists. */
  modelSelection: ModelSelection;
  onChange(value: string): void;
  onModeChange(mode: AgentMode): void;
  onModelSelectionChange(selection: ModelSelection): void;
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
                title={unsupported ? `${AGENT_MODE_LABELS[item]} is unavailable for this provider and execution. Check provider setup.`
                  : execution === 'docker' ? item === 'agent'
                    ? 'Agent edits the mounted repository and runs commands without individual approvals.'
                    : 'The repository is mounted read-only; writable scratch space is available inside Docker.'
                    : AGENT_MODE_TOOLTIPS[item]}
                onClick={() => onModeChange(item)}
              >
                {AGENT_MODE_LABELS[item]}
              </button>
            );
          })}
        </div>
        <ModelMenu choices={modelChoices} selection={modelSelection} disabled={running} onChange={onModelSelectionChange} />
        <span className="composer-hint">{execution === 'docker'
          ? mode === 'agent' ? 'Docker · autonomous direct edits' : 'Docker · repository read-only'
          : AGENT_MODE_HINTS[mode]}</span>
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
