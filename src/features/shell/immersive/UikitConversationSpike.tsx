'use client';

import { useThree } from '@react-three/fiber';
import {
  Button as HorizonButtonImpl,
  Dropdown as HorizonDropdownImpl,
  DropdownButton as HorizonDropdownButtonImpl,
  DropdownList as HorizonDropdownListImpl,
  DropdownListItem as HorizonDropdownListItemImpl,
  DropdownTextValue as HorizonDropdownTextValueImpl,
  Input as HorizonInputImpl,
  Panel as HorizonPanelImpl,
  type ButtonProperties,
  type DropdownListItemProperties,
  type DropdownProperties,
  type InputProperties,
} from '@pmndrs/uikit-horizon';
import {
  build, Container, Text, type ContainerProperties, type TextProperties, type VanillaComponent,
} from '@react-three/uikit';
import { reversePainterSortStable } from '@pmndrs/uikit';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { ThemeName } from '@/shared/design/tokens';
import type { SessionSnapshot } from '@/shared/types';
import { immersiveMessageEntry } from '@/features/diagram/spatial/immersiveTranscript';
import type { ImmersiveSemanticAction } from '@/features/diagram/spatial/immersiveTypes';
import type { ImmersiveConversationControls } from './conversationControls';
import type { ConversationHistoryController, ConversationHistoryScrollState } from './ConversationHistory';
import { dpToWorld, immersiveTheme } from './immersiveTheme';
import { codeAiUikitFontMetrics, codeAiUikitFonts } from './uikitFonts.generated';
import { mergeUikitInputValue, textForUikitAtlas } from './uikitFontPolicy';

type WithChildren<T> = T & { children?: ReactNode };
const HorizonPanel = build<HorizonPanelImpl, ContainerProperties>(HorizonPanelImpl, 'CodeAiHorizonPanel');
const HorizonButton = build<HorizonButtonImpl, WithChildren<ButtonProperties>>(HorizonButtonImpl, 'CodeAiHorizonButton');
const HorizonInput = build<HorizonInputImpl, InputProperties & {
  value?: string; disabled?: boolean; onValueChange?(value: string): void;
}>(HorizonInputImpl, 'CodeAiHorizonInput');
const HorizonDropdown = build<HorizonDropdownImpl, WithChildren<DropdownProperties>>(HorizonDropdownImpl, 'CodeAiHorizonDropdown');
const HorizonDropdownButton = build<HorizonDropdownButtonImpl, ContainerProperties>(HorizonDropdownButtonImpl, 'CodeAiHorizonDropdownButton');
const HorizonDropdownList = build<HorizonDropdownListImpl, ContainerProperties>(HorizonDropdownListImpl, 'CodeAiHorizonDropdownList');
const HorizonDropdownListItem = build<HorizonDropdownListItemImpl, WithChildren<DropdownListItemProperties>>(HorizonDropdownListItemImpl, 'CodeAiHorizonDropdownListItem');
const HorizonDropdownTextValue = build<HorizonDropdownTextValueImpl, TextProperties & { placeholder?: string }>(HorizonDropdownTextValueImpl, 'CodeAiHorizonDropdownTextValue');

const ATLAS_BYTES = codeAiUikitFontMetrics.reduce((bytes, font) => bytes + font.width * font.height * 4, 0);
const PIXEL_SIZE = dpToWorld(1);

function useTestHook(ref: RefObject<VanillaComponent | null>, name: string, userData: Record<string, unknown>) {
  useLayoutEffect(() => {
    const object = ref.current;
    if (!object) return;
    object.name = name;
    Object.assign(object.userData, userData);
  }, [ref, name, userData]);
}

