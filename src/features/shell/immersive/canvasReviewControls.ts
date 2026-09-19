import type { DrawingMark } from '@/shared/types';

export interface ImmersiveCanvasReviewControls {
  attachmentIds: string[];
  canCreateSketch: boolean;
  onMarksChange(canvasId: string, marks: DrawingMark[]): void;
  onCreateSketch(): void;
  onToggleAttachment(canvasId: string): void;
}

export const CANVAS_REVIEW_ACTIONS = {
  pen: 'Pen', rectangle: 'Rectangle', arrow: 'Arrow', text: 'Text label', eraser: 'Eraser',
  undo: 'Undo', redo: 'Redo', clear: 'Clear',
  attach: 'Attach', sketch: 'New sketch', compare: 'Compare',
  spatial: 'Explore in 3D', projection: 'View 2D',
  'rotate-left': 'Rotate left', 'rotate-right': 'Rotate right',
  'focus-selection': 'Focus selection', 'toggle-group': 'Expand or collapse group',
  'previous-detail': 'Previous detail', 'next-detail': 'Next detail', 'reset-spatial': 'Reset diagram',
  'previous-compare': 'Previous comparison', 'next-compare': 'Next comparison',
  'commit-label': 'Add label', 'cancel-label': 'Cancel',
} as const;

export type CanvasReviewActionName = keyof typeof CANVAS_REVIEW_ACTIONS;
export type CanvasReviewAction = `canvas:${CanvasReviewActionName}`;
