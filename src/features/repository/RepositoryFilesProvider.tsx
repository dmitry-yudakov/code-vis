'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ShellIcon } from '@/features/shell/ShellIcon';
import type { GitChangedFile } from '@/shared/types';
import { openTab, closeTab, resolveTab, tabFileContext, type FileTabs } from './repositoryFileTabs';
import type { ActiveFileContext } from '@/shared/activeFileContext';
import type { RepositoryFile } from '@/shared/repositoryFiles';
import { localFileLink, type LocalFileLink } from './localFileLinks';
import { MarkdownPreviewCodeBlock } from './MarkdownPreviewCodeBlock';

type OpenFile = (link: LocalFileLink, checkoutId?: string) => void;
interface FilesContextValue extends FileTabs {
  repositories: { id: string; name: string }[];
  apiBase: string;
  openFile: OpenFile;
  openDiff(checkoutId: string, file: GitChangedFile): void;
  select(id: number): void;
  close(id: number): void;
  resolved(id: number, checkoutId: string, path: string): void;
  contextCandidate?: ActiveFileContext;
  activeFile?: ActiveFileContext;
  setContextIncluded(included: boolean): void;
  restoreContext(context?: ActiveFileContext): void;
}
const FilesContext = createContext<FilesContextValue | undefined>(undefined);
const EMPTY_TABS: FileTabs = { tabs: [] };
export const useRepositoryFiles = () => useContext(FilesContext);
export const useOpenRepositoryFile = () => {
  const context = useRepositoryFiles();
  return context?.repositories.length ? context.openFile : undefined;
};

/** Retain tab metadata per workspace; Send and the file pane share this synchronous owner. */
export function useRepositoryFileWorkspace({ scope, parentScope, repositories, apiBase, docker = false, onOpen }: {
  scope: string;
  parentScope?: string;
  repositories: { id: string; name: string }[];
  apiBase: string;
  docker?: boolean;
  onOpen(emptyPane: boolean): void;
}): FilesContextValue {
  const workspaceKey = (key: string, container: boolean) => JSON.stringify([key, apiBase, container, repositories.map(item => item.id)]);
  const identity = workspaceKey(scope, docker);
  const [workspaces, setWorkspaces] = useState<Record<string, FileTabs>>({});
  const sequence = useRef(0);
  const parent = parentScope ? workspaces[workspaceKey(parentScope, false)] : undefined;
  const parentTab = parent?.tabs.find(tab => tab.id === parent.activeId);
  const stored = workspaces[identity];
  const primaryId = repositories[0]?.id;
  const inherited = useMemo<FileTabs | undefined>(() => {
    const context = tabFileContext(parentTab);
    if (stored || !parentTab || !context || docker && context.checkoutId !== primaryId) return;
    // Viewer keys must be unique across workspaces, so their reads and view choices stay separate.
    const id = ++sequence.current;
    const tab = { ...parentTab, id, navigation: id };
    return { tabs: [tab.kind === 'file' ? { ...tab, checkoutId: context.checkoutId, link: { path: context.path } } : tab], activeId: id };
  }, [stored, parentTab, docker, primaryId, identity]);
  const current = stored || inherited || EMPTY_TABS;
  useEffect(() => {
    // Seed once; returning to a conversation (even one whose tabs were closed) keeps its own state.
    if (inherited) setWorkspaces(value => value[identity] ? value : { ...value, [identity]: inherited });
  }, [identity, inherited]);
  const updateTabs = useCallback((update: (tabs: FileTabs) => FileTabs) => {
    setWorkspaces(value => {
      const prior = value[identity] || current;
      const next = update(prior);
      return next === prior ? value : { ...value, [identity]: next };
    });
  }, [identity, current]);
  const openFile = useCallback<OpenFile>((link, checkoutId) => {
    const target = docker && !checkoutId && link.path.startsWith('/workspace/')
      ? { ...link, path: link.path.slice('/workspace/'.length) } : link;
    const bound = checkoutId || (!target.path.startsWith('/') ? repositories[0]?.id : undefined);
    const navigation = ++sequence.current;
    updateTabs(value => openTab(value, { kind: 'file', link: target, checkoutId: bound }, navigation));
    onOpen(current.tabs.length === 0);
  }, [updateTabs, docker, repositories, onOpen, current.tabs.length]);
  const resolved = useCallback((id: number, checkoutId: string, path: string) => {
    updateTabs(value => resolveTab(value, id, checkoutId, path));
  }, [updateTabs]);
  const activeTab = current.tabs.find(tab => tab.id === current.activeId);
  const candidate = tabFileContext(activeTab);
  const contextCandidate = candidate && repositories.some(repository => repository.id === candidate.checkoutId)
    && (!docker || candidate.checkoutId === repositories[0]?.id) ? candidate : undefined;
  return { ...current, repositories, apiBase, openFile, resolved, contextCandidate,
    activeFile: activeTab?.contextExcluded ? undefined : contextCandidate,
    setContextIncluded: included => updateTabs(value => ({ ...value,
      tabs: value.tabs.map(tab => tab.id === value.activeId ? { ...tab, contextExcluded: !included } : tab),
    })),
    restoreContext: context => {
      const navigation = ++sequence.current;
      updateTabs(value => {
        if (!context) return { ...value, tabs: value.tabs.map(tab => tab.id === value.activeId ? { ...tab, contextExcluded: true } : tab) };
        let next = openTab(value, context.view === 'diff'
          ? { kind: 'diff', checkoutId: context.checkoutId, file: { path: context.path, status: 'modified', staged: false, unstaged: true } }
          : { kind: 'file', checkoutId: context.checkoutId, link: { path: context.path } }, navigation);
        if (context.view === 'file') next = resolveTab(next, next.activeId!, context.checkoutId, context.path);
        return { ...next, tabs: next.tabs.map(tab => tab.id === next.activeId ? { ...tab, contextExcluded: false } : tab) };
      });
    },
    openDiff: (checkoutId, file) => {
      const navigation = ++sequence.current;
      updateTabs(value => openTab(value, { kind: 'diff', checkoutId, file }, navigation));
      onOpen(current.tabs.length === 0);
    },
    select: activeId => updateTabs(value => ({ ...value, activeId })),
    close: id => updateTabs(value => closeTab(value, id)),
  };
}

