'use client';

import { useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import type { ArenaSessionSummary } from '@/shared/types';
import { DesktopPopover } from '@/features/shell/DesktopPopover';
import { ShellIcon } from '@/features/shell/ShellIcon';

/** The shell supplies only the selected project and machine's archives. */
export function SessionArchivePicker({ sessions, online, refreshError, onRefresh, onRestore }: {
  sessions: ArenaSessionSummary[];
  online: boolean;
  refreshError?: string;
  onRefresh(): Promise<void>;
  onRestore(session: ArenaSessionSummary): Promise<boolean>;
}) {
  const [restoring, setRestoring] = useState<string>();
  const busy = useRef(false);
  const opened = useRef(false);
  const archives = [...sessions].sort((left, right) => Date.parse(right.archivedAt || right.updatedAt)
    - Date.parse(left.archivedAt || left.updatedAt));

  async function restore(session: ArenaSessionSummary, close: () => void) {
    if (busy.current || !online) return;
    busy.current = true;
    setRestoring(session.id);
    try {
      if (await onRestore(session) && opened.current) close();
    } finally {
      busy.current = false;
      setRestoring(undefined);
    }
  }

  return <DesktopPopover className="session-archive-menu" label="Archived sessions" icon
    summary={<ShellIcon name="archive" />} placement="bottom-end" width={400}
    onOpenChange={open => { opened.current = open; if (open) void onRefresh(); }}>
    {close => <Box component="section" aria-label="Project archive">
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
            onClick={() => void restore(session, close)} sx={{ flexShrink: 0, mt: 0.5 }}>
            {restoring === session.id ? 'Restoring…' : 'Restore'}
          </Button>
        </ListItem>)}
      </List>
    </Box>}
  </DesktopPopover>;
}
