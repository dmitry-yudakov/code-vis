export const UIKIT_REPLACEMENT_GLYPH = '\uFFFD';

/** Printable ranges requested by Story 55; control and unassigned code points are excluded. */
export const UIKIT_ATLAS_RANGES = [
  { name: 'Basic Latin', start: 0x20, end: 0x7e },
  { name: 'Latin-1 Supplement', start: 0xa0, end: 0xff },
  { name: 'Latin Extended-A', start: 0x100, end: 0x17f },
  { name: 'General Punctuation', start: 0x2000, end: 0x206f },
  { name: 'Arrows', start: 0x2190, end: 0x21ff },
  { name: 'Box Drawing', start: 0x2500, end: 0x257f },
] as const;

export const UIKIT_ATLAS_CHARSET = UIKIT_ATLAS_RANGES
  .flatMap(({ start, end }) => Array.from({ length: end - start + 1 }, (_, index) => String.fromCodePoint(start + index)))
  .join('') + UIKIT_REPLACEMENT_GLYPH;

const atlasCharacters = new Set(UIKIT_ATLAS_CHARSET);

/**
 * The spike keeps one texture page per font weight. Text outside that bounded atlas is represented
 * by U+FFFD instead of allowing uikit's solid missing-glyph quad into the scene.
 */
export function textForUikitAtlas(value: string): string {
  return Array.from(value, (character) => character === '\n' || character === '\t' || atlasCharacters.has(character)
    ? character : UIKIT_REPLACEMENT_GLYPH).join('');
}

/** Reconciles edits made against the sanitized projection without replacing untouched raw text. */
export function mergeUikitInputValue(rawValue: string, nextProjectedValue: string): string {
  const raw = Array.from(rawValue);
  const previous = Array.from(textForUikitAtlas(rawValue));
  const next = Array.from(nextProjectedValue);
  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (suffix < previous.length - prefix && suffix < next.length - prefix
    && previous[previous.length - suffix - 1] === next[next.length - suffix - 1]) suffix++;
  return [...raw.slice(0, prefix), ...next.slice(prefix, next.length - suffix), ...raw.slice(raw.length - suffix)].join('');
}

export function missingUikitAtlasCharacters(value: string): string[] {
  return [...new Set(Array.from(value).filter((character) => character !== '\n' && character !== '\t' && !atlasCharacters.has(character)))];
}
