'use client';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import { PROVIDER_LABELS } from '@/shared/participants';
import type { AgentProvider } from '@/shared/types';

/** Both choices stay visible, including a provider that needs setup on this machine. */
export function ProviderChips({ value, available, disabled, onChange }: {
  value?: AgentProvider;
  available: readonly AgentProvider[];
  disabled?: boolean;
  onChange(provider: AgentProvider): void;
}) {
  return <Box role="group" aria-label="Provider" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
    {(['claude', 'codex'] as const).map(provider => <Chip key={provider} component="button" type="button"
      label={PROVIDER_LABELS[provider]} aria-pressed={value === provider}
      icon={value === provider ? <span aria-hidden="true">✓</span> : undefined}
      color={value === provider ? 'primary' : 'default'} variant={value === provider ? 'filled' : 'outlined'}
      disabled={disabled || !available.includes(provider)}
      title={!available.includes(provider) ? `${PROVIDER_LABELS[provider]} needs setup on this machine` : undefined}
      onClick={() => { if (provider !== value) onChange(provider); }} />)}
  </Box>;
}
