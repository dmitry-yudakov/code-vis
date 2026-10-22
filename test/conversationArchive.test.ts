import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConversationDrawer } from '@/features/conversation/ConversationDrawer';
import type { ChatMessage, SessionSnapshot } from '@/shared/types';
import { createTurn, updateActivity, finishTurn } from '@/shared/turnActivity';

const reply: ChatMessage = { id: 'reply', role: 'assistant', authorId: 'agent', status: 'complete',
  createdAt: '2026-10-20T00:00:00Z', rawMarkdown: 'Finished.', blocks: [{ kind: 'markdown', markdown: 'Finished.' }] };
const user: ChatMessage = { id: 'user', role: 'user', authorId: 'human', addressedParticipantId: 'agent',
  createdAt: reply.createdAt, status: 'sent', text: 'Please help.', diagramAttachments: [] };

type Props = ComponentProps<typeof ConversationDrawer>;
function drawer(messages: ChatMessage[], overrides: Partial<Props> = {}) {
  return renderToStaticMarkup(createElement(ConversationDrawer, {
    open: true, session: { id: 'session', participants: [], messages, annotations: {}, sketches: [], pinnedDiagramIds: [] } as unknown as SessionSnapshot,
    theme: 'light', agents: [], healthyProviders: [], participantBusy: false, preview: '', toolActivity: [],
    permissions: [], running: false, cancelReady: false, continuing: false, status: '', composer: '',
    mode: 'ask', unsupportedModes: [], modelSelection: {}, attached: [], reports: [], images: [], markCounts: {},
    ...Object.fromEntries(['onSelectDiagram', 'onRetry', 'onComposer', 'onModeChange', 'onModelSelectionChange',
      'onSelectAgent', 'onMakePrimary', 'onAddAgent', 'onHandoff', 'onSend', 'onCancel', 'onRemoveAttachment',
      'onRemoveReport', 'onAddImages', 'onRemoveImage', 'onOpenImage', 'onDecidePermission', 'onExecutePlan',
      'onContinue', 'onNewChat', 'onToggleAttachment', 'onOpenHistory', 'onNewSketch', 'onArchive'].map(key => [key, vi.fn()])),
    ...overrides,
  } as Props)).replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');
}

describe('conversation archive action', () => {
  it('offers Archive only below the final completed reply', () => {
    const html = drawer([{ ...reply, id: 'old' }, user, reply]);
    expect(html.match(/aria-label="Archive session"/g)).toHaveLength(1);
    expect(html.indexOf('aria-label="Archive session"')).toBeGreaterThan(html.lastIndexOf('Finished.'));
    expect(html).toMatch(/<button(?=[^>]*aria-label="Archive session")(?![^>]*disabled="")[^>]*>/);
  });

  it('renders the action once when the final reply is a canonical activity entry', () => {
    const active = updateActivity(createTurn('run', user.id, 'agent', user.createdAt), 1,
      { kind: 'assistant', key: 'final', text: reply.rawMarkdown });
    const turn = finishTurn(active, 'completed', { attempt: 1, messageId: reply.id, key: 'final' });
    const html = drawer([{ ...user, turn }, reply]);
    expect(html.match(/aria-label="Archive session"/g)).toHaveLength(1);
    expect(html.match(/Finished\./g)).toHaveLength(1);
  });

  it.each(([[], [user], [{ ...reply, status: 'failed' }], [reply, user]] as ChatMessage[][]).map(messages => ({ messages })))
    ('does not offer Archive without a final completed assistant reply: $messages', ({ messages }) => {
      expect(drawer(messages)).not.toContain('aria-label="Archive session"');
    });

  it.each(['Wait for this turn to finish.', 'Archiving this session…', 'This execution machine is offline.'])
    ('retains the shared guard and its reason: %s', archiveDisabledReason => {
      const html = drawer([reply], { archiveDisabledReason });
      expect(html).toMatch(/<button(?=[^>]*aria-label="Archive session")(?=[^>]*disabled="")[^>]*>/);
      expect(html).toContain(archiveDisabledReason);
    });
});
