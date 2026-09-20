import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/diagram/mermaid/mermaidRenderer', () => ({ renderMermaid: vi.fn() }));
vi.mock('@/features/diagram/annotations/compositeExport', () => ({ composeSvgMarkup: vi.fn(() => '<svg />') }));

import { composeSvgMarkup } from '@/features/diagram/annotations/compositeExport';
import { renderMermaid } from '@/features/diagram/mermaid/mermaidRenderer';
import { createPanelResources } from '@/features/diagram/spatial/panelResources';
import { SpatialResourceLedger } from '@/features/diagram/spatial/resourceLedger';
import type { CanvasTarget, DrawingMark } from '@/shared/types';

const render = vi.mocked(renderMermaid);
const compose = vi.mocked(composeSvgMarkup);

function diagram(id: string, source = 'flowchart TD\n A-->B'): CanvasTarget {
  return { kind: 'diagram', artifact: {
    id, sessionId: 'session', messageId: 'message', ordinal: 1, source, createdAt: 'now', status: 'ready',
    derivedFromDiagramIds: [], evidence: [],
  } };
}

const stroke: DrawingMark = {
  id: 'stroke', origin: 'user', color: '#c67139', createdAt: 'now', kind: 'pen', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
};

// A superseded ledger ends a generation after its snapshots and before any DOM rasterization.
function snapshot(target: CanvasTarget, marks: DrawingMark[] = [], theme: 'light' | 'dark' = 'dark') {
  const superseded = new SpatialResourceLedger();
  superseded.dispose();
  const id = target.kind === 'diagram' ? target.artifact.id : target.sketch.id;
  return createPanelResources([target], { [id]: { marks } }, id, theme, superseded, 800_000, true);
}

describe('panel snapshot cache', () => {
  beforeEach(() => {
    render.mockReset();
    render.mockResolvedValue({ svg: '<svg>diagram</svg>', viewBox: [0, 0, 100, 50] });
    compose.mockClear();
  });

  it('composes a new stroke over the cached Mermaid render of unchanged source', async () => {
    await snapshot(diagram('stroke-diagram'));
    await snapshot(diagram('stroke-diagram'), [stroke]);
    expect(render).toHaveBeenCalledTimes(1);
    expect(compose.mock.calls.map(([, marks]) => marks)).toEqual([[], [stroke]]);

    await snapshot(diagram('stroke-diagram', 'flowchart TD\n A-->C'), [stroke]);
    await snapshot(diagram('stroke-diagram'), [stroke], 'light');
    expect(render).toHaveBeenCalledTimes(3);
  });

  it('shares one queued render between generations that restart before it finishes', async () => {
    await Promise.all([snapshot(diagram('restarted-diagram')), snapshot(diagram('restarted-diagram'), [stroke])]);
    expect(render).toHaveBeenCalledTimes(1);
    expect(compose).toHaveBeenCalledTimes(2);
  });

  it('renders again after a failure instead of caching it', async () => {
    render.mockRejectedValueOnce(new Error('Mermaid chunk failed to load.'));
    await snapshot(diagram('failed-diagram'));
    await snapshot(diagram('failed-diagram'));
    expect(render).toHaveBeenCalledTimes(2);
    expect(compose).toHaveBeenCalledTimes(1);
  });
});
