'use client';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { ShellIcon } from '@/features/shell/ShellIcon';

export function MessageNavigation({ kind, previous, next, onNavigate }: {
  kind: 'user message' | 'response';
  previous?: string;
  next?: string;
  onNavigate(id: string): void;
}) {
  if (!previous && !next) return null;
  return <Box component="span" sx={{ display: 'flex', width: 'fit-content', alignItems: 'center', ml: 'auto', flexShrink: 0, color: 'text.secondary',
    '& .shell-icon': { width: 16, height: 16 } }}>
    {([['Previous', previous, 'arrowUp'], ['Next', next, 'arrowDown']] as const).map(([direction, target, icon]) => (
      <Tooltip key={direction} title={`${direction} ${kind}`} describeChild>
        <span><IconButton type="button" size="small" color="inherit" aria-label={`${direction} ${kind}`}
          disabled={!target} onClick={() => { if (target) onNavigate(target); }}
        ><ShellIcon name={icon} /></IconButton></span>
      </Tooltip>
    ))}
  </Box>;
}
