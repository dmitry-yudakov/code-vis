'use client';

import { useEffect, useState } from 'react';
import type { GitFileDiff } from '@/shared/types';

/** Shared read-only diff state; late responses cannot cross a checkout/machine/path change. */
export function useRepositoryDiff(checkoutId: string, path: string | undefined, revision: number, apiBase = '/api') {
  const identity = JSON.stringify([apiBase, checkoutId, path]);
  const [result, setResult] = useState<{ identity: string; revision: number; diff?: GitFileDiff; error?: string }>();
  useEffect(() => {
    if (!checkoutId || !path) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ checkoutId, path });
    void fetch(`${apiBase}/repository/diff?${query}`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { diff?: GitFileDiff; error?: string };
        if (!response.ok || !data.diff) throw new Error(data.error || 'Could not load this diff.');
        if (!controller.signal.aborted) setResult({ identity, revision, diff: data.diff });
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setResult({ identity, revision, error: reason instanceof Error ? reason.message : 'Could not load this diff.' });
      });
    return () => controller.abort();
  }, [apiBase, checkoutId, path, identity, revision]);
  const current = result?.identity === identity ? result : undefined;
  return { diff: current?.diff, error: current?.error, loading: Boolean(checkoutId && path && current?.revision !== revision) };
}
export type RepositoryDiffState = ReturnType<typeof useRepositoryDiff>;
