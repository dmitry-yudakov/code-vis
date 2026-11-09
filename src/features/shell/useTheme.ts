'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState } from 'react';
import type { LightThemeName, ThemeName } from '@/shared/design/tokens';
import { isLightTheme, isThemePreference, LIGHT_THEME_STORAGE_KEY, resolveAppearance, THEME_STORAGE_KEY, type ThemePreference } from '@/shared/design/appearance';

export type { ThemePreference } from '@/shared/design/appearance';
export type ResolvedTheme = ThemeName;

const DARK_QUERY = '(prefers-color-scheme: dark)';

function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function readLightTheme(): LightThemeName {
  try {
    const stored = window.localStorage.getItem(LIGHT_THEME_STORAGE_KEY);
    return isLightTheme(stored) ? stored : 'light';
  } catch {
    return 'light';
  }
}

function systemIsDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(DARK_QUERY).matches;
}

function stampPreference(preference: ThemePreference, lightTheme: LightThemeName): void {
  if (preference === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', preference);
  }
  document.documentElement.setAttribute('data-appearance', resolveAppearance(preference, lightTheme, systemIsDark()));
}

type Appearance = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
  lightTheme: LightThemeName;
  setLightTheme: (next: LightThemeName) => void;
};

export const AppearanceContext = createContext<Appearance | undefined>(undefined);

export function useTheme(): Appearance {
  const appearance = useContext(AppearanceContext);
  if (!appearance) throw new Error('Appearance requires DesktopThemeProvider.');
  return appearance;
}

export function useAppearanceOwner(): Appearance {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => (
    typeof window === 'undefined' ? 'system' : readPreference()
  ));
  const [systemDark, setSystemDark] = useState(systemIsDark);
  const [lightTheme, setLightThemeState] = useState<LightThemeName>(() => (
    typeof window === 'undefined' ? 'light' : readLightTheme()
  ));

  useLayoutEffect(() => {
    const stored = readPreference();
    const storedLight = readLightTheme();
    setPreferenceState(stored);
    setLightThemeState(storedLight);
    setSystemDark(systemIsDark());
    stampPreference(stored, storedLight);
  }, []);

  useEffect(() => {
    if (preference !== 'system') return;
    const media = window.matchMedia(DARK_QUERY);
    const update = (event: MediaQueryListEvent) => {
      setSystemDark(event.matches);
      stampPreference('system', lightTheme);
    };
    setSystemDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [preference, lightTheme]);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
      setPreferenceState(next);
      stampPreference(next, lightTheme);
    } catch {
      setPreferenceState('system');
      setSystemDark(systemIsDark());
      stampPreference('system', lightTheme);
    }
  }, [lightTheme]);

  const setLightTheme = useCallback((next: LightThemeName) => {
    try {
      window.localStorage.setItem(LIGHT_THEME_STORAGE_KEY, next);
      setLightThemeState(next);
      stampPreference(preference, next);
    } catch {
      setLightThemeState('light');
      stampPreference(preference, 'light');
    }
  }, [preference]);

  return {
    preference,
    resolved: resolveAppearance(preference, lightTheme, systemDark),
    setPreference,
    lightTheme,
    setLightTheme,
  };
}
