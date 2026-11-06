export interface LocalFileLink { path: string; line?: number; endLine?: number; anchor?: string }

/** Parse agent Markdown references without giving arbitrary URL schemes a browser destination. */
export function localFileLink(href: string, documentPath?: string): LocalFileLink | undefined {
  if (!href || href.length > 4096 || href.startsWith('//')) return;
  let source = href;
  if (/^file:/i.test(source)) {
    try {
      const url = new URL(source);
      if (url.hostname && url.hostname !== 'localhost') return;
      source = url.pathname + url.hash;
    } catch { return; }
  } else if (/^[a-z][a-z\d+.-]*:/i.test(source) && !/^[^/:]+:\d/.test(source)) return;
  const hash = source.indexOf('#');
  let file = hash < 0 ? source : source.slice(0, hash);
  let fragment: string;
  try {
    file = decodeURIComponent(file);
    fragment = hash < 0 ? '' : decodeURIComponent(source.slice(hash + 1));
  } catch { return; }
  if (/[\u0000-\u001f\u007f\\?]/.test(file) || /[\u0000-\u001f\u007f]/.test(fragment)) return;
  const suffix = file.match(/:(\d+)(?::\d+|-(\d+))?$/);
  const lines = fragment.match(/^L(\d+)(?:-L?(\d+))?$/i);
  if (suffix) file = file.slice(0, suffix.index);
  if (!file && !documentPath) return;
  const line = lines?.[1] || suffix?.[1];
  const endLine = lines?.[2] || suffix?.[2];
  if (line && (!Number.isSafeInteger(Number(line)) || Number(line) < 1)) return;
  if (endLine && (!Number.isSafeInteger(Number(endLine)) || Number(endLine) < Number(line))) return;
  // A colon left in a path denotes an unsupported scheme (or platform), never a file action.
  if (file.includes(':') || file.startsWith('//')) return;
  const resolved = !file ? documentPath! : documentPath && !file.startsWith('/')
    ? documentPath.slice(0, documentPath.lastIndexOf('/') + 1) + file : file;
  return { path: resolved, ...(line ? { line: Number(line) } : {}), ...(endLine ? { endLine: Number(endLine) } : {}),
    ...(fragment && !lines ? { anchor: fragment } : {}) };
}
