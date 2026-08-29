import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RunRibbon } from '@/features/diagram/components/RunRibbon';

const globalsPath = new URL('../src/app/globals.css', import.meta.url);
const layoutPath = new URL('../src/app/layout.tsx', import.meta.url);
const typesPath = new URL('../src/shared/types.ts', import.meta.url);

describe('sheet and instrument visual language', () => {
  it('loads each typography role through next/font/google', async () => {
    const layout = await readFile(layoutPath, 'utf8');

    expect(layout).toContain("import { Archivo, Geist, Geist_Mono } from 'next/font/google';");
    expect(layout).toContain("variable: '--font-geist'");
    expect(layout).toContain("variable: '--font-geist-mono'");
    expect(layout).toContain("variable: '--font-archivo'");
    expect(layout).toMatch(/className=\{`\$\{geist\.variable\} \$\{geistMono\.variable\} \$\{archivo\.variable\}`\}/);
  });

  it('reserves ambient animation for the ribbon and streaming cursor', async () => {
    const css = await readFile(globalsPath, 'utf8');
    const animationNames = [...css.matchAll(/\banimation:\s*([\w-]+)/g)]
      .map((match) => match[1])
      .filter((name) => name !== 'none');

    expect([...new Set(animationNames)].sort()).toEqual(['blink', 'ribbon-breathe']);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('animation: none !important');
  });

  it('gives every native and custom control a focus-visible treatment', async () => {
    const css = await readFile(globalsPath, 'utf8');

    expect(css).toContain(':where(button, select, textarea, input, a, summary, [tabindex]):focus-visible');
    expect(css).toContain('.project-search-input:focus-within');
    expect(css).toContain('.instruction-composer:focus-within');
  });

  it('uses Archivo only for the header lockup and display-scale empty headings', async () => {
    const css = await readFile(globalsPath, 'utf8');
    const displayRules = css.split('\n').filter((line) => line.includes('var(--display)'));

    expect(displayRules).toHaveLength(2);
    expect(displayRules.every((line) => /\.brand|\.empty-canvas-content h1/.test(line))).toBe(true);
    expect(css).toMatch(/\.empty-canvas-content h1[^\n]+clamp\(34px/);
  });

  it('renders an idle hairline and one honest tick per reported tool event', () => {
    const idle = renderToStaticMarkup(createElement(RunRibbon, {
      running: false,
      failed: false,
      pendingApprovals: 0,
      activity: [],
    }));
    expect(idle).toContain('run-ribbon idle');
    expect(idle).not.toContain('progressbar');

    const working = renderToStaticMarkup(createElement(RunRibbon, {
      running: true,
      failed: false,
      pendingApprovals: 0,
      activity: [
        { key: 1, tool: 'Read', detail: 'README.md' },
        { key: 2, tool: 'Bash', detail: 'blocked command', denied: true },
      ],
    }));
    expect(working.match(/run-ribbon-tick/g)).toHaveLength(2);
    expect(working).toContain('run-ribbon-tick denied newest');
    expect(working).toContain('Denied — Bash — blocked command');
    expect(working).not.toContain('progressbar');
  });

  it('gives approval and failure precedence without expanding AgentEvent', async () => {
    const approval = renderToStaticMarkup(createElement(RunRibbon, {
      running: true,
      failed: false,
      pendingApprovals: 1,
      activity: [{ key: 1, tool: 'Edit', detail: 'README.md' }],
    }));
    expect(approval).toContain('run-ribbon awaiting-approval');
    expect(approval).not.toContain('run-ribbon-tick');

    const failed = renderToStaticMarkup(createElement(RunRibbon, {
      running: false,
      failed: true,
      pendingApprovals: 0,
      activity: [],
    }));
    expect(failed).toContain('run-ribbon failed');

    const types = await readFile(typesPath, 'utf8');
    const eventType = types.slice(types.indexOf('export type AgentEvent'), types.indexOf('/** Public, host-local identity'));
    expect(eventType).toContain("type: 'tool-activity'; runId: string; tool: string; detail?: string; denied?: boolean");
    expect(eventType).not.toMatch(/\b(?:total|percentage|progress|callId)\b/);
  });
});
