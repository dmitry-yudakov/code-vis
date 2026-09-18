import type { ThemeName } from '@/shared/design/tokens';
import { texturePanel } from '@/features/diagram/spatial/immersiveResources';
import type { SpatialResourceLedger } from '@/features/diagram/spatial/resourceLedger';
import { IMMERSIVE_CHAT_LINE_HEIGHT, IMMERSIVE_CHAT_TEXT_WIDTH } from '@/features/diagram/spatial/immersiveTranscript';
import { HISTORY_SIZE, HISTORY_TOP, HISTORY_VIEW_HEIGHT, visibleHistoryEntries, type HistoryEntry, type ConversationHistoryScrollState } from './conversationHistoryModel';
import { dpToWorld, immersiveFont, immersiveTheme, immersiveRadii } from './immersiveTheme';

export function createConversationHistoryResource(ledger: SpatialResourceLedger) {
  const canvas = document.createElement('canvas');
  canvas.width = 1_024;
  canvas.height = 1_024;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Conversation rasterization unavailable.');
  return { ...texturePanel(canvas, [2.2, 2.2], ledger), context };
}

export function paintConversationHistory(resource: ReturnType<typeof createConversationHistoryResource>, entries: HistoryEntry[], scroll: ConversationHistoryScrollState,
  theme: ThemeName, status: string, pendingApprovals: number, unread: number): void {
  try {
    drawConversationHistory(resource, entries, scroll, theme, status, pendingApprovals, unread);
    resource.status = window.__CODEAI_XR_TEST__?.failTranscript ? 'error' : 'ready';
    resource.detail = undefined;
  } catch (error) {
    resource.status = 'error';
    resource.detail = error instanceof Error ? error.message : 'Conversation rasterization failed.';
    // Keep the surrounding navigation available even if the canvas implementation fails.
    try {
      const context = resource.context;
      context.restore();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.fillStyle = immersiveTheme[theme].surface;
      context.fillRect(0, 0, 1_024, 1_024);
      context.fillStyle = immersiveTheme[theme].negative;
      context.font = immersiveFont('reading', 1_000);
      context.fillText('Conversation unavailable', 40, 150);
      resource.material.map!.needsUpdate = true;
    } catch { /* A broken drawing context must not end the immersive session. */ }
  }
}

function drawConversationHistory(resource: ReturnType<typeof createConversationHistoryResource>, entries: HistoryEntry[], scroll: ConversationHistoryScrollState,
  theme: ThemeName, status: string, pendingApprovals: number, unread: number): void {
  const context = resource.context;
  const colors = immersiveTheme[theme];
  context.setTransform(1_024 / HISTORY_SIZE, 0, 0, 1_024 / HISTORY_SIZE, 0, 0);
  context.fillStyle = colors.surface;
  context.fillRect(0, 0, HISTORY_SIZE, HISTORY_SIZE);
  context.textAlign = 'left';
  context.fillStyle = colors.secondaryText;
  context.font = immersiveFont('label', 1_000);
  context.fillText(pendingApprovals ? `${pendingApprovals} approval${pendingApprovals === 1 ? '' : 's'} waiting · ${status}` : status, 48, 52, 880);
  context.textAlign = 'right';
  context.fillStyle = scroll.newActivity ? colors.positive : colors.secondaryText;
  context.fillText(scroll.newActivity ? 'New activity' : unread ? `${unread} unread` : '', 1_232, 52, 300);
  context.textAlign = 'left';
  context.save();
  context.beginPath();
  context.rect(0, HISTORY_TOP, HISTORY_SIZE, HISTORY_VIEW_HEIGHT);
  context.clip();
  const failure = window.__CODEAI_XR_TEST__?.failTranscript;
  if (failure || entries.length === 0) {
    context.font = immersiveFont('reading', 1_000);
    context.fillStyle = failure ? colors.negative : colors.secondaryText;
    context.fillText(failure ? 'Conversation unavailable' : 'Start a conversation', 48, 220);
  } else for (const item of visibleHistoryEntries(entries, scroll.offset)) {
    const { entry, lines } = item;
    const y = HISTORY_TOP + item.top - scroll.offset;
    const isUser = entry.role === 'user';
    // Full width for multiline bubbles avoids measuring entire long messages per frame.
    context.font = immersiveFont('reading', 1_000);
    const width = lines.length > 1 ? IMMERSIVE_CHAT_TEXT_WIDTH + 56
      : Math.min(IMMERSIVE_CHAT_TEXT_WIDTH + 56, Math.max(180, context.measureText(lines[0]).width + 56));
    const x = isUser ? 1_232 - width : 48;
    const state = entry.state && !['sent', 'complete'].includes(entry.state) ? entry.state : '';
    context.textAlign = isUser ? 'right' : 'left';
    context.fillStyle = colors.secondaryText;
    context.font = immersiveFont('label', 1_000);
    context.fillText(`${isUser ? 'You' : entry.author}${state ? ` · ${state}` : ''}`, isUser ? x + width - 12 : x + 12, y + 32, IMMERSIVE_CHAT_TEXT_WIDTH);
    context.textAlign = 'left';
    context.fillStyle = isUser ? colors.raised : colors.control;
    context.beginPath();
    const radius = dpToWorld(immersiveRadii.bubble) * 1_000;
    const tail = radius / 4;
    context.roundRect(x, y + 52, width, lines.length * IMMERSIVE_CHAT_LINE_HEIGHT + 36,
      isUser ? [radius, radius, tail, radius] : [radius, radius, radius, tail]);
    context.fill();
    context.fillStyle = colors.text;
    context.font = immersiveFont('reading', 1_000);
    const first = Math.max(0, Math.floor((HISTORY_TOP - y - 122) / IMMERSIVE_CHAT_LINE_HEIGHT));
    const last = Math.min(lines.length, Math.ceil((HISTORY_TOP + HISTORY_VIEW_HEIGHT - y - 122) / IMMERSIVE_CHAT_LINE_HEIGHT) + 1);
    for (let index = first; index < last; index += 1) context.fillText(lines[index], x + 28, y + 122 + index * IMMERSIVE_CHAT_LINE_HEIGHT, IMMERSIVE_CHAT_TEXT_WIDTH);
  }
  context.restore();
  if (scroll.maxOffset > 0) {
    const track = HISTORY_VIEW_HEIGHT;
    const thumb = Math.max(42, track * track / (scroll.maxOffset + track));
    context.fillStyle = colors.control;
    context.beginPath();
    context.roundRect(1_258, HISTORY_TOP + (track - thumb) * scroll.offset / scroll.maxOffset, 7, thumb, 3);
    context.fill();
  }
  resource.material.map!.needsUpdate = true;
}
