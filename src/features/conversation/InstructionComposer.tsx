'use client';

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { ThemeName } from '@/shared/design/tokens';
import type { AgentExecution, AgentMode, CanvasTarget, ModelChoices, ModelSelection } from '@/shared/types';
import { canvasTargetId } from '@/features/conversation/sessionStore';
import type { RecentCanvas } from '@/features/conversation/recentCanvases';
import { AGENT_MODE_LABELS, agentModeHint, agentModeTooltip, effortLabel, executionModeHint } from '@/features/agents/toolActivity';
import { useMenuDismiss } from '@/features/agents/useMenuDismiss';
import { CanvasThumbnail } from '@/features/diagram/components/CanvasThumbnail';
import { offeredEfforts, offeredModelSelection } from '@/shared/modelChoices';

const MODES: AgentMode[] = ['ask', 'plan', 'agent'];

// Opening one of the composer's popovers closes the others, which would overlap.
const MENU_GROUP = 'composer-menu';

const ICON_PATHS = {
  plus: 'M12 5v14M5 12h14',
  chevronDown: 'm6 9 6 6 6-6',
  chevronUp: 'm6 15 6-6 6 6',
  check: 'M20 6 9 17l-5-5',
  local: 'M5.5 5h13A1.5 1.5 0 0 1 20 6.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 14.5v-8A1.5 1.5 0 0 1 5.5 5zM2 19h20',
  docker: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.3 7 12 12l8.7-5M12 22V12',
  pen: 'M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z',
  report: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
};

function Icon({ name }: { name: keyof typeof ICON_PATHS }) {
  return <svg className="composer-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={ICON_PATHS[name]} /></svg>;
}

/** The arrow keys move between a menu's enabled items; from its summary they enter at either end. */
function moveBetweenItems(event: KeyboardEvent<HTMLDetailsElement>) {
  const menu = event.currentTarget;
  if (!menu.open || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
  const items = [...menu.querySelectorAll<HTMLButtonElement>(':scope > div button:not(:disabled)')];
  if (!items.length) return;
  event.preventDefault();
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'ArrowDown' ? (index + 1) % items.length : (index <= 0 ? items.length : index) - 1;
  items[next].focus();
}

/**
 * A `<details>` popover of the composer, opening upward. Escape or a press outside closes it, and so
 * does a running turn when the menu is disabled by one. Choosing an item closes it and returns focus
 * to its summary.
 */
function ComposerMenu({ className, label, summary, disabled = false, children }: {
  className: string;
  label: string;
  summary: ReactNode;
  disabled?: boolean;
  children(close: () => void): ReactNode;
}) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  useMenuDismiss(menuRef);
  useEffect(() => {
    if (disabled) menuRef.current?.removeAttribute('open');
  }, [disabled]);
  const close = () => {
    menuRef.current?.removeAttribute('open');
    menuRef.current?.querySelector('summary')?.focus();
  };
  return (
    <details ref={menuRef} className={`composer-menu ${className}`} name={MENU_GROUP} onKeyDown={moveBetweenItems}>
      <summary aria-label={label} title={label} aria-disabled={disabled || undefined}
        onClick={disabled ? (event) => event.preventDefault() : undefined}>
        {summary}
      </summary>
      <div>{children(close)}</div>
    </details>
  );
}

/**
 * One choice of a composer menu: its name, and a line under it. The line and a longer title, when
 * there is one, are its accessible description.
 */
function MenuItem({ role, label, detail, checked, disabled, title, className, lead, children, onClick }: {
  role: 'radio' | 'menuitem' | 'menuitemcheckbox';
  label: string;
  detail?: string;
  checked?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
  lead?: ReactNode;
  children?: ReactNode;
  onClick(): void;
}) {
  const id = useId();
  const longTitle = title && title !== detail ? title : undefined;
  const describedBy = [detail && `${id}-detail`, longTitle && `${id}-title`].filter(Boolean).join(' ');
  return (
    <button type="button" role={role} aria-checked={checked} aria-label={label} aria-describedby={describedBy || undefined}
      className={className} disabled={disabled} title={title} onClick={onClick}>
      {lead}
      <span className="menu-item-text"><span>{label}</span>{detail && <small id={`${id}-detail`}>{detail}</small>}</span>
      {longTitle && <span id={`${id}-title`} hidden>{longTitle}</span>}
      {children}
    </button>
  );
}

