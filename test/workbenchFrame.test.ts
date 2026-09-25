import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ActivityBar } from '@/features/shell/ActivityBar';
import { LayoutToggles } from '@/features/shell/LayoutToggles';
import { RepositorySidebar } from '@/features/repository/RepositorySidebar';

function activityBar(props: Partial<ComponentProps<typeof ActivityBar>> = {}) {
  return renderToStaticMarkup(createElement(ActivityBar, {
    views: ['changes', 'history'],
    unread: 0,
    onToggleView: vi.fn(),
    more: createElement('button', { type: 'button' }, 'Export session'),
    ...props,
  }));
}

/** Accessible names of the bar's controls, in order. */
function controlNames(markup: string): string[] {
  return [...markup.matchAll(/<(?:button|a|summary)\b[^>]*aria-label="([^"]+)"/g)].map((match) => match[1]);
}

describe('activity bar', () => {
  it('lists the session views, then the Arena and the Inbox, then More', () => {
    const markup = activityBar();
    expect(markup).toMatch(/^<nav class="activity-bar" aria-label="Views">/);
    expect(controlNames(markup)).toEqual(['Changes', 'History', 'Arena', 'Inbox', 'More']);
    expect(markup).toContain('href="/arena"');
    expect(markup).toContain('href="/arena/inbox"');
    // Each control names itself for the pointer as well as for assistive technology.
    expect(markup.match(/<(?:button|a|summary)\b[^>]*title="/g)).toHaveLength(5);
  });

  it('offers Reports only where it is given, which is CodeAI\'s own project', () => {
    expect(controlNames(activityBar({ views: ['changes', 'history', 'reports'] })))
      .toEqual(['Changes', 'History', 'Reports', 'Arena', 'Inbox', 'More']);
  });

  it('has no session views on the Arena page or the welcome screen', () => {
    expect(controlNames(activityBar({ views: [] }))).toEqual(['Arena', 'Inbox', 'More']);
  });

  it('presses only the view the side panel shows', () => {
    const closed = activityBar();
    expect(closed).not.toContain('aria-pressed="true"');
    expect(closed.match(/aria-pressed="false"/g)).toHaveLength(2);
    const history = activityBar({ shownView: 'history' });
    expect(history).toMatch(/aria-label="History" aria-pressed="true"/);
    expect(history).toMatch(/aria-label="Changes" aria-pressed="false"/);
  });

  it('counts the changed files on Changes and the unread items on the Inbox', () => {
    const markup = activityBar({ changeCount: 7, unread: 2 });
    expect(controlNames(markup)).toEqual(['Changes, 7 files', 'History', 'Arena', 'Inbox, 2 unread', 'More']);
    expect(markup).toMatch(/<span class="activity-badge"[^>]*>7<\/span>/);
    expect(markup).toMatch(/<span class="activity-badge attention"[^>]*>2<\/span>/);
    expect(controlNames(activityBar({ changeCount: 1 }))[0]).toBe('Changes, 1 file');
    expect(activityBar({ changeCount: 0 })).not.toContain('activity-badge');
  });

  it('marks the Arena section that is open', () => {
    expect(activityBar({ views: [], arenaSection: 'inbox' })).toMatch(/aria-current="page"[^>]*aria-label="Inbox"|aria-label="Inbox"[^>]*aria-current="page"/);
    expect(activityBar({ views: [], arenaSection: 'sessions' })).toMatch(/aria-current="page"[^>]*aria-label="Arena"|aria-label="Arena"[^>]*aria-current="page"/);
    expect(activityBar({ views: [], arenaSection: 'archived' })).not.toContain('aria-current');
    expect(activityBar()).not.toContain('aria-current');
  });

  it('keeps More\'s contents in its menu', () => {
    expect(activityBar()).toMatch(/<details class="more-menu"><summary aria-label="More" title="More">[\s\S]*<\/summary><div>[\s\S]*Export session/);
  });
});

describe('side panel', () => {
  const panel = (tab: 'changes' | 'history' | 'reports', reports?: string) => renderToStaticMarkup(createElement(RepositorySidebar, {
    repositoryName: 'alpha',
    open: true,
    tab,
    history: createElement('p', null, 'History body'),
    reports: reports ? createElement('p', null, reports) : undefined,
    children: createElement('p', null, 'Changes body'),
  }));

  it('names its view in its header instead of offering tabs or a close button', () => {
    const changes = panel('changes');
    expect(changes).toMatch(/<h2 class="side-panel-title">Changes<\/h2>/);
    expect(changes).not.toContain('side-panel-tabs');
    expect(changes).not.toContain('Close side panel');
    expect(panel('history')).toMatch(/<h2 class="side-panel-title">History<\/h2>[\s\S]*History body/);
    expect(panel('reports', 'Reports body')).toMatch(/<h2 class="side-panel-title">Reports<\/h2>[\s\S]*Reports body/);
  });

  it('falls back to Changes where a remembered Reports view is unavailable', () => {
    expect(panel('reports')).toMatch(/<h2 class="side-panel-title">Changes<\/h2>[\s\S]*Changes body/);
  });
});

describe('layout icons', () => {
  const toggles = (props: Partial<ComponentProps<typeof LayoutToggles>> = {}) => renderToStaticMarkup(createElement(LayoutToggles, {
    canvasShown: true,
    canvasToggleable: true,
    conversationShown: true,
    approvals: 0,
    unread: 0,
    onToggleCanvas: vi.fn(),
    onToggleConversation: vi.fn(),
    ...props,
  }));

  it('offers Canvas and Conversation as pressed toggles with tooltips', () => {
    const markup = toggles();
    expect(markup).toMatch(/^<div class="layout-toggles" role="group" aria-label="Layout">/);
    expect(controlNames(markup)).toEqual(['Canvas', 'Conversation']);
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(markup).toContain('title="Hide the canvas"');
    expect(markup).toContain('title="Close the conversation"');
    const hidden = toggles({ canvasShown: false });
    expect(hidden).toMatch(/aria-label="Canvas" aria-pressed="false" title="Show the canvas"/);
    const closed = toggles({ conversationShown: false });
    expect(closed).toMatch(/aria-label="Conversation" aria-pressed="false" title="Open the conversation"/);
  });

  it('does not offer Canvas where the panels overlay it', () => {
    expect(controlNames(toggles({ canvasToggleable: false }))).toEqual(['Conversation']);
  });

  it('badges a closed conversation with its approvals, else its unread replies', () => {
    const approval = toggles({ conversationShown: false, approvals: 1, unread: 3 });
    expect(controlNames(approval)).toEqual(['Canvas', 'Conversation, 1 action waiting for your approval']);
    expect(approval).toMatch(/<span class="layout-badge attention"[^>]*>1<\/span>/);
    expect(controlNames(toggles({ conversationShown: false, approvals: 2 }))[1]).toBe('Conversation, 2 actions waiting for your approval');
    const unread = toggles({ conversationShown: false, unread: 3 });
    expect(controlNames(unread)[1]).toBe('Conversation, 3 unread');
    expect(unread).toMatch(/<span class="layout-badge"[^>]*>3<\/span>/);
    // The open conversation already shows both.
    const open = toggles({ approvals: 1, unread: 3 });
    expect(controlNames(open)[1]).toBe('Conversation');
    expect(open).not.toContain('layout-badge');
  });
});
