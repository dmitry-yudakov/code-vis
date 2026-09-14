import { MAX_DRAFT_LENGTH } from '@/shared/voice';

export interface TextEditState { value: string; start: number; end: number }

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Edits the whole draft, independently of a system keyboard's private input buffer. */
export function editImmersiveText(state: TextEditState, key: string): TextEditState {
  const { value } = state;
  let start = Math.min(state.start, state.end, value.length);
  let end = Math.min(Math.max(state.start, state.end), value.length);
  const boundaries = [...Array.from(segmenter.segment(value), ({ index }) => index), value.length];
  const previous = (index: number) => boundaries.findLast((boundary) => boundary < index) ?? 0;
  const next = (index: number) => boundaries.find((boundary) => boundary > index) ?? value.length;
  if (key === 'All') return { value, start: 0, end: value.length };
  if (key === 'Home' || key === 'End' || key === 'ArrowLeft' || key === 'ArrowRight') {
    const caret = key === 'Home' ? 0 : key === 'End' ? value.length
      : key === 'ArrowLeft' ? start === end ? previous(start) : start : start === end ? next(end) : end;
    return { value, start: caret, end: caret };
  }
  if (key === 'Backspace' && start === end) start = previous(start);
  if (key === 'Delete' && start === end) end = next(end);
  const insertion = key === 'Backspace' || key === 'Delete' ? '' : key === 'Enter' ? '\n' : key;
  if (value.length - (end - start) + insertion.length > MAX_DRAFT_LENGTH) return state;
  const updated = value.slice(0, start) + insertion + value.slice(end);
  return { value: updated, start: start + insertion.length, end: start + insertion.length };
}

export interface InputLine { start: number; end: number; text: string; stops: Array<{ index: number; x: number }> }

/** The same measured positions drive wrapping, selection drawing, and ray-to-caret placement. */
export function immersiveInputLines(value: string, width: number, measure: (text: string) => number): InputLine[] {
  const lines: InputLine[] = [];
  let line: InputLine = { start: 0, end: 0, text: '', stops: [{ index: 0, x: 0 }] };
  for (const { segment, index } of segmenter.segment(value)) {
    const text = segment === '\t' ? '  ' : segment;
    if (segment === '\n' || (line.text && measure(line.text + text) > width)) {
      lines.push(line);
      const start = segment === '\n' ? index + segment.length : index;
      line = { start, end: start, text: '', stops: [{ index: start, x: 0 }] };
      if (segment === '\n') continue;
    }
    line.text += text;
    line.end = index + segment.length;
    line.stops.push({ index: line.end, x: measure(line.text) });
  }
  lines.push(line);
  return lines;
}