function ModePicker({ mode, execution, unsupportedModes, disabled, onChange }: {
  mode: AgentMode;
  execution: AgentExecution;
  unsupportedModes: AgentMode[];
  disabled: boolean;
  onChange(mode: AgentMode): void;
}) {
  return (
    <ComposerMenu className={`mode-menu mode-${mode}`} disabled={disabled}
      label={`Mode: ${AGENT_MODE_LABELS[mode]}. ${agentModeHint(mode, execution)}`}
      summary={<>{AGENT_MODE_LABELS[mode]}<Icon name="chevronDown" /></>}>
      {(close) => (
        <div role="radiogroup" aria-label="Agent mode">
          {MODES.map((item) => {
            const reason = unsupportedModes.includes(item)
              ? `${AGENT_MODE_LABELS[item]} is unavailable for this provider and execution. Check provider setup.`
              : undefined;
            return (
              <MenuItem key={item} role="radio" className={`mode-choice mode-choice-${item}`} checked={mode === item}
                disabled={disabled || Boolean(reason)} label={AGENT_MODE_LABELS[item]}
                detail={reason || agentModeHint(item, execution)} title={reason || agentModeTooltip(item, execution)}
                lead={<Icon name="check" />}
                onClick={() => { onChange(item); close(); }} />
            );
          })}
        </div>
      )}
    </ComposerMenu>
  );
}

function AttachMenu({ canvases, attachedIds, theme, disabled, onToggle, onOpenHistory, onNewSketch, onOpenReports }: {
  canvases: RecentCanvas[];
  attachedIds: string[];
  theme: ThemeName;
  disabled: boolean;
  onToggle(id: string): void;
  onOpenHistory(): void;
  onNewSketch(): void;
  onOpenReports?(): void;
}) {
  return (
    <ComposerMenu className="attach-menu" label="Attach" disabled={disabled} summary={<Icon name="plus" />}>
      {(close) => (<>
        <span className="composer-menu-heading">This session</span>
        {!canvases.length && <p>No diagrams or sketches yet.</p>}
        <div role="menu" aria-label="Attach to the next instruction">
          {canvases.map((canvas) => {
            const attached = attachedIds.includes(canvas.id);
            return (
              <MenuItem key={canvas.id} role="menuitemcheckbox" checked={attached} label={canvas.title} detail={canvas.detail}
                // The thumbnail renders once the open menu shows it, one Mermaid render at a time.
                lead={<CanvasThumbnail
                  artifact={canvas.target.kind === 'diagram' ? canvas.target.artifact : undefined}
                  sketch={canvas.target.kind === 'sketch' ? canvas.target.sketch : undefined}
                  marks={canvas.marks}
                  theme={theme}
                  fallback={canvas.target.kind === 'sketch' ? '✎' : '◇'}
                />}
                onClick={() => { onToggle(canvas.id); close(); }}>
                {attached && <span className="menu-item-check"><Icon name="check" />{canvas.active && 'Included'}</span>}
              </MenuItem>
            );
          })}
          <MenuItem role="menuitem" className="attach-more" label="All history…" onClick={() => { onOpenHistory(); close(); }} />
          <span role="separator" />
          <MenuItem role="menuitem" label="New sketch" detail="Draw, then send the drawing as the instruction" lead={<Icon name="pen" />}
            onClick={() => { onNewSketch(); close(); }} />
          {onOpenReports && (
            <MenuItem role="menuitem" label="Headset report…" detail="CodeAI's own project" lead={<Icon name="report" />}
              onClick={() => { onOpenReports(); close(); }} />
          )}
        </div>
      </>)}
    </ComposerMenu>
  );
}

interface ComposerContinuation {
  /** Why the session cannot continue in the other execution now. */
  unavailable?: string;
  /** A new session is being created. */
  busy?: boolean;
  onContinue(): void;
}

/**
 * Where the turn runs, as a menu that continues the session in the other execution, then the mode's
 * hint, or that a continuation is being created.
 */
