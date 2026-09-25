import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InstructionComposer } from '@/features/conversation/InstructionComposer';
import type { RecentCanvas } from '@/features/conversation/recentCanvases';
import type { AgentExecution, AgentMode, DiagramArtifact } from '@/shared/types';

const artifact: DiagramArtifact = {
  id: 'diagram-8', sessionId: 't1', messageId: 'message-1', ordinal: 8, source: 'flowchart LR\n  A --> B',
  createdAt: '2026-09-25T11:00:00.000Z', status: 'ready', derivedFromDiagramIds: [], evidence: [],
};
const CANVASES: RecentCanvas[] = [
  { id: 'diagram-8', target: { kind: 'diagram', artifact }, marks: [], title: 'Diagram 8', detail: 'flowchart · on the canvas', active: true },
  {
    id: 'sketch-3', target: { kind: 'sketch', sketch: { id: 'sketch-3', sessionId: 't1', ordinal: 3, createdAt: artifact.createdAt, viewBox: [0, 0, 1_600, 1_000] } },
    marks: [], title: 'Sketch 3', detail: 'sketch · 1h ago', active: false,
  },
];

function render(options: {
  mode?: AgentMode;
  execution?: AgentExecution;
  unsupportedModes?: AgentMode[];
  running?: boolean;
  attachedIds?: string[];
  reports?: boolean;
  unavailable?: string;
  busy?: boolean;
} = {}) {
  const attachedIds = options.attachedIds ?? [];
  return renderToStaticMarkup(createElement(InstructionComposer, {
    value: '',
    execution: options.execution,
    running: options.running ?? false,
    attached: CANVASES.filter((canvas) => attachedIds.includes(canvas.id)).map((canvas) => canvas.target),
    activeDiagramId: 'diagram-8',
    markCounts: {},
    mode: options.mode ?? 'plan',
    unsupportedModes: options.unsupportedModes ?? [],
    modelSelection: {},
    theme: 'light',
    recentCanvases: CANVASES,
    continuation: { unavailable: options.unavailable, busy: options.busy, onContinue: vi.fn() },
    onChange: vi.fn(),
    onModeChange: vi.fn(),
    onModelSelectionChange: vi.fn(),
    onSend: vi.fn(),
    onCancel: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onToggleAttachment: vi.fn(),
    onOpenHistory: vi.fn(),
    onNewSketch: vi.fn(),
    onOpenReports: options.reports ? vi.fn() : undefined,
  }));
}

