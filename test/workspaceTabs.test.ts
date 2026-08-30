import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceTabs } from '@/features/conversation/WorkspaceTabs';
import type { SessionSnapshot } from '@/shared/types';

const SESSION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('workspace tabs', () => {
  it('keeps close controls outside the tablist accessibility tree', () => {
    const sessions = [
      { id: SESSION_A, title: 'First session' },
      { id: SESSION_B, title: 'Second session' },
    ] as SessionSnapshot[];
    const markup = renderToStaticMarkup(createElement(WorkspaceTabs, {
      sessions,
      openSessionIds: [SESSION_A, SESSION_B],
      focusedSessionId: SESSION_A,
      runningSessionId: undefined,
      approvalCount: 0,
      unreadBySession: {},
      onFocus: vi.fn(),
      onClose: vi.fn(),
    }));
    const tablist = markup.match(/<div class="workspace-tablist"[\s\S]*?<\/div>/)?.[0];
    expect(tablist).toBeDefined();
    expect(tablist).toContain('role="tab"');
    expect(tablist).not.toContain('workspace-tab-close');
    expect(markup.indexOf('workspace-tab-close')).toBeGreaterThan(markup.indexOf(tablist!));
  });
});