function ExecutionLine({ execution, mode, continuation }: {
  execution: AgentExecution;
  mode: AgentMode;
  continuation: ComposerContinuation;
}) {
  const name = execution === 'docker' ? 'Docker' : 'Local';
  const other = execution === 'docker' ? 'Local' : 'Docker';
  return (
    <div className="execution-line">
      <ComposerMenu className="execution-menu" label={`Execution: ${name}`}
        summary={<><Icon name={execution === 'docker' ? 'docker' : 'local'} />{name}<Icon name="chevronUp" /></>}>
        {(close) => (<>
          <span className="composer-menu-heading">{name} session</span>
          <div role="menu" aria-label="Execution">
            <MenuItem role="menuitem" label={`Continue in ${other}…`} disabled={continuation.busy || Boolean(continuation.unavailable)}
              detail={continuation.unavailable || 'Opens a new session with an editable recap.'}
              onClick={() => { continuation.onContinue(); close(); }} />
          </div>
        </>)}
      </ComposerMenu>
      <span aria-hidden="true">·</span>
      <span className="execution-hint">
        {continuation.busy ? `Creating a ${other} session…` : executionModeHint(mode, execution)}
      </span>
    </div>
  );
}

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
    <details ref={menuRef} className="model-menu" name={MENU_GROUP}>
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

export interface PendingReportChip {
  id: string;
  label: string;
}

export function InstructionComposer({
  value, running, cancelReady = true, turnBlocked, autoFocus, attached, reports = [], activeDiagramId, markCounts, mode, unsupportedModes,
  modelChoices, modelSelection, theme, recentCanvases, continuation, onChange, onModeChange, onModelSelectionChange, onSend, onCancel,
  onRemoveAttachment, onRemoveReport, onToggleAttachment, onOpenHistory, onNewSketch, onOpenReports,
  execution = 'local',
}: {
  value: string;
  execution?: AgentExecution;
  theme: ThemeName;
  /** The attach menu's canvases: the active one first, then the newest others. */
  recentCanvases: RecentCanvas[];
  continuation: ComposerContinuation;
  running: boolean;
  cancelReady?: boolean;
  turnBlocked?: boolean;
  autoFocus?: boolean;
  attached: CanvasTarget[];
  /** CodeAI reports for the next message; each is enough to send on its own. */
  reports?: PendingReportChip[];
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
  onRemoveReport?(id: string): void;
  /** The same toggle as History's Attach next. */
  onToggleAttachment(id: string): void;
  onOpenHistory(): void;
  onNewSketch(): void;
  /** Present only in CodeAI's own project, where the Reports view exists. */
  onOpenReports?(): void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // A drawing or a report is an instruction in itself, so such a turn does not need typed text.
  const canSend = Boolean(value.trim()) || attached.some((canvas) => canvas.kind === 'sketch') || reports.length > 0;
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  useEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, 260)}px`;
  }, [value]);
  return (
    <>
    <div className="instruction-composer">
      {attached.length + reports.length > 0 && (
        <div className="attachment-chips" aria-label="Attachments">
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
          {reports.map((report) => (
            <span className="attachment-chip report" key={report.id}>
              <span>{report.label}</span>
              <button type="button" aria-label="Remove report attachment" onClick={() => onRemoveReport?.(report.id)}>×</button>
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
        placeholder={attached.some((canvas) => canvas.kind === 'sketch')
          ? 'Describe what you drew, or just send the sketch…'
          : reports.length ? 'Explain what the report shows, or just send it…'
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
        <AttachMenu
          canvases={recentCanvases}
          attachedIds={attached.map(canvasTargetId)}
          theme={theme}
          disabled={running}
          onToggle={onToggleAttachment}
          onOpenHistory={onOpenHistory}
          onNewSketch={onNewSketch}
          onOpenReports={onOpenReports}
        />
        <ModePicker mode={mode} execution={execution} unsupportedModes={unsupportedModes} disabled={running} onChange={onModeChange} />
        <ModelMenu choices={modelChoices} selection={modelSelection} disabled={running} onChange={onModelSelectionChange} />
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
    <ExecutionLine execution={execution} mode={mode} continuation={continuation} />
    </>
  );
}
