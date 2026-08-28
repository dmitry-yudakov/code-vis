'use client';

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = Exclude<ThemePreference, 'system'>;

const STORAGE_KEY = 'code-ai:theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function systemIsDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(DARK_QUERY).matches;
}

function stampPreference(preference: ThemePreference): void {
  if (preference === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', preference);
  }
}

export function useTheme(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
} {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => (
    typeof window === 'undefined' ? 'system' : readPreference()
  ));
  const [systemDark, setSystemDark] = useState(systemIsDark);

  useLayoutEffect(() => {
    const stored = readPreference();
    setPreferenceState(stored);
    setSystemDark(systemIsDark());
    stampPreference(stored);
  }, []);

  useEffect(() => {
    if (preference !== 'system') return;
    const media = window.matchMedia(DARK_QUERY);
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    setSystemDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
      setPreferenceState(next);
      stampPreference(next);
    } catch {
      setPreferenceState('system');
      setSystemDark(systemIsDark());
      stampPreference('system');
    }
  }, []);

  return {
    preference,
    resolved: preference === 'system' ? (systemDark ? 'dark' : 'light') : preference,
    setPreference,
  };
}
