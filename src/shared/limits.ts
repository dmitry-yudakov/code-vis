/** Fixed browser/server wire limits. Keep these in one importable, runtime-neutral module. */
export const MAX_MESSAGE_TEXT_CHARS = 8_000;
export const MAX_WIRE_TRANSCRIPT_MESSAGES = 80;

/** Local history is intentionally larger than the old 200-message wire-shaped ceiling. */
export const MAX_STORED_MESSAGES = 2_000;

/** Server-owned model choices one provider may list, and the efforts one model may accept. */
export const MAX_PROVIDER_MODELS = 50;
export const MAX_MODEL_EFFORTS = 8;
export const MAX_MODEL_LABEL_CHARS = 80;
/** A model id or effort is passed to a provider as an argument value, so it can never start with `-`. */
export const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
export const MODEL_EFFORT_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

export const DEFAULT_TRANSCRIPT_DELTA_MESSAGES = 40;
export const DEFAULT_TRANSCRIPT_DELTA_BYTES = 24_000;

export const TEXT_OMISSION_MARKER = '\n\n… [middle omitted] …\n\n';

/** Keeps conclusions near the start as well as useful trailing detail. */
export function truncateTextHeadTail(
  value: string,
  maxChars = MAX_MESSAGE_TEXT_CHARS,
  marker = TEXT_OMISSION_MARKER,
): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= marker.length) return marker.slice(0, maxChars);
  const remaining = maxChars - marker.length;
  const headLength = Math.ceil(remaining / 2);
  const tailLength = Math.floor(remaining / 2);
  return `${value.slice(0, headLength)}${marker}${value.slice(value.length - tailLength)}`;
}

const encoder = new TextEncoder();

export function utf8Length(value: string): number {
  return encoder.encode(value).byteLength;
}

/** UTF-8-aware head/tail truncation that never splits a code point or exceeds the byte bound. */
export function truncateUtf8HeadTail(
  value: string,
  maxBytes: number,
  marker = TEXT_OMISSION_MARKER,
): string {
  if (utf8Length(value) <= maxBytes) return value;
  if (maxBytes <= 0) return '';
  const markerBytes = utf8Length(marker);
  if (markerBytes >= maxBytes) {
    let result = '';
    for (const character of marker) {
      if (utf8Length(result + character) > maxBytes) break;
      result += character;
    }
    return result;
  }

  const characters = Array.from(value);
  const remaining = maxBytes - markerBytes;
  const headBudget = Math.ceil(remaining / 2);
  const tailBudget = Math.floor(remaining / 2);
  let head = '';
  let headBytes = 0;
  for (const character of characters) {
    const size = utf8Length(character);
    if (headBytes + size > headBudget) break;
    head += character;
    headBytes += size;
  }
  let tail = '';
  let tailBytes = 0;
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const character = characters[index];
    const size = utf8Length(character);
    if (tailBytes + size > tailBudget) break;
    tail = character + tail;
    tailBytes += size;
  }
  return `${head}${marker}${tail}`;
}
