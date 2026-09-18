import { describe, expect, it } from 'vitest';
import {
  IMMERSIVE_CONTROL_HEIGHT, IMMERSIVE_DEFAULT_DISTANCE, contrastRatio, dpToWorld, immersiveTheme, immersiveType,
} from '@/features/shell/immersive/immersiveTheme';
import { WORKSPACE_GLYPH_MAP } from '@/features/shell/immersive/workspaceIcons';
import { MAX_IMMERSIVE_TEXTURE_PIXELS } from '@/features/diagram/spatial/immersiveTypes';
import { getImmersiveInstrumentation, SpatialResourceLedger } from '@/features/diagram/spatial/resourceLedger';
import { sanitizeImmersiveSvg } from '@/features/diagram/spatial/panelResources';
import { WORKSPACE_HEADER_RASTER_SIZE, WORKSPACE_HEADER_WORLD_SIZE } from '@/features/shell/immersive/workspaceResources';
import { centeredControlRow } from '@/features/shell/immersive/conversationControls';

describe('Quest-like immersive visual system', () => {
  it('keeps every text and status color readable across its supported surfaces', () => {
    for (const colors of Object.values(immersiveTheme)) {
      for (const foreground of [colors.text, colors.positive, colors.negative, colors.warning, colors.link]) {
        for (const background of [colors.surface, colors.raised, colors.control, colors.hover, colors.pressed]) {
          expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
        }
      }
      for (const background of [colors.surface, colors.raised]) {
        expect(contrastRatio(colors.secondaryText, background)).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(immersiveTheme.dark.environment).toBe('#1A1A1A');
    expect(immersiveTheme.light.surface).toBe('#DADADA');
  });

  it('derives the complete type and control scale from the headset dp convention', () => {
    expect(dpToWorld(1, IMMERSIVE_DEFAULT_DISTANCE)).toBeCloseTo(0.002836, 5);
    expect(IMMERSIVE_CONTROL_HEIGHT).toBeCloseTo(dpToWorld(48), 10);
    expect(Math.min(...Object.values(immersiveType).map((value) => value.size))).toBe(14);
    expect(immersiveType.reading.size).toBeGreaterThanOrEqual(18);
    const horizontalDensity = WORKSPACE_HEADER_RASTER_SIZE[0] / WORKSPACE_HEADER_WORLD_SIZE[0];
    const verticalDensity = WORKSPACE_HEADER_RASTER_SIZE[1] / WORKSPACE_HEADER_WORLD_SIZE[1];
    expect(horizontalDensity / verticalDensity).toBeCloseTo(1, 2);
  });

  it('assigns each glyph one meaning and confines chevrons to pagers', () => {
    const meanings = new Map<string, Set<string>>();
    for (const [action, value] of Object.entries(WORKSPACE_GLYPH_MAP)) {
      const values = meanings.get(value.glyph) || new Set<string>();
      values.add(value.meaning); meanings.set(value.glyph, values);
      if (value.glyph === 'ChevronLeft' || value.glyph === 'ChevronRight') expect(action.startsWith('pager:')).toBe(true);
    }
    expect([...meanings.values()].every((value) => value.size === 1)).toBe(true);
  });

  it('packs mixed-width speech editing controls without overlapping', () => {
    const controls = [
      { key: 'retry', width: 0.36 }, { key: 'help', width: 0.33 },
      { key: 'clear', width: IMMERSIVE_CONTROL_HEIGHT }, { key: 'done', width: 0.19 },
    ] as const;
    const positions = centeredControlRow(controls);
    for (let index = 1; index < controls.length; index += 1) {
      const previous = controls[index - 1];
      const current = controls[index];
      const gap = positions.get(current.key)! - current.width / 2
        - (positions.get(previous.key)! + previous.width / 2);
      expect(gap).toBeCloseTo(0.02, 10);
    }
    expect(positions.get(controls[0].key)! - controls[0].width / 2).toBeGreaterThan(-0.66);
    expect(positions.get(controls.at(-1)!.key)! + controls.at(-1)!.width / 2).toBeLessThan(0.66);
  });

  it('charges mipmapped textures at four thirds under the raised ceiling', () => {
    const before = getImmersiveInstrumentation().logicalTexturePixels;
    const ledger = new SpatialResourceLedger('immersive');
    ledger.trackTexture({ dispose() {} }, 3_000, true);
    expect(getImmersiveInstrumentation().logicalTexturePixels - before).toBe(4_000);
    expect(MAX_IMMERSIVE_TEXTURE_PIXELS).toBe(5_592_405);
    ledger.dispose();
    expect(getImmersiveInstrumentation().logicalTexturePixels).toBe(before);
  });

  it('makes immersive diagram font stacks resolvable and sans-serif', () => {
    const svg = sanitizeImmersiveSvg('<text style="font-family:var(--font-geist), ui-serif, serif, sans-serif">A</text>');
    expect(svg).not.toMatch(/var\(|(?<!sans-)\b(?:ui-)?serif\b/);
    expect(svg).toContain('system-ui, sans-serif');
    expect(svg).toContain('sans-serif');
  });
});
