import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import type { Mesh } from 'three';
import type { ThemeName } from '@/shared/design/tokens';
import type { ImmersiveSessionChoice } from '@/features/diagram/spatial/immersiveTypes';
import { immersiveChatLines } from '@/features/diagram/spatial/immersiveTranscript';
import { texturePanel } from '@/features/diagram/spatial/immersiveResources';
import { CONVERSATION_LIST_BATCH_SIZE, formatConversationActivityTime } from './conversationListModel';
import { useTextureResource } from './useTextureResource';
import { useImmersiveScroll } from './useImmersiveScroll';
import { dpToWorld, immersiveFont, immersiveTheme } from './immersiveTheme';

const SIZE = 1_280;
const TOP = 24;
const VIEW_HEIGHT = 1_232;
const ROW_HEIGHT = 264;
const MORE_HEIGHT = 120;
const choiceKey = (choice: ImmersiveSessionChoice) => `${choice.machineId}:${choice.sessionId}`;

export interface ConversationListController { loadMore(): void }

export function ConversationList({ choices, theme, enabled, focused, onOpenSession, onController }: {
  choices: ImmersiveSessionChoice[];
  theme: ThemeName;
  enabled: boolean;
  focused: boolean;
  onOpenSession(choice: ImmersiveSessionChoice): void;
  onController(controller?: ConversationListController): void;
}) {
  const [limit, setLimit] = useState(CONVERSATION_LIST_BATCH_SIZE);
  const [offset, setOffset] = useState(0);
  const [hovered, setHovered] = useState<string>();
  const [now, setNow] = useState(Date.now);
  const mesh = useRef<Mesh>(null);
  const keys = useMemo(() => choices.map(choiceKey), [choices]);
  const previousKeys = useRef(keys);
  const loadedCount = Math.min(limit, choices.length);
  const hasMore = loadedCount < choices.length;
  const maxOffset = Math.max(0, loadedCount * ROW_HEIGHT + (hasMore ? MORE_HEIGHT : 0) - VIEW_HEIGHT);
  const clampOffset = (value: number) => Math.max(0, Math.min(value, maxOffset));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useLayoutEffect(() => {
    // Keep the top visible conversation anchored when activity reorders the live list.
    const oldIndex = Math.floor(offset / ROW_HEIGHT);
    const anchor = previousKeys.current[oldIndex];
    const nextIndex = anchor ? keys.indexOf(anchor) : -1;
    previousKeys.current = keys;
    if (nextIndex >= loadedCount && nextIndex >= 0) {
      setLimit(Math.ceil((nextIndex + 1) / CONVERSATION_LIST_BATCH_SIZE) * CONVERSATION_LIST_BATCH_SIZE);
    }
    const nextOffset = nextIndex >= 0 ? nextIndex * ROW_HEIGHT + offset % ROW_HEIGHT : offset;
    const nextCount = Math.max(loadedCount, nextIndex + 1);
    const nextMax = Math.max(0, nextCount * ROW_HEIGHT + (nextCount < choices.length ? MORE_HEIGHT : 0) - VIEW_HEIGHT);
    setOffset(Math.max(0, Math.min(nextOffset, nextMax)));
  }, [keys]);
  useLayoutEffect(() => setOffset((value) => clampOffset(value)), [maxOffset]);
  const loadMore = useCallback(() => {
    if (enabled) setLimit((value) => Math.min(choices.length, value + CONVERSATION_LIST_BATCH_SIZE));
  }, [enabled, choices.length]);
  useEffect(() => { onController({ loadMore }); return () => onController(undefined); }, [loadMore, onController]);

  const first = Math.floor(offset / ROW_HEIGHT);
  const last = Math.min(loadedCount, Math.ceil((offset + VIEW_HEIGHT) / ROW_HEIGHT));
  const rows = choices.slice(first, last).map((choice, index) => {
    const top = TOP + (first + index) * ROW_HEIGHT - offset;
    const middle = (Math.max(TOP, top) + Math.min(TOP + VIEW_HEIGHT, top + ROW_HEIGHT)) / 2;
    return { choice, top, timeLabel: formatConversationActivityTime(choice.updatedAt, now),
      position: [0, (0.5 - middle / SIZE) * 2.2, 0.001] as [number, number, number] };
  });
  const moreTop = TOP + loadedCount * ROW_HEIGHT - offset;
  const moreVisible = hasMore && moreTop < TOP + VIEW_HEIGHT && moreTop + MORE_HEIGHT > TOP;
  const moreMiddle = (Math.max(TOP, moreTop) + Math.min(TOP + VIEW_HEIGHT, moreTop + MORE_HEIGHT)) / 2;
  const resource = useTextureResource((ledger) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1_024; canvas.height = 1_024;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Conversation list rasterization unavailable.');
    return { ...texturePanel(canvas, [2.2, 2.2], ledger), context };
  }, []);
  useLayoutEffect(() => {
    if (!resource) return;
    const { context } = resource;
    const colors = immersiveTheme[theme];
    try {
      context.setTransform(1_024 / SIZE, 0, 0, 1_024 / SIZE, 0, 0);
      context.fillStyle = colors.surface;
      context.fillRect(0, 0, SIZE, SIZE);
      context.save();
      context.beginPath(); context.rect(0, TOP, SIZE, VIEW_HEIGHT); context.clip();
      for (const { choice, top, timeLabel } of rows) {
        context.fillStyle = hovered === choiceKey(choice) ? colors.raised : colors.surface;
        context.beginPath(); context.roundRect(30, top + dpToWorld(4) * 1_000, 1_190, ROW_HEIGHT - dpToWorld(8) * 1_000, dpToWorld(16) * 1_000); context.fill();
        context.fillStyle = colors.text;
        context.font = immersiveFont('heading', 1_000);
        const title = immersiveChatLines(choice.title, 1_120, 60);
        title.slice(0, 2).forEach((line, index) => context.fillText(`${line}${index === 1 && title.length > 2 ? '…' : ''}`, 44, top + 68 + index * 64, 1_120));
        context.fillStyle = colors.secondaryText;
        context.font = immersiveFont('label', 1_000);
        context.fillText(choice.detail, 44, top + 182, 1_120);
        context.font = immersiveFont('label', 1_000);
        context.fillText(timeLabel, 44, top + 232, 1_120);
      }
      if (moreVisible) {
        context.fillStyle = colors.control;
        context.beginPath(); context.roundRect(44, moreTop + 18, 1_140, 84, 20); context.fill();
        context.fillStyle = colors.text;
        context.font = immersiveFont('button', 1_000);
        context.textAlign = 'center';
        context.fillText('Load more', 614, moreTop + 74);
        context.textAlign = 'left';
      }
      if (!choices.length) {
        context.fillStyle = colors.secondaryText;
        context.font = immersiveFont('reading', 1_000);
        context.fillText('No conversations yet', 44, 130);
      }
      context.restore();
      if (maxOffset > 0) {
        const thumb = Math.max(42, VIEW_HEIGHT * VIEW_HEIGHT / (maxOffset + VIEW_HEIGHT));
        context.fillStyle = colors.control;
        context.beginPath(); context.roundRect(1_250, TOP + (VIEW_HEIGHT - thumb) * offset / maxOffset, 7, thumb, 3); context.fill();
      }
      resource.material.map!.needsUpdate = true;
    } catch {
      context.restore();
      resource.status = 'error';
    }
  }, [resource, choices, offset, limit, theme, now, hovered]);

  const handlers = useImmersiveScroll(mesh, {
    enabled, focused, offset, pageSize: VIEW_HEIGHT, pixelsPerUnit: SIZE / 2.2,
    onOffset: (value) => setOffset(clampOffset(value)),
    onActivate: (point, start) => {
      if (!mesh.current) return;
      const local = mesh.current.worldToLocal(point.clone());
      const y = (0.5 - local.y / 2.2) * SIZE;
      if (Math.abs(local.x) > 1.1 || y < TOP || y >= TOP + VIEW_HEIGHT) return;
      const contentY = y - TOP + offset;
      const index = Math.floor(contentY / ROW_HEIGHT);
      const startY = (0.5 - mesh.current.worldToLocal(start.clone()).y / 2.2) * SIZE;
      if (Math.floor((startY - TOP + offset) / ROW_HEIGHT) !== index) return;
      if (index < loadedCount) onOpenSession(choices[index]);
      else if (hasMore && contentY < loadedCount * ROW_HEIGHT + MORE_HEIGHT) loadMore();
    },
  });
  const hoverRow = (event: ThreeEvent<PointerEvent>) => {
    handlers.onPointerMove(event);
    if (!mesh.current || !enabled) { setHovered(undefined); return; }
    const local = mesh.current.worldToLocal(event.point.clone());
    const y = (0.5 - local.y / 2.2) * SIZE;
    const contentY = y - TOP + offset;
    const index = Math.floor(contentY / ROW_HEIGHT);
    setHovered(Math.abs(local.x) <= 1.1 && y >= TOP && y < TOP + VIEW_HEIGHT && index < loadedCount
      ? choiceKey(choices[index]) : undefined);
  };
  return resource && <mesh ref={mesh} name="Conversation list scroll" geometry={resource.geometry} material={resource.material}
    scale={0.58} position-y={0.01} pointerEvents={enabled ? 'auto' : 'none'}
    userData={{ immersiveConversationList: { offset, maxOffset, loadedCount, visibleSessionIds: rows.map(({ choice }) => choice.sessionId), hasMore,
      rows: rows.map(({ choice, position, timeLabel }) => ({ choice, position, timeLabel })),
      hoveredSessionId: hovered?.split(':').at(-1),
      ...(moreVisible ? { loadMorePosition: [0, (0.5 - moreMiddle / SIZE) * 2.2, 0.001] } : {}) } }}
    {...handlers} onPointerMove={hoverRow} onPointerOut={() => setHovered(undefined)} />;
}
