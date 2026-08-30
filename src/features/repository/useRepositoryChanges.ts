'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GitWorkingTree } from '@/shared/types';

/** Git-specific state remains outside the reusable repository shell and presentation views. */
export function useRepositoryChanges(checkoutId: string, onTreeChange: (tree?: GitWorkingTree) => void) {
  const [tree, setTree] = useState<GitWorkingTree>();
  const [selectedPath, setSelectedPath] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setTree(undefined);
    setSelectedPath(undefined);
    setError(undefined);
    onTreeChange(undefined);
  }, [checkoutId, onTreeChange]);

  useEffect(() => {
    if (!checkoutId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    void fetch(`/api/repository/status?checkoutId=${encodeURIComponent(checkoutId)}`, {
      cache: 'no-store', signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json() as { tree?: GitWorkingTree; error?: string };
      if (!response.ok || !data.tree) throw new Error(data.error || 'Could not load repository status.');
      setTree(data.tree);
      onTreeChange(data.tree);
      setSelectedPath((current) => current && data.tree!.files.some((file) => file.path === current) ? current : undefined);
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      setTree(undefined);
      onTreeChange(undefined);
      setError(reason instanceof Error ? reason.message : 'Could not load repository status.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [checkoutId, onTreeChange, revision]);

  const refresh = useCallback(() => setRevision((current) => current + 1), []);
  return {
    tree,
    selectedPath,
    selectedFile: tree?.files.find((file) => file.path === selectedPath),
    loading,
    error,
    revision,
    refresh,
    selectPath: setSelectedPath,
    closeInspector: () => setSelectedPath(undefined),
  };
}
