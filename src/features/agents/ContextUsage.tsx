'use client';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import type { AgentContextUsage } from '@/shared/types';

function contextPercent(usage?: AgentContextUsage): number | undefined {
  return usage?.contextWindow === undefined ? undefined : Math.min(100, Math.round(usage.usedTokens / usage.contextWindow * 100));
}

export function contextUsageLabel(name: string, usage?: AgentContextUsage): string {
  const percent = contextPercent(usage);
  const tokens = usage?.usedTokens.toLocaleString('en-US');
  const capacity = usage?.contextWindow?.toLocaleString('en-US');
  return percent === undefined ? `@${name} context: ${tokens ? `${tokens} tokens; capacity unavailable` : 'not reported yet'}`
    : `@${name} context: ${percent}% used, ${tokens} of ${capacity} tokens`;
}

export function ContextUsage({ name, usage, focusable = true }: { name: string; usage?: AgentContextUsage; focusable?: boolean }) {
  const percent = contextPercent(usage);
  const label = contextUsageLabel(name, usage);
  const detail = `${label}. ${usage ? 'Last provider report.' : 'Available after the provider reports usage.'}`;
  return <Tooltip title={detail} describeChild>
    <Box component="span" tabIndex={focusable ? 0 : undefined} role={percent === undefined ? 'img' : 'meter'} aria-label={label}
      {...(percent === undefined ? {} : { 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent, 'aria-valuetext': label })}
      sx={{ display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle', color: 'text.secondary', flexShrink: 0, px: 0.5, pointerEvents: 'auto' }}>
      <Box component="span" sx={{ position: 'relative', display: 'inline-flex', width: 14, height: 14 }} aria-hidden="true">
        <CircularProgress variant="determinate" value={100} size={14} thickness={4} sx={{ color: 'divider' }} />
        {percent !== undefined && <CircularProgress variant="determinate" value={percent} size={14} thickness={4}
          color={percent >= 90 ? 'warning' : 'inherit'} sx={{ position: 'absolute', left: 0 }} />}
      </Box>
    </Box>
  </Tooltip>;
}
