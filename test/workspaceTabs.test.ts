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
    runsBySession: {}, unreadBySession: {}, onFocus: vi.fn(), onClose: vi.fn(),
    canArchive: true, onArchive: vi.fn(),
    ...props,
  })).replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');
}

describe('workspace tabs', () => {
  it('keeps session actions outside the tablist accessibility tree', () => {
    const markup = tabs();
    const tablist = markup.match(/<div[^>]*role="tablist"[\s\S]*?<\/div>/)?.[0];
    expect(tablist).toBeDefined();
    expect(tablist).toContain('role="tab"');
    expect(tablist).not.toContain('workspace-session-actions');
    expect(markup.indexOf('workspace-session-actions')).toBeGreaterThan(markup.indexOf(tablist!));
    expect(markup).toContain('aria-label="Archive session"');
    expect(markup).toContain('aria-label="Session actions"');
    expect(markup).not.toContain('Close focused view');
    expect(markup).not.toContain('workspace-tab-close');
  });

  it.each(['running', 'queued', 'needs-you'] as const)('retains %s status and the shell archive guard', (state) => {
    const markup = tabs({ canArchive: false, runsBySession: { [SESSION_A]: { state, status: state, pendingApprovals: 1 } } });
    expect(markup).toMatch(/<button(?=[^>]*aria-label="Archive session")(?=[^>]*disabled="")[^>]*>/);
    expect(markup).toContain(`First session — ${state}`);
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
    expect(markup.match(/<button(?=[^>]*role="tab")(?=[^>]*tabindex="0")[^>]*>/g)).toHaveLength(1);
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
