'use client';

import Link from 'next/link';
import IconButton from '@mui/material/IconButton';
import { DesktopPopover, type DesktopPopoverHandle } from './DesktopPopover';
import type { ReactNode, RefObject } from 'react';
import { ARENA_SECTION_PATHS, type ArenaSection } from '@/features/arena/routes';
import type { SideTab } from './panelLayout';
import { ShellIcon } from './ShellIcon';

const VIEW_LABELS: Record<SideTab, string> = { changes: 'Changes', history: 'History', reports: 'Reports' };

/**
 * The column of views beside the side panel. The session's views toggle the side panel; the Arena
 * and the Inbox are pages of their own until they become side-panel views (Story 75). More sits at
 * the bottom, as a gear.
 */
export function ActivityBar({ views, shownView, changeCount = 0, arenaSection, unread, updateCount = 0, more, moreRef, onMoreToggle, onToggleView }: {
  /** Empty where no session is shown: the Arena page and the welcome screen. */
  views: readonly SideTab[];
  shownView?: SideTab;
  changeCount?: number;
  arenaSection?: ArenaSection;
  unread: number;
  updateCount?: number;
  more: ReactNode;
  moreRef?: RefObject<DesktopPopoverHandle | null>;
  onMoreToggle?(open: boolean): void;
  onToggleView(view: SideTab): void;
}) {
  const updateDescription = updateCount > 0
    ? `${updateCount} Docker agent update${updateCount === 1 ? '' : 's'} available`
    : undefined;

  return (
    <nav className="activity-bar" aria-label="Views">
      {views.map((view) => {
        const count = view === 'changes' ? changeCount : 0;
        return (
          <IconButton
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
          </IconButton>
        );
      })}
      {views.length > 0 && <span className="activity-divider" aria-hidden="true" />}
      <IconButton component={Link}
        href={ARENA_SECTION_PATHS.sessions}
        scroll={false}
        className="activity-item"
        aria-label="Arena"
        aria-current={arenaSection === 'sessions' ? 'page' : undefined}
        title="Arena"
      ><ShellIcon name="arena" /></IconButton>
      <IconButton component={Link}
        href={ARENA_SECTION_PATHS.inbox}
        scroll={false}
        className="activity-item"
        aria-label={unread ? `Inbox, ${unread} unread` : 'Inbox'}
        aria-current={arenaSection === 'inbox' ? 'page' : undefined}
        title="Inbox"
      >
        <ShellIcon name="inbox" />
        {unread > 0 && <span className="activity-badge attention" aria-hidden="true">{unread}</span>}
      </IconButton>
      <DesktopPopover control={moreRef} className="more-menu" label="More" description={updateDescription}
        icon width={240} placement="right-end" onOpenChange={onMoreToggle}
        summary={<><ShellIcon name="more" />{updateDescription && <span className="activity-badge updates" aria-label={updateDescription}>{updateCount}</span>}</>}>
        {() => <div className="desktop-more-content">{more}</div>}
      </DesktopPopover>
    </nav>
  );
}
