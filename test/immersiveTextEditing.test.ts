import { describe, expect, it } from 'vitest';
import { editImmersiveText, immersiveInputLines } from '@/features/shell/immersive/immersiveTextEditing';

describe('whole-draft immersive editing', () => {
  it('deletes and replaces previously written text without a system keyboard buffer', () => {
    const opened = { value: 'Fix old/path\nKeep tests.', start: 4, end: 12 };
    const replaced = editImmersiveText(opened, 'src/App.tsx');
    expect(replaced).toEqual({ value: 'Fix src/App.tsx\nKeep tests.', start: 15, end: 15 });
    expect(editImmersiveText(replaced, 'Backspace').value).toBe('Fix src/App.ts\nKeep tests.');
    expect(editImmersiveText(editImmersiveText(replaced, 'All'), 'Backspace'))
      .toEqual({ value: '', start: 0, end: 0 });
  });

  it('moves and deletes by complete graphemes, including combined emoji', () => {
    const value = 'a👩🏽‍💻e\u0301';
    const end = { value, start: value.length, end: value.length };
    const left = editImmersiveText(end, 'ArrowLeft');
    expect(left.start).toBe(value.length - 2);
    expect(editImmersiveText(left, 'Backspace').value).toBe('ae\u0301');
    expect(editImmersiveText(left, 'Delete').value).toBe('a👩🏽‍💻');
    expect(editImmersiveText({ value, start: 1, end: value.length }, 'ArrowLeft').start).toBe(1);
  });

  it('enforces the draft limit without truncating unrelated text or splitting an insertion', () => {
    const full = { value: 'x'.repeat(8000), start: 4000, end: 4000 };
    expect(editImmersiveText(full, '🙂')).toEqual(full);
    expect(editImmersiveText({ ...full, end: 4002 }, '🙂').value).toHaveLength(8000);
    expect(editImmersiveText({ value: '', start: 0, end: 0 }, 'Backspace').value).toBe('');
  });

  it('maps wrapped multiline text and tabs back to exact draft positions', () => {
    const lines = immersiveInputLines('a\t🙂\nb\n', 3, (text) => Array.from(text).length);
    expect(lines.map(({ text, start, end }) => ({ text, start, end }))).toEqual([
      { text: 'a  ', start: 0, end: 2 }, { text: '🙂', start: 2, end: 4 },
      { text: 'b', start: 5, end: 6 }, { text: '', start: 7, end: 7 },
    ]);
    expect(lines[0].stops).toEqual([{ index: 0, x: 0 }, { index: 1, x: 1 }, { index: 2, x: 3 }]);
    expect(lines[1].stops).toEqual([{ index: 2, x: 0 }, { index: 4, x: 1 }]);
  });
});
