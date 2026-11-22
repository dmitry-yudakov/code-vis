'use client';

import { useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import type { ArenaSessionSummary } from '@/shared/types';
import { DesktopPopover, type DesktopPopoverHandle } from '@/features/shell/DesktopPopover';
import { ShellIcon } from '@/features/shell/ShellIcon';
import type { WorkspaceRunState } from './WorkspaceTabs';

/** Header navigation and archives scoped to the selected project and machine. */
export function SessionArchivePicker({ sessions, active, online, refreshError, onRefresh, onRestore }: {
  sessions: ArenaSessionSummary[];
  /** Compact headers combine active-session navigation and the existing archive menu. */
  active?: {
    sessions: Pick<ArenaSessionSummary, 'id' | 'title'>[];
    value?: string;
    runs: Record<string, WorkspaceRunState>;
    unread: Record<string, number>;
    onSelect(id: string): void;
  };
  online: boolean;
  refreshError?: string;
  onRefresh(): Promise<void>;
  onRestore(session: ArenaSessionSummary): Promise<boolean>;
}) {
  const [restoring, setRestoring] = useState<string>();
  const busy = useRef(false);
  const opened = useRef(false);
  const popover = useRef<DesktopPopoverHandle>(null);
  const archives = [...sessions].sort((left, right) => Date.parse(right.archivedAt || right.updatedAt)
    - Date.parse(left.archivedAt || left.updatedAt));
  const current = active?.sessions.find(session => session.id === active.value);
  const status = current && active?.runs[current.id]?.status;

  async function restore(session: ArenaSessionSummary) {
    if (busy.current || !online) return;
    busy.current = true;
    setRestoring(session.id);
    try {
      if (await onRestore(session) && opened.current) popover.current?.close();
    } finally {
      busy.current = false;
      setRestoring(undefined);
    }
  }

  return <DesktopPopover key={active ? 'compact' : 'desktop'} control={popover}
    className="session-archive-menu" label={active ? 'Session' : 'Archived sessions'} icon={!active}
    description={active ? [current?.title, status].filter(Boolean).join(' · ') || undefined : undefined}
    summary={<>{active && <span className="session-selector-title">{current?.title || 'Sessions'}</span>}
      <ShellIcon name="chevronDown" /></>} placement="bottom-end" width={400}
    onOpenChange={open => { opened.current = open; if (open) void onRefresh(); }}>
    {close => <Box component="section" aria-label="Project archive">
      {active && <>
        <Typography variant="subtitle2">Active sessions</Typography>
        {!active.sessions.length && <Typography variant="body2" color="text.secondary">No active sessions</Typography>}
        <List dense disablePadding component="div" role="listbox" aria-label="Active sessions">
          {active.sessions.map(session => {
            const detail = [active.runs[session.id]?.status, active.unread[session.id] ? `${active.unread[session.id]} unread` : undefined]
              .filter(Boolean).join(' · ');
            return <ListItemButton key={session.id} component="button" role="option" selected={session.id === active.value}
              aria-selected={session.id === active.value} aria-label={detail ? `${session.title} — ${detail}` : session.title}
              onClick={() => { close(); active.onSelect(session.id); }} sx={{ width: '100%', borderRadius: 1 }}>
              <ListItemText primary={session.title} secondary={detail || undefined}
                slotProps={{ primary: { sx: { overflowWrap: 'anywhere' } } }} />
            </ListItemButton>;
          })}
        </List>
      </>}
      <Typography variant="subtitle2" sx={{ mb: 1 }}>Project archive</Typography>
      {refreshError && <Alert severity="error" action={<Button onClick={() => void onRefresh()}>Retry</Button>}>{refreshError}</Alert>}
      {!online && <Typography role="status" variant="body2" color="text.secondary">This machine is offline.</Typography>}
      {!archives.length && <Typography variant="body2" color="text.secondary">No archived sessions</Typography>}
      <List dense disablePadding>
        {archives.map(session => <ListItem key={session.id} disableGutters sx={{ gap: 1, alignItems: 'flex-start' }}>
          <ListItemText
            primary={session.title}
            secondary={`Archived ${new Date(session.archivedAt || session.updatedAt).toLocaleString()}`}
            slotProps={{ primary: { sx: { overflowWrap: 'anywhere' } } }} />
          <Button size="small" aria-label={`Restore ${session.title}`} disabled={!online || Boolean(restoring)}
            onClick={() => void restore(session)} sx={{ flexShrink: 0, mt: 0.5 }}>
            {restoring === session.id ? 'Restoring…' : 'Restore'}
          </Button>
        </ListItem>)}
      </List>
    </Box>}
  </DesktopPopover>;
}
