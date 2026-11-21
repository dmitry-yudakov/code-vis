import { isAgentMode } from '@/shared/agentModes';
import { MAX_IMAGES_PER_MESSAGE, MAX_MESSAGE_TEXT_CHARS } from '@/shared/limits';
import type { AgentMode, ModelSelection } from '@/shared/types';
import { parseModelSelection } from '@/features/shell/workspaceViews';
import type { PendingImage } from '@/features/conversation/imageAttachments';

export const ARENA_REPLY_STORAGE_KEY = 'code-ai:tab:arena-replies:v1';
export interface ArenaReplyState {
  text: string;
  /** Prepared pixels stay in memory, like the conversation composer's images. */
  images?: PendingImage[];
  preparing?: boolean;
  /** Only the captured request identity/choices; never a canonical conversation snapshot. */
  delivery?: { messageId: string; participantId: string; mode: AgentMode; modelSelection: ModelSelection; imageCount?: number };
  busy?: boolean;
  error?: string;
  feedback?: string;
  sent?: boolean;
}
const EMPTY_REPLY: ArenaReplyState = { text: '' };

/** Only the edited tile subscribes to its draft; typing never updates the surrounding shell. */
export function createArenaReplyStore() {
  let drafts: Record<string, ArenaReplyState> = {};
  const listeners = new Map<string, Set<() => void>>();
  return {
    get: (key: string) => drafts[key] || EMPTY_REPLY,
    all: () => drafts,
    load(next: Record<string, ArenaReplyState>) {
      drafts = next;
      for (const group of listeners.values()) for (const listener of group) listener();
    },
    patch(key: string, update: Partial<ArenaReplyState>) {
      drafts = { ...drafts, [key]: { ...(drafts[key] || EMPTY_REPLY), ...update } };
      for (const listener of listeners.get(key) || []) listener();
    },
    subscribe(key: string, listener: () => void) {
      const group = listeners.get(key) || new Set();
      group.add(listener); listeners.set(key, group);
      return () => { group.delete(listener); if (!group.size) listeners.delete(key); };
    },
  };
}
export function parseArenaReplies(value: string | null): Record<string, ArenaReplyState> {
  try {
    const parsed = JSON.parse(value || '');
    if (parsed?.version !== 1 || !parsed.drafts || typeof parsed.drafts !== 'object') return {};
    const result: Record<string, ArenaReplyState> = {};
    for (const [key, raw] of Object.entries(parsed.drafts)) {
      const draft = raw as ArenaReplyState | null;
      if (!/^[a-f\d-]{36}:[a-f\d-]{36}$/i.test(key) || !draft || typeof draft.text !== 'string' || draft.text.length > MAX_MESSAGE_TEXT_CHARS) continue;
      const delivery = draft.delivery;
      if (delivery && (!/^[a-f\d-]{36}$/i.test(delivery.messageId) || typeof delivery.participantId !== 'string' || !delivery.participantId || !isAgentMode(delivery.mode))) continue;
      if (delivery?.imageCount !== undefined && (!Number.isInteger(delivery.imageCount) || delivery.imageCount < 0 || delivery.imageCount > MAX_IMAGES_PER_MESSAGE)) continue;
      result[key] = { text: draft.text, ...(delivery ? { delivery: {
        messageId: delivery.messageId, participantId: delivery.participantId, mode: delivery.mode, modelSelection: parseModelSelection(delivery.modelSelection) || {},
        ...(delivery.imageCount !== undefined ? { imageCount: delivery.imageCount } : {}),
      } } : {}) };
    }
    return result;
  } catch { return {}; }
}
export function serializeArenaReplies(drafts: Record<string, ArenaReplyState>): string {
  return JSON.stringify({ version: 1, drafts: Object.fromEntries(Object.entries(drafts)
    .filter(([, draft]) => draft.text || draft.delivery)
    .map(([key, { text, delivery }]) => [key, { text, delivery }])) });
}
