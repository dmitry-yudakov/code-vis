import { describe, expect, it } from 'vitest';
import { drawingReducer, type DrawingState } from '@/features/diagram/annotations/drawingReducer';
import { isSharedMarks } from '@/features/diagram/components/DiagramCanvas';
import type { DrawingMark } from '@/shared/types';

const mark = (id: string, x = 1): DrawingMark => ({
  id, origin: 'user', color: '#c67139', createdAt: '2026-09-20T00:00:00.000Z', kind: 'rectangle', x, y: 2, width: 3, height: 4,
});

describe('Flat canvas marks shared with VR', () => {
  it('recognizes marks adopted from the shared record, so a VR stroke is not echoed back as a Flat change', () => {
    const local: DrawingState = { marks: [mark('flat')], past: [[]], future: [] };
    // VR added a stroke: the session record now holds the VR array, and Flat resets to it.
    const shared = [mark('flat'), mark('vr')];
    const adopted = drawingReducer(local, { type: 'reset', marks: shared });
    expect(adopted.marks).not.toBe(shared);
    expect(isSharedMarks(adopted.marks, shared)).toBe(true);
    expect(isSharedMarks([], [])).toBe(true);
  });

  it('still reports every local Flat change, including one that restores equal-looking marks', () => {
    const shared = [mark('first')];
    const adopted = drawingReducer({ marks: [], past: [], future: [] }, { type: 'reset', marks: shared });
    const added = drawingReducer(adopted, { type: 'add', mark: mark('second') });
    const moved = drawingReducer(added, { type: 'replace', mark: mark('second', 40) });
    const undone = drawingReducer(added, { type: 'undo' });
    const erased = drawingReducer(adopted, { type: 'remove', id: 'first' });
    expect(isSharedMarks(added.marks, shared)).toBe(false);
    expect(isSharedMarks(moved.marks, added.marks)).toBe(false);
    expect(isSharedMarks(undone.marks, added.marks)).toBe(false);
    expect(isSharedMarks(erased.marks, shared)).toBe(false);
    // A server snapshot deep-clones the record; equal content is then not the same marks, which
    // only matters to the reset that decides adoption, never to a local report.
    expect(isSharedMarks(added.marks, structuredClone(added.marks))).toBe(false);
  });

  it('reports the sanitized marks when the shared record held marks Flat will not draw', () => {
    const shared = [mark('kept'), mark('dropped', Number.NaN)];
    const adopted = drawingReducer({ marks: [], past: [], future: [] }, { type: 'reset', marks: shared });
    expect(adopted.marks.map((item) => item.id)).toEqual(['kept']);
    expect(isSharedMarks(adopted.marks, shared)).toBe(false);
  });
});
