'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { CODEAI_LIFECYCLE_PATH, availableLifecycleSnapshotSchema, codeAiLifecycleSnapshotSchema } from '@/shared/codeAiLifecycle';
import {
  INITIAL_LIFECYCLE, LIFECYCLE_REQUEST_TIMEOUT_MS, lifecyclePollDelay, lifecycleReducer, lifecycleView, type LifecycleFlow, type LifecycleView,
} from './lifecycleFlow';

const RETURN_PROJECT_KEY = 'code-ai:lifecycle:return-project';

/** Keep a stalled request from trapping the UI; the same-origin snapshot reconciles an uncertain POST. */
async function requestLifecycle(init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LIFECYCLE_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(CODEAI_LIFECYCLE_PATH, { ...init, cache: 'no-store', signal: controller.signal });
    const data: unknown = await response.json();
    return { response, data };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * The project a page reloaded by Build & restart was showing, read once. Page loads otherwise open
 * the first project; this tab-scoped note brings the user back to the session they were verifying.
 */
export function takeRestartProject(): string | undefined {
  try {
    const projectId = sessionStorage.getItem(RETURN_PROJECT_KEY) || undefined;
    sessionStorage.removeItem(RETURN_PROJECT_KEY);
    return projectId;
  } catch {
    return undefined;
  }
}

export interface CodeAiLifecycleOwner extends LifecycleView {
  confirming: boolean;
  error?: string;
  refresh(): Promise<void>;
  /** First activation: show the confirmation. */
  ask(): void;
  dismiss(): void;
  /** Second activation: start the build. */
  confirm(): void;
}

/**
 * The one owner of Build & restart for the home machine, shared by the flat shell and the
 * headset. The server decides availability; this follows an operation through the restart and
 * reloads the page on the release that answers afterwards.
 */
export function useCodeAiLifecycle(projectId?: string): CodeAiLifecycleOwner {
  const [flow, dispatch] = useReducer(lifecycleReducer, INITIAL_LIFECYCLE);
  const flowRef = useRef<LifecycleFlow>(flow);
  flowRef.current = flow;
  const [now, setNow] = useState(() => Date.now());
  const latestRequest = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++latestRequest.current;
    let event: Parameters<typeof dispatch>[0];
    try {
      // Relative, so a reconnect only ever reaches the origin this page came from.
      const { response, data } = await requestLifecycle();
      const parsed = codeAiLifecycleSnapshotSchema.safeParse(response.ok ? data : undefined);
      event = parsed.success ? { type: 'snapshot', snapshot: parsed.data } : { type: 'unreachable', at: Date.now() };
    } catch {
      event = { type: 'unreachable', at: Date.now() };
    }
    // An answer overtaken by a later read or a confirmation is dropped.
    if (request === latestRequest.current) dispatch(event);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const delay = lifecyclePollDelay(flow);
  useEffect(() => {
    if (delay === undefined) return;
    const timer = setTimeout(() => { void refresh(); }, delay);
    return () => clearTimeout(timer);
  }, [delay, flow, refresh]);

  // Coarse, because every tick re-renders the whole shell, on a headset too.
  const building = Boolean(flow.watch && !flow.watch.restarting);
  useEffect(() => {
    if (!building) return;
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, [building]);

  useEffect(() => {
    if (!flow.reload) return;
    try { if (projectId) sessionStorage.setItem(RETURN_PROJECT_KEY, projectId); } catch { /* the first project opens instead */ }
    window.location.reload();
  }, [flow.reload, projectId]);

  const confirm = useCallback(() => {
    if (!flowRef.current.confirming || !lifecycleView(flowRef.current, Date.now()).canRequest) return;
    // A read already in flight describes the server before this request.
    latestRequest.current += 1;
    flowRef.current = lifecycleReducer(flowRef.current, { type: 'confirm' });
    dispatch({ type: 'confirm' });
    void (async () => {
      try {
        const { response, data } = await requestLifecycle({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'build-and-restart' }),
        });
        const result = data as { snapshot?: unknown; error?: string } | null;
        const snapshot = availableLifecycleSnapshotSchema.safeParse(result?.snapshot);
        if (!response.ok || !snapshot.success) throw new Error(result?.error || 'CodeAI could not start the build.');
        setNow(Date.now());
        dispatch({ type: 'accepted', snapshot: snapshot.data });
      } catch (error) {
        // The request may have reached the supervisor despite its response being lost.
        await refresh();
        dispatch({ type: 'rejected', message: error instanceof Error ? error.message : 'CodeAI could not start the build.' });
      }
    })();
  }, [refresh]);

  return {
    ...lifecycleView(flow, now),
    confirming: flow.confirming,
    error: flow.error,
    refresh,
    ask: useCallback(() => dispatch({ type: 'ask' }), []),
    dismiss: useCallback(() => dispatch({ type: 'dismiss' }), []),
    confirm,
  };
}