function SpikeButton({ action, label, theme, onAction, variant = 'secondary' }: {
  action: ImmersiveSemanticAction | 'uikit:dropdown';
  label: string;
  theme: ThemeName;
  onAction(): void;
  variant?: 'primary' | 'secondary' | 'negative';
}) {
  const ref = useRef<HorizonButtonImpl>(null);
  const userData = useMemo(() => ({ immersiveAction: action, uikitSpike: true }), [action]);
  useTestHook(ref, label, userData);
  const colors = immersiveTheme[theme];
  return <HorizonButton ref={ref} variant={variant === 'negative' ? 'negative' : variant}
    height={48} minWidth={48} paddingX={16} borderRadius={24} fontSize={16} lineHeight={20} fontWeight={600}
    backgroundColor={variant === 'primary' ? colors.selected : colors.control}
    color={variant === 'primary' ? colors.selectedInk : variant === 'negative' ? colors.negative : colors.text}
    hover={{ backgroundColor: colors.hover }} active={{ backgroundColor: colors.pressed }} onClick={onAction}>
    <Text fontSize={16} lineHeight={20} fontWeight={600}>{textForUikitAtlas(label)}</Text>
  </HorizonButton>;
}

function SpikeDropdown({ theme }: { theme: ThemeName }) {
  const ref = useRef<HorizonDropdownImpl>(null);
  const target = useRef<import('@react-three/uikit').VanillaContainer>(null);
  const list = useRef<HorizonDropdownListImpl>(null);
  // Keep the menu open in the spike so its cross-panel stacking remains observable on-headset and
  // in automated screenshots without adding a production dropdown state.
  const [open, setOpen] = useState(true);
  const colors = immersiveTheme[theme];
  const rootData = useMemo(() => ({ immersiveAction: 'uikit:dropdown', uikitSpike: true }), []);
  const listData = useMemo(() => ({ uikitDropdownList: true, drawsOverRasterPanels: true }), []);
  useTestHook(target, 'Uikit view dropdown', rootData);
  useTestHook(list, 'Uikit view dropdown list', listData);
  return <Container ref={target} width={150} height={48} borderRadius={24} backgroundColor={colors.control}
    pointerEvents="listener" onClick={() => setOpen((value) => !value)}>
    <HorizonDropdown ref={ref} open={open} onOpenChange={(value) => setOpen(Boolean(value))} defaultValue="Thread" width="100%" height={48} paddingX={16} paddingY={0}
      fontSize={16} lineHeight={20} borderRadius={24} backgroundColor={colors.control} color={colors.text} pointerEvents="none">
      <HorizonDropdownTextValue placeholder="View" fontSize={16} />
      <HorizonDropdownButton width={24} height={24} />
      <HorizonDropdownList ref={list} backgroundColor={colors.raised} color={colors.text} zIndex={10_000}
        renderOrder={10_000} borderRadius={16} padding={8} gap={8} pointerEvents="auto">
        {['Thread', 'Compose', 'Agents'].map((value) => <HorizonDropdownListItem key={value} value={value}
          minHeight={48} paddingX={16} paddingY={12} borderRadius={12} hover={{ backgroundColor: colors.hover }}>
          <Text fontSize={16} lineHeight={20}>{value}</Text>
        </HorizonDropdownListItem>)}
      </HorizonDropdownList>
    </HorizonDropdown>
  </Container>;
}

function messageText(message: SessionSnapshot['messages'][number], session: SessionSnapshot): { id: string; author: string; meta: string; text: string } {
  const participants = new Map(session.participants.map((participant) => [participant.id, participant]));
  const entry = immersiveMessageEntry(message, participants);
  return { id: entry.id, author: entry.author, meta: entry.meta, text: entry.text };
}

