'use client';

import { useCallback, useEffect, useState } from 'react';
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
    setLoading(true);
    setError(undefined);
    void fetch(`${apiBase}/repository/status?checkoutId=${encodeURIComponent(checkoutId)}`, {
      cache: 'no-store', signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json() as { tree?: GitWorkingTree; error?: string };
      if (controller.signal.aborted) return;
      if (!response.ok || !data.tree) throw new Error(data.error || 'Could not load repository status.');
      setLoadedIdentity(identity);
      setTree(data.tree);
      onTreeChange(data.tree);
      setSelectedPath((current) => current && data.tree!.files.some((file) => file.path === current) ? current : undefined);
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      setLoadedIdentity(identity);
      setTree(undefined);
      onTreeChange(undefined);
      setError(reason instanceof Error ? reason.message : 'Could not load repository status.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [apiBase, checkoutId, onTreeChange, revision, identity]);

  const refresh = useCallback(() => setRevision((current) => current + 1), []);
  const current = loadedIdentity === identity;
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
  };
}
