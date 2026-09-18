import type { ThemeName } from '@/shared/design/tokens';

export const IMMERSIVE_DEFAULT_DISTANCE = 2.6;
export const IMMERSIVE_DP_DEGREES = 0.0625;
export const IMMERSIVE_GLYPH_MASK = '#FFFFFF';

/** Project VR convention: one dp subtends 0.0625 degrees at the supplied distance. */
export function dpToWorld(dp: number, distance = IMMERSIVE_DEFAULT_DISTANCE): number {
  return 2 * distance * Math.tan((dp * IMMERSIVE_DP_DEGREES * Math.PI / 180) / 2);
}

export const immersiveType = {
  title: { size: 24, lineHeight: 28, weight: 600, family: 'sans' },
  heading: { size: 20, lineHeight: 24, weight: 600, family: 'sans' },
  reading: { size: 18, lineHeight: 26, weight: 400, family: 'sans' },
  code: { size: 16, lineHeight: 22, weight: 400, family: 'mono' },
  button: { size: 16, lineHeight: 20, weight: 600, family: 'sans' },
  label: { size: 14, lineHeight: 20, weight: 400, family: 'sans' },
} as const;

export const immersiveRadii = {
  panel: 24,
  card: 16,
  field: 16,
  bubble: 16,
} as const;

export type ImmersiveTypeName = keyof typeof immersiveType;

export const immersiveTheme = {
  dark: {
    environment: '#1A1A1A', surface: '#303030', raised: '#3B3B3B', control: '#454545',
    hover: '#505050', pressed: '#3A3A3A', selected: '#EBEBEB', selectedInk: '#1F1F1F',
    text: '#EBEBEB', secondaryText: '#BDBDBD', positive: '#7FE38A', negative: '#FFB3B9',
    warning: '#FFB866', link: '#8CC8FF', focus: '#FFFFFF', annotation: '#FFB866',
  },
  light: {
    environment: '#B0B0B0', surface: '#DADADA', raised: '#CECECE', control: '#CACACA',
    hover: '#C0C0C0', pressed: '#D4D4D4', selected: '#1F1F1F', selectedInk: '#EBEBEB',
    text: '#1A1A1A', secondaryText: '#424242', positive: '#07561A', negative: '#8C1022',
    warning: '#6B3A00', link: '#084C96', focus: '#1A1A1A', annotation: '#6B3A00',
  },
} as const satisfies Record<ThemeName, Record<string, string>>;

export type ImmersiveColors = typeof immersiveTheme[ThemeName];

export const IMMERSIVE_PANEL_RADIUS = dpToWorld(immersiveRadii.panel);
export const IMMERSIVE_CONTENT_INSET = dpToWorld(24);
export const IMMERSIVE_CONTROL_HEIGHT = dpToWorld(48);
export const IMMERSIVE_CONTROL_RADIUS = IMMERSIVE_CONTROL_HEIGHT / 2;
export const IMMERSIVE_FIELD_RADIUS = dpToWorld(immersiveRadii.field);
export const IMMERSIVE_CARD_RADIUS = dpToWorld(immersiveRadii.card);
export const IMMERSIVE_CONTROL_BAR_GAP = dpToWorld(12);
export const IMMERSIVE_FOCUS_WIDTH = dpToWorld(3);
export const IMMERSIVE_FOCUS_GAP = dpToWorld(4);

export const IMMERSIVE_LAYERS = {
  surface: 0,
  content: 0.003,
  controls: 0.004,
  hover: 0.006,
  tooltip: 0.007,
} as const;

function cssFont(variable: string, fallback: string): string {
  if (typeof document === 'undefined' || !document.documentElement || typeof getComputedStyle === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || fallback;
}

export function immersiveFontFamily(family: 'sans' | 'mono'): string {
  return family === 'mono'
    ? `${cssFont('--font-geist-mono', 'ui-monospace')}, ui-monospace, monospace`
    : `${cssFont('--font-inter', 'Inter')}, system-ui, sans-serif`;
}

export function immersiveFont(name: ImmersiveTypeName, pixelsPerMeter: number): string {
  const token = immersiveType[name];
  return `${token.weight} ${Math.max(1, Math.round(dpToWorld(token.size) * pixelsPerMeter))}px ${immersiveFontFamily(token.family)}`;
}

export function immersiveLineHeight(name: ImmersiveTypeName, pixelsPerMeter: number): number {
  return Math.max(1, Math.round(dpToWorld(immersiveType[name].lineHeight) * pixelsPerMeter));
}

export async function loadImmersiveFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const sans = immersiveFontFamily('sans');
  const mono = immersiveFontFamily('mono');
  await Promise.all([
    document.fonts.load(`400 18px ${sans}`),
    document.fonts.load(`600 18px ${sans}`),
    document.fonts.load(`400 16px ${mono}`),
  ]);
}

export function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = hex.slice(1).match(/.{2}/g)!.map((value) => parseInt(value, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}
