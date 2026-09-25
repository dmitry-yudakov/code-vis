import { describe, expect, it } from 'vitest';
import { mermaidKind, recentCanvases } from '@/features/conversation/recentCanvases';
import type { DiagramArtifact, DrawingMark, SessionSnapshot, SketchCanvas } from '@/shared/types';

const NOW = Date.parse('2026-09-25T12:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function diagram(ordinal: number, minutes: number, source = 'flowchart LR\n  A --> B'): DiagramArtifact {
  return {
    id: `diagram-${ordinal}`, sessionId: 't1', messageId: `message-${ordinal}`, ordinal, source, createdAt: minutesAgo(minutes),
    status: 'ready', derivedFromDiagramIds: [], evidence: [],
  };
}

function sketch(ordinal: number, minutes: number): SketchCanvas {
  return { id: `sketch-${ordinal}`, sessionId: 't1', ordinal, createdAt: minutesAgo(minutes), viewBox: [0, 0, 1_600, 1_000] };
}

function session(artifacts: DiagramArtifact[], sketches: SketchCanvas[], overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    version: 4, execution: 'local', revision: 0, id: 't1', title: 'Test', repositories: [], createdAt: minutesAgo(600), updatedAt: minutesAgo(1),
    participants: [{ id: 'agent-1', kind: 'agent', displayName: 'Claude', provider: 'claude', role: 'coder', defaultMode: 'ask' }],
    primaryAgentId: 'agent-1', addressedAgentId: 'agent-1',
    messages: [{
      id: 'message-1', role: 'assistant', authorId: 'agent-1', createdAt: minutesAgo(600), status: 'complete', rawMarkdown: '',
      blocks: artifacts.map((artifact) => ({ kind: 'diagram' as const, artifact })),
    }],
    pinnedDiagramIds: [], annotations: {}, sketches, ...overrides,
  };
}

describe('the attach menu\'s recent canvases', () => {
  it('offers the active canvas first, then the three newest others', () => {
    const canvases = recentCanvases(session(
      [diagram(1, 300), diagram(2, 200), diagram(3, 90, 'sequenceDiagram\n  A->>B: hi'), diagram(4, 2)],
      [sketch(1, 60), sketch(2, 30)],
      { activeDiagramId: 'diagram-2', pinnedDiagramIds: ['diagram-4'] },
    ), NOW);

    expect(canvases.map(({ title, detail, active }) => ({ title, detail, active }))).toEqual([
      { title: 'Diagram 2', detail: 'flowchart · on the canvas', active: true },
      { title: 'Diagram 4', detail: 'pinned · flowchart · 2m ago', active: false },
      { title: 'Sketch 2', detail: 'sketch · 30m ago', active: false },
      { title: 'Sketch 1', detail: 'sketch · 1h ago', active: false },
    ]);
    expect(canvases.map((canvas) => canvas.target.kind)).toEqual(['diagram', 'diagram', 'sketch', 'sketch']);
  });

  it('offers only the newest without an active canvas, and nothing in an empty session', () => {
    const canvases = recentCanvases(session([diagram(1, 30), diagram(2, 20), diagram(3, 10), diagram(4, 5)], []), NOW);
    expect(canvases.map((canvas) => canvas.id)).toEqual(['diagram-4', 'diagram-3', 'diagram-2']);
    expect(recentCanvases(session([], []), NOW)).toEqual([]);
  });

  it('carries a sketch\'s marks for its thumbnail', () => {
    const mark: DrawingMark = { id: 'm1', origin: 'user', color: '#000000', createdAt: minutesAgo(1), kind: 'arrow', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } };
    const [canvas] = recentCanvases(session([], [sketch(1, 5)], {
      activeDiagramId: 'sketch-1',
      annotations: { 'sketch-1': { version: 1, diagramId: 'sketch-1', marks: [mark], updatedAt: minutesAgo(1) } },
    }), NOW);
    expect(canvas).toMatchObject({ title: 'Sketch 1', detail: 'sketch · on the canvas', marks: [mark] });
  });

  it('names a diagram by its Mermaid type', () => {
    expect(mermaidKind('flowchart TD\n  A --> B')).toBe('flowchart');
    expect(mermaidKind('graph LR\n  A --> B')).toBe('flowchart');
    expect(mermaidKind('%% a comment\n\n  sequenceDiagram\n  A->>B: hi')).toBe('sequence');
    expect(mermaidKind('stateDiagram-v2\n  [*] --> A')).toBe('state');
    expect(mermaidKind('erDiagram\n  A ||--o{ B : has')).toBe('er');
    expect(mermaidKind('mindmap\n  root')).toBe('mindmap');
    expect(mermaidKind('')).toBe('diagram');
  });
});
