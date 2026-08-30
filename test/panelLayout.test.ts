import { describe, expect, it } from 'vitest';
import {
  CANVAS_MIN_WIDTH,
  DEFAULT_PANEL_LAYOUT,
  DEFAULT_PANEL_WIDTHS,
  MAX_VIEW_PANEL_LAYOUTS,
  dockCapacityForWidth,
  parsePanelWidths,
  parseViewPanelLayouts,
  reconcilePanelLayouts,
  resolveDockWidths,
  storePanelLayout,
} from '@/features/shell/panelLayout';

function viewId(index: number): string {
  return `${index.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
}

describe('panel layout geometry', () => {
  it('derives both docking thresholds from the column minimums', () => {
    expect(dockCapacityForWidth(639)).toBe(0);
    expect(dockCapacityForWidth(640)).toBe(1);
    expect(dockCapacityForWidth(959)).toBe(1);
    expect(dockCapacityForWidth(960)).toBe(2);
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
          historyOpen: false,
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
        historyOpen: false,
        inspectorOpen: true,
        focusMode: true,
        lastOpened: 'dock',
        repositoryWidth: 268,
        conversationWidth: 560,
      },
    });
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
