'use client';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { AgentContextUsage } from '@/shared/types';

export function ContextUsage({ name, usage }: { name: string; usage?: AgentContextUsage }) {
  const percent = usage?.contextWindow === undefined ? undefined : Math.min(100, Math.round(usage.usedTokens / usage.contextWindow * 100));
  const tokens = usage?.usedTokens.toLocaleString('en-US');
  const capacity = usage?.contextWindow?.toLocaleString('en-US');
  const label = percent === undefined ? `@${name} context: ${tokens ? `${tokens} tokens; capacity unavailable` : 'not reported yet'}`
    : `@${name} context: ${percent}% used, ${tokens} of ${capacity} tokens`;
  const detail = `${label}. ${usage ? 'Last provider report; refreshes as the agent works.' : 'Available after the provider reports usage.'}`;
  return <Tooltip title={detail} describeChild>
    <Box component="span" tabIndex={0} role={percent === undefined ? 'img' : 'meter'} aria-label={label}
      {...(percent === undefined ? {} : { 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent, 'aria-valuetext': label })}
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, color: 'text.secondary', flexShrink: 0, px: 0.5 }}>
      <Box component="span" sx={{ position: 'relative', display: 'inline-flex', width: 18, height: 18 }} aria-hidden="true">
        <CircularProgress variant="determinate" value={100} size={18} thickness={4} sx={{ color: 'divider' }} />
        {percent !== undefined && <CircularProgress variant="determinate" value={percent} size={18} thickness={4}
          color={percent >= 90 ? 'warning' : 'inherit'} sx={{ position: 'absolute', left: 0 }} />}
      </Box>
      <Typography component="span" variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>{percent === undefined ? '—' : `${percent}%`}</Typography>
    </Box>
  </Tooltip>;
}
