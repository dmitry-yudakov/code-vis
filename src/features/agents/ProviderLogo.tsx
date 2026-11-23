import { useId } from 'react';
import type { AgentProvider } from '@/shared/types';
import { CLAUDE_LOGO_COLOR, CODEX_LOGO_STOPS, PROVIDER_LOGO_PATHS } from './providerLogos';

export function ProviderLogo({ provider, onAccent, className }: { provider: AgentProvider; onAccent?: boolean; className?: string }) {
  const gradient = useId();
  const size = onAccent ? 18 : 16;
  return <svg className={className} data-provider-logo={provider} viewBox={onAccent ? '-1.5 -1.5 27 27' : '0 0 24 24'} width={size} height={size}
    style={{ flexShrink: 0 }} aria-hidden="true" focusable="false">
    {onAccent && <rect x="-1.5" y="-1.5" width="27" height="27" rx="4.5" fill="var(--raised)" />}
    {provider === 'codex' && <defs>
      <linearGradient id={gradient} x2="0" y2="1">
        {CODEX_LOGO_STOPS.map(([offset, color]) => <stop key={offset} offset={offset} stopColor={color} />)}
      </linearGradient>
    </defs>}
    <path d={PROVIDER_LOGO_PATHS[provider]} fillRule="evenodd" fill={provider === 'claude' ? CLAUDE_LOGO_COLOR : `url(#${gradient})`} />
  </svg>;
}
