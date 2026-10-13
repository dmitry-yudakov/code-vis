'use client';

import type { ReactNode } from 'react';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';

/** Evidence has an explicit removal action, and may contain its own preview control. */
export function AttachmentChip({ children, className, removeLabel, disabled, onRemove }: {
  children: ReactNode; className?: string; removeLabel: string; disabled?: boolean; onRemove(): void;
}) {
  return <Chip className={`attachment-chip ${className ?? ''}`} variant="outlined" label={<>
    {children}<IconButton aria-label={removeLabel} disabled={disabled} onClick={onRemove}>×</IconButton>
  </>} sx={{ height: 'auto', maxWidth: '100%', '& .MuiChip-label': { display: 'flex', alignItems: 'center', gap: 0.5, py: 0.25, whiteSpace: 'normal', overflowWrap: 'anywhere' } }} />;
}
