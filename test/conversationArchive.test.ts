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
    expect(html).not.toContain('>Archive</button>');
    expect(html).toContain('aria-label="Copy reply"');
    expect(html.lastIndexOf('<time')).toBeGreaterThan(html.lastIndexOf('Finished.'));
    expect(html).toContain(`dateTime="${reply.createdAt}"`);
    const footer = html.slice(html.lastIndexOf('<footer'));
    expect(footer.indexOf('<time')).toBeLessThan(footer.indexOf('aria-label="Archive session"'));
    expect(footer.indexOf('aria-label="Archive session"')).toBeLessThan(footer.indexOf('aria-label="Copy reply"'));
  });

  it('omits the permanent idle status and shows working progress in the timeline', () => {
    const idle = drawer([reply]);
    expect(idle).not.toContain('Ready for an instruction');
    expect(idle).not.toContain('inline-status');
    const working = drawer([user], { running: true, status: 'Thinking' });
    expect(working).toContain('role="progressbar"');
    expect(working).toContain('aria-label="Thinking"');
    expect(working.indexOf('role="progressbar"')).toBeLessThan(working.indexOf('drawer-composer'));
  });

  it('keeps streaming text and tool progress without a duplicate waiting indicator', () => {
    const turn = updateActivity(createTurn('run', user.id, 'agent', user.createdAt), 1,
      { kind: 'tool', key: 'tool', tool: 'Shell', summary: 'npm test', status: 'running' });
    const working = drawer([{ ...user, turn }], { running: true, turn, status: 'Running tests' });
    expect(working.match(/role="progressbar"/g)).toHaveLength(1);
    const streaming = drawer([user], { running: true, preview: 'Partial answer', status: 'Writing' });
    expect(streaming).toContain('Partial answer');
    expect(streaming).not.toContain('role="progressbar"');
  });

  it('shows waiting progress after completed commentary and tools despite accumulated preview text', () => {
    let turn = updateActivity(createTurn('run', user.id, 'agent', user.createdAt), 1,
      { kind: 'assistant', key: 'commentary', text: 'Earlier commentary', complete: true });
    turn = updateActivity(turn, 1, { kind: 'tool', key: 'tool', tool: 'Read', status: 'succeeded' });
    const html = drawer([{ ...user, turn }], { running: true, turn, preview: 'Earlier commentary', status: 'Working' });
    expect(html).toContain('role="progressbar"');
    expect(html.match(/Earlier commentary/g)).toHaveLength(1);
  });

  it('retains actionable blocked-send feedback and queued/recovery progress', () => {
    const blocked = drawer([reply], { sendBlocked: 'This provider is unavailable.' });
    expect(blocked).toContain('This provider is unavailable.');
    expect(blocked).not.toContain('inline-status');
    const queued = drawer([user], { running: true, liveState: 'queued', status: 'Queued · position 2' });
    expect(queued).toContain('Queued · position 2');
    const reconnecting = drawer([user], { running: true, status: 'Reconnecting to the accepted turn' });
    expect(reconnecting).toContain('aria-label="Reconnecting to the accepted turn"');
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

describe('turn recovery placement', () => {
  const recovery: NonNullable<Props['recovery']> = {
    checkpoint: { id: 'checkpoint', messageId: user.id, createdAt: user.createdAt,
      expiresAt: '2026-10-30T00:00:00Z', state: 'ready', changedFiles: 2 },
    busy: false, confirming: false, onAsk: vi.fn(), onDismiss: vi.fn(), onConfirm: vi.fn(),
  };

  it.each([
    { name: 'ready', changes: {}, text: 'Restore files' },
    { name: 'confirming', changes: { confirming: true }, text: 'Confirm restore' },
    { name: 'busy', changes: { busy: true }, text: 'Restore files' },
    { name: 'failed', changes: { error: 'Newer changes prevent recovery.' }, text: 'Newer changes prevent recovery.' },
    { name: 'restored', changes: { checkpoint: { ...recovery.checkpoint!, state: 'undone' as const } }, text: 'Checkout files restored.' },
  ])('places $name recovery before its user message and activity', ({ changes, text }) => {
    const active = updateActivity(createTurn('run', user.id, 'agent', user.createdAt), 1,
      { kind: 'assistant', key: 'final', text: reply.rawMarkdown });
    const turn = finishTurn(active, 'completed', { attempt: 1, messageId: reply.id, key: 'final' });
    const html = drawer([{ ...reply, id: 'earlier', rawMarkdown: 'Earlier reply', blocks: [{ kind: 'markdown', markdown: 'Earlier reply' }] },
      { ...user, turn }, reply], { recovery: { ...recovery, ...changes } });
    expect(html.match(/aria-label="Turn recovery"/g)).toHaveLength(1);
    expect(html).toContain(text);
    expect(html.indexOf('aria-label="Turn recovery"')).toBeGreaterThan(html.indexOf('Earlier reply'));
    expect(html.indexOf('aria-label="Turn recovery"')).toBeLessThan(html.indexOf('Please help.'));
    expect(html.indexOf(text)).toBeLessThan(html.lastIndexOf('Finished.'));
    if (changes.busy) expect(html).toMatch(/<button(?=[^>]*disabled="")[^>]*>Restore files<\/button>/);
  });

  it('keeps errors without a checkpoint visible', () => {
    expect(drawer([user, reply], { recovery: { ...recovery, checkpoint: undefined, error: 'Could not read recovery status.' } }))
      .toContain('Could not read recovery status.');
  });
});
