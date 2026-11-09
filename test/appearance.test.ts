import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { appearanceScript, isLightTheme, isThemePreference, resolveAppearance } from '@/shared/design/appearance';

function bootstrap(preference: string | null, lightTheme: string | null, systemDark: boolean, blocked = false) {
  const attributes = new Map<string, string>();
  runInNewContext(appearanceScript, {
    document: { documentElement: {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
    } },
    localStorage: { getItem(key: string) {
      if (blocked) throw new Error('Storage unavailable');
      return key === 'code-ai:theme' ? preference : lightTheme;
    } },
    matchMedia: () => ({ matches: systemDark }),
  });
  return attributes;
}

describe('appearance before hydration', () => {
  for (const preference of ['light', 'dark', 'system'] as const) {
    for (const lightTheme of ['light', 'steel', 'sand'] as const) {
      for (const systemDark of [true, false]) {
        it(`resolves ${preference}/${lightTheme}, system dark=${systemDark} like the preference owner`, () => {
          const attributes = bootstrap(preference, lightTheme, systemDark);
          expect(attributes.get('data-appearance')).toBe(resolveAppearance(preference, lightTheme, systemDark));
          expect(attributes.get('data-theme')).toBe(preference === 'system' ? undefined : preference);
        });
      }
    }
  }

  it.each([null, '', 'unknown', 'toString', '__proto__'])('falls back safely for invalid stored choices: %s', (invalid) => {
    expect(isThemePreference(invalid)).toBe(false);
    expect(isLightTheme(invalid)).toBe(false);
    expect(bootstrap(invalid, invalid, true).get('data-appearance')).toBe('dark');
    expect(bootstrap(invalid, invalid, false).get('data-appearance')).toBe('light');
    expect(bootstrap('light', invalid, true).get('data-appearance')).toBe('light');
  });

  it('uses system appearance and Classic when storage is unavailable', () => {
    expect(bootstrap('light', 'steel', true, true).get('data-appearance')).toBe('dark');
    expect(bootstrap('dark', 'sand', false, true).get('data-appearance')).toBe('light');
  });
});
