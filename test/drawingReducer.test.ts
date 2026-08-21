import { describe, expect, it } from 'vitest';
import { drawingReducer, type DrawingState } from '@/features/diagram/annotations/drawingReducer';

const empty: DrawingState = { marks: [], past: [], future: [] };

describe('drawingReducer', () => {
  it('adds, undoes, and redoes independent vector marks', () => {
    const mark = { id: crypto.randomUUID(), origin: 'user' as const, color: '#c67139', createdAt: new Date().toISOString(), kind: 'rectangle' as const, x: 1, y: 2, width: 3, height: 4 };
    const added = drawingReducer(empty, { type: 'add', mark });
    expect(added.marks).toEqual([mark]);
    const undone = drawingReducer(added, { type: 'undo' });
    expect(undone.marks).toEqual([]);
    expect(drawingReducer(undone, { type: 'redo' }).marks).toEqual([mark]);
  });

  it('rejects non-finite geometry', () => {
    const mark = { id: crypto.randomUUID(), origin: 'user' as const, color: '#c67139', createdAt: new Date().toISOString(), kind: 'text' as const, x: Number.NaN, y: 2, text: 'bad' };
    expect(drawingReducer(empty, { type: 'add', mark }).marks).toEqual([]);
  });
});
