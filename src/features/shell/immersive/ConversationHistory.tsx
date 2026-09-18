import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Mesh } from 'three';
import type { ThemeName } from '@/shared/design/tokens';
import type { SessionSnapshot } from '@/shared/types';
import { immersiveConversationVersion } from '@/features/diagram/spatial/immersiveTranscript';
import { buildConversationHistory, historyScrollState, updateHistoryScroll, visibleHistoryEntries, HISTORY_SIZE, HISTORY_VIEW_HEIGHT, type ConversationHistoryScrollState } from './conversationHistoryModel';
import { createConversationHistoryResource, paintConversationHistory } from './conversationHistoryResource';
import { useTextureResource } from './useTextureResource';
import { useImmersiveScroll } from './useImmersiveScroll';

export type { ConversationHistoryScrollState } from './conversationHistoryModel';
export interface ConversationHistoryController { scroll(delta: number): void; latest(): void }

export function ConversationHistory({ session, preview, theme, runStatus, pendingApprovals, unread, enabled, visible, focused = enabled, onController, onScrollState }: {
  session?: SessionSnapshot;
  preview: string;
  theme: ThemeName;
  runStatus: string;
  pendingApprovals: number;
  unread: number;
  enabled: boolean;
  visible: boolean;
  focused?: boolean;
  onController(controller?: ConversationHistoryController): void;
  onScrollState(state: ConversationHistoryScrollState): void;
}) {
  const history = useMemo(() => buildConversationHistory(session, preview), [session?.messages, session?.participants, session?.addressedAgentId, session?.primaryAgentId, preview]);
  const key = `${session?.machineId || ''}:${session?.id || ''}`;
  const version = session ? immersiveConversationVersion(session, preview) : '';
  const previous = useRef({ key, version });
  const [scrollState, setScrollState] = useState(() => historyScrollState(Infinity, history.height));
  const current = useRef({ history, enabled, visible, scrollState });
  current.current = { history, enabled, visible, scrollState };
  useLayoutEffect(() => {
    const changedSession = previous.current.key !== key;
    const changed = previous.current.version !== version;
    previous.current = { key, version };
    setScrollState((value) => changedSession ? historyScrollState(Infinity, history.height) : updateHistoryScroll(value, history.height, changed));
  }, [key, version, history.height]);
  useEffect(() => onScrollState(scrollState), [onScrollState, scrollState]);

  const controller = useMemo<ConversationHistoryController>(() => ({
    scroll(delta) {
      if (!current.current.enabled || !current.current.visible || !Number.isFinite(delta)) return;
      setScrollState((value) => {
        const next = historyScrollState(value.offset + delta, current.current.history.height, value.newActivity);
        return next.offset === value.offset && next.maxOffset === value.maxOffset && next.newActivity === value.newActivity ? value : next;
      });
    },
    latest() {
      if (current.current.enabled) setScrollState(historyScrollState(Infinity, current.current.history.height));
    },
  }), []);
  useEffect(() => { onController(controller); return () => onController(undefined); }, [controller, onController]);
  const resource = useTextureResource((ledger) => visible ? createConversationHistoryResource(ledger) : undefined, [visible]);
  useLayoutEffect(() => {
    if (resource && visible) {
      paintConversationHistory(resource, history.entries, scrollState, theme, runStatus, pendingApprovals, unread);
      if (mesh.current) mesh.current.userData.conversationStatus = resource.status;
    }
  }, [resource, visible, history, scrollState, theme, runStatus, pendingApprovals, unread]);

  const mesh = useRef<Mesh>(null);
  const scrollHandlers = useImmersiveScroll(mesh, {
    enabled: enabled && visible, focused, offset: scrollState.offset,
    pageSize: HISTORY_VIEW_HEIGHT, pixelsPerUnit: HISTORY_SIZE / 2.2,
    onOffset: (offset) => controller.scroll(offset - scrollState.offset),
  });
  if (!resource) return null;
  return <mesh ref={mesh} name="VR chat messages" geometry={resource.geometry} material={resource.material}
    scale={0.58} position-y={0.01} visible={visible} renderOrder={5} pointerEvents={enabled && visible ? 'auto' : 'none'}
    userData={{ immersiveHistory: { ...scrollState, visibleMessageIds: visibleHistoryEntries(history.entries, scrollState.offset).map((item) => item.entry.id) }, conversationStatus: resource.status }}
    {...scrollHandlers} />;
}
