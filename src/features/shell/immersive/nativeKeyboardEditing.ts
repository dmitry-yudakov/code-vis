import { MAX_DRAFT_LENGTH } from '@/shared/voice';
import { editImmersiveText, type TextEditState } from './immersiveTextEditing';

// Quest exposes only the native field value. This invisible character gives an otherwise empty
// field a value that Backspace can remove, producing the input event needed to edit the VR draft.
export const NATIVE_KEYBOARD_GUARD = '\u2060';

export interface NativeKeyboardEditSession {
  base: TextEditState;
  buffer: string;
  hasInput: boolean;
}

export interface NativeKeyboardUpdate {
  session: NativeKeyboardEditSession;
  edit: TextEditState;
  nativeValue: string;
  rearm: boolean;
}

export function startNativeKeyboardEdit(base: TextEditState): NativeKeyboardEditSession {
  const start = Math.max(0, Math.min(base.start, base.end, base.value.length));
  const end = Math.max(start, Math.min(Math.max(base.start, base.end), base.value.length));
  return { base: { value: base.value, start, end }, buffer: '', hasInput: false };
}

function bufferIndex(raw: string, index: number): number {
  return raw.slice(0, index).replaceAll(NATIVE_KEYBOARD_GUARD, '').length;
}

function boundedPrefix(value: string, capacity: number): string {
  let result = '';
  for (const point of value) {
    if (result.length + point.length > capacity) break;
    result += point;
  }
  return result;
}

export function applyNativeKeyboardValue(
  session: NativeKeyboardEditSession,
  rawValue: string,
  rawStart: number,
  rawEnd: number,
  inputType = '',
): NativeKeyboardUpdate {
  const withoutGuard = rawValue.replaceAll(NATIVE_KEYBOARD_GUARD, '');
  const deletion = inputType.startsWith('delete');
  const insertion = inputType.startsWith('insert');
  const deletedGuard = !session.hasInput && session.buffer === '' && withoutGuard === ''
    && ((rawValue === '' && !insertion) || deletion);

  if (deletedGuard) {
    const base = editImmersiveText(session.base, 'Backspace');
    return {
      session: { base, buffer: '', hasInput: false },
      edit: base,
      nativeValue: NATIVE_KEYBOARD_GUARD,
      rearm: true,
    };
  }

  const selectionLength = session.base.end - session.base.start;
  const capacity = MAX_DRAFT_LENGTH - (session.base.value.length - selectionLength);
  const buffer = boundedPrefix(withoutGuard, capacity);
  if (!buffer) {
    if (insertion) {
      return { session: { ...session, buffer: '', hasInput: false }, edit: session.base,
        nativeValue: NATIVE_KEYBOARD_GUARD, rearm: true };
    }
    if (session.hasInput) {
      const value = session.base.value.slice(0, session.base.start) + session.base.value.slice(session.base.end);
      const base = { value, start: session.base.start, end: session.base.start };
      return { session: { base, buffer: '', hasInput: false }, edit: base,
        nativeValue: NATIVE_KEYBOARD_GUARD, rearm: true };
    }
    return { session, edit: session.base, nativeValue: NATIVE_KEYBOARD_GUARD, rearm: true };
  }
  const value = session.base.value.slice(0, session.base.start) + buffer + session.base.value.slice(session.base.end);
  const start = session.base.start + Math.min(bufferIndex(rawValue, rawStart), buffer.length);
  const end = session.base.start + Math.min(bufferIndex(rawValue, rawEnd), buffer.length);
  const edit = { value, start: Math.min(start, end), end: Math.max(start, end) };
  return {
    session: { base: session.base, buffer, hasInput: true },
    edit,
    nativeValue: buffer,
    rearm: false,
  };
}
