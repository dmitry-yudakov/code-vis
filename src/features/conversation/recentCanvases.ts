import type { CanvasTarget, DrawingMark, SessionSnapshot } from '@/shared/types';
import { firstMermaidStatement } from '@/features/diagram/mermaid/mermaidPolicy';
import { relativeActivityTime } from '@/features/shell/immersive/conversationListModel';
import { canvasTargetId, findCanvasTarget, getArtifacts, getSketches } from './sessionStore';

/** Besides the active canvas, how many of the newest the composer's attach menu offers. */
const RECENT_CANVAS_LIMIT = 3;

/** One canvas the composer's attach menu offers for the next instruction. */
export interface RecentCanvas {
  id: string;
  target: CanvasTarget;
  marks: DrawingMark[];
  /** "Diagram 8", "Sketch 3". */
  title: string;
  /** "pinned · flowchart · 1h ago", "sketch · on the canvas". */
  detail: string;
  active: boolean;
}

/** The Mermaid diagram type from the source's header, as a reader names it: `graph` and `flowchart` are both "flowchart". */
export function mermaidKind(source: string): string {
  const keyword = firstMermaidStatement(source)?.split(/[\s;]/)[0] ?? '';
  if (keyword === 'graph') return 'flowchart';
  return keyword.replace(/-v\d+$/, '').replace(/Diagram$/, '') || 'diagram';
}

/** The active canvas first, then the newest others, up to {@link RECENT_CANVAS_LIMIT}. */
export function recentCanvases(session: SessionSnapshot, now: number): RecentCanvas[] {
  const all: CanvasTarget[] = [
    ...getArtifacts(session).map((artifact): CanvasTarget => ({ kind: 'diagram', artifact })),
    ...getSketches(session).map((sketch): CanvasTarget => ({ kind: 'sketch', sketch })),
  ];
  const active = findCanvasTarget(session, session.activeDiagramId);
  const others = all
    .filter((target) => canvasTargetId(target) !== session.activeDiagramId)
    .sort((left, right) => createdAt(right).localeCompare(createdAt(left)))
    .slice(0, RECENT_CANVAS_LIMIT);
  return [...(active ? [active] : []), ...others].map((target) => {
    const id = canvasTargetId(target);
    const isActive = id === session.activeDiagramId;
    const detail = [
      session.pinnedDiagramIds.includes(id) ? 'pinned' : undefined,
      target.kind === 'diagram' ? mermaidKind(target.artifact.source) : 'sketch',
      isActive ? 'on the canvas' : relativeActivityTime(createdAt(target), now),
    ].filter(Boolean).join(' · ');
    return {
      id,
      target,
      marks: session.annotations[id]?.marks ?? [],
      title: target.kind === 'diagram' ? `Diagram ${target.artifact.ordinal}` : `Sketch ${target.sketch.ordinal}`,
      detail,
      active: isActive,
    };
  });
}

function createdAt(target: CanvasTarget): string {
  return target.kind === 'diagram' ? target.artifact.createdAt : target.sketch.createdAt;
}
