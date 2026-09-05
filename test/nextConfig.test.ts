import { describe, expect, it } from 'vitest';
import nextConfig, { resolveAllowedDevOrigins, XR_PERMISSIONS_POLICY } from '../next.config';

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

  it('grants XR spatial tracking only to the same origin on every production response', async () => {
    const rules = await nextConfig.headers!();
    const policy = rules.flatMap((rule) => rule.headers)
      .find((header) => header.key.toLowerCase() === 'permissions-policy');
    expect(policy?.value).toBe(XR_PERMISSIONS_POLICY);
    expect(policy?.value).toBe('xr-spatial-tracking=(self)');
    expect(policy?.value).not.toContain('*');
    expect(policy?.value).not.toMatch(/https?:/);
  });
});