export function UikitConversationSpike({ session, controls, preview, theme, enabled, focused, perform, onController, onScrollState }: {
  session?: SessionSnapshot;
  controls?: ImmersiveConversationControls;
  preview: string;
  theme: ThemeName;
  enabled: boolean;
  focused: boolean;
  perform(action: ImmersiveSemanticAction): void;
  onController(controller?: ConversationHistoryController): void;
  onScrollState(state: ConversationHistoryScrollState): void;
}) {
  const gl = useThree((state) => state.gl);
  const panel = useRef<HorizonPanelImpl>(null);
  const transcript = useRef<import('@react-three/uikit').VanillaContainer>(null);
  const inputTarget = useRef<import('@react-three/uikit').VanillaContainer>(null);
  const input = useRef<HorizonInputImpl>(null);
  const observedTransparentSort = useRef<unknown>(undefined);
  const [scrollY, setScrollY] = useState(0);
  const messages = useMemo(() => session?.messages.map((message) => messageText(message, session)) || [], [session]);
  const colors = immersiveTheme[theme];
  const panelData = useMemo(() => ({ uikitSpike: true, focused }), [focused]);
  useTestHook(panel, 'VR uikit Conversation panel', panelData);
  useLayoutEffect(() => {
    // The React wrapper does not forward Object3D transforms. Set the spike above the retained
    // raster chrome through its Component ref so desktop and XR rays reach uikit first.
    if (panel.current) panel.current.position.set(0, -0.08, 0.008);
  }, []);
  useLayoutEffect(() => {
    const setTransparentSort = gl.setTransparentSort;
    gl.setTransparentSort = (method) => {
      observedTransparentSort.current = method;
      setTransparentSort.call(gl, method);
    };
    return () => { gl.setTransparentSort = setTransparentSort; };
  }, [gl]);
  useLayoutEffect(() => {
    if (!input.current) return;
    input.current.name = 'Uikit input field';
    if (inputTarget.current) {
      inputTarget.current.name = 'Message input';
      Object.assign(inputTarget.current.userData, { immersiveMessageInput: true, immersiveAction: 'message-input', uikitSpike: true });
    }
    input.current.input.element.dataset.immersiveMessageInput = '';
    input.current.input.element.setAttribute('aria-label', 'VR message input');
  }, [input.current]);
  const syncScrollState = useCallback((nextY = transcript.current?.scrollPosition.value[1] || 0) => {
    const maxOffset = transcript.current?.maxScrollPosition.value[1] || 0;
    const state = { offset: nextY, maxOffset, atBottom: maxOffset - nextY < 2, newActivity: false };
    setScrollY(nextY);
    if (transcript.current) transcript.current.userData.immersiveHistory = {
      ...state, visibleMessageIds: messages.map((message) => message.id), uikit: true,
    };
    onScrollState(state);
  }, [messages, onScrollState]);
  const controller = useMemo<ConversationHistoryController>(() => ({
    scroll(delta) {
      const target = transcript.current;
      if (!target || !enabled) return;
      const max = target.maxScrollPosition.value[1] || 0;
      const next = Math.max(0, Math.min(max, target.scrollPosition.value[1] + delta));
      target.scrollPosition.value = [0, next]; syncScrollState(next);
    },
    latest() {
      const target = transcript.current;
      if (!target) return;
      const max = target.maxScrollPosition.value[1] || 0;
      target.scrollPosition.value = [0, max]; syncScrollState(max);
    },
  }), [enabled, syncScrollState]);
  useEffect(() => { onController(controller); return () => onController(undefined); }, [controller, onController]);
  useLayoutEffect(() => {
    const target = transcript.current;
    if (!target) return;
    target.name = 'VR chat messages';
    Object.assign(target.userData, { immersiveAction: 'uikit:transcript', uikitSpike: true, rasterFallback: false });
    const frame = requestAnimationFrame(() => controller.latest());
    return () => cancelAnimationFrame(frame);
  }, [controller, messages.length, preview]);
  useEffect(() => {
    window.__CODEAI_UIKIT_SPIKE__ = () => ({
      enabled: true,
      atlasBytes: ATLAS_BYTES,
      fonts: codeAiUikitFontMetrics.map((font) => ({ ...font })),
      renderer: { textures: gl.info.memory.textures, geometries: gl.info.memory.geometries, programs: gl.info.programs?.length || 0 },
      transparentSortInstalled: observedTransparentSort.current === reversePainterSortStable,
    });
    return () => { delete window.__CODEAI_UIKIT_SPIKE__; };
  }, [gl]);

  return <HorizonPanel ref={panel} width={478} height={456} pixelSize={PIXEL_SIZE} padding={24} gap={16}
    flexDirection="column" backgroundColor={colors.surface} borderColor={colors.surface} borderRadius={24}
    color={colors.text} fontFamilies={codeAiUikitFonts} fontFamily="inter" fontWeight={400}
    depthWrite={false} renderOrder={30} pointerEvents={enabled ? 'auto' : 'none'}>
    <Container height={58} flexShrink={0} flexDirection="row" alignItems="center" justifyContent="space-between" gap={16}>
      <Container flexGrow={1} minWidth={0} flexDirection="column" gap={4}>
        <Text fontSize={24} lineHeight={28} fontWeight={600}>{textForUikitAtlas(session?.title || 'Conversation')}</Text>
        <Text fontSize={14} lineHeight={20} color={colors.secondaryText}>{textForUikitAtlas(controls?.target || 'No active session')}</Text>
      </Container>
      <SpikeDropdown theme={theme} />
    </Container>
    <Container ref={transcript} flexGrow={1} width="100%" overflow="scroll"
      scrollbarWidth={8} scrollbarColor={colors.secondaryText} flexDirection="column" gap={8}
      onScroll={(_x, y) => { syncScrollState(y); }}>
      {messages.map((message) => <Container key={message.id} flexShrink={0} width="100%" padding={16} gap={4}
        flexDirection="column" borderRadius={16} backgroundColor={colors.raised}>
        <Container flexDirection="row" justifyContent="space-between" gap={8}>
          <Text fontSize={14} lineHeight={20} fontWeight={600}>{textForUikitAtlas(message.author)}</Text>
          <Text fontSize={14} lineHeight={20} color={colors.secondaryText}>{textForUikitAtlas(message.meta)}</Text>
        </Container>
        <Text fontSize={18} lineHeight={26} whiteSpace="pre-line" wordBreak="break-word">{textForUikitAtlas(message.text)}</Text>
      </Container>)}
      {preview && <Container flexShrink={0} width="100%" padding={16} borderRadius={16} backgroundColor={colors.control}>
        <Text fontSize={18} lineHeight={26} whiteSpace="pre-line" wordBreak="break-word">{textForUikitAtlas(preview)}</Text>
      </Container>}
    </Container>
    <Container flexShrink={0} width="100%" flexDirection="row" alignItems="center" gap={12}>
      <Container ref={inputTarget} height={48} minWidth={0} flexGrow={1} borderRadius={16}
        backgroundColor={colors.raised} onClick={() => input.current?.input.focus()}>
        <HorizonInput ref={input} value={textForUikitAtlas(controls?.draft || '')} disabled={!enabled || controls?.running || controls?.busy}
          onValueChange={(value) => controls?.onDraft(mergeUikitInputValue(controls?.draft || '', String(value)))} placeholder="What would you like to work on?"
          height={48} width="100%" paddingX={16} borderRadius={16} fontSize={18} lineHeight={26}
          backgroundColor={colors.raised} color={colors.text} />
      </Container>
      <SpikeButton action="conversation:send" label="Send" theme={theme} variant="primary"
        onAction={() => perform('conversation:send')} />
    </Container>
    <Container flexShrink={0} width="100%" height={64} paddingX={12} flexDirection="row" alignItems="center"
      justifyContent="space-between" gap={8} borderRadius={32} backgroundColor={colors.raised}>
      <SpikeButton action="panel:conversation:drag" label="Move" theme={theme} onAction={() => perform('panel:conversation:drag')} />
      <Text fontSize={14} lineHeight={20} fontWeight={600}>Conversation</Text>
      <Container flexDirection="row" gap={8}>
        <SpikeButton action="panel:conversation:resize" label="Size" theme={theme} onAction={() => perform('panel:conversation:resize')} />
        <SpikeButton action="panel:conversation:close" label="Close" theme={theme} variant="negative" onAction={() => perform('panel:conversation:close')} />
      </Container>
    </Container>
    <Container positionType="absolute" positionRight={24} positionBottom={96} paddingX={10} paddingY={6}
      borderRadius={10} backgroundColor={colors.raised} pointerEvents="none" zIndex={9_000} renderOrder={9_000}>
      <Text fontFamily="geistMono" fontSize={14} lineHeight={20}>{`Scroll ${Math.round(scrollY)}`}</Text>
    </Container>
  </HorizonPanel>;
}