/** The `<details>` menu with this class, as its summary's name and text and its items' names, states, and details. */
function menu(markup: string, className: string) {
  const details = markup.match(new RegExp(`<details class="composer-menu ${className}[^"]*"[^>]*>([\\s\\S]*?)</details>`));
  if (!details) return undefined;
  const summary = details[1].match(/<summary([^>]*)>([\s\S]*?)<\/summary>/)!;
  const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, '\'').replace(/&amp;/g, '&');
  const attribute = (html: string, name: string) => html.match(new RegExp(`${name}="([^"]*)"`))?.[1]?.replace(/&#x27;/g, '\'');
  return {
    className: details[0].match(/^<details class="([^"]*)"/)![1],
    label: attribute(summary[1], 'aria-label'),
    disabled: summary[1].includes('aria-disabled="true"'),
    text: text(summary[2]),
    items: [...details[1].matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attributes, content]) => ({
      role: attribute(attributes, 'role'),
      name: attribute(attributes, 'aria-label'),
      detail: text(content.match(/<small[^>]*>([\s\S]*?)<\/small>/)?.[1] ?? ''),
      checked: attributes.includes('aria-checked="true"'),
      disabled: /\sdisabled=""/.test(attributes),
      title: attribute(attributes, 'title'),
      /** Every text the item's aria-describedby points at, in order. */
      description: (attribute(attributes, 'aria-describedby') ?? '').split(' ').filter(Boolean)
        .map((id) => text(content.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`))?.[1] ?? '')).join(' | '),
      thumbnail: content.includes('canvas-thumbnail'),
      trail: text(content.match(/<span class="menu-item-check">([\s\S]*)$/)?.[1] ?? ''),
    })),
    heading: text(details[1].match(/<span class="composer-menu-heading">([\s\S]*?)<\/span>/)?.[1] ?? ''),
  };
}

describe('composer mode picker', () => {
  it('replaces the three mode buttons with one picker named for its mode and hint', () => {
    const markup = render();
    expect(markup).not.toContain('mode-selector');
    const picker = menu(markup, 'mode-menu')!;
    expect(picker.text).toBe('Plan');
    expect(picker.label).toBe('Mode: Plan. Read-only · ends in a plan');
    expect(picker.items).toMatchObject([
      { role: 'radio', name: 'Ask', detail: 'Read-only · git history', checked: false, disabled: false, title: expect.stringMatching(/^Ask — read-only/) },
      { role: 'radio', name: 'Plan', detail: 'Read-only · ends in a plan', checked: true, disabled: false },
      { role: 'radio', name: 'Agent', detail: 'Edits files · asks first', checked: false, disabled: false, title: expect.stringMatching(/asks for approval/) },
    ]);
    expect(markup).toMatch(/role="radiogroup" aria-label="Agent mode"/);
    // The hint and the long explanation both reach assistive technology.
    expect(picker.items[1].description).toBe('Read-only · ends in a plan | Plan — same read-only capability as Ask, but the turn ends in an implementation plan you can execute.');
  });

  it('uses the Docker hints and explanations in a Docker session', () => {
    const picker = menu(render({ execution: 'docker', mode: 'agent' }), 'mode-menu')!;
    expect(picker.label).toBe('Mode: Agent. Docker · autonomous direct edits');
    expect(picker.items.map((item) => item.detail)).toEqual([
      'Docker · repository read-only', 'Docker · repository read-only', 'Docker · autonomous direct edits',
    ]);
    expect(picker.items[2].title).toBe('Agent edits the mounted repository and runs commands without individual approvals.');
    expect(picker.items[0].title).toMatch(/mounted read-only/);
  });

  it('fills with wait for Agent only', () => {
    expect(menu(render({ mode: 'agent' }), 'mode-menu')!.className).toContain('mode-agent');
    expect(menu(render({ mode: 'plan' }), 'mode-menu')!.className).not.toContain('mode-agent');
  });

  it('offers an unsupported mode as a disabled choice that says why', () => {
    const [ask, plan] = menu(render({ unsupportedModes: ['plan'] }), 'mode-menu')!.items;
    expect(ask.disabled).toBe(false);
    expect(plan).toMatchObject({
      disabled: true,
      detail: 'Plan is unavailable for this provider and execution. Check provider setup.',
      description: 'Plan is unavailable for this provider and execution. Check provider setup.',
    });
  });

  it('is disabled while a turn runs', () => {
    const picker = menu(render({ running: true }), 'mode-menu')!;
    expect(picker.disabled).toBe(true);
    expect(picker.items.every((item) => item.disabled)).toBe(true);
    expect(menu(render(), 'mode-menu')!.disabled).toBe(false);
  });
});

describe('composer attach menu', () => {
  it('starts the action row, before the mode picker, the model menu, and Send', () => {
    const markup = render();
    const order = ['attach-menu', 'mode-menu', 'send-button'].map((name) => markup.indexOf(name));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('lists this session\'s recent canvases with thumbnails, checking the attached ones', () => {
    const attach = menu(render({ attachedIds: ['diagram-8'] }), 'attach-menu')!;
    expect(attach.label).toBe('Attach');
    expect(attach.heading).toBe('This session');
    expect(attach.items.slice(0, 2)).toMatchObject([
      { role: 'menuitemcheckbox', name: 'Diagram 8', detail: 'flowchart · on the canvas', checked: true, thumbnail: true, trail: 'Included' },
      { role: 'menuitemcheckbox', name: 'Sketch 3', detail: 'sketch · 1h ago', checked: false, thumbnail: true, trail: '' },
    ]);
    const attachedSketch = menu(render({ attachedIds: ['sketch-3'] }), 'attach-menu')!.items[1];
    expect(attachedSketch).toMatchObject({ checked: true, trail: '' });
  });

  it('opens History, starts a sketch, and offers a headset report only in CodeAI\'s own project', () => {
    const names = (markup: string) => menu(markup, 'attach-menu')!.items.slice(2).map((item) => item.name);
    expect(names(render())).toEqual(['All history…', 'New sketch']);
    expect(names(render({ reports: true }))).toEqual(['All history…', 'New sketch', 'Headset report…']);
  });

  it('is disabled while a turn runs, as the instruction field is', () => {
    expect(menu(render({ running: true }), 'attach-menu')!.disabled).toBe(true);
    expect(menu(render(), 'attach-menu')!.disabled).toBe(false);
  });
});

describe('composer execution line', () => {
  it('names the execution once, followed by the mode\'s hint', () => {
    const markup = render({ execution: 'docker', mode: 'agent' });
    expect(markup).not.toContain('composer-hint');
    const execution = menu(markup, 'execution-menu')!;
    expect(execution).toMatchObject({ label: 'Execution: Docker', text: 'Docker', disabled: false, heading: 'Docker session' });
    expect(markup).toMatch(/<span class="execution-hint">autonomous direct edits<\/span>/);
    expect(render({ mode: 'plan' })).toMatch(/<span class="execution-hint">Read-only · ends in a plan<\/span>/);
    expect(menu(render(), 'execution-menu')!.label).toBe('Execution: Local');
  });

  it('continues in the other execution, or says why it cannot', () => {
    expect(menu(render(), 'execution-menu')!.items).toMatchObject([
      { role: 'menuitem', name: 'Continue in Docker…', disabled: false, detail: 'Opens a new session with an editable recap.' },
    ]);
    expect(menu(render({ unavailable: 'Enable Docker in Arena to continue there.' }), 'execution-menu')!.items[0])
      .toMatchObject({ disabled: true, detail: 'Enable Docker in Arena to continue there.' });
    expect(menu(render({ execution: 'docker' }), 'execution-menu')!.items[0].name).toBe('Continue in Local…');
  });

  it('says a continuation is being created, where the hint was', () => {
    const markup = render({ busy: true });
    expect(menu(markup, 'execution-menu')!.items[0].disabled).toBe(true);
    expect(markup).toMatch(/<span class="execution-hint">Creating a Docker session…<\/span>/);
  });

  it('stays open to a running turn, whose reason the continuation carries', () => {
    expect(menu(render({ running: true, unavailable: 'Wait for this turn to finish.' }), 'execution-menu')!.disabled).toBe(false);
  });
});
