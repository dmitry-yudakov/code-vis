import { describe, expect, it } from 'vitest';
import {
  CANVAS_MIN_WIDTH,
  DEFAULT_PANEL_WIDTHS,
  dockCapacityForWidth,
  parsePanelWidths,
  resolveDockWidths,
} from '@/features/shell/panelLayout';

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
