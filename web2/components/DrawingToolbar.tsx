'use client';

import type { DrawingTool } from '@/lib/shared/types';

const TOOLS: Array<{ id: DrawingTool; icon: string; label: string; shortcut: string }> = [
  { id: 'pointer', icon: '↖', label: 'Pointer', shortcut: 'V' },
  { id: 'pan', icon: '✋', label: 'Pan', shortcut: 'H' },
  { id: 'pen', icon: '✎', label: 'Pen', shortcut: 'P' },
  { id: 'rectangle', icon: '□', label: 'Rectangle', shortcut: 'R' },
  { id: 'arrow', icon: '↗', label: 'Arrow', shortcut: 'A' },
  { id: 'text', icon: 'T', label: 'Text', shortcut: 'T' },
  { id: 'eraser', icon: '⌫', label: 'Eraser', shortcut: 'E' },
];

export function DrawingToolbar({
  tool, onTool, canUndo, canRedo, onUndo, onRedo, onClear,
}: {
  tool: DrawingTool;
  onTool(tool: DrawingTool): void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  onClear(): void;
}) {
  return (
    <div className="drawing-toolbar" role="toolbar" aria-label="Diagram drawing tools">
      {TOOLS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={tool === item.id ? 'active' : ''}
          aria-pressed={tool === item.id}
          aria-label={`${item.label} (${item.shortcut})`}
          title={`${item.label} · ${item.shortcut}`}
          onClick={() => onTool(item.id)}
        >
          <span aria-hidden="true">{item.icon}</span>
        </button>
      ))}
      <span className="tool-separator" />
      <button type="button" disabled={!canUndo} onClick={onUndo} aria-label="Undo drawing">↶</button>
      <button type="button" disabled={!canRedo} onClick={onRedo} aria-label="Redo drawing">↷</button>
      <button type="button" onClick={onClear} aria-label="Clear all ink">Clear</button>
    </div>
  );
}
