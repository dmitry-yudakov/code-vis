import { describe, expect, it } from 'vitest';
import { resolveAllowedDevOrigins } from '../next.config';

describe('Next.js development origins', () => {
  it('keeps additional development origins opt-in', () => {
    expect(resolveAllowedDevOrigins({})).toBeUndefined();
  });

  it('normalizes, deduplicates, and accepts the former setting name', () => {
    expect(resolveAllowedDevOrigins({
      CODEAI_WEB2_ALLOWED_DEV_ORIGINS: ' 192.168.100.10, Quest.CodeAI.Test,192.168.100.10 ',
    })).toEqual(['192.168.100.10', 'quest.codeai.test']);
  });

  it('prefers the neutral setting and reuses the paired public hostname', () => {
    expect(resolveAllowedDevOrigins({
      CODEAI_ALLOWED_DEV_ORIGINS: 'dev.codeai.test',
      CODEAI_WEB2_ALLOWED_DEV_ORIGINS: 'legacy.codeai.test',
      CODEAI_PUBLIC_ORIGIN: 'https://192.168.100.10:3023',
    })).toEqual(['dev.codeai.test', '192.168.100.10']);
  });

  it('does not fail development config loading for an invalid optional public origin', () => {
    expect(resolveAllowedDevOrigins({ CODEAI_PUBLIC_ORIGIN: 'not a URL' })).toBeUndefined();
  });
});
