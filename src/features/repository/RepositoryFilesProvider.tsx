'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ShellIcon } from '@/features/shell/ShellIcon';
import type { GitChangedFile } from '@/shared/types';
import { openTab, closeTab, resolveTab, type FileTabs } from './repositoryFileTabs';
import type { RepositoryFile } from '@/shared/repositoryFiles';
import { localFileLink, type LocalFileLink } from './localFileLinks';

type OpenFile = (link: LocalFileLink, checkoutId?: string) => void;
interface FilesContextValue extends FileTabs {
  repositories: { id: string; name: string }[];
  apiBase: string;
  openFile: OpenFile;
  openDiff(checkoutId: string, file: GitChangedFile): void;
  select(id: number): void;
  close(id: number): void;
  resolved(id: number, checkoutId: string, path: string): void;
}
const FilesContext = createContext<FilesContextValue | undefined>(undefined);
export const useRepositoryFiles = () => useContext(FilesContext);
export const useOpenRepositoryFile = () => {
  const context = useRepositoryFiles();
  return context?.repositories.length ? context.openFile : undefined;
};

/** Retain tab metadata per workspace; only the focused workspace mounts file readers. */
export function RepositoryFilesProvider({ scope, repositories, apiBase, docker = false, onOpen, children }: {
  scope: string;
  repositories: { id: string; name: string }[];
  apiBase: string;
  docker?: boolean;
  onOpen(): void;
  children: ReactNode;
}) {
  const identity = JSON.stringify([scope, apiBase, docker, repositories.map(item => item.id)]);
  const [workspaces, setWorkspaces] = useState<Record<string, FileTabs>>({});
  const sequence = useRef(0);
  const current = workspaces[identity] || { tabs: [] };
  const updateTabs = useCallback((update: (tabs: FileTabs) => FileTabs) => {
    setWorkspaces(value => {
      const prior = value[identity] || { tabs: [] };
      const next = update(prior);
      return next === prior ? value : { ...value, [identity]: next };
    });
  }, [identity]);
  const openFile = useCallback<OpenFile>((link, checkoutId) => {
    const target = docker && !checkoutId && link.path.startsWith('/workspace/')
      ? { ...link, path: link.path.slice('/workspace/'.length) } : link;
    const bound = checkoutId || (!target.path.startsWith('/') ? repositories[0]?.id : undefined);
    const navigation = ++sequence.current;
    updateTabs(value => openTab(value, { kind: 'file', link: target, checkoutId: bound }, navigation));
    onOpen();
  }, [updateTabs, docker, repositories, onOpen]);
  const resolved = useCallback((id: number, checkoutId: string, path: string) => {
    updateTabs(value => resolveTab(value, id, checkoutId, path));
  }, [updateTabs]);
  return <FilesContext.Provider value={{ ...current, repositories, apiBase, openFile, resolved,
    openDiff: (checkoutId, file) => {
      const navigation = ++sequence.current;
      updateTabs(value => openTab(value, { kind: 'diff', checkoutId, file }, navigation));
      onOpen();
    },
    select: activeId => updateTabs(value => ({ ...value, activeId })),
    close: id => updateTabs(value => closeTab(value, id)),
  }}>{children}</FilesContext.Provider>;
}

/** The default Markdown URL filter drops file: URLs; preserve only parsed local references. */
export function repositoryUrlTransform(url: string): string {
  return localFileLink(url) ? url : defaultUrlTransform(url);
}

export function RepositoryLink({ href, children, documentPath, checkoutId }: {
  href?: string; children?: ReactNode; documentPath?: string; checkoutId?: string;
}) {
  const openFile = useOpenRepositoryFile();
  const local = href ? localFileLink(href, documentPath) : undefined;
  if (local && openFile) return <Link component="button" type="button" underline="always" sx={{ font: 'inherit', textAlign: 'left', verticalAlign: 'baseline' }}
    title={`Open ${local.path}${local.line ? ` at line ${local.line}` : ''}`} onClick={() => openFile(local, checkoutId)}>{children}</Link>;
  if (href && /^(https?:|mailto:)/i.test(href)) return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
  return <span title={local ? 'Attach a repository to open this file.' : href}>{children}</span>;
}

