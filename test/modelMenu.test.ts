import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InstructionComposer } from '@/features/conversation/InstructionComposer';
import type { ModelSelection, ProviderHealth } from '@/shared/types';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const CHOICES: Pick<ProviderHealth, 'models' | 'efforts'> = {
  models: [
    { id: 'opus', label: 'Opus', efforts: EFFORTS },
    { id: 'haiku', label: 'Haiku', efforts: [] },
    { id: 'gpt-5.5', label: 'GPT-5.5', efforts: ['low', 'ultra'] },
  ],
  efforts: EFFORTS,
};

function render(options: { choices?: Pick<ProviderHealth, 'models' | 'efforts'>; selection?: ModelSelection; running?: boolean } = {}) {
  return renderToStaticMarkup(createElement(InstructionComposer, {
    value: 'hello',
    running: options.running ?? false,
    attached: [],
    markCounts: {},
    mode: 'ask',
    unsupportedModes: [],
    modelChoices: 'choices' in options ? options.choices : CHOICES,
    modelSelection: options.selection ?? {},
    theme: 'light',
    recentCanvases: [],
    continuation: { onContinue: vi.fn() },
    onChange: vi.fn(),
    onModeChange: vi.fn(),
    onModelSelectionChange: vi.fn(),
    onSend: vi.fn(),
    onCancel: vi.fn(),
    onRemoveAttachment: vi.fn(),
    onToggleAttachment: vi.fn(),
    onOpenHistory: vi.fn(),
    onNewSketch: vi.fn(),
  }));
}

function radiogroup(markup: string, label: string) {
  const group = markup.match(new RegExp(`<div[^>]*role="radiogroup" aria-label="${label}"[^>]*>([\\s\\S]*?)</div>`))?.[1];
  if (group === undefined) return undefined;
  return [...group.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(([, attributes, text]) => ({
    text,
    checked: attributes.includes('aria-checked="true"'),
    disabled: attributes.includes('disabled'),
  }));
}

function summary(markup: string) {
  return markup.match(/<details class="model-menu"[^>]*><summary[^>]*>([^<]*)<\/summary>/)?.[1];
}

describe('composer model menu', () => {
  it('is absent when the provider lists no models and no efforts', () => {
    for (const choices of [undefined, {}, { models: [], efforts: [] }]) {
      expect(render({ choices })).not.toContain('model-menu');
    }
  });

  it('sits between the mode picker and Send', () => {
    const markup = render();
    expect(markup.indexOf('mode-menu')).toBeGreaterThanOrEqual(0);
    expect(markup.indexOf('mode-menu')).toBeLessThan(markup.indexOf('model-menu'));
    expect(markup.indexOf('model-menu')).toBeLessThan(markup.indexOf('send-button'));
  });

  it('names the selection in its summary and offers the chosen model\'s efforts', () => {
    const plain = render();
    expect(summary(plain)).toBe('Default');
    expect(radiogroup(plain, 'Model')).toEqual([
      { text: 'Default', checked: true, disabled: false },
      { text: 'Opus', checked: false, disabled: false },
      { text: 'Haiku', checked: false, disabled: false },
      { text: 'GPT-5.5', checked: false, disabled: false },
    ]);
    expect(radiogroup(plain, 'Effort')?.map((item) => item.text)).toEqual(['Default', 'Low', 'Medium', 'High', 'Extra high', 'Max']);

    const chosen = render({ selection: { model: 'opus', effort: 'high' } });
    expect(summary(chosen)).toBe('Opus · High');
    expect(radiogroup(chosen, 'Model')?.find((item) => item.checked)?.text).toBe('Opus');
    expect(radiogroup(chosen, 'Effort')?.find((item) => item.checked)?.text).toBe('High');

    expect(summary(render({ selection: { model: 'opus' } }))).toBe('Opus');
    expect(summary(render({ selection: { effort: 'xhigh' } }))).toBe('Default · Extra high');
    // Unknown provider efforts are shown as sent.
    const codex = render({ selection: { model: 'gpt-5.5', effort: 'ultra' } });
    expect(summary(codex)).toBe('GPT-5.5 · ultra');
    expect(radiogroup(codex, 'Effort')?.map((item) => item.text)).toEqual(['Default', 'Low', 'ultra']);
    // A model that takes no effort has no Effort group at all.
    expect(radiogroup(render({ selection: { model: 'haiku' } }), 'Effort')).toBeUndefined();
  });

  it('is disabled while a turn runs, like mode', () => {
    const markup = render({ running: true, selection: { model: 'opus', effort: 'low' } });
    expect(markup).toMatch(/<details class="model-menu"[^>]*><summary[^>]*aria-disabled="true"/);
    expect([...radiogroup(markup, 'Model')!, ...radiogroup(markup, 'Effort')!].every((item) => item.disabled)).toBe(true);
    expect(render()).not.toMatch(/<details class="model-menu"[^>]*><summary[^>]*aria-disabled/);
  });
});
