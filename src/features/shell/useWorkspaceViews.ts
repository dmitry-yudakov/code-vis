'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEVICE_WORKSPACE_STORAGE_KEY,
  EMPTY_DEVICE_WORKSPACE,
  closeWorkspaceView,
  ensureWorkspaceView,
  getWorkspaceScope,
  getWorkspaceViewIds,
  openWorkspaceView,
  parseDeviceWorkspace,
  reconcileWorkspaceScope,
  updateWorkspaceView,
  workspaceScopeKey,
  type DeviceViewState,
  type DeviceWorkspace,
  type DeviceWorkspaceScope,
} from './workspaceViews';

export function useWorkspaceViews(projectId?: string, machineId?: string) {
  const scopeId = workspaceScopeKey(projectId, machineId);
  const [workspace, setWorkspace] = useState<DeviceWorkspace>(EMPTY_DEVICE_WORKSPACE);
  const [ready, setReady] = useState(false);
  // The ref owns current drafts; workspace is the last snapshot published to the shell.
  const workspaceRef = useRef(workspace);
  const readyRef = useRef(false);
  const draftListeners = useRef(new Set<() => void>());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dirty = useRef(false);
  const persist = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    if (!readyRef.current || !dirty.current) return;
    dirty.current = false;
    const saved = JSON.stringify(workspaceRef.current);
    try { sessionStorage.setItem(DEVICE_WORKSPACE_STORAGE_KEY, saved); } catch { /* optional */ }
    try { localStorage.setItem(DEVICE_WORKSPACE_STORAGE_KEY, saved); } catch { /* optional */ }
  }, []);

  useEffect(() => {
    try {
      // A tab owns its workspace. The shared copy seeds new tabs and migrates older releases.
      let saved: string | null = null;
      try { saved = sessionStorage.getItem(DEVICE_WORKSPACE_STORAGE_KEY); } catch { /* optional */ }
      const stored = parseDeviceWorkspace(saved ?? localStorage.getItem(DEVICE_WORKSPACE_STORAGE_KEY));
      workspaceRef.current = stored;
      setWorkspace(stored);
    } catch {
      workspaceRef.current = EMPTY_DEVICE_WORKSPACE;
      setWorkspace(EMPTY_DEVICE_WORKSPACE);
    } finally {
      readyRef.current = true;
      dirty.current = true;
      persist();
      setReady(true);
    }
  }, [persist]);

  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden') persist(); };
    window.addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', hide);
    return () => {
      window.removeEventListener('pagehide', persist);
      document.removeEventListener('visibilitychange', hide);
      persist();
    };
  }, [persist]);

  const commit = useCallback((update: (current: DeviceWorkspace) => DeviceWorkspace, draftOnly = false): DeviceWorkspace => {
    const next = update(workspaceRef.current);
    if (next === workspaceRef.current) return next;
    workspaceRef.current = next;
    dirty.current = true;
    if (draftOnly) {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(persist, 250);
    } else {
      // Navigation/camera changes must survive an immediate reload, including pending draft edits.
      persist();
      setWorkspace(next);
    }
    draftListeners.current.forEach(listener => listener());
    return next;
  }, [persist]);

  const subscribeToDraft = useCallback((listener: () => void) => {
    draftListeners.current.add(listener);
    return () => { draftListeners.current.delete(listener); };
  }, []);
  const updateComposer = useCallback((sessionId: string, update: (current: string) => string) => {
    commit(current => updateWorkspaceView(current, scopeId, sessionId, view => ({ ...view, composer: update(view.composer) })), true);
  }, [commit, scopeId]);

  const open = useCallback((sessionId: string) => {
    commit((current) => openWorkspaceView(current, scopeId, sessionId));
  }, [commit, scopeId]);
  const openInProject = useCallback((targetProjectId: string | undefined, sessionId: string, update?: (current: DeviceViewState) => DeviceViewState, targetMachineId?: string) => {
    const targetScopeId = workspaceScopeKey(targetProjectId, targetMachineId);
    commit((current) => {
      const opened = openWorkspaceView(current, targetScopeId, sessionId);
      return update ? updateWorkspaceView(opened, targetScopeId, sessionId, update) : opened;
    });
  }, [commit]);
  const close = useCallback((sessionId: string) => {
    return getWorkspaceScope(commit((current) => closeWorkspaceView(current, scopeId, sessionId)), scopeId).focusedSessionId;
  }, [commit, scopeId]);
  const closeInProject = useCallback((targetProjectId: string | undefined, sessionId: string, targetMachineId?: string) => {
    const targetScopeId = workspaceScopeKey(targetProjectId, targetMachineId);
    return getWorkspaceScope(commit((current) => closeWorkspaceView(current, targetScopeId, sessionId)), targetScopeId).focusedSessionId;
  }, [commit]);
  const ensure = useCallback((sessionId: string) => {
    commit((current) => ensureWorkspaceView(current, scopeId, sessionId));
  }, [commit, scopeId]);
  const reconcile = useCallback((sessionIds: readonly string[]) => {
    const next = commit((current) => reconcileWorkspaceScope(current, scopeId, sessionIds));
    return getWorkspaceViewIds(next);
  }, [commit, scopeId]);
  const updateView = useCallback((sessionId: string, update: (current: DeviceViewState) => DeviceViewState) => {
    commit((current) => updateWorkspaceView(current, scopeId, sessionId, update));
  }, [commit, scopeId]);
  /** Updates a view wherever it lives, so a delayed result reaches the session it belongs to. */
  const updateViewInProject = useCallback((targetProjectId: string | undefined, sessionId: string, update: (current: DeviceViewState) => DeviceViewState, targetMachineId?: string) => {
    commit((current) => updateWorkspaceView(current, workspaceScopeKey(targetProjectId, targetMachineId), sessionId, update));
  }, [commit]);
  const getView = useCallback((sessionId: string) => (
    getWorkspaceScope(workspaceRef.current, scopeId).views[sessionId]
  ), [scopeId]);
  const getScopeInProject = useCallback((targetProjectId?: string, targetMachineId?: string): DeviceWorkspaceScope | undefined => (
    workspaceRef.current.scopes[workspaceScopeKey(targetProjectId, targetMachineId)]
  ), []);

  const scope = useMemo(() => getWorkspaceScope(workspace, scopeId), [scopeId, workspace]);
  return { ready, scope, open, openInProject, ensure, close, closeInProject, reconcile, updateView, updateViewInProject, getView, getScopeInProject, subscribeToDraft, updateComposer };
}
