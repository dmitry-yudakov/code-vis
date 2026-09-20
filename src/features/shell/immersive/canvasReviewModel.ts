import type { CanvasTarget, DrawingMark, DrawingTool, Point } from '@/shared/types';

/**
 * Everything about a target that reaches its raster. Every session mutation rebuilds equal targets,
 * so the texture pipeline restarts on this key rather than on object identity. `marksRevision` is
 * the annotation's `updatedAt` for a canvas whose marks arrive with the session.
 */
export function canvasRenderKey(target?: CanvasTarget, marksRevision = ''): string {
  if (!target) return '';
  return target.kind === 'diagram'
    ? `diagram:${target.artifact.id}:${target.artifact.status}:${target.artifact.error || ''}:${marksRevision}:${target.artifact.source}`
    : `sketch:${target.sketch.id}:${target.sketch.viewBox.join(',')}:${marksRevision}`;
}

/**
 * A failed raster or an over-budget omission leaves a dead panel that takes no pointer input, so no
 * stroke can restart it; a later workspace change may have freed the budget or the network. An
 * artifact the agent left invalid cannot heal, and its render key already covers a repair.
 */
export function canvasCanHeal(target?: CanvasTarget, status?: 'ready' | 'omitted' | 'error'): boolean {
  if (!target || !status || status === 'ready') return false;
  return target.kind !== 'diagram' || target.artifact.status === 'ready';
}

export function canvasPointFromUv(
  viewBox: readonly [number, number, number, number],
  uv: { x: number; y: number },
): Point {
  const x = Math.max(0, Math.min(1, uv.x));
  const y = Math.max(0, Math.min(1, uv.y));
  return {
    x: viewBox[0] + x * viewBox[2],
    y: viewBox[1] + (1 - y) * viewBox[3],
  };
}

export function createCanvasMark(
  tool: DrawingTool,
  point: Point,
  color: string,
  id: string,
  createdAt: string,
  text?: string,
): DrawingMark | undefined {
  const common = { id, origin: 'user' as const, color, createdAt };
  if (tool === 'pen') return { ...common, kind: 'pen', points: [point] };
  if (tool === 'rectangle') return { ...common, kind: 'rectangle', x: point.x, y: point.y, width: 0, height: 0 };
  if (tool === 'arrow') return { ...common, kind: 'arrow', start: point, end: point };
  if (tool === 'text' && text?.trim()) return { ...common, kind: 'text', x: point.x, y: point.y, text: text.trim().slice(0, 500) };
  return undefined;
}

export function updateCanvasMark(mark: DrawingMark, start: Point, point: Point): DrawingMark {
  if (mark.kind === 'pen') return { ...mark, points: [...mark.points, point].slice(-5_000) };
  if (mark.kind === 'rectangle') return {
    ...mark,
    x: Math.min(start.x, point.x),
    y: Math.min(start.y, point.y),
    width: Math.abs(point.x - start.x),
    height: Math.abs(point.y - start.y),
  };
  if (mark.kind === 'arrow') return { ...mark, end: point };
  return mark;
}

function segmentDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function markDistance(mark: DrawingMark, point: Point): number {
  if (mark.kind === 'pen') {
    if (mark.points.length === 1) return segmentDistance(point, mark.points[0], mark.points[0]);
    return Math.min(...mark.points.slice(1).map((end, index) => segmentDistance(point, mark.points[index], end)));
  }
  if (mark.kind === 'arrow') return segmentDistance(point, mark.start, mark.end);
  if (mark.kind === 'rectangle') {
    const left = { x: mark.x, y: mark.y };
    const right = { x: mark.x + mark.width, y: mark.y + mark.height };
    return Math.min(
      segmentDistance(point, left, { x: right.x, y: left.y }),
      segmentDistance(point, { x: right.x, y: left.y }, right),
      segmentDistance(point, right, { x: left.x, y: right.y }),
      segmentDistance(point, { x: left.x, y: right.y }, left),
    );
  }
  const width = Math.max(24, [...mark.text].length * 11);
  const nearestX = Math.max(mark.x, Math.min(mark.x + width, point.x));
  const nearestY = Math.max(mark.y - 22, Math.min(mark.y + 4, point.y));
  return Math.hypot(point.x - nearestX, point.y - nearestY);
}

export function findCanvasMarkAt(
  marks: readonly DrawingMark[],
  point: Point,
  viewBox: readonly [number, number, number, number],
): DrawingMark | undefined {
  const tolerance = Math.max(8, Math.min(viewBox[2], viewBox[3]) * 0.03);
  return [...marks].reverse()
    .map((mark) => ({ mark, distance: markDistance(mark, point) }))
    .filter(({ distance }) => distance <= tolerance)
    .sort((left, right) => left.distance - right.distance)[0]?.mark;
}
