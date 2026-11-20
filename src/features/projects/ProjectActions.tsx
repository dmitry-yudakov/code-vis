'use client';

import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useId, useState } from 'react';
import { ShellIcon } from '@/features/shell/ShellIcon';

export type ProjectAction = 'rename' | 'delete';

export function ProjectActions({ name, disabled, onAction }: {
  name: string;
  disabled: boolean;
  onAction(action: ProjectAction): void;
}) {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const choose = (action: ProjectAction) => {
    setAnchor(null);
    // Let the menu release its focus trap before the dialog records its opener.
    requestAnimationFrame(() => { anchor?.focus(); onAction(action); });
  };
  return <>
    <IconButton id={id} type="button" disabled={disabled} aria-label={`Project actions for ${name}`}
      title={`Project actions for ${name}`} aria-haspopup="menu" aria-expanded={Boolean(anchor)}
      aria-controls={anchor ? `${id}-menu` : undefined} onClick={event => setAnchor(event.currentTarget)}>
      <ShellIcon name="ellipsis" />
    </IconButton>
    <Menu anchorEl={anchor} open={Boolean(anchor) && !disabled} onClose={() => { anchor?.focus(); setAnchor(null); }}
      disableRestoreFocus slotProps={{ list: { id: `${id}-menu`, 'aria-labelledby': id } }}>
      <MenuItem onClick={() => choose('rename')}>Rename project</MenuItem>
      <MenuItem onClick={() => choose('delete')}>Delete project</MenuItem>
    </Menu>
  </>;
}
