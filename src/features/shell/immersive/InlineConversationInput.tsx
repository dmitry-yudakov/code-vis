import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { palette, type ThemeName } from '@/shared/design/tokens';
import { MAX_DRAFT_LENGTH } from '@/shared/voice';
import { texturePanel } from '@/features/diagram/spatial/immersiveResources';
import { useTextureResource } from './useTextureResource';
import { immersiveInputLines, type InputLine, type TextEditState } from './immersiveTextEditing';
import {
  NATIVE_KEYBOARD_GUARD,
  applyNativeKeyboardValue,
  startNativeKeyboardEdit,
  type NativeKeyboardEditSession,
} from './nativeKeyboardEditing';

type QuestKeyboardSession = XRSession & { isSystemKeyboardSupported?: boolean };

export function InlineConversationInput({
  draft, theme, enabled, onDraft,
  ariaLabel = 'VR message input', dataAttribute = 'data-immersive-message-input',
  placeholder = 'Message…', meshName = 'Message input', maxLength = MAX_DRAFT_LENGTH,
  position = [0, -0.66, 0.035],
}: {
  draft: string;
  theme: ThemeName;
  enabled: boolean;
  onDraft(value: string): void;
  ariaLabel?: string;
  dataAttribute?: string;
  placeholder?: string;
  meshName?: string;
  maxLength?: number;
  position?: [number, number, number];
}) {
  const get = useThree((state) => state.get);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const mesh = useRef<THREE.Mesh>(null);
  const pressed = useRef<number | null>(null);
  const current = useRef({ draft, onDraft });
  current.current = { draft, onDraft };
  const nativeEdit = useRef<NativeKeyboardEditSession | null>(null);
  const selection = useRef({ start: draft.length, end: draft.length });
  const [caret, setCaret] = useState(selection.current);
  const [focused, setFocused] = useState(false);
  const renderedLines = useRef<InputLine[]>([]);
  const resource = useTextureResource((ledger) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Message input could not be rendered.');
    return { ...texturePanel(canvas, [1.32, 0.30], ledger), context };
  }, []);

  const select = (start: number, end = start) => {
    selection.current = { start, end };
    setCaret(selection.current);
  };
  const updateDraft = (edit: TextEditState) => {
    selection.current = { start: edit.start, end: edit.end };
    setCaret(selection.current);
    if (edit.value === current.current.draft) return;
    current.current.draft = edit.value;
    current.current.onDraft(edit.value);
  };

  useEffect(() => {
    if (!enabled) return;
    const input = document.createElement('textarea');
    input.setAttribute('aria-label', ariaLabel);
    input.setAttribute(dataAttribute, '');
    input.tabIndex = -1;
    input.maxLength = maxLength;
    input.placeholder = placeholder;
    input.value = current.current.draft;
    // Keep the focus target in the viewport so Quest does not move the underlying page.
    Object.assign(input.style, { position: 'fixed', top: '0', left: '0', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' });
    const nativeSelection = () => {
      const session = nativeEdit.current;
      if (!session) {
        select(input.selectionStart, input.selectionEnd);
        return;
      }
      const beforeStart = input.value.slice(0, input.selectionStart).replaceAll(NATIVE_KEYBOARD_GUARD, '').length;
      const beforeEnd = input.value.slice(0, input.selectionEnd).replaceAll(NATIVE_KEYBOARD_GUARD, '').length;
      select(session.base.start + beforeStart, session.base.start + beforeEnd);
    };
    input.oninput = (event) => {
      const session = nativeEdit.current;
      if (session) {
        const update = applyNativeKeyboardValue(session, input.value, input.selectionStart, input.selectionEnd,
          event instanceof InputEvent ? event.inputType : '', maxLength);
        nativeEdit.current = update.session;
        updateDraft(update.edit);
        if (input.value !== update.nativeValue) input.value = update.nativeValue;
        if (update.rearm) input.setSelectionRange(NATIVE_KEYBOARD_GUARD.length, NATIVE_KEYBOARD_GUARD.length);
        return;
      }
      let value = input.value.slice(0, maxLength);
      if (/[\uD800-\uDBFF]$/u.test(value)) value = value.slice(0, -1);
      if (input.value !== value) input.value = value;
      updateDraft({ value, start: Math.min(input.selectionStart, value.length), end: Math.min(input.selectionEnd, value.length) });
    };
    input.onselect = nativeSelection;
    input.onkeyup = nativeSelection;
    input.onkeydown = (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); input.blur(); }
    };
    input.onfocus = () => setFocused(true);
    input.onblur = () => {
      nativeEdit.current = null;
      input.value = current.current.draft;
      input.setSelectionRange(selection.current.start, selection.current.end);
      setFocused(false);
    };
    document.body.appendChild(input);
    textarea.current = input;
    return () => {
      nativeEdit.current = null;
      input.blur();
      input.remove();
      textarea.current = null;
      pressed.current = null;
      setFocused(false);
    };
  }, [ariaLabel, dataAttribute, enabled, maxLength, placeholder]);

  useEffect(() => {
    const input = textarea.current;
    const start = Math.min(selection.current.start, draft.length);
    const end = Math.min(selection.current.end, draft.length);
    select(start, end);
    if (!input || nativeEdit.current || input.value === draft) return;
    input.value = draft;
    input.setSelectionRange(start, end);
  }, [draft]);

  useLayoutEffect(() => {
    if (!resource) return;
    const { context } = resource;
    const colors = palette[theme];
    context.clearRect(0, 0, 1024, 256);
    context.fillStyle = colors.sheetSunk;
    context.strokeStyle = focused ? colors.live : colors.line;
    context.lineWidth = 3;
    context.beginPath(); context.roundRect(3, 3, 1018, 250, 28); context.fill(); context.stroke();
    context.font = '44px Arial, sans-serif';
    const lines = immersiveInputLines(draft, 680, (text) => context.measureText(text).width);
    const caretLine = lines.findLastIndex((line) => line.start <= caret.end);
    const first = focused ? Math.max(0, Math.min(caretLine - 1, lines.length - 3)) : Math.max(0, lines.length - 3);
    renderedLines.current = lines.slice(first, first + 3);
    renderedLines.current.forEach((line, index) => {
      const baseline = 66 + index * 62;
      if (focused) {
        const x = (at: number) => line.stops.find((stop) => stop.index === at)?.x ?? 0;
        if (caret.start !== caret.end && caret.start <= line.end && caret.end >= line.start) {
          context.fillStyle = colors.lineStrong;
          const left = x(Math.max(caret.start, line.start));
          context.fillRect(28 + left, baseline - 44, x(Math.min(caret.end, line.end)) - left, 54);
        }
        if (first + index === caretLine) {
          context.fillStyle = colors.live;
          context.fillRect(28 + x(caret.end), baseline - 43, 3, 52);
        }
      }
      context.fillStyle = colors.ink;
      context.fillText(line.text, 28, baseline);
    });
    if (!draft && !focused) { context.fillStyle = colors.muted; context.fillText(placeholder, 28, 66); }
    resource.material.opacity = enabled ? 1 : 0.5;
    resource.material.map!.needsUpdate = true;
  }, [resource, draft, theme, focused, caret, enabled, placeholder]);

  const caretAt = (event: ThreeEvent<PointerEvent>) => {
    if (!mesh.current) return current.current.draft.length;
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0).applyMatrix4(mesh.current.matrixWorld);
    const point = event.ray.intersectPlane(plane, new THREE.Vector3());
    if (!point) return current.current.draft.length;
    mesh.current.worldToLocal(point);
    const x = (point.x / 1.32 + 0.5) * 1024 - 28;
    const y = (0.5 - point.y / 0.30) * 256;
    const line = renderedLines.current[Math.max(0, Math.min(2, Math.floor((y - 20) / 62)))] ?? renderedLines.current.at(-1);
    return line?.stops.reduce((best, stop) => Math.abs(stop.x - x) < Math.abs(best.x - x) ? stop : best).index
      ?? current.current.draft.length;
  };
  const open = (event: ThreeEvent<PointerEvent>) => {
    const input = textarea.current;
    if (!enabled || !input) return;
    // A second focus() does not start a new Quest editing session. Ignore the impossible-in-headset
    // re-entry rather than rebasing against a private native buffer that may still contain text.
    if (nativeEdit.current && document.activeElement === input) return;
    const position = caretAt(event);
    select(position);
    const xrSession = get().gl.xr.getSession() as QuestKeyboardSession | null;
    if (xrSession?.isSystemKeyboardSupported) {
      nativeEdit.current = startNativeKeyboardEdit({ value: current.current.draft, start: position, end: position });
      input.value = NATIVE_KEYBOARD_GUARD;
      input.setSelectionRange(NATIVE_KEYBOARD_GUARD.length, NATIVE_KEYBOARD_GUARD.length);
    } else {
      nativeEdit.current = null;
      input.value = current.current.draft;
      input.setSelectionRange(position, position);
    }
    input.focus({ preventScroll: true });
  };

  return resource && <mesh ref={mesh} name={meshName} geometry={resource.geometry} material={resource.material}
    position={position} pointerEvents={enabled ? 'auto' : 'none'}
    userData={{ immersiveMessageInput: true, draft, focused, enabled, selection: caret,
      nativeKeyboard: Boolean((get().gl.xr.getSession() as QuestKeyboardSession | null)?.isSystemKeyboardSupported) }}
    onPointerDown={(event) => { event.stopPropagation(); if (event.button === 0 && pressed.current === null) pressed.current = event.pointerId; }}
    onPointerOut={(event) => { if (pressed.current === event.pointerId) pressed.current = null; }}
    onPointerCancel={(event) => { if (pressed.current === event.pointerId) pressed.current = null; }}
    onPointerUp={(event) => {
      event.stopPropagation();
      if (event.button !== 0 || pressed.current !== event.pointerId) return;
      pressed.current = null;
      open(event);
    }} onClick={(event) => event.stopPropagation()} />;
}
