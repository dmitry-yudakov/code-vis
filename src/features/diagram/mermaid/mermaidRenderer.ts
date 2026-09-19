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

interface ParsedMermaidDiagram {
  type: string;
  db: unknown;
}

function themeVariables(theme: ThemeName) {
  const colors = palette[theme];
  // Mindmap, pie, journey and quadrant sections read cScale0…n, not primaryColor. Left unset the
  // base theme derives them by rotating the primary hue, which lands on magenta and purple — the
  // one thing on screen that belongs to no palette. Cycling the plot ramp keeps diagram ink in
  // the plot family whatever the diagram type is.
  const scale = [colors.plotScale1, colors.plotScale2, colors.plotScale3, colors.plotScale4, colors.plotScale5];
  const sections = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [
    [`cScale${index}`, scale[index % scale.length]],
    [`cScaleLabel${index}`, colors.ink],
  ]).flat());
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
    ...sections,
  };
}

async function initializedMermaid(theme: ThemeName) {
  const mermaid = (await import('mermaid')).default;
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
  return mermaid;
}

/**
 * Reads Mermaid's official parsed database while holding the same process-global queue as render.
 * Flowchart databases are reused by Mermaid, so callers must copy everything they need in `read`.
 */
export function readMermaidDiagram<T>(source: string, theme: ThemeName, read: (diagram: ParsedMermaidDiagram) => T): Promise<T> {
  const operation = renderQueue.then(async () => {
    const mermaid = await initializedMermaid(theme);
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(normalizeMermaidSource(source));
    return read(diagram as ParsedMermaidDiagram);
  });
  renderQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export function renderMermaid(id: string, source: string, theme: ThemeName): Promise<MermaidRender> {
  const render = renderQueue.then(async () => {
    const mermaid = await initializedMermaid(theme);
    const normalizedSource = normalizeMermaidSource(source);
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
