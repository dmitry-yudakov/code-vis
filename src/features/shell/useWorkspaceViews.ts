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
} from './workspaceViews';

export function useWorkspaceViews(projectId?: string) {
  const scopeId = workspaceScopeKey(projectId);
  const [workspace, setWorkspace] = useState<DeviceWorkspace>(EMPTY_DEVICE_WORKSPACE);
  const [ready, setReady] = useState(false);
  const workspaceRef = useRef(workspace);
  const readyRef = useRef(false);
  workspaceRef.current = workspace;

  useEffect(() => {
    try {
      const stored = parseDeviceWorkspace(localStorage.getItem(DEVICE_WORKSPACE_STORAGE_KEY));
      workspaceRef.current = stored;
      setWorkspace(stored);
    } catch {
      workspaceRef.current = EMPTY_DEVICE_WORKSPACE;
      setWorkspace(EMPTY_DEVICE_WORKSPACE);
    } finally {
      readyRef.current = true;
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(DEVICE_WORKSPACE_STORAGE_KEY, JSON.stringify(workspace)); } catch { /* Device state is optional. */ }
  }, [ready, workspace]);

  const commit = useCallback((update: (current: DeviceWorkspace) => DeviceWorkspace): DeviceWorkspace => {
    const next = update(workspaceRef.current);
    workspaceRef.current = next;
    // User navigation/camera events can be followed immediately by a reload. Persist in the same
    // turn instead of depending only on a later passive effect that the navigation may pre-empt.
    if (readyRef.current) {
      try { localStorage.setItem(DEVICE_WORKSPACE_STORAGE_KEY, JSON.stringify(next)); } catch { /* optional */ }
    }
    setWorkspace(next);
    return next;
  }, []);

  const open = useCallback((sessionId: string) => {
    commit((current) => openWorkspaceView(current, scopeId, sessionId));
  }, [commit, scopeId]);
  const openInProject = useCallback((targetProjectId: string | undefined, sessionId: string, update?: (current: DeviceViewState) => DeviceViewState) => {
    const targetScopeId = workspaceScopeKey(targetProjectId);
    commit((current) => {
      const opened = openWorkspaceView(current, targetScopeId, sessionId);
      return update ? updateWorkspaceView(opened, targetScopeId, sessionId, update) : opened;
    });
  }, [commit]);
  const close = useCallback((sessionId: string) => {
    commit((current) => closeWorkspaceView(current, scopeId, sessionId));
  }, [commit, scopeId]);
  const closeInProject = useCallback((targetProjectId: string | undefined, sessionId: string) => {
    commit((current) => closeWorkspaceView(current, workspaceScopeKey(targetProjectId), sessionId));
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
  const getView = useCallback((sessionId: string) => (
    getWorkspaceScope(workspaceRef.current, scopeId).views[sessionId]
  ), [scopeId]);

  const scope = useMemo(() => getWorkspaceScope(workspace, scopeId), [scopeId, workspace]);
  return { ready, scope, open, openInProject, ensure, close, closeInProject, reconcile, updateView, getView };
}
