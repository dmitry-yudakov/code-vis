import type { AgentMode, AgentParticipant, AgentProvider, AgentRole } from '@/shared/types';

/** Commands are supplied by AppShell and capture their session/machine at render time. */
export interface ImmersiveConversationControls {
  draft: string;
  target: string;
  attachments: string[];
  canSend: boolean;
  running: boolean;
  runStatus: string;
  runId?: string;
  cancelKey?: string;
  busy: boolean;
  agents: AgentParticipant[];
  activeAgentId?: string;
  primaryAgentId?: string;
  providers: AgentProvider[];
  mode: AgentMode;
  unsupportedModes: AgentMode[];
  onDraft(value: string): void;
  onSend(): void;
  onCancel(): void;
  onMode(mode: AgentMode): void;
  onSelectAgent(id: string): void;
  onAddAgent(provider: AgentProvider, role: AgentRole): void;
  onMakePrimary(id: string): void;
}

export const CONVERSATION_ACTIONS = {
  read: 'Read', compose: 'Compose', agents: 'Agents', latest: 'Latest', help: 'Voice help',
  record: 'Dictate', retry: 'Retry voice', stop: 'Stop recording', discard: 'Discard speech',
  append: 'Append', replace: 'Replace word', 'replace-all': 'Replace all', spell: 'Spell',
  'previous-word': 'Previous word', 'next-word': 'Next word', delete: 'Delete word', clear: 'Clear draft',
  undo: 'Undo edit', newline: 'New line', 'draft-older': 'Previous page', 'draft-newer': 'Next page',
  send: 'Send', cancel: 'Cancel run', 'previous-agent': 'Previous agent', 'next-agent': 'Next agent',
  ask: 'Ask', plan: 'Plan', agent: 'Agent', 'make-primary': 'Make main',
  provider: 'Provider', role: 'Role', add: 'Add agent',
  edit: 'Speech tools', done: 'Done',
  list: 'Conversations', back: 'Back to conversation',
} as const;
export type ConversationActionName = keyof typeof CONVERSATION_ACTIONS;
export type ConversationAction = `conversation:${ConversationActionName}`;

export function centeredControlRow<T>(items: readonly { key: T; width: number }[], gap = 0.02): Map<T, number> {
  const totalWidth = items.reduce((total, item) => total + item.width, 0) + Math.max(0, items.length - 1) * gap;
  let cursor = -totalWidth / 2;
  return new Map(items.map((item) => {
    const center = cursor + item.width / 2;
    cursor += item.width + gap;
    return [item.key, center];
  }));
}
