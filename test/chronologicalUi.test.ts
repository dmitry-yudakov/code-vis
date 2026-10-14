import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApprovalArea } from '@/features/conversation/ApprovalArea';
import { TurnActivity } from '@/features/conversation/TurnActivity';
import { createTurn, updateActivity, finishTurn } from '@/shared/turnActivity';

describe('chronological conversation presentation', () => {
  it('keeps unknown review unallowable without removing Deny or Review', () => {
    const html = renderToStaticMarkup(createElement(ApprovalArea, { requests: [{ requestId: 'p', participantId: 'a', tool: 'Run', detail: 'shortened' }], agents: [], onDecide: () => {}, onStop: () => {} }));
    expect(html).toContain('Full review unavailable');
    expect(html).toMatch(/disabled=""[^>]*>Allow once/);
    expect(html).toContain('>Deny</button>');
    expect(html).toContain('>Review</button>');
  });

  it('renders retained outcomes in order with inert output and explicit omissions', () => {
    let turn = createTurn('run', 'message', 'a', '2026-10-13T00:00:00.000Z');
    turn = updateActivity(turn, 1, { kind: 'assistant', key: 'a', text: '**Before**' });
    turn = updateActivity(turn, 1, { kind: 'tool', key: 't', tool: 'Run', summary: 'false', status: 'failed', error: '<script>bad()</script>', output: 'detail', omittedBytes: 50 });
    turn = finishTurn(turn, 'failed');
    const html = renderToStaticMarkup(createElement(TurnActivity, { turn, agentName: 'Claude', permissions: [], onReview: () => {}, renderFinal: () => null }));
    expect(html.indexOf('<strong>Before</strong>')).toBeLessThan(html.indexOf('false'));
    expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;');
    expect(html).not.toContain('<script>bad()');
    expect(html).toContain('50 bytes omitted');
    expect(html).toContain('Failed');
  });
});
