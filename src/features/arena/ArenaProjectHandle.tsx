import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useId, useState, type DragEventHandler } from 'react';
import { ShellIcon } from '@/features/shell/ShellIcon';

export function ArenaProjectHandle({ name, previousId, nextId, onMove, onDragStart, onDragEnd }: {
  name: string;
  previousId?: string;
  nextId?: string;
  onMove(targetId: string): void;
  onDragStart: DragEventHandler<HTMLButtonElement>;
  onDragEnd: DragEventHandler<HTMLButtonElement>;
}) {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);

  const move = (targetId: string | undefined) => {
    setAnchor(null);
    if (targetId) onMove(targetId);
  };

  return <>
    <IconButton id={id} type="button" className="arena-project-handle" draggable
      aria-label={`Reorder ${name}`} aria-haspopup="menu" aria-expanded={Boolean(anchor)}
      aria-controls={anchor ? `${id}-menu` : undefined} title="Drag to reorder"
      onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={event => setAnchor(event.currentTarget)}>
      <ShellIcon name="grip" />
    </IconButton>
    {anchor && <Menu anchorEl={anchor} open onClose={() => setAnchor(null)}
      slotProps={{ list: { id: `${id}-menu`, 'aria-labelledby': id } }}>
      <MenuItem disabled={!previousId} onClick={() => move(previousId)}>Move earlier</MenuItem>
      <MenuItem disabled={!nextId} onClick={() => move(nextId)}>Move later</MenuItem>
    </Menu>}
  </>;
}
