import { describe, expect, it } from 'vitest';
import { getContrastRatio } from '@mui/material/styles';
import { desktopTheme } from '@/features/shell/desktopTheme';
import { fonts, palette } from '@/shared/design/tokens';

describe('desktop theme', () => {
  it('maps both appearances to the shared palette, including approval semantics', () => {
    for (const mode of ['light', 'dark'] as const) {
      const colors = palette[mode];
      const mapped = desktopTheme.colorSchemes![mode]!.palette;
      expect(mapped.primary.main).toBe(colors.plot);
      expect(mapped.warning.main).toBe(colors.wait);
      expect(mapped.background.default).toBe(colors.shell);
      expect(mapped.background.paper).toBe(colors.raised);
      expect(mapped.text.primary).toBe(colors.ink);
      expect(mapped.text.secondary).toBe(colors.muted);
      for (const color of ['primary', 'warning', 'success', 'error'] as const) {
        expect(getContrastRatio(mapped[color].contrastText, mapped[color].main)).toBeGreaterThanOrEqual(4.5);
        expect(getContrastRatio(mapped[color].contrastText, mapped[color].dark)).toBeGreaterThanOrEqual(4.5);
      }
      expect(getContrastRatio(mapped.text.secondary, mapped.background.paper)).toBeGreaterThanOrEqual(4.5);
    }
    expect(desktopTheme.typography.fontFamily).toBe(fonts.sans);
  });

  it('emits both schemes for the appearance stamped before hydration', () => {
    const css = JSON.stringify(desktopTheme.generateStyleSheets());
    expect(css).toContain('[data-appearance=');
    expect(css).toContain('dark');
    expect(css).toContain('light');
    expect(css).toContain(palette.dark.raised);
  });
});
