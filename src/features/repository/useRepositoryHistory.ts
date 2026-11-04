'use client';

import { useEffect, useState } from 'react';
import type { GitHistory } from '@/shared/types';

export function useRepositoryHistory(checkoutId: string, enabled: boolean, revision: number, apiBase: string) {
  const identity = JSON.stringify([apiBase, checkoutId, revision]);
  const [result, setResult] = useState<{ identity: string; history?: GitHistory; error?: string }>();
  useEffect(() => {
    if (!enabled || !checkoutId) return;
    const controller = new AbortController();
    void fetch(`${apiBase}/repository/history?${new URLSearchParams({ checkoutId })}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const data = await response.json() as { history?: GitHistory; error?: string };
        if (!response.ok || !data.history) throw new Error(data.error || 'Could not load Git history.');
        if (!controller.signal.aborted) setResult({ identity, history: data.history });
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setResult({ identity, error: reason instanceof Error ? reason.message : 'Could not load Git history.' });
      });
    return () => controller.abort();
  }, [apiBase, checkoutId, enabled, identity]);
  const current = result?.identity === identity ? result : undefined;
  return { history: current?.history, error: current?.error, loading: Boolean(enabled && checkoutId && !current) };
}
