'use client';

import { normalizeMermaidSource } from './mermaidPolicy';

let initialized = false;

export async function renderMermaid(id: string, source: string): Promise<{ svg: string; viewBox: [number, number, number, number] }> {
  const mermaid = (await import('mermaid')).default;
  const normalizedSource = normalizeMermaidSource(source);
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      theme: 'base',
      themeVariables: {
        background: '#fffdf8',
        primaryColor: '#f5ead8',
        primaryTextColor: '#201e1d',
        primaryBorderColor: '#8c491a',
        lineColor: '#756b5d',
        secondaryColor: '#eef4df',
        tertiaryColor: '#fff2eb',
        fontFamily: 'Figtree, system-ui, sans-serif',
      },
      flowchart: { htmlLabels: false, curve: 'basis' },
    });
    initialized = true;
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
}
