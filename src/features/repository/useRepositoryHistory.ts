'use client';

import { useEffect, useState } from 'react';
import type { GitHistory } from '@/shared/types';

export function useRepositoryHistory(checkoutId: string, enabled: boolean, revision: number, apiBase: string) {
  const identity = JSON.stringify([apiBase, checkoutId]);
  const [result, setResult] = useState<{ identity: string; revision: number; history?: GitHistory; error?: string }>();
  useEffect(() => {
    if (!enabled || !checkoutId) return;
    const controller = new AbortController();
    void fetch(`${apiBase}/repository/history?${new URLSearchParams({ checkoutId })}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const data = await response.json() as { history?: GitHistory; error?: string };
        if (!response.ok || !data.history) throw new Error(data.error || 'Could not load Git history.');
        if (!controller.signal.aborted) setResult({ identity, revision, history: data.history });
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setResult({ identity, revision, error: reason instanceof Error ? reason.message : 'Could not load Git history.' });
      });
    return () => controller.abort();
  }, [apiBase, checkoutId, enabled, identity, revision]);
  const current = result?.identity === identity ? result : undefined;
  return { history: current?.history, error: current?.error, loading: Boolean(enabled && checkoutId && current?.revision !== revision) };
}
