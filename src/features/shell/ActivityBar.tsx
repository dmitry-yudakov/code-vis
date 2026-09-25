'use client';

import Link from 'next/link';
import type { ReactNode, RefObject, SyntheticEvent } from 'react';
import { ARENA_SECTION_PATHS, type ArenaSection } from '@/features/arena/routes';
import type { SideTab } from './panelLayout';
import { ShellIcon } from './ShellIcon';

const VIEW_LABELS: Record<SideTab, string> = { changes: 'Changes', history: 'History', reports: 'Reports' };

/**
 * The column of views beside the side panel. The session's views toggle the side panel; the Arena
 * and the Inbox are pages of their own until they become side-panel views (Story 75). More sits at
 * the bottom, as a gear.
 */
export function ActivityBar({ views, shownView, changeCount = 0, arenaSection, unread, more, moreRef, onMoreToggle, onToggleView }: {
  /** Empty where no session is shown: the Arena page and the welcome screen. */
  views: readonly SideTab[];
  shownView?: SideTab;
  changeCount?: number;
  arenaSection?: ArenaSection;
  unread: number;
  more: ReactNode;
  moreRef?: RefObject<HTMLDetailsElement | null>;
  onMoreToggle?(event: SyntheticEvent<HTMLDetailsElement>): void;
  onToggleView(view: SideTab): void;
}) {
  return (
    <nav className="activity-bar" aria-label="Views">
      {views.map((view) => {
        const count = view === 'changes' ? changeCount : 0;
        return (
          <button
            key={view}
            type="button"
            className="activity-item"
            aria-label={count ? `${VIEW_LABELS[view]}, ${count} ${count === 1 ? 'file' : 'files'}` : VIEW_LABELS[view]}
            aria-pressed={shownView === view}
            title={VIEW_LABELS[view]}
            onClick={() => onToggleView(view)}
          >
            <ShellIcon name={view} />
            {count > 0 && <span className="activity-badge" aria-hidden="true">{count}</span>}
          </button>
        );
      })}
      {views.length > 0 && <span className="activity-divider" aria-hidden="true" />}
      <Link
        href={ARENA_SECTION_PATHS.sessions}
        scroll={false}
        className="activity-item"
        aria-label="Arena"
        aria-current={arenaSection === 'sessions' ? 'page' : undefined}
        title="Arena"
      ><ShellIcon name="arena" /></Link>
      <Link
        href={ARENA_SECTION_PATHS.inbox}
        scroll={false}
        className="activity-item"
        aria-label={unread ? `Inbox, ${unread} unread` : 'Inbox'}
        aria-current={arenaSection === 'inbox' ? 'page' : undefined}
        title="Inbox"
      >
        <ShellIcon name="inbox" />
        {unread > 0 && <span className="activity-badge attention" aria-hidden="true">{unread}</span>}
      </Link>
      <details ref={moreRef} className="more-menu" onToggle={onMoreToggle}>
        <summary aria-label="More" title="More"><ShellIcon name="more" /></summary>
        <div>{more}</div>
      </details>
    </nav>
  );
}
