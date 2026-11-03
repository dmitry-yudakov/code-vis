import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceTabs } from '@/features/conversation/WorkspaceTabs';
import { SessionPicker } from '@/features/conversation/SessionPicker';
import type { SessionSnapshot } from '@/shared/types';

const SESSION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function tabs(props: Partial<ComponentProps<typeof WorkspaceTabs>> = {}) {
  return renderToStaticMarkup(createElement(WorkspaceTabs, {
    sessions: [{ id: SESSION_A, title: 'First session' }, { id: SESSION_B, title: 'Second session' }] as SessionSnapshot[],
    openSessionIds: [SESSION_A, SESSION_B], focusedSessionId: SESSION_A,
    runsBySession: {}, unreadBySession: {}, onFocus: vi.fn(), onClose: vi.fn(), onArchive: vi.fn(),
    ...props,
  })).replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');
}

describe('workspace tabs', () => {
  it('puts a named archive button on every tab without nested native buttons or detached actions', () => {
    const markup = tabs();
    expect(markup).toContain('aria-label="Archive this session: First session"');
    expect(markup).toContain('aria-label="Archive this session: Second session"');
    expect(markup.match(/title="Archive this session"/g)).toHaveLength(2);
    expect(markup).not.toContain('aria-label="Archive session"');
    expect(markup).not.toContain('aria-label="Session actions"');
    expect(markup).not.toMatch(/<button[^>]*role="tab"/);
    expect(markup.match(/class="[^"]*workspace-tab-close/g)).toHaveLength(2);
  });

  it.each(['running', 'queued', 'needs-you'] as const)('protects only the %s tab while retaining its status', (state) => {
    const markup = tabs({ runsBySession: { [SESSION_A]: { state, status: state, pendingApprovals: 1 } } });
    expect(markup).toMatch(/<button(?=[^>]*aria-label="Archive this session: First session")(?=[^>]*disabled="")[^>]*>/);
    expect(markup).toMatch(/<button(?=[^>]*aria-label="Archive this session: Second session")(?![^>]*disabled="")[^>]*>/);
    expect(markup).toContain(`First session — ${state}`);
  });

  it('protects a background tab during preparation or an archive request', () => {
    const markup = tabs({ closeDisabledReasons: { [SESSION_B]: 'Archiving this session…' } });
    expect(markup).toMatch(/<button(?=[^>]*aria-label="Archive this session: Second session")(?=[^>]*disabled="")[^>]*>/);
    expect(markup).toContain('Archiving this session…');
  });

  it('disables archive with its offline reason', () => {
    const markup = tabs({ archiveDisabledReasons: { [SESSION_B]: 'This execution machine is offline.' } });
    expect(markup).toMatch(/<button(?=[^>]*aria-label="Archive this session: Second session")(?=[^>]*disabled="")[^>]*>/);
    expect(markup).toContain('title="This execution machine is offline."');
  });

  it('retains queue, approval and unread indicators after presentation changes', () => {
    const markup = tabs({
      runsBySession: {
        [SESSION_A]: { state: 'queued', status: 'Queued · position 2', queuePosition: 2, pendingApprovals: 0 },
        [SESSION_B]: { state: 'needs-you', status: 'Needs you', pendingApprovals: 3 },
      },
      unreadBySession: { [SESSION_B]: 4 },
    });
    expect(markup).toContain('class="queue-badge">Q2');
    expect(markup).toContain('class="approval-badge">3');
    expect(markup).toContain('class="unread-badge">4');
    expect(markup.match(/<div(?=[^>]*role="tab")(?=[^>]*tabindex="0")[^>]*>/g)).toHaveLength(1);
  });
});

describe('All sessions picker', () => {
  it('lists the full scope and provides a placeholder when its last view closes', () => {
    const markup = renderToStaticMarkup(createElement(SessionPicker, {
      sessions: [{ id: SESSION_A, title: 'Closed view', participants: [] },
        { id: SESSION_B, title: 'Overflow view', participants: [] }] as unknown as SessionSnapshot[],
      newProvider: 'claude', creating: false, checkouts: [], onChange: vi.fn(),
      onNewProvider: vi.fn(), onNew: vi.fn(),
    }));
    expect(markup).toMatch(/<select(?=[^>]*id="all-sessions")(?=[^>]*aria-label="All sessions")(?=[^>]*title="All sessions")[^>]*>/);
    expect(markup).toContain('<option value="" disabled="" selected="">Choose a session</option>');
    expect(markup).toContain('Closed view');
    expect(markup).toContain('Overflow view');
    expect(markup).toMatch(/<button(?=[^>]*aria-label="New session")(?=[^>]*title="New session")[^>]*>/);
    expect(markup).not.toContain('aria-label="Session"');
    expect(markup).toContain('class="all-sessions-label"');
    expect(markup).toContain('All sessions <span>⌄</span>');
  });
});