export function RepositoryFilesProvider({ value, children }: { value: FilesContextValue; children: ReactNode }) {
  return <FilesContext.Provider value={value}>{children}</FilesContext.Provider>;
}

/** The default Markdown URL filter drops file: URLs; preserve only parsed local references. */
export function repositoryUrlTransform(url: string): string {
  return localFileLink(url) ? url : defaultUrlTransform(url);
}

export function RepositoryLink({ href, children, documentPath, checkoutId }: {
  href?: string; children?: ReactNode; documentPath?: string; checkoutId?: string;
}) {
  const openFile = useOpenRepositoryFile();
  const [copyMenu, setCopyMenu] = useState<{ anchor: HTMLButtonElement; failed?: boolean }>();
  const local = href ? localFileLink(href, documentPath) : undefined;
  if (href && local && openFile) return <>
    <Link component="button" type="button" underline="always"
      sx={{ font: 'inherit', textAlign: 'left', verticalAlign: 'baseline', userSelect: 'text' }}
      title={`Open ${local.path}${local.line ? ` at line ${local.line}` : ''} · Right-click to copy link target`}
      aria-keyshortcuts="Shift+F10"
      onClick={event => {
        const selection = window.getSelection();
        if (event.detail && selection && !selection.isCollapsed && selection.containsNode(event.currentTarget, true)) return;
        openFile(local, checkoutId);
      }}
      onContextMenu={event => {
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        setCopyMenu({ anchor: event.currentTarget });
      }}
      onKeyDown={event => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
        event.preventDefault();
        setCopyMenu({ anchor: event.currentTarget });
      }}>{children}</Link>
    {copyMenu && <Menu open anchorEl={copyMenu.anchor} onClose={() => setCopyMenu(undefined)}
      slotProps={{ list: { 'aria-label': 'File link actions' } }}>
      <MenuItem aria-label="Copy link target" sx={{ display: 'block' }} onClick={async () => {
        try {
          await navigator.clipboard.writeText(href);
          setCopyMenu(current => current === copyMenu ? undefined : current);
        } catch {
          setCopyMenu(current => current === copyMenu ? { ...current, failed: true } : current);
        }
      }}>
        Copy link target
        {copyMenu.failed && <div role="status">Could not copy. Try again.</div>}
      </MenuItem>
    </Menu>}
  </>;
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
              pre: MarkdownPreviewCodeBlock,
              a: ({ href, children }) => <RepositoryLink href={href} documentPath={file.path} checkoutId={result.checkoutId}>{children}</RepositoryLink>,
              img: ({ alt }) => <span>[Image: {alt || 'image'}]</span>,
            }}>{file.text}</ReactMarkdown>
          </article>)}
      </div>
    </section>;
}
