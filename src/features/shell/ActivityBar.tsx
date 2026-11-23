'use client';

import Link from 'next/link';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import { DesktopPopover, type DesktopPopoverHandle } from './DesktopPopover';
import type { ReactNode, RefObject } from 'react';
import { ARENA_SECTION_PATHS, type ArenaSection } from '@/features/arena/routes';
import type { SideTab } from './panelLayout';
import { ShellIcon } from './ShellIcon';

const VIEW_LABELS: Record<SideTab, string> = { files: 'Files', changes: 'Repository', history: 'History', reports: 'Reports' };

export const ARENA_SHORTCUT_HINT = { title: 'Arena · Ctrl/Cmd+J', 'aria-keyshortcuts': 'Control+J Meta+J' };

/** The desktop rail and compact bottom navigation for workspace views and global destinations. */
export function ActivityBar({ views, shownView, changeCount = 0, arenaSection, arenaShortcutHint, unread, updateCount = 0, more, moreRef, onMoreToggle, onToggleView, compact = false, workspace, fileView }: {
  compact?: boolean;
  /** The compact session's Chat and Canvas controls. */
  workspace?: ReactNode;
  fileView?: ReactNode;
  /** Empty on the Arena and welcome pages. */
  views: readonly SideTab[];
  shownView?: SideTab;
  changeCount?: number;
  arenaSection?: ArenaSection;
  arenaShortcutHint?: typeof ARENA_SHORTCUT_HINT;
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
  const inboxInMore = compact && Boolean(workspace);
  const inboxCount = inboxInMore ? unread : 0;
  const inboxLabel = unread ? `Inbox, ${unread} unread` : 'Inbox';
  const moreDescription = [updateDescription, inboxCount ? inboxLabel : undefined].filter(Boolean).join('. ') || undefined;
  const railViews = compact ? views.filter(view => !workspace && view === 'files') : views;
  const moreViews = compact ? views.filter(view => !railViews.includes(view)) : [];
  const viewLabel = (view: SideTab) => view === 'changes' && changeCount > 0
    ? `${VIEW_LABELS[view]}, ${changeCount} ${changeCount === 1 ? 'file' : 'files'}` : VIEW_LABELS[view];
  const inboxLink = (
    <IconButton component={Link}
      href={ARENA_SECTION_PATHS.inbox}
      scroll={false}
      className="activity-item activity-inbox"
      aria-label={inboxLabel}
      aria-current={arenaSection === 'inbox' ? 'page' : undefined}
      title="Inbox"
    >
      <ShellIcon name="inbox" />
      {compact && <span className="activity-label">Inbox</span>}
      {unread > 0 && <span className="activity-badge attention" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
    </IconButton>
  );

  return (
    <nav className="activity-bar" aria-label="Views">
      {workspace}
      {railViews.map((view) => {
        const count = view === 'changes' ? changeCount : 0;
        return (
          <IconButton
            key={view}
            type="button"
            className="activity-item"
            aria-label={viewLabel(view)}
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
      {compact && !inboxInMore && inboxLink}
      <IconButton component={Link}
        href={ARENA_SECTION_PATHS.sessions}
        scroll={false}
        className="activity-item activity-arena"
        aria-label="Arena"
        aria-current={arenaSection === 'sessions' ? 'page' : undefined}
        title="Arena"
        {...arenaShortcutHint}
      ><ShellIcon name="arena" />{compact && <span className="activity-label">Arena</span>}</IconButton>
      {!compact && inboxLink}
      {fileView}
      <DesktopPopover control={moreRef} className="more-menu" label="More" description={moreDescription}
        icon width={240} placement={compact ? 'top-end' : 'right-end'} focusOnKeyboardOpen={compact} onOpenChange={onMoreToggle}
        summary={<><ShellIcon name={compact ? 'ellipsis' : 'more'} />{compact && <span className="activity-label">More</span>}{updateDescription && !inboxCount && <span className="activity-badge updates" aria-hidden="true">{updateCount > 99 ? '99+' : updateCount}</span>}{inboxCount > 0 && <span className="activity-badge attention" aria-hidden="true">{inboxCount > 99 ? '99+' : inboxCount}</span>}</>}>
        {close => <div className="desktop-more-content">
          {moreViews.map(view => (
            <Button key={view} className="activity-more-item" color="inherit" startIcon={<ShellIcon name={view} />}
              aria-pressed={shownView === view} onClick={() => { close(); onToggleView(view); }}>
              {viewLabel(view)}
            </Button>
          ))}
          {inboxInMore && <Button component={Link} href={ARENA_SECTION_PATHS.inbox} scroll={false}
            className="activity-more-item" color="inherit" startIcon={<ShellIcon name="inbox" />} onClick={close}>{inboxLabel}</Button>}
          {(moreViews.length > 0 || inboxInMore) && <Divider />}
          {more}
        </div>}
      </DesktopPopover>
    </nav>
  );
}
