import { LIGHT_THEMES, type LightThemeName, type ThemeName } from './tokens';

export type ThemePreference = 'light' | 'dark' | 'system';
export const THEME_STORAGE_KEY = 'code-ai:theme';
export const LIGHT_THEME_STORAGE_KEY = 'code-ai:light-theme';

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function isLightTheme(value: string | null): value is LightThemeName {
  return value !== null && Object.hasOwn(LIGHT_THEMES, value);
}

export function resolveAppearance(preference: ThemePreference, lightTheme: LightThemeName, systemDark: boolean): ThemeName {
  return preference === 'dark' || (preference === 'system' && systemDark) ? 'dark' : lightTheme;
}

/** Runs before first paint; keep its validation in parity with the preference owner. */
export const appearanceScript = `(function(){var r=document.documentElement,t="system",l="light";try{t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}try{l=localStorage.getItem(${JSON.stringify(LIGHT_THEME_STORAGE_KEY)})}catch(e){}if(t==="light"||t==="dark")r.setAttribute("data-theme",t);else{t="system";r.removeAttribute("data-theme")}if(!${JSON.stringify(Object.keys(LIGHT_THEMES))}.includes(l))l="light";r.setAttribute("data-appearance",t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches)?"dark":l)})()`;