export function RepositoryFileViewer({ link, checkoutId, repositories, apiBase, active, navigation, onResolved }: {
  link: LocalFileLink; checkoutId?: string; repositories: { id: string; name: string }[]; apiBase: string;
  active: boolean; navigation: number; onResolved(checkoutId: string, path: string): void;
}) {
  const [result, setResult] = useState<{ file: RepositoryFile; checkoutId: string }>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState(Boolean(link.line) || !/\.(md|markdown)$/i.test(link.path));
  const [wrap, setWrap] = useState(true);
  const content = useRef<HTMLDivElement>(null);
  const resolvedCallback = useRef(onResolved);
  resolvedCallback.current = onResolved;
  const lastNavigation = useRef<number>(undefined);
  const candidateIds = JSON.stringify((checkoutId ? repositories.filter(item => item.id === checkoutId)
    : link.path.startsWith('/') ? repositories : repositories.slice(0, 1)).map(item => item.id));
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    // Relative chat references belong to the primary repository. Absolute references may name
    // any bound repository; the server proves containment separately for each candidate.
    const candidates = JSON.parse(candidateIds) as string[];
    void (async () => {
      for (const candidate of candidates) {
        const query = new URLSearchParams({ checkoutId: candidate, path: link.path });
        const response = await fetch(`${apiBase}/repository/file?${query}`, { cache: 'no-store', signal: controller.signal });
        const data = await response.json() as { file?: RepositoryFile; error?: string };
        if (response.status === 404 && candidates.length > 1) continue;
        if (!response.ok || !data.file) throw new Error(data.error || 'Could not open this file.');
        if (!controller.signal.aborted) {
          setResult({ file: data.file, checkoutId: candidate });
          resolvedCallback.current(candidate, data.file.path);
        }
        return;
      }
      throw new Error('File not found in this conversation’s repositories.');
    })().catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not open this file.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [apiBase, candidateIds, link.path, revision]);
  const file = result?.file;
  const lines = useMemo(() => file?.text.split('\n') || [], [file]);
  const lineExists = Boolean(link.line && link.line <= lines.length);
  const markdown = /\.(md|markdown)$/i.test(file?.path || link.path);
  useEffect(() => {
    if (!active || !file || error || loading || lastNavigation.current === navigation || link.line && !source || markdown && link.anchor && source) return;
    lastNavigation.current = navigation;
    const target = source ? content.current?.querySelector('[data-file-line]')
      : Array.from(content.current?.querySelectorAll('h1,h2,h3,h4,h5,h6') || []).find(element =>
        element.textContent?.toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').trim().replace(/\s+/g, '-') === link.anchor);
    if (target) target.scrollIntoView({ block: 'center' });
    else if (content.current) content.current.scrollTop = 0;
  }, [file, error, loading, source, link.anchor, link.line, active, navigation, markdown]);
  useEffect(() => {
    if (link.line) setSource(true);
    else if (link.anchor && markdown) setSource(false);
  }, [navigation, link.line, link.anchor, markdown]);
  return <section className="repository-inspector diff-inspector repository-file-viewer">
      <header className="diff-inspector-header">
        <div><span className="eyebrow">{repositories.find(item => item.id === result?.checkoutId)?.name || 'Repository'} · read only</span><strong title={file?.path || link.path}>Repository file: {file?.path || link.path}</strong></div>
        <IconButton aria-label="Refresh file" disabled={loading} onClick={() => setRevision(value => value + 1)}><ShellIcon name="refresh" /></IconButton>
      </header>
      <div className="diff-inspector-toolbar">
        {markdown && <ToggleButtonGroup size="small" exclusive value={source ? 'source' : 'preview'} aria-label="File view"
          onChange={(_, value) => { if (value) setSource(value === 'source'); }}>
          <ToggleButton value="preview">Preview</ToggleButton><ToggleButton value="source">Source</ToggleButton>
        </ToggleButtonGroup>}
        {source && <ToggleButton size="small" value="wrap" selected={wrap} onChange={() => setWrap(!wrap)} aria-label="Wrap text">Wrap</ToggleButton>}
        <span className="diff-preview-source">Current working-tree file{lineExists ? ` · Line ${link.line}${link.endLine ? `–${Math.min(link.endLine, lines.length)}` : ''}` : ''}</span>
      </div>
      <div ref={content} className="diff-inspector-scroll">
        {loading ? <div className="repository-state" role="status"><p>Reading file…</p></div>
          : error ? <div className="repository-state error" role="alert"><strong>File unavailable</strong><p>{error}</p><Button onClick={() => setRevision(value => value + 1)}>Try again</Button></div>
          : file && (source ? <>
            {link.line && !lineExists && <p role="status">Line {link.line} is beyond this file ({lines.length} lines).</p>}
            <pre className={`repository-file-source${wrap ? ' wrap-lines' : ''}`} aria-label="File source"><code>{lineExists ? <>
              {link.line! > 1 && <span>{lines.slice(0, link.line! - 1).join('\n') + '\n'}</span>}
              <mark data-file-line={link.line}>{lines.slice(link.line! - 1, link.endLine || link.line).join('\n') || ' '}</mark>
              {(link.endLine || link.line)! < lines.length && <span>{'\n' + lines.slice(link.endLine || link.line).join('\n')}</span>}
            </> : file.text || '(empty file)'}</code></pre>
          </> : <article className="assistant-blocks diff-markdown-preview" aria-label="Markdown preview">
            <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={repositoryUrlTransform} components={{
              a: ({ href, children }) => <RepositoryLink href={href} documentPath={file.path} checkoutId={result.checkoutId}>{children}</RepositoryLink>,
              img: ({ alt }) => <span>[Image: {alt || 'image'}]</span>,
            }}>{file.text}</ReactMarkdown>
          </article>)}
      </div>
    </section>;
}
