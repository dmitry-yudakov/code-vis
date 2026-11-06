import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';

/** Watch only canonical state directories, never repository trees or build output. */
export function watchWorkspaceFiles(dataDir: string, changed: (scope: 'local' | 'machines') => void, fail: (cause: unknown) => void): () => void {
  const watchers = new Map<string, FSWatcher>();
  const store = path.join(/* turbopackIgnore: true */ dataDir, 'session-store-v2');
  const paths = [dataDir, store, ...['sessions', 'archived-sessions', 'projects'].map(name => path.join(/* turbopackIgnore: true */ store, name)),
    ...['worktrees', 'docker', 'instructions'].map(name => path.join(/* turbopackIgnore: true */ dataDir, name))];
  let closed = false;
  const attach = () => {
    if (closed) return;
    for (const directory of paths) {
      if (watchers.has(directory)) continue;
      try {
        const watcher = watch(/* turbopackIgnore: true */ directory, { persistent: false }, (_event, filename) => {
          if (closed) return;
          const name = filename?.toString();
          if (!name) { changed('local'); changed('machines'); return; }
          if (directory === dataDir) {
            if (name === 'machine-registry-v1.json') changed('machines');
            if (['worktrees', 'docker', 'instructions', 'session-store-v2'].includes(name)) {
              // Directory creation/replacement needs a watch on its new inode, including children.
              const replaced = path.join(directory, name);
              for (const [target, previous] of watchers) if (target === replaced || target.startsWith(`${replaced}${path.sep}`)) {
                previous.close(); watchers.delete(target);
              }
              attach();
              changed('local');
            }
          } else if (directory === store) {
            if (['sessions', 'archived-sessions', 'projects'].includes(name)) {
              const target = path.join(store, name);
              watchers.get(target)?.close(); watchers.delete(target); attach(); changed('local');
            }
          } else if (/^[^.].*\.json$/.test(name)) changed('local');
        });
        watcher.on('error', fail);
        watchers.set(directory, watcher);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') { fail(cause); return; }
        // Optional settings/journal directories can be created later; their parent is watched.
      }
    }
  };
  attach();
  return () => { closed = true; for (const watcher of watchers.values()) watcher.close(); watchers.clear(); };
}
