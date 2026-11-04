'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitWorkingTree } from '@/shared/types';

/** Git-specific state remains outside the reusable repository shell and presentation views. */
export function useRepositoryChanges(checkoutId: string, onTreeChange: (tree?: GitWorkingTree) => void, apiBase = '/api') {
  const [tree, setTree] = useState<GitWorkingTree>();
  const identity = JSON.stringify([apiBase, checkoutId]);
  const [loadedIdentity, setLoadedIdentity] = useState<string>();
  const [selectedPath, setSelectedPath] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [pushingIdentity, setPushingIdentity] = useState<string>();
  const requestRefresh = useRef<() => void>(() => undefined);
  const refresh = useCallback(() => requestRefresh.current(), []);

  useEffect(() => {
    setTree(undefined);
    setSelectedPath(undefined);
    setError(undefined);
    setLoading(false);
    setLoadedIdentity(undefined);
    onTreeChange(undefined);
  }, [identity, onTreeChange]);

  useEffect(() => {
    if (!checkoutId) return;
    const controller = new AbortController();
    let reading = false;
    let pending = false;
    const load = async () => {
      if (reading) { pending = true; return; }
      reading = true;
      setLoading(true);
      do {
        pending = false;
        setError(undefined);
        try {
          const response = await fetch(`${apiBase}/repository/status?checkoutId=${encodeURIComponent(checkoutId)}`, {
            cache: 'no-store', signal: controller.signal,
          });
          const data = await response.json() as { tree?: GitWorkingTree; error?: string };
          if (controller.signal.aborted) return;
          if (!response.ok || !data.tree) throw new Error(data.error || 'Could not load repository status.');
          setLoadedIdentity(identity);
          setTree(data.tree);
          onTreeChange(data.tree);
          setSelectedPath((current) => current && data.tree!.files.some((file) => file.path === current) ? current : undefined);
        } catch (reason: unknown) {
          if (controller.signal.aborted) return;
          setLoadedIdentity(identity);
          setError(reason instanceof Error ? reason.message : 'Could not load repository status.');
        }
        // Content and HEAD may change without changing the file list. Diff/history reads also
        // have their own limits and must remain retryable even when status cannot be read.
        setRevision((current) => current + 1);
      } while (pending && !controller.signal.aborted);
      reading = false;
      if (!controller.signal.aborted) setLoading(false);
    };
    requestRefresh.current = () => { void load(); };
    void load();
    return () => {
      requestRefresh.current = () => undefined;
      controller.abort();
    };
  }, [apiBase, checkoutId, onTreeChange, identity]);

  const current = loadedIdentity === identity;
  const target = current && !error ? tree?.pushTarget : undefined;
  /** Resolves to where the branch went. The status refreshes either way: a failure may be stale status. */
  const push = useCallback(async (): Promise<string> => {
    setPushingIdentity(identity);
    try {
      const response = await fetch(`${apiBase}/repository/push`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checkoutId, target }),
      });
      const data = await response.json().catch(() => ({})) as { target?: string; error?: string };
      if (!response.ok || !data.target) throw new Error(data.error || 'Could not push this branch.');
      return data.target;
    } finally {
      setPushingIdentity((held) => held === identity ? undefined : held);
      refresh();
    }
  }, [apiBase, checkoutId, identity, refresh, target]);
  return {
    tree: current ? tree : undefined,
    selectedPath: current ? selectedPath : undefined,
    selectedFile: current ? tree?.files.find((file) => file.path === selectedPath) : undefined,
    loading: Boolean(checkoutId && (loading || !current)),
    error: current ? error : undefined,
    revision,
    refresh,
    selectPath: setSelectedPath,
    closeInspector: () => setSelectedPath(undefined),
    pushing: pushingIdentity === identity,
    /** An attached machine's credentials are not this machine's to spend, so it offers no push. */
    push: apiBase === '/api' ? push : undefined,
  };
}
