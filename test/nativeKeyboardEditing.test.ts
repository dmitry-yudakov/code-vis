import { describe, expect, it } from 'vitest';
import {
  NATIVE_KEYBOARD_GUARD,
  applyNativeKeyboardValue,
  startNativeKeyboardEdit,
} from '@/features/shell/immersive/nativeKeyboardEditing';

describe('Quest native keyboard draft bridge', () => {
  it('inserts and natively edits a separate buffer at the clicked caret', () => {
    let session = startNativeKeyboardEdit({ value: 'Hello world', start: 5, end: 5 });
    let update = applyNativeKeyboardValue(session, ' brave', 6, 6);
    expect(update.edit).toEqual({ value: 'Hello brave world', start: 11, end: 11 });
    expect(update.rearm).toBe(false);

    session = update.session;
    update = applyNativeKeyboardValue(session, ' broad', 4, 4);
    expect(update.edit).toEqual({ value: 'Hello broad world', start: 9, end: 9 });
  });

  it('replaces a remembered range without exposing the surrounding draft to Quest', () => {
    const session = startNativeKeyboardEdit({ value: 'Fix old/path now', start: 4, end: 12 });
    const update = applyNativeKeyboardValue(session, 'src/App.tsx', 11, 11);
    expect(update.edit).toEqual({ value: 'Fix src/App.tsx now', start: 15, end: 15 });
    expect(update.nativeValue).toBe('src/App.tsx');
  });

  it('uses the guard to detect first and repeated Backspace before the caret', () => {
    let session = startNativeKeyboardEdit({ value: 'Go 🙂', start: 5, end: 5 });
    let update = applyNativeKeyboardValue(session, '', 0, 0);
    expect(update.edit).toEqual({ value: 'Go ', start: 3, end: 3 });
    expect(update.nativeValue).toBe(NATIVE_KEYBOARD_GUARD);
    expect(update.rearm).toBe(true);

    session = update.session;
    update = applyNativeKeyboardValue(session, '', 0, 0);
    expect(update.edit).toEqual({ value: 'Go', start: 2, end: 2 });
    expect(update.rearm).toBe(true);
  });

  it('removes a remembered selection before deleting earlier text', () => {
    let session = startNativeKeyboardEdit({ value: 'Keep old text', start: 5, end: 8 });
    let update = applyNativeKeyboardValue(session, '', 0, 0);
    expect(update.edit.value).toBe('Keep  text');
    session = update.session;
    update = applyNativeKeyboardValue(session, '', 0, 0);
    expect(update.edit.value).toBe('Keep text');
  });

  it('re-arms after deleting newly inserted text, then deletes the base draft', () => {
    let session = startNativeKeyboardEdit({ value: 'ab', start: 2, end: 2 });
    let update = applyNativeKeyboardValue(session, 'x', 1, 1);
    expect(update.edit.value).toBe('abx');
    session = update.session;
    update = applyNativeKeyboardValue(session, '', 0, 0);
    expect(update.edit.value).toBe('ab');
    expect(update.rearm).toBe(true);
    session = update.session;
    update = applyNativeKeyboardValue(session, '', 0, 0);
    expect(update.edit.value).toBe('a');
  });

  it('strips the guard if the IME appends and respects the shared draft limit', () => {
    let session = startNativeKeyboardEdit({ value: 'a', start: 1, end: 1 });
    expect(applyNativeKeyboardValue(session, `${NATIVE_KEYBOARD_GUARD}b`, 2, 2).edit.value).toBe('ab');

    session = startNativeKeyboardEdit({ value: 'x'.repeat(7_999), start: 7_999, end: 7_999 });
    const update = applyNativeKeyboardValue(session, '🙂z', 3, 3);
    expect(update.edit.value).toBe('x'.repeat(7_999));
    expect(update.nativeValue).toBe(NATIVE_KEYBOARD_GUARD);
    expect(update.rearm).toBe(true);
  });

  it('accepts a deletion input type when Quest reports no visible buffer change', () => {
    const session = startNativeKeyboardEdit({ value: 'abc', start: 3, end: 3 });
    const update = applyNativeKeyboardValue(session, NATIVE_KEYBOARD_GUARD, 1, 1, 'deleteContentBackward');
    expect(update.edit.value).toBe('ab');
    expect(update.rearm).toBe(true);
  });

  it.each(['All', 'End', 'Home', 'Enter', 'Delete', 'Backspace', 'ArrowLeft', 'ArrowRight'])(
    'inserts the literal native text %s instead of treating it as an editor command', (text) => {
      const session = startNativeKeyboardEdit({ value: 'Say: ', start: 5, end: 5 });
      expect(applyNativeKeyboardValue(session, text, text.length, text.length).edit.value).toBe(`Say: ${text}`);
    },
  );

  it('does not turn an empty insertion or composition update into Backspace', () => {
    const session = startNativeKeyboardEdit({ value: 'abc', start: 3, end: 3 });
    for (const inputType of ['insertCompositionText', 'insertText', 'insertFromDictation']) {
      const update = applyNativeKeyboardValue(session, '', 0, 0, inputType);
      expect(update.edit.value).toBe('abc');
      expect(update.nativeValue).toBe(NATIVE_KEYBOARD_GUARD);
      expect(update.rearm).toBe(true);
    }
  });

  it('commits an erased replacement before handling the next Backspace', () => {
    let session = startNativeKeyboardEdit({ value: 'abc', start: 1, end: 2 });
    let update = applyNativeKeyboardValue(session, 'x', 1, 1);
    expect(update.edit.value).toBe('axc');
    session = update.session;
    update = applyNativeKeyboardValue(session, '', 0, 0);
    expect(update.edit.value).toBe('ac');
    session = update.session;
    update = applyNativeKeyboardValue(session, '', 0, 0);
    expect(update.edit.value).toBe('c');
  });

  it('restores a selected range when native composition is cancelled', () => {
    let session = startNativeKeyboardEdit({ value: 'abc', start: 1, end: 2 });
    let update = applyNativeKeyboardValue(session, 'x', 1, 1, 'insertCompositionText');
    expect(update.edit.value).toBe('axc');
    session = update.session;
    update = applyNativeKeyboardValue(session, '', 0, 0, 'insertCompositionText');
    expect(update.edit).toEqual({ value: 'abc', start: 1, end: 2 });
    expect(update.nativeValue).toBe(NATIVE_KEYBOARD_GUARD);
  });
});
