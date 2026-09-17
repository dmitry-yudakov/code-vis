import { describe, expect, it } from 'vitest';
import {
  canvasPointFromUv,
  createCanvasMark,
  findCanvasMarkAt,
  updateCanvasMark,
} from '@/features/shell/immersive/canvasReviewModel';
import type { DrawingMark } from '@/shared/types';

const viewBox: [number, number, number, number] = [100, 200, 1_600, 1_000];

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
});
