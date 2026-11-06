import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContextUsage } from '@/features/agents/ContextUsage';
import { RunRegistry } from '@/server/runs/runRegistry';
import { agentEventStream } from '@/app/api/agent/eventStream';
import { readNdjson } from '@/features/conversation/ndjson';
import type { AgentEvent } from '@/shared/types';

describe('context indicator and recovery', () => {
  it('provides an accessible percentage and exact token counts; over-capacity readings stay bounded', () => {
    const markup = renderToStaticMarkup(createElement(ContextUsage, { name: 'Codex', usage: { usedTokens: 42_000, contextWindow: 200_000 } }));
    expect(markup).toContain('role="meter"');
    expect(markup).toContain('aria-valuenow="21"');
    expect(markup).toContain('42,000 of 200,000 tokens');
    const full = renderToStaticMarkup(createElement(ContextUsage, { name: 'Claude', usage: { usedTokens: 250_000, contextWindow: 200_000 } }));
    expect(full).toContain('aria-valuenow="100"');
    expect(full).toContain('250,000 of 200,000 tokens');
  });

  it('distinguishes unavailable usage/capacity from an actual empty context', () => {
    const unknown = renderToStaticMarkup(createElement(ContextUsage, { name: 'Claude' }));
    expect(unknown).toContain('not reported yet');
    expect(unknown).not.toContain('role="meter"');
    const tokens = renderToStaticMarkup(createElement(ContextUsage, { name: 'Claude', usage: { usedTokens: 10_000 } }));
    expect(tokens).toContain('10,000 tokens; capacity unavailable');
    const empty = renderToStaticMarkup(createElement(ContextUsage, { name: 'Codex', usage: { usedTokens: 0, contextWindow: 200_000 } }));
    expect(empty).toContain('aria-valuenow="0"');
  });

  it('retains only the most recent context for reconnect replay alongside required events', () => {
    const registry = new RunRegistry();
    registry.start({ runId: 'run', sessionId: 'session', participantId: 'agent', cancel() {} });
    for (let i = 0; i < 2000; i++) registry.record('run', { type: 'context-usage', runId: 'run', participantId: 'agent', usage: { usedTokens: i, contextWindow: 200_000 } });
    registry.record('run', { type: 'done', runId: 'run', cancelled: false, durationMs: 1 });
    registry.finish('run');
    const replay = registry.subscribe('run', () => undefined)!.replay;
    expect(replay.filter(event => event.type === 'context-usage')).toEqual([{ type: 'context-usage', runId: 'run', participantId: 'agent', usage: { usedTokens: 1999, contextWindow: 200_000 } }]);
    expect(replay).toContainEqual({ type: 'done', runId: 'run', cancelled: false, durationMs: 1 });
  });

  it('coalesces context bursts for a slow reader while delivering required events and the final reading', async () => {
    const response = agentEventStream({ runId: 'run', onDetach() {}, async start(write) {
      for (let i = 0; i < 30_000; i++) write({ type: 'context-usage', runId: 'run', participantId: 'agent', usage: { usedTokens: i, contextWindow: 200_000 } });
      write({ type: 'done', runId: 'run', cancelled: false, durationMs: 1 });
    } });
    const received: AgentEvent[] = [];
    for await (const event of readNdjson<AgentEvent>(response)) received.push(event);
    expect(received.filter(event => event.type === 'context-usage').at(-1)).toMatchObject({ usage: { usedTokens: 29_999 } });
    expect(received.length).toBeLessThan(10);
    expect(received.at(-1)?.type).toBe('done');
  });
});
