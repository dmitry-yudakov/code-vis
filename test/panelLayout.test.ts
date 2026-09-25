import { describe, expect, it } from 'vitest';
import {
  CANVAS_MIN_WIDTH,
  CONVERSATION_MIN_WIDTH,
  DEFAULT_PANEL_LAYOUT,
  DEFAULT_PANEL_WIDTHS,
  MAX_VIEW_PANEL_LAYOUTS,
  dockCapacityForWidth,
  isCanvasHidden,
  parsePanelWidths,
  parseViewPanelLayouts,
  reconcilePanelLayouts,
  resolveDockWidths,
  storePanelLayout,
  toggledCanvas,
  withoutConversation,
  type DockCapacity,
  type PanelLayout,
} from '@/features/shell/panelLayout';

function viewId(index: number): string {
  return `${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
}

describe('panel layout geometry', () => {
  it('derives both docking thresholds from the column minimums and the activity bar', () => {
    expect(dockCapacityForWidth(687)).toBe(0);
    expect(dockCapacityForWidth(688)).toBe(1);
    expect(dockCapacityForWidth(1007)).toBe(1);
    expect(dockCapacityForWidth(1008)).toBe(2);
  });

  it('clamps stored widths and safely falls back for invalid storage', () => {
    expect(parsePanelWidths('{"repositoryWidth":20,"conversationWidth":900}')).toEqual({
      repositoryWidth: 268,
      conversationWidth: 560,
    });
    expect(parsePanelWidths('not json')).toEqual(DEFAULT_PANEL_WIDTHS);
  });

  it('parses independent persisted layouts by view id', () => {
    const viewId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect(parseViewPanelLayouts(JSON.stringify({
      version: 1,
      layouts: {
        [viewId]: {
          repositoryOpen: false,
          conversationOpen: true,
          // Written before Story 62: history was a dock state, and is now a side-panel tab.
          historyOpen: true,
          inspectorOpen: true,
          focusMode: true,
          lastOpened: 'dock',
          repositoryWidth: 10,
          conversationWidth: 900,
        },
        invalid: { repositoryOpen: false },
      },
    }))).toEqual({
      [viewId]: {
        repositoryOpen: false,
        conversationOpen: true,
        sideTab: 'changes',
        inspectorOpen: true,
        focusMode: true,
        lastOpened: 'dock',
        // Written before Story 72, when the canvas could not be hidden.
        canvasOpen: true,
        repositoryWidth: 268,
        conversationWidth: 560,
      },
    });
  });

  it('keeps a stored hidden canvas and opens every other stored layout with the canvas', () => {
    const id = viewId(2);
    const parse = (canvasOpen: unknown) => parseViewPanelLayouts(JSON.stringify({ version: 1, layouts: { [id]: { conversationOpen: true, canvasOpen } } }))[id].canvasOpen;
    expect(parse(false)).toBe(false);
    expect(parse(true)).toBe(true);
    expect(parse(undefined)).toBe(true);
    expect(parse('no')).toBe(true);
    expect(DEFAULT_PANEL_LAYOUT.canvasOpen).toBe(true);
    // Both closed would re-hide the canvas the moment the conversation opened again.
    expect(parseViewPanelLayouts(JSON.stringify({ version: 1, layouts: { [id]: { conversationOpen: false, canvasOpen: false } } }))[id].canvasOpen).toBe(true);
  });

  it('opens a view nobody has arranged with the conversation and without the side panel', () => {
    expect(DEFAULT_PANEL_LAYOUT).toMatchObject({ conversationOpen: true, repositoryOpen: false, sideTab: 'changes', lastOpened: 'dock' });
  });

  it('keeps a stored history or reports tab and ignores anything else in its place', () => {
    const id = viewId(1);
    const parse = (sideTab: unknown) => parseViewPanelLayouts(JSON.stringify({ version: 1, layouts: { [id]: { sideTab } } }))[id].sideTab;
    expect(parse('history')).toBe('history');
    expect(parse('reports')).toBe('reports');
    expect(parse('elsewhere')).toBe('changes');
    expect(parse(undefined)).toBe('changes');
  });

  it('bounds persisted layouts by retaining the most recently stored ids', () => {
    const layouts = Object.fromEntries(Array.from({ length: MAX_VIEW_PANEL_LAYOUTS + 2 }, (_, index) => [
      viewId(index),
      { ...DEFAULT_PANEL_LAYOUT, repositoryOpen: index % 2 === 0 },
    ]));
    const parsed = parseViewPanelLayouts(JSON.stringify({ version: 1, layouts }));
    expect(Object.keys(parsed)).toHaveLength(MAX_VIEW_PANEL_LAYOUTS);
    expect(parsed[viewId(0)]).toBeUndefined();
    expect(parsed[viewId(1)]).toBeUndefined();
    expect(parsed[viewId(MAX_VIEW_PANEL_LAYOUTS + 1)]).toBeDefined();
  });

  it('bounds live layouts by recency and reconciles against all known workspace views', () => {
    let layouts: Record<string, typeof DEFAULT_PANEL_LAYOUT> = {};
    for (let index = 0; index < MAX_VIEW_PANEL_LAYOUTS; index += 1) {
      layouts = storePanelLayout(layouts, viewId(index), DEFAULT_PANEL_LAYOUT);
    }
    layouts = storePanelLayout(layouts, viewId(0), { ...DEFAULT_PANEL_LAYOUT, focusMode: true });
    layouts = storePanelLayout(layouts, viewId(MAX_VIEW_PANEL_LAYOUTS), DEFAULT_PANEL_LAYOUT);
    expect(Object.keys(layouts)).toHaveLength(MAX_VIEW_PANEL_LAYOUTS);
    expect(layouts[viewId(0)].focusMode).toBe(true);
    expect(layouts[viewId(1)]).toBeUndefined();

    const reconciled = reconcilePanelLayouts(layouts, [viewId(0), viewId(50)]);
    expect(Object.keys(reconciled)).toEqual([viewId(50), viewId(0)]);
  });

  it('shrinks preferred widths before allowing the canvas below its minimum', () => {
    const resolved = resolveDockWidths({
      shellWidth: 960,
      capacity: 2,
      repositoryOpen: true,
      dockOpen: true,
      inspectorOpen: false,
      lastOpened: 'dock',
      widths: { repositoryWidth: 480, conversationWidth: 560 },
    });
    expect(resolved.repositoryColumnWidth + resolved.conversationColumnWidth).toBeLessThanOrEqual(960 - CANVAS_MIN_WIDTH);
    expect(resolved.conversationWidth).toBeGreaterThanOrEqual(320);
    expect(resolved.repositoryWidth).toBeGreaterThanOrEqual(268);
  });

  it('reduces the inspector pane after preserving the canvas minimum', () => {
    const resolved = resolveDockWidths({
      shellWidth: 960,
      capacity: 2,
      repositoryOpen: true,
      dockOpen: false,
      inspectorOpen: true,
      lastOpened: 'repository',
      widths: DEFAULT_PANEL_WIDTHS,
    });
    expect(resolved.repositoryColumnWidth).toBe(600);
    expect(960 - resolved.repositoryColumnWidth).toBe(CANVAS_MIN_WIDTH);
  });
});

describe('hiding the canvas', () => {
  const layout = (overrides: Partial<PanelLayout> = {}): PanelLayout => ({ ...DEFAULT_PANEL_LAYOUT, ...overrides });
  const capacities: DockCapacity[] = [0, 1, 2];

  it('hides the canvas only beside an open conversation, outside focus mode, above the overlay band', () => {
    const hidden = layout({ canvasOpen: false, conversationOpen: true });
    expect(isCanvasHidden(hidden, 2)).toBe(true);
    expect(isCanvasHidden(hidden, 1)).toBe(true);
    expect(isCanvasHidden(hidden, 0)).toBe(false);
    expect(isCanvasHidden({ ...hidden, focusMode: true }, 2)).toBe(false);
    // A stored layout that closed both shows the canvas: the two are never hidden together.
    expect(isCanvasHidden({ ...hidden, conversationOpen: false }, 2)).toBe(false);
    expect(isCanvasHidden(layout(), 2)).toBe(false);
  });

  it('hides the canvas by opening the conversation, and leaves focus mode', () => {
    for (const capacity of [1, 2] as const) {
      const next = toggledCanvas(layout({ conversationOpen: false, focusMode: true, repositoryOpen: true }), capacity);
      expect(next).toMatchObject({ canvasOpen: false, conversationOpen: true, focusMode: false, repositoryOpen: true });
      expect(isCanvasHidden(next, capacity)).toBe(true);
    }
  });

  it('shows the canvas again, closing the side panel only where one dock fits', () => {
    const both = layout({ canvasOpen: false, conversationOpen: true, repositoryOpen: true });
    expect(toggledCanvas(both, 2)).toMatchObject({ canvasOpen: true, conversationOpen: true, repositoryOpen: true });
    expect(toggledCanvas(both, 1)).toMatchObject({ canvasOpen: true, conversationOpen: true, repositoryOpen: false });
    // At two docks a diff inspector would need the conversation's room: the side panel gives way.
    expect(toggledCanvas(both, 2, false)).toMatchObject({ canvasOpen: true, conversationOpen: true, repositoryOpen: false });
    expect(toggledCanvas(both, 1, true)).toMatchObject({ repositoryOpen: false });
  });

  it('shows the canvas when the conversation closes, and keeps it when the conversation returns', () => {
    const closed = withoutConversation(layout({ canvasOpen: false, conversationOpen: true }));
    expect(closed).toMatchObject({ canvasOpen: true, conversationOpen: false });
    expect(isCanvasHidden({ ...closed, conversationOpen: true }, 2)).toBe(false);
  });

  it('never leaves the canvas and the conversation both hidden', () => {
    for (const capacity of capacities) {
      for (const canvasOpen of [true, false]) {
        for (const conversationOpen of [true, false]) {
          for (const focusMode of [true, false]) {
            const next = toggledCanvas(layout({ canvasOpen, conversationOpen, focusMode }), capacity);
            expect(next.canvasOpen || next.conversationOpen).toBe(true);
          }
        }
      }
    }
  });

  it('gives the side panel what the conversation minimum leaves while the canvas is hidden', () => {
    const resolved = resolveDockWidths({
      shellWidth: 952,
      capacity: 1,
      repositoryOpen: true,
      dockOpen: true,
      canvasShown: false,
      inspectorOpen: false,
      lastOpened: 'dock',
      widths: { repositoryWidth: 480, conversationWidth: 460 },
    });
    expect(resolved.repositoryColumnWidth).toBe(480);
    // The conversation takes the rest of the row, so its column is not fixed.
    expect(resolved.conversationColumnWidth).toBe(0);
    const narrow = resolveDockWidths({
      shellWidth: 640,
      capacity: 1,
      repositoryOpen: true,
      dockOpen: true,
      canvasShown: false,
      inspectorOpen: false,
      lastOpened: 'dock',
      widths: { repositoryWidth: 480, conversationWidth: 460 },
    });
    expect(narrow.repositoryColumnWidth).toBe(640 - CONVERSATION_MIN_WIDTH);
  });
});
