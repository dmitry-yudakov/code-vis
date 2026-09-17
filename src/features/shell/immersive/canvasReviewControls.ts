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
  undo: 'Undo mark', redo: 'Redo mark', clear: 'Clear marks',
  attach: 'Toggle canvas attachment', sketch: 'New sketch', compare: 'Compare canvases',
  'previous-compare': 'Previous comparison', 'next-compare': 'Next comparison',
  'commit-label': 'Add label', 'cancel-label': 'Cancel label',
} as const;

export type CanvasReviewActionName = keyof typeof CANVAS_REVIEW_ACTIONS;
export type CanvasReviewAction = `canvas:${CanvasReviewActionName}`;
