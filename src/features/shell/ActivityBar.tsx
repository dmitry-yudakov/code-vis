'use client';

import Link from 'next/link';
import IconButton from '@mui/material/IconButton';
import { DesktopPopover, type DesktopPopoverHandle } from './DesktopPopover';
import type { ReactNode, RefObject } from 'react';
import { ARENA_SECTION_PATHS, type ArenaSection } from '@/features/arena/routes';
import type { SideTab } from './panelLayout';
import { ShellIcon } from './ShellIcon';

const VIEW_LABELS: Record<SideTab, string> = { files: 'Files', changes: 'Repository', history: 'History', reports: 'Reports' };

/**
 * The column of views beside the side panel. The session's views toggle the side panel; the Arena
 * and the Inbox are pages of their own until they become side-panel views (Story 75). Global
 * navigation stays together at the bottom, ending with More as a gear.
 */
export function ActivityBar({ views, shownView, changeCount = 0, arenaSection, unread, updateCount = 0, more, moreRef, onMoreToggle, onToggleView, compact = false, workspace }: {
  compact?: boolean;
  workspace?: ReactNode;
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
  const inboxCount = compact && workspace ? unread : 0;
  const moreDescription = [updateDescription, inboxCount ? `Inbox, ${inboxCount} unread` : undefined].filter(Boolean).join('. ') || undefined;

  return (
    <nav className="activity-bar" aria-label="Views">
      {workspace}
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
            {compact && <span className="activity-label">{VIEW_LABELS[view]}</span>}
            {count > 0 && <span className="activity-badge" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
          </IconButton>
        );
      })}
      <span className="activity-divider" aria-hidden="true" />
      {(!compact || !workspace) && <>
      <IconButton component={Link}
        href={ARENA_SECTION_PATHS.sessions}
        scroll={false}
        className="activity-item"
        aria-label="Arena"
        aria-current={arenaSection === 'sessions' ? 'page' : undefined}
        title="Arena"
      ><ShellIcon name="arena" />{compact && <span className="activity-label">Arena</span>}</IconButton>
      <IconButton component={Link}
        href={ARENA_SECTION_PATHS.inbox}
        scroll={false}
        className="activity-item"
        aria-label={unread ? `Inbox, ${unread} unread` : 'Inbox'}
        aria-current={arenaSection === 'inbox' ? 'page' : undefined}
        title="Inbox"
      >
        <ShellIcon name="inbox" />
        {compact && <span className="activity-label">Inbox</span>}
        {unread > 0 && <span className="activity-badge attention" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </IconButton>
      </>}
      <DesktopPopover control={moreRef} className="more-menu" label="More" description={moreDescription}
        icon width={240} placement={compact ? 'top-start' : 'right-end'} onOpenChange={onMoreToggle}
        summary={<><ShellIcon name="more" />{compact && <span className="activity-label">More</span>}{updateDescription && !inboxCount && <span className="activity-badge updates" aria-label={updateDescription}>{updateCount > 99 ? '99+' : updateCount}</span>}{inboxCount > 0 && <span className="activity-badge attention" aria-label={`Inbox, ${inboxCount} unread`}>{inboxCount > 99 ? '99+' : inboxCount}</span>}</>}>
        {() => <div className="desktop-more-content">{more}</div>}
      </DesktopPopover>
    </nav>
  );
}
