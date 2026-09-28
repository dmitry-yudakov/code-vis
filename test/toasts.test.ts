import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { runOutcomeFromError } from '@/features/conversation/runPresentation';
import { ToastStack } from '@/features/shell/ToastStack';
import {
  MAX_TOASTS, runOutcomeTone, toastLifetime, withoutToast, withToast, type Toast, type ToastInput,
} from '@/features/shell/toasts';

function raise(inputs: ToastInput[]): Toast[] {
  return inputs.reduce<Toast[]>((toasts, input, index) => withToast(toasts, input, index + 1), []);
}

describe('toast stack model', () => {
  it('merges a repeated message into one toast that counts it', () => {
    const toasts = raise([
      { tone: 'error', message: 'Could not save the drawing.' },
      { tone: 'info', message: 'Reconnected to 1 active turn.' },
      { tone: 'error', message: 'Could not save the drawing.' },
    ]);

    expect(toasts.map((toast) => [toast.key, toast.count, toast.serial])).toEqual([
      ['info:Reconnected to 1 active turn.', 1, 2],
      ['error:Could not save the drawing.', 2, 3],
    ]);
  });

  it('replaces a keyed toast in place of stacking it, and restarts its count for a new message', () => {
    const toasts = raise([
      { key: 'archive:s1', tone: 'success', message: 'Archived “Auth”.', actions: [{ label: 'Undo archive', onSelect: () => {} }] },
      { key: 'archive:s1', tone: 'success', message: 'Restored “Auth”.' },
    ]);

    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ key: 'archive:s1', message: 'Restored “Auth”.', count: 1, serial: 2 });
    expect(toasts[0].actions).toBeUndefined();
  });

  it('drops the oldest toast that can time out once the stack is full', () => {
    const toasts = raise([
      { tone: 'error', message: 'Sticky one' },
      { tone: 'info', message: 'Transient one' },
      { tone: 'success', message: 'Transient two' },
      { tone: 'warning', message: 'Transient three' },
    ]);

    expect(MAX_TOASTS).toBe(3);
    expect(toasts.map((toast) => toast.message)).toEqual(['Sticky one', 'Transient two', 'Transient three']);
  });

  it('drops the oldest persistent toast only when every toast is persistent', () => {
    const toasts = raise([
      { tone: 'error', message: 'First' },
      { tone: 'error', message: 'Second' },
      { tone: 'info', message: 'Third', persistent: true },
      { tone: 'error', message: 'Fourth' },
    ]);

    expect(toasts.map((toast) => toast.message)).toEqual(['Second', 'Third', 'Fourth']);
  });

  it('dismisses by key and leaves the stack untouched for an unknown key', () => {
    const toasts = raise([
      { key: 'send', tone: 'warning', message: 'Attach a repository first.' },
      { tone: 'success', message: 'Restored.' },
    ]);

    expect(withoutToast(toasts, 'send').map((toast) => toast.key)).toEqual(['success:Restored.']);
    expect(withoutToast(toasts, 'missing')).toBe(toasts);
  });

  it('never drops the toast being raised, even when every other toast stays until dismissed', () => {
    const toasts = raise([
      { tone: 'error', message: 'First' },
      { tone: 'error', message: 'Second' },
      { tone: 'error', message: 'Third' },
      { key: 'archive:s1', tone: 'success', message: 'Archived “Auth”.', actions: [{ label: 'Undo archive', onSelect: () => {} }] },
    ]);

    expect(toasts.map((toast) => toast.message)).toEqual(['Second', 'Third', 'Archived “Auth”.']);
  });

  it('times out news quickly, what needs reading later, and never an error or a persistent toast', () => {
    const undo = [{ label: 'Undo archive', onSelect: () => {} }];

    expect(toastLifetime({ tone: 'info', message: 'News' })).toBe(6_000);
    expect(toastLifetime({ tone: 'success', message: 'Done' })).toBe(6_000);
    expect(toastLifetime({ tone: 'warning', message: 'Refused' })).toBe(10_000);
    expect(toastLifetime({ tone: 'success', message: 'Archived', actions: undo })).toBe(10_000);
    expect(toastLifetime({ tone: 'error', message: 'Failed' })).toBeUndefined();
    expect(toastLifetime({ tone: 'info', message: 'Hidden sessions', persistent: true })).toBeUndefined();
  });

  it('gives a cancelled turn a neutral tone, a turn at its limit a warning, and a failure an error', () => {
    const error = (code: 'cancelled' | 'max-turns' | 'process-failed') => runOutcomeFromError({
      type: 'error', runId: 'run-a', code, message: code, retryable: false, delivery: 'possibly-sent',
    }, 'plan');

    expect(error('cancelled').cancelled).toBe(true);
    expect(runOutcomeTone(error('cancelled'))).toBe('info');
    expect(runOutcomeTone(error('max-turns'))).toBe('warning');
    expect(runOutcomeTone(error('process-failed'))).toBe('error');
    expect(runOutcomeTone({ message: 'Agent request failed (503).', missingProviderSession: false })).toBe('error');
  });
});

describe('toast stack', () => {
  function render(toasts: Toast[]) {
    return renderToStaticMarkup(createElement(ToastStack, { toasts, onRemove: () => {} }));
  }

  it('renders nothing while there is nothing to say', () => {
    expect(render([])).toBe('');
  });

  it('shows the newest toast first, each with its tone, role, glyph, count, actions, and dismiss', () => {
    const markup = render(raise([
      { tone: 'error', message: 'Could not save the drawing.' },
      { tone: 'error', message: 'Could not save the drawing.' },
      { key: 'archive:s1', tone: 'success', message: 'Archived “Auth”.', actions: [{ label: 'Undo archive', onSelect: () => {} }] },
    ]));

    expect(markup).toContain('<section class="toast-region" aria-label="Notifications"');
    expect(markup.indexOf('Archived “Auth”.')).toBeLessThan(markup.indexOf('Could not save the drawing.'));
    expect(markup).toMatch(/<div class="toast" data-tone="success" role="status"[^>]*>/);
    expect(markup).toMatch(/<div class="toast" data-tone="error" role="alert"[^>]*>/);
    expect(markup.match(/class="toast-glyph"/g)).toHaveLength(2);
    expect(markup).toContain('<span class="toast-count"><span aria-hidden="true">×2</span><span class="sr-only"> (2 times)</span></span>');
    expect(markup).toContain('>Undo archive</button>');
    expect(markup.match(/aria-label="Dismiss notification"/g)).toHaveLength(2);
  });

  it('keeps a disabled action visible but unusable', () => {
    const markup = render(raise([{
      tone: 'error', message: 'The provider session is missing.',
      actions: [{ label: 'Continue in new session', onSelect: () => {}, disabled: true }],
    }]));

    expect(markup).toMatch(/<button type="button" disabled="">Continue in new session<\/button>/);
  });
});
