import { describe, expect, it } from 'vitest';
import {
  canvasCanHeal,
  canvasPointFromUv,
  canvasRenderKey,
  createCanvasMark,
  findCanvasMarkAt,
  updateCanvasMark,
} from '@/features/shell/immersive/canvasReviewModel';
import { findCanvasTarget } from '@/features/conversation/sessionStore';
import type { CanvasTarget, DrawingMark, SessionSnapshot } from '@/shared/types';

const viewBox: [number, number, number, number] = [100, 200, 1_600, 1_000];

function sessionWith(source: string, status: 'ready' | 'parse-error' = 'ready'): SessionSnapshot {
  return {
    messages: [{ role: 'assistant', blocks: [{ kind: 'diagram', artifact: {
      id: 'diagram', sessionId: 'session', messageId: 'message', ordinal: 1, source, createdAt: 'now', status,
      derivedFromDiagramIds: [], evidence: [],
    } }] }],
    sketches: [{ id: 'sketch', sessionId: 'session', ordinal: 1, createdAt: 'now', viewBox }],
  } as unknown as SessionSnapshot;
}

describe('immersive canvas review', () => {
  it('maps texture intersections into canonical canvas coordinates', () => {
    expect(canvasPointFromUv(viewBox, { x: 0, y: 1 })).toEqual({ x: 100, y: 200 });
    expect(canvasPointFromUv(viewBox, { x: 0.5, y: 0.5 })).toEqual({ x: 900, y: 700 });
    expect(canvasPointFromUv(viewBox, { x: 1.4, y: -0.2 })).toEqual({ x: 1_700, y: 1_200 });
  });

  it('creates and updates the same bounded vector marks used by Flat', () => {
    const start = { x: 200, y: 300 };
    const end = { x: 500, y: 600 };
    const rectangle = createCanvasMark('rectangle', start, '#c67139', 'mark', '2026-09-16T00:00:00.000Z');
    expect(rectangle).toMatchObject({ kind: 'rectangle', x: 200, y: 300, width: 0, height: 0 });
    expect(updateCanvasMark(rectangle!, start, end)).toMatchObject({ kind: 'rectangle', x: 200, y: 300, width: 300, height: 300 });

    const arrow = createCanvasMark('arrow', end, '#c67139', 'arrow', '2026-09-16T00:00:00.000Z');
    expect(updateCanvasMark(arrow!, end, start)).toMatchObject({ kind: 'arrow', start: end, end: start });
  });

  it('erases the nearest visible mark without depending on panel pose', () => {
    const marks: DrawingMark[] = [
      { id: 'far', origin: 'user', color: '#c67139', createdAt: 'now', kind: 'rectangle', x: 1_000, y: 700, width: 200, height: 100 },
      { id: 'near', origin: 'user', color: '#c67139', createdAt: 'now', kind: 'pen', points: [{ x: 180, y: 280 }, { x: 260, y: 360 }] },
    ];
    expect(findCanvasMarkAt(marks, { x: 220, y: 320 }, viewBox)?.id).toBe('near');
    expect(findCanvasMarkAt(marks, { x: 700, y: 500 }, viewBox)).toBeUndefined();
  });

  it('keys a canvas by what reaches its raster, not by the session snapshot that carries it', () => {
    const source = 'flowchart TD\n A-->B';
    // A new message or an applied server snapshot rebuilds the session, so the target is a new object.
    const before = findCanvasTarget(sessionWith(source), 'diagram');
    const after = findCanvasTarget(structuredClone(sessionWith(source)), 'diagram');
    expect(after).not.toBe(before);
    expect(canvasRenderKey(after)).toBe(canvasRenderKey(before));
    expect(canvasRenderKey(findCanvasTarget(sessionWith(source), 'sketch')))
      .toBe(canvasRenderKey(findCanvasTarget(structuredClone(sessionWith(source)), 'sketch')));

    const keys = [
      undefined,
      before,
      findCanvasTarget(sessionWith(`${source}\n B-->C`), 'diagram'),
      findCanvasTarget(sessionWith(source, 'parse-error'), 'diagram'),
      findCanvasTarget(sessionWith(source), 'sketch'),
      { kind: 'sketch', sketch: { id: 'sketch', sessionId: 'session', ordinal: 1, createdAt: 'now', viewBox: [0, 0, 800, 600] } } satisfies CanvasTarget,
    ].map((target) => canvasRenderKey(target));
    expect(new Set(keys).size).toBe(keys.length);
    // Marks of a comparison canvas arrive with the session; their revision is part of its raster.
    expect(canvasRenderKey(before, '2026-09-20T00:00:01.000Z')).not.toBe(canvasRenderKey(before, '2026-09-20T00:00:00.000Z'));
  });

  it('retries only a canvas failure that a later workspace change can heal', () => {
    const diagram = findCanvasTarget(sessionWith('flowchart TD\n  A --> B'), 'diagram')!;
    const invalid = findCanvasTarget(sessionWith('flowchart TD\n  A --', 'parse-error'), 'diagram')!;
    const sketch = findCanvasTarget(sessionWith('flowchart TD\n  A --> B'), 'sketch')!;
    // A shown canvas never restarts, however often the session changes.
    expect(canvasCanHeal(diagram, 'ready')).toBe(false);
    expect(canvasCanHeal(diagram, undefined)).toBe(false);
    expect(canvasCanHeal(undefined, 'error')).toBe(false);
    // A failed raster or an over-budget omission leaves a dead panel the user cannot draw on.
    expect(canvasCanHeal(diagram, 'error')).toBe(true);
    expect(canvasCanHeal(diagram, 'omitted')).toBe(true);
    expect(canvasCanHeal(sketch, 'omitted')).toBe(true);
    // An artifact the agent left invalid stays invalid; its render key covers a later repair.
    expect(canvasCanHeal(invalid, 'error')).toBe(false);
  });
});
