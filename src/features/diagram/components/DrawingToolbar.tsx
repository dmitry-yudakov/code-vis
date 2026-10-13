'use client';

import Paper from '@mui/material/Paper';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import type { Ref } from 'react';
import type { DrawingTool } from '@/shared/types';

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
  tool, onTool, canUndo, canRedo, onUndo, onRedo, onClear, rootRef, readOnly = false,
}: {
  tool: DrawingTool;
  readOnly?: boolean;
  onTool(tool: DrawingTool): void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  onClear(): void;
  rootRef?: Ref<HTMLDivElement>;
}) {
  return (
    <Paper ref={rootRef} className="drawing-toolbar" role="toolbar" aria-label="Diagram drawing tools">
      <ToggleButtonGroup value={tool} exclusive size="small">{TOOLS.map((item) => (
        <ToggleButton value={item.id} selected={tool === item.id}
          key={item.id}
          type="button"
          className={tool === item.id ? 'active' : ''}
          disabled={readOnly && item.id !== 'pointer' && item.id !== 'pan'}
          aria-pressed={tool === item.id}
          aria-label={`${item.label} (${item.shortcut})`}
          title={`${item.label} · ${item.shortcut}`}
          onClick={() => onTool(item.id)}
        >
          <span aria-hidden="true">{item.icon}</span>
        </ToggleButton>
      ))}</ToggleButtonGroup>
      <span className="tool-separator" />
      <IconButton type="button" disabled={readOnly || !canUndo} onClick={onUndo} aria-label="Undo drawing">↶</IconButton>
      <IconButton type="button" disabled={readOnly || !canRedo} onClick={onRedo} aria-label="Redo drawing">↷</IconButton>
      <Button type="button" disabled={readOnly} onClick={onClear} aria-label="Clear all ink">Clear</Button>
    </Paper>
  );
}
