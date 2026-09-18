import { describe, expect, it } from 'vitest';
import { UIKIT_ATLAS_CHARSET, UIKIT_ATLAS_RANGES, UIKIT_REPLACEMENT_GLYPH, mergeUikitInputValue, missingUikitAtlasCharacters, textForUikitAtlas } from '@/features/shell/immersive/uikitFontPolicy';

describe('uikit spike font policy', () => {
  it('requests every printable Story 55 range plus the replacement glyph', () => {
    for (const { start, end } of UIKIT_ATLAS_RANGES) {
      for (let codePoint = start; codePoint <= end; codePoint++) {
        expect(UIKIT_ATLAS_CHARSET).toContain(String.fromCodePoint(codePoint));
      }
    }
    expect(UIKIT_ATLAS_CHARSET.endsWith(UIKIT_REPLACEMENT_GLYPH)).toBe(true);
  });

  it('preserves covered fixture punctuation and demonstrates the out-of-atlas replacement policy', () => {
    const fixture = 'Crème · café… ‹branch› → ┌─┐\nПривет 世界 😀';
    expect(missingUikitAtlasCharacters(fixture)).toEqual([...'Привет世界😀']);
    expect(textForUikitAtlas(fixture)).toBe(`Crème · café… ‹branch› → ┌─┐\n${UIKIT_REPLACEMENT_GLYPH.repeat(6)} ${UIKIT_REPLACEMENT_GLYPH.repeat(2)} ${UIKIT_REPLACEMENT_GLYPH}`);
  });

  it('preserves the raw draft while editing through its replacement-glyph projection', () => {
    let raw = '';
    for (const character of [...'Привет 世界 😀']) {
      raw = mergeUikitInputValue(raw, textForUikitAtlas(raw) + character);
    }
    expect(raw).toBe('Привет 世界 😀');
    expect(mergeUikitInputValue('Пa😀', 'a�')).toBe('a😀');
  });
});
