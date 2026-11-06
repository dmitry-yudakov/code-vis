import { describe, expect, it } from 'vitest';
import { claudeContextUsage, codexContextUsage } from '@/server/agents/contextUsage';

describe('provider context usage', () => {
  it('uses the latest Codex request rather than cumulative usage or double-counted cached tokens', () => {
    expect(codexContextUsage({ total: { totalTokens: 900_000 }, last: { totalTokens: 42_000, cachedInputTokens: 20_000 }, modelContextWindow: 200_000 }))
      .toEqual({ usedTokens: 42_000, contextWindow: 200_000 });
    expect(codexContextUsage({ total: { totalTokens: 900_000 } })).toBeUndefined();
    // Compaction may lower the most recent request's size.
    expect(codexContextUsage({ last: { totalTokens: 5000 }, modelContextWindow: 200_000 })?.usedTokens).toBe(5000);
  });

  it('matches Claude status-line input usage, including both cache categories, for the root model', () => {
    expect(claudeContextUsage({ model: 'main', usage: { input_tokens: 1000, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 5000, output_tokens: 500 } }, {
      child: { contextWindow: 1_000_000, inputTokens: 999_999 }, main: { contextWindow: 200_000, inputTokens: 800_000 },
    })).toEqual({ usedTokens: 26_000, contextWindow: 200_000, model: 'main' });
  });

  it('retains measured tokens when capacity is unavailable without guessing a model limit', () => {
    expect(codexContextUsage({ last: { totalTokens: 0 }, modelContextWindow: null })).toEqual({ usedTokens: 0 });
    expect(claudeContextUsage({ model: 'unknown', usage: { input_tokens: 100 } }, { child: { contextWindow: 200_000 } }))
      .toEqual({ usedTokens: 100, model: 'unknown' });
  });

  it('reuses reported Claude capacity only for the same actual model', () => {
    const previous = { usedTokens: 40_000, contextWindow: 200_000, model: 'main' };
    expect(claudeContextUsage({ model: 'main', usage: { input_tokens: 42_000 } }, undefined, previous))
      .toEqual({ usedTokens: 42_000, contextWindow: 200_000, model: 'main' });
    expect(claudeContextUsage({ model: 'other', usage: { input_tokens: 42_000 } }, undefined, previous))
      .toEqual({ usedTokens: 42_000, model: 'other' });
  });

  it.each([-1, NaN, Infinity, 1.5, '100', Number.MAX_SAFE_INTEGER + 1])('ignores invalid token counts: %s', invalid => {
    expect(codexContextUsage({ last: { totalTokens: invalid }, modelContextWindow: 200_000 })).toBeUndefined();
    expect(claudeContextUsage({ usage: { input_tokens: invalid } })).toBeUndefined();
    expect(claudeContextUsage({ usage: { input_tokens: 100, cache_read_input_tokens: invalid } })).toBeUndefined();
  });

  it('does not treat missing usage or malformed capacities as a full or empty context', () => {
    expect(claudeContextUsage({})).toBeUndefined();
    expect(codexContextUsage(null)).toBeUndefined();
    expect(codexContextUsage({ last: { totalTokens: 100 }, modelContextWindow: -1 })).toEqual({ usedTokens: 100 });
    expect(claudeContextUsage({ usage: { input_tokens: 100 } })).toEqual({ usedTokens: 100 });
  });
});
