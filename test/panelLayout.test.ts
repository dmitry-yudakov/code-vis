import { describe, expect, it } from 'vitest';
import {
  CANVAS_MIN_WIDTH,
  CONVERSATION_MIN_WIDTH,
  DEFAULT_PANEL_LAYOUT,
  DEFAULT_PANEL_WIDTHS,
  MAX_VIEW_PANEL_LAYOUTS,
  dockCapacityForWidth,
  isCanvasHidden,
  initialSessionLayout,
  parsePanelWidths,
  parseViewPanelLayouts,
  reconcilePanelLayouts,
  resolveDockWidths,
  storePanelLayout,
  toggledCanvas,
  withoutConversation,
  visiblePanes,
  toggledMaximized,
  canMaximize,
  type DockCapacity,
  type PanelLayout,
} from '@/features/shell/panelLayout';

function viewId(index: number): string {
  return `${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
}

describe('panel layout geometry', () => {
  it('initializes empty sessions with full conversation without changing saved layouts', () => {
    const empty = initialSessionLayout(undefined, DEFAULT_PANEL_LAYOUT, false);
    expect(empty).toMatchObject({ conversationOpen: true, canvasOpen: false });
    expect(isCanvasHidden(empty, 2)).toBe(true);
    expect(isCanvasHidden(empty, 1)).toBe(true);
    expect(isCanvasHidden(empty, 0)).toBe(true);
    expect(isCanvasHidden({ ...empty, maximized: 'canvas' }, 2)).toBe(false);
    expect(initialSessionLayout(DEFAULT_PANEL_LAYOUT, DEFAULT_PANEL_LAYOUT, false)).toBe(DEFAULT_PANEL_LAYOUT);
    expect(initialSessionLayout(undefined, DEFAULT_PANEL_LAYOUT, true)).toMatchObject({ canvasOpen: true });
    // Receiving the first diagram cannot overwrite an initialized session preference.
    expect(initialSessionLayout(empty, DEFAULT_PANEL_LAYOUT, true)).toBe(empty);
  });
  it('derives both docking thresholds from the column minimums and the activity bar', () => {
    expect(dockCapacityForWidth(728)).toBe(0);
    expect(dockCapacityForWidth(736)).toBe(0);
    expect(dockCapacityForWidth(739)).toBe(0);
    expect(dockCapacityForWidth(740)).toBe(1);
    expect(dockCapacityForWidth(1007)).toBe(1);
    expect(dockCapacityForWidth(1008)).toBe(2);
  });

  it('clamps stored widths and safely falls back for invalid storage', () => {
    expect(parsePanelWidths('{"repositoryWidth":20,"conversationWidth":900}')).toEqual({
      repositoryWidth: 268,
      conversationWidth: 900,
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
        maximized: 'canvas',
        lastOpened: 'dock',
        // Written before Story 72, when the canvas could not be hidden.
        canvasOpen: true,
        repositoryWidth: 268,
        conversationWidth: 900,
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

  it('keeps a stored Files, history or reports view and ignores anything else in its place', () => {
    const id = viewId(1);
    const parse = (sideTab: unknown) => parseViewPanelLayouts(JSON.stringify({ version: 1, layouts: { [id]: { sideTab } } }))[id].sideTab;
    expect(parse('history')).toBe('history');
    expect(parse('files')).toBe('files');
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
    layouts = storePanelLayout(layouts, viewId(0), { ...DEFAULT_PANEL_LAYOUT, maximized: 'canvas' });
    layouts = storePanelLayout(layouts, viewId(MAX_VIEW_PANEL_LAYOUTS), DEFAULT_PANEL_LAYOUT);
    expect(Object.keys(layouts)).toHaveLength(MAX_VIEW_PANEL_LAYOUTS);
    expect(layouts[viewId(0)].maximized).toBe('canvas');
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

  it('fits three framed panes and their gutters at the two-dock threshold', () => {
    const resolved = resolveDockWidths({
      shellWidth: 960, capacity: 2, repositoryOpen: true, dockOpen: true,
      inspectorOpen: false, lastOpened: 'dock', widths: DEFAULT_PANEL_WIDTHS,
    });
    expect(resolved.repositoryWidth).toBe(268);
    expect(resolved.conversationWidth).toBe(320);
    expect(resolved.repositoryColumnWidth).toBe(272);
    expect(resolved.conversationColumnWidth).toBe(324);
    // The canvas's right inset is separate from its 360px content frame.
    expect(960 - resolved.repositoryColumnWidth - resolved.conversationColumnWidth - 4).toBe(360);
  });

  it('fits either dock at its minimum beside the canvas at the one-dock threshold', () => {
    for (const repositoryOpen of [true, false]) {
      const resolved = resolveDockWidths({
        shellWidth: 692, capacity: 1, repositoryOpen, dockOpen: !repositoryOpen,
        inspectorOpen: false, lastOpened: repositoryOpen ? 'repository' : 'dock',
        widths: DEFAULT_PANEL_WIDTHS,
      });
      expect(repositoryOpen ? resolved.repositoryWidth : resolved.conversationWidth).toBeGreaterThanOrEqual(repositoryOpen ? 268 : 320);
      expect(692 - resolved.repositoryColumnWidth - resolved.conversationColumnWidth - 4).toBeGreaterThanOrEqual(360);
    }
  });

  it('retains wide preferences and caps either dock at 80% of the window', () => {
    const widths = { repositoryWidth: 2200, conversationWidth: 2200 };
    expect(parsePanelWidths(JSON.stringify(widths))).toEqual(widths);
    const resolve = (repositoryOpen: boolean, shellWidth = 2352) => resolveDockWidths({
      shellWidth, capacity: 2, repositoryOpen, dockOpen: !repositoryOpen,
      inspectorOpen: false, lastOpened: repositoryOpen ? 'repository' : 'dock', widths,
    });
    expect(resolve(true).repositoryWidth).toBe(1920);
    expect(resolve(false).conversationWidth).toBe(1920);
    expect(resolve(true).repositoryColumnWidth).toBe(1924);
    expect(resolve(false).conversationColumnWidth).toBe(1924);
    expect(resolve(true, 1392).repositoryColumnWidth).toBe(1392 - CANVAS_MIN_WIDTH - 4);
    expect(resolve(false, 1392).conversationColumnWidth).toBe(1392 - CANVAS_MIN_WIDTH - 4);
    expect(resolve(true).repositoryWidth).toBe(1920);
  });

  it('caps the combined changes and diff inspector at 80% with or without the canvas', () => {
    for (const canvasShown of [true, false]) {
      const resolved = resolveDockWidths({
        shellWidth: 2352, capacity: 2, repositoryOpen: true, dockOpen: !canvasShown,
        canvasShown, inspectorOpen: true, lastOpened: 'repository',
        widths: { repositoryWidth: 2200, conversationWidth: 460 },
      });
      expect(resolved.repositoryColumnWidth).toBe(1924);
      expect(resolved.repositoryWidth).toBe(960);
    }
  });

  it('keeps the inspector resize value within its available half of the dock', () => {
    for (const canvasShown of [true, false]) {
      const resolved = resolveDockWidths({
        shellWidth: 1392, capacity: 2, repositoryOpen: true, dockOpen: !canvasShown,
        canvasShown, inspectorOpen: true, lastOpened: 'repository',
        widths: { repositoryWidth: 1920, conversationWidth: 460 },
      });
      expect(resolved.repositoryWidth).toBe((1392 - 8 - (canvasShown ? CANVAS_MIN_WIDTH : CONVERSATION_MIN_WIDTH)) / 2);
      expect(resolved.repositoryColumnWidth).toBe(resolved.repositoryWidth * 2 + 4);
    }
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
    expect(resolved.repositoryColumnWidth).toBe(596);
    expect(960 - resolved.repositoryColumnWidth - 4).toBe(CANVAS_MIN_WIDTH);
  });
});

describe('hiding the canvas', () => {
  const layout = (overrides: Partial<PanelLayout> = {}): PanelLayout => ({ ...DEFAULT_PANEL_LAYOUT, ...overrides });
  const capacities: DockCapacity[] = [0, 1, 2];

  it('hides the canvas beside conversation and honors maximized canvas', () => {
    const hidden = layout({ canvasOpen: false, conversationOpen: true });
    expect(isCanvasHidden(hidden, 2)).toBe(true);
    expect(isCanvasHidden(hidden, 1)).toBe(true);
    expect(isCanvasHidden(hidden, 0)).toBe(true);
    expect(isCanvasHidden({ ...hidden, maximized: 'canvas' }, 2)).toBe(false);
    // A stored layout that closed both shows the canvas: the two are never hidden together.
    expect(isCanvasHidden({ ...hidden, conversationOpen: false }, 2)).toBe(false);
    expect(isCanvasHidden(layout(), 2)).toBe(false);
  });

  it('hides the canvas by opening the conversation, and leaves focus mode', () => {
    for (const capacity of [1, 2] as const) {
      const next = toggledCanvas(layout({ conversationOpen: false, maximized: 'canvas', repositoryOpen: true }), capacity);
      expect(next).toMatchObject({ canvasOpen: false, conversationOpen: true, maximized: null, repositoryOpen: true });
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
          for (const maximized of ['canvas', null] as const) {
            const next = toggledCanvas(layout({ canvasOpen, conversationOpen, maximized }), capacity);
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
    expect(resolved.repositoryWidth).toBe(480);
    expect(resolved.repositoryColumnWidth).toBe(484);
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
    expect(narrow.repositoryColumnWidth).toBe(640 - CONVERSATION_MIN_WIDTH - 4);
  });
});

describe('maximized and narrow panes', () => {
  it('shows exactly one narrow module without rewriting the desktop flags', () => {
    for (const lastOpened of ['repository', 'dock'] as const) {
      const layout = { ...DEFAULT_PANEL_LAYOUT, repositoryOpen: true, lastOpened };
      expect(visiblePanes(layout, 0)).toEqual({ side: lastOpened === 'repository', conversation: lastOpened === 'dock', canvas: false });
      expect(visiblePanes(layout, 2)).toEqual({ side: true, conversation: true, canvas: true });
    }
    expect(visiblePanes({ ...DEFAULT_PANEL_LAYOUT, conversationOpen: false }, 0)).toEqual({ side: false, conversation: false, canvas: true });
  });

  it('maximizes each pane temporarily, preserving open flags, widths and inspector for restore', () => {
    const original: PanelLayout = { ...DEFAULT_PANEL_LAYOUT, repositoryOpen: true, inspectorOpen: true, sideTab: 'history', repositoryWidth: 300 };
    for (const capacity of [0, 1, 2] as const) {
      for (const pane of ['side', 'canvas', 'conversation'] as const) {
        const maximized = toggledMaximized(original, pane);
        expect(visiblePanes(maximized, capacity)).toEqual({ side: pane === 'side', canvas: pane === 'canvas', conversation: pane === 'conversation' });
        expect(toggledMaximized(maximized, pane)).toEqual(original);
      }
    }
  });

  it('offers maximize beside another docked pane, and always on a narrow screen', () => {
    const chatOnly: PanelLayout = { ...DEFAULT_PANEL_LAYOUT, canvasOpen: false };
    const canvasOnly: PanelLayout = { ...DEFAULT_PANEL_LAYOUT, conversationOpen: false };
    for (const capacity of [1, 2] as const) {
      expect(canMaximize(chatOnly, capacity)).toBe(false);
      expect(canMaximize(canvasOnly, capacity)).toBe(false);
      expect(canMaximize(DEFAULT_PANEL_LAYOUT, capacity)).toBe(true);
      expect(canMaximize({ ...chatOnly, repositoryOpen: true }, capacity)).toBe(true);
      expect(canMaximize({ ...canvasOnly, repositoryOpen: true }, capacity)).toBe(true);
    }
    // Maximizing a narrow module also hides the header and the bottom bar.
    expect(canMaximize(chatOnly, 0)).toBe(true);
    expect(canMaximize(canvasOnly, 0)).toBe(true);
  });

  it('roundtrips every maximized pane and rejects invalid values with explicit null overriding legacy focus', () => {
    const id = viewId(0);
    for (const maximized of ['side', 'canvas', 'conversation', null, 'invalid', true]) {
      const parsed = parseViewPanelLayouts(JSON.stringify({ version: 1, layouts: { [id]: { ...DEFAULT_PANEL_LAYOUT, maximized, focusMode: true } } }))[id];
      expect(parsed.maximized).toBe(['side', 'canvas', 'conversation'].includes(maximized as string) ? maximized : null);
    }
  });
});
