'use client';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import { PROVIDER_LABELS } from '@/shared/participants';
import type { AgentProvider } from '@/shared/types';
import { ProviderLogo } from './ProviderLogo';

/** Both choices stay visible, including a provider that needs setup on this machine. */
export function ProviderChips({ value, available, disabled, onChange }: {
  value?: AgentProvider;
  available: readonly AgentProvider[];
  disabled?: boolean;
  onChange(provider: AgentProvider): void;
}) {
  return <Box role="group" aria-label="Provider" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
    {(['claude', 'codex'] as const).map(provider => {
      const selected = value === provider;
      return <Chip key={provider} component="button" type="button"
        label={<Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {PROVIDER_LABELS[provider]}{selected && <span aria-hidden="true">✓</span>}
        </Box>} aria-pressed={selected}
        icon={<ProviderLogo provider={provider} />}
        color={selected ? 'primary' : 'default'} variant="outlined"
        sx={selected ? { bgcolor: 'var(--plot-wash-soft)', '&.MuiChip-clickable:hover': { bgcolor: 'var(--plot-wash)' } } : undefined}
        disabled={disabled || !available.includes(provider)}
        title={!available.includes(provider) ? `${PROVIDER_LABELS[provider]} needs setup on this machine` : undefined}
        onClick={() => { if (!selected) onChange(provider); }} />;
    })}
  </Box>;
}
