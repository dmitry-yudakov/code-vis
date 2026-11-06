type Scope = 'local' | 'machines';
const state = globalThis as typeof globalThis & {
  __codeaiWorkspaceChanges?: Map<string, Set<(scope: Scope) => void>>;
};
const changes = state.__codeaiWorkspaceChanges ??= new Map<string, Set<(scope: Scope) => void>>();

export function workspaceChanged(dataDir: string, scope: Scope = 'local'): void {
  for (const listener of changes.get(dataDir) ?? []) {
    try { listener(scope); } catch { /* Notifications cannot fail a committed write. */ }
  }
}

export function subscribeWorkspaceChanges(dataDir: string, listener: (scope: Scope) => void): () => void {
  let listeners = changes.get(dataDir);
  if (!listeners) changes.set(dataDir, listeners = new Set());
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) changes.delete(dataDir);
  };
}
