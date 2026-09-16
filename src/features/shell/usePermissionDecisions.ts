'use client';

import { useCallback, useRef, useState } from 'react';
import { machineApiPath } from '@/features/machines/routes';
import type { RunDiscovery } from '@/shared/types';
import { permissionKey, type PermissionResult, type PermissionTarget } from './immersive/sessionControls';

/** One command owner for DOM and XR; a same-frame second selection cannot issue another POST. */
export function usePermissionDecisions(localMachineId: string | undefined, refresh: () => Promise<void>, refreshAccess: () => Promise<void>, onOutcome: (target: PermissionTarget, message: string) => void) {
  const [results, setResults] = useState<Record<string, PermissionResult>>({});
  const submitted = useRef(new Map<string, { target: PermissionTarget; result: PermissionResult }>());
  const publishResults = () => setResults(Object.fromEntries([...submitted.current].map(([key, entry]) => [key, entry.result])));
  const decide = useCallback(async (target: PermissionTarget, decision: 'allow' | 'deny') => {
    const key = permissionKey(target);
    if (submitted.current.has(key)) return;
    const publish = (result: PermissionResult) => {
      submitted.current.set(key, { target, result });
      // Device-only recent outcomes; never grow with the lifetime of the application.
      for (const [oldKey, old] of submitted.current) {
        if (submitted.current.size <= 32) break;
        if (!old.result.pending && oldKey !== key) submitted.current.delete(oldKey);
      }
      publishResults();
      if (!result.pending) onOutcome(target, result.message);
    };
    publish({ pending: true, message: `Submitting ${decision}…` });
    try {
      const response = await fetch(machineApiPath('/api/agent/permission', target.machineId, localMachineId), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: target.runId, requestId: target.requestId, decision }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      publish({ pending: false, retryable: response.status >= 500, message: response.ok ? decision === 'allow' ? 'Allowed.' : 'Denied.'
        : data.error || `Decision failed (${response.status}). Refresh status before trying again.` });
      if (response.status === 401 || response.status === 403) await refreshAccess();
    } catch {
      publish({ pending: false, retryable: true, message: 'Delivery could not be confirmed. Refresh status; do not assume the action was approved.' });
    } finally {
      await refresh();
    }
  }, [localMachineId, refresh, refreshAccess, onOutcome]);
  const refreshFailures = useCallback(async () => {
    for (const [key, entry] of [...submitted.current]) {
      if (!entry.result.retryable || entry.result.pending) continue;
      const { target } = entry;
      try {
        const response = await fetch(machineApiPath(`/api/agent/runs?sessionId=${encodeURIComponent(target.sessionId)}`, target.machineId, localMachineId), { cache: 'no-store' });
        if (response.status === 401 || response.status === 403) await refreshAccess();
        if (!response.ok) continue;
        const discovery = await response.json() as RunDiscovery;
        if (submitted.current.get(key) !== entry) continue;
        const pending = discovery.active.some((run) => run.runId === target.runId && run.sessionId === target.sessionId
          && run.pendingPermissions.some((request) => request.requestId === target.requestId));
        if (pending) submitted.current.delete(key);
        else submitted.current.set(key, { target, result: { pending: false, message: 'This request is no longer pending. It was answered elsewhere or the run ended.' } });
      } catch { /* Keep the uncertain outcome until its owner can confirm current status. */ }
    }
    publishResults();
    await refresh();
  }, [localMachineId, refresh, refreshAccess]);
  return { results, decide, refreshFailures };
}
