import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { renderTokensCss } from '../scripts/generate-tokens';
import { palette } from '@/shared/design/tokens';

const globalsPath = new URL('../src/app/globals.css', import.meta.url);
const tokensPath = new URL('../src/app/tokens.css', import.meta.url);
const sourcePath = new URL('../src/shared/design/tokens.ts', import.meta.url);

function relativeLuminance(color: string): number {
  const hex = color.slice(1);
  const normalized = hex.length === 3 ? [...hex].map((digit) => `${digit}${digit}`).join('') : hex;
  const channels = [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground: string, background: string): number {
  const light = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const dark = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (light + 0.05) / (dark + 0.05);
}

describe('design tokens', () => {
  it('keeps the shared token source side-effect free', async () => {
    const source = await readFile(sourcePath, 'utf8');

    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\b(?:document|window|navigator)\b|node:/);
  });

  it('keeps globals.css free of color literals', async () => {
    const css = await readFile(globalsPath, 'utf8');

    expect(css).toMatch(/^@import ['"]\.\/tokens\.css['"];\n/);
    expect(css.match(/#[0-9a-f]{3,8}\b|rgba?\s*\(/gi)).toBeNull();
  });

  it('keeps the committed generated CSS in byte-for-byte parity', async () => {
    const css = await readFile(tokensPath, 'utf8');

    expect(css).toBe(renderTokensCss());
    expect(css).toContain('@media (prefers-color-scheme: dark) {');
    expect(css).toContain(':root:not([data-theme="light"]) {');
    expect(css).toContain(':root[data-theme="dark"] {');
    const declarations = css.split('\n').filter((line) => /^\s+[^{}]+;$/.test(line));
    expect(declarations.every((line) => /^\s+(?:--[a-z0-9-]+: .+|color-scheme: (?:light|dark));$/.test(line))).toBe(true);
  });

  it('keeps body, muted, and semantic state text at WCAG AA contrast in both themes', () => {
    for (const colors of Object.values(palette)) {
      const textPairs = [
        [colors.ink, colors.shell],
        [colors.muted, colors.shell],
        [colors.muted, colors.sheet],
        [colors.live, colors.sheet],
        [colors.onEmphasis, colors.live],
        [colors.onEmphasis, colors.wait],
        [colors.onEmphasis, colors.plot],
        [colors.liveInk, colors.liveWash],
        [colors.waitInkStrong, colors.waitWash],
        [colors.stopInk, colors.stopWash],
        [colors.plotInk, colors.plotWash],
        [colors.add, colors.addWash],
        [colors.del, colors.delWash],
      ];
      for (const [foreground, background] of textPairs) {
        expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
