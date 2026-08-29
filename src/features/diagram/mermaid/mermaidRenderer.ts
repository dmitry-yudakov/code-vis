'use client';

import { fonts, palette, type ThemeName } from '@/shared/design/tokens';
import { normalizeMermaidSource } from './mermaidPolicy';

interface MermaidRender {
  svg: string;
  viewBox: [number, number, number, number];
}

// This caches Mermaid's process-global initialization only; every caller still supplies a theme.
let lastInitializedTheme: ThemeName | undefined;
let renderQueue: Promise<void> = Promise.resolve();

function themeVariables(theme: ThemeName) {
  const colors = palette[theme];
  return {
    background: colors.sheet,
    primaryColor: colors.plotWash,
    primaryTextColor: colors.ink,
    primaryBorderColor: colors.plot,
    lineColor: colors.plot,
    secondaryColor: colors.plotWash,
    secondaryBorderColor: colors.plot,
    tertiaryColor: colors.raised,
    tertiaryBorderColor: colors.plot,
    noteBkgColor: colors.plotWash,
    noteBorderColor: colors.plot,
    fontFamily: fonts.sans,
  };
}

export function renderMermaid(id: string, source: string, theme: ThemeName): Promise<MermaidRender> {
  const render = renderQueue.then(async () => {
    const mermaid = (await import('mermaid')).default;
    const normalizedSource = normalizeMermaidSource(source);
    if (lastInitializedTheme !== theme) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        htmlLabels: false,
        theme: 'base',
        themeVariables: themeVariables(theme),
        flowchart: { htmlLabels: false, curve: 'basis' },
      });
      lastInitializedTheme = theme;
    }
    await mermaid.parse(normalizedSource);
    const rendered = await mermaid.render(id, normalizedSource);
    const parsed = new DOMParser().parseFromString(rendered.svg, 'image/svg+xml').documentElement;
    const raw = parsed.getAttribute('viewBox')?.split(/[ ,]+/).map(Number);
    const width = Number.parseFloat(parsed.getAttribute('width') || '') || 900;
    const height = Number.parseFloat(parsed.getAttribute('height') || '') || 600;
    const viewBox: [number, number, number, number] = raw?.length === 4 && raw.every(Number.isFinite)
      ? [raw[0], raw[1], Math.max(1, raw[2]), Math.max(1, raw[3])]
      : [0, 0, width, height];
    return { svg: rendered.svg, viewBox };
  });
  renderQueue = render.then(() => undefined, () => undefined);
  return render;
}
