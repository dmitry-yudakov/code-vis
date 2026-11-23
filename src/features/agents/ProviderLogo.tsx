import type { AgentProvider } from '@/shared/types';
import { CLAUDE_LOGO_COLOR, PROVIDER_LOGO_PATHS } from './providerLogos';

export function ProviderLogo({ provider, onAccent, className }: { provider: AgentProvider; onAccent?: boolean; className?: string }) {
  const size = onAccent ? 18 : 16;
  return <svg className={className} data-provider-logo={provider} viewBox={onAccent ? '-1.5 -1.5 27 27' : '0 0 24 24'} width={size} height={size}
    style={{ flexShrink: 0 }} aria-hidden="true" focusable="false">
    {onAccent && <rect x="-1.5" y="-1.5" width="27" height="27" rx="4.5" fill="var(--raised)" />}
    <path d={PROVIDER_LOGO_PATHS[provider]} fillRule="evenodd" fill={provider === 'claude' ? CLAUDE_LOGO_COLOR : 'light-dark(black, white)'} />
  </svg>;
}
