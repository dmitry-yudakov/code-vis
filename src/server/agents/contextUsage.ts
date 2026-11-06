import type { AgentContextUsage } from '@/shared/types';

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function tokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function measured(usedTokens: unknown, contextWindow: unknown): AgentContextUsage | undefined {
  if (!tokenCount(usedTokens)) return;
  return { usedTokens, ...(tokenCount(contextWindow) && contextWindow > 0 ? { contextWindow } : {}) };
}

/** App Server's `last` already includes cached input and output; `total` is lifetime usage. */
export function codexContextUsage(value: unknown): AgentContextUsage | undefined {
  const usage = record(value);
  return measured(record(usage?.last)?.totalTokens, usage?.modelContextWindow);
}

/** Match Claude's status-line input-only percentage, including cached prompt tokens. */
export function claudeContextUsage(message: unknown, modelUsage?: unknown, previous?: AgentContextUsage): AgentContextUsage | undefined {
  const root = record(message);
  const usage = record(root?.usage);
  if (!usage || !tokenCount(usage.input_tokens)) return;
  const read = usage.cache_read_input_tokens ?? 0;
  const created = usage.cache_creation_input_tokens ?? 0;
  if (!tokenCount(read) || !tokenCount(created)) return;
  const model = typeof root?.model === 'string' && root.model.length > 0 && root.model.length <= 200 ? root.model : undefined;
  const reported = model ? record(record(modelUsage)?.[model])?.contextWindow : undefined;
  const capacity = reported ?? (model && previous?.model === model ? previous.contextWindow : undefined);
  const result = measured(usage.input_tokens + read + created, capacity);
  return result && { ...result, ...(model ? { model } : {}) };
}
