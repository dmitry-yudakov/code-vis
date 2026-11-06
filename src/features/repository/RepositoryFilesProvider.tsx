'use client';

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ShellIcon } from '@/features/shell/ShellIcon';
import type { RepositoryFile } from '@/shared/repositoryFiles';
import { localFileLink, type LocalFileLink } from './localFileLinks';

type OpenFile = (link: LocalFileLink, checkoutId?: string) => void;
const FilesContext = createContext<OpenFile | undefined>(undefined);
export const useOpenRepositoryFile = () => useContext(FilesContext);

/** Keep file actions scoped to the focused conversation and executing machine. */
export function RepositoryFilesProvider({ scope, repositories, apiBase, docker = false, children }: {
  scope: string;
  repositories: { id: string; name: string }[];
  apiBase: string;
  docker?: boolean;
  children: ReactNode;
}) {
  const identity = JSON.stringify([scope, apiBase, docker, repositories.map(item => item.id)]);
  const [selection, setSelection] = useState<{ identity: string; link: LocalFileLink; checkoutId?: string; sequence: number }>();
  const titleId = useId();
  const sequence = useRef(0);
  useEffect(() => setSelection(undefined), [identity]);
  const openFile = useCallback<OpenFile>((link, checkoutId) => {
    const target = docker && !checkoutId && link.path.startsWith('/workspace/')
      ? { ...link, path: link.path.slice('/workspace/'.length) } : link;
    setSelection({ identity, link: target, checkoutId, sequence: ++sequence.current });
  }, [identity, docker]);
  return <FilesContext.Provider value={repositories.length ? openFile : undefined}>
    {children}
    {selection?.identity === identity && <Dialog open fullScreen transitionDuration={0} onClose={() => setSelection(undefined)}
      slotProps={{ paper: { 'aria-labelledby': titleId } }}
      onKeyDown={event => { if (event.key !== 'Escape') event.stopPropagation(); }}>
      <RepositoryFileViewer key={selection.sequence} titleId={titleId}
        link={selection.link} checkoutId={selection.checkoutId} repositories={repositories} apiBase={apiBase}
        onClose={() => setSelection(undefined)} />
    </Dialog>}
  </FilesContext.Provider>;
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

function RepositoryFileViewer({ link, checkoutId, repositories, apiBase, titleId, onClose }: {
  link: LocalFileLink; checkoutId?: string; repositories: { id: string; name: string }[]; apiBase: string; titleId: string; onClose(): void;
}) {
  const [result, setResult] = useState<{ file: RepositoryFile; checkoutId: string }>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState(Boolean(link.line) || !/\.(md|markdown)$/i.test(link.path));
  const [wrap, setWrap] = useState(true);
  const content = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLElement>(null);
  // Following a Markdown link replaces the content inside the same dialog. Keep keyboard
  // focus inside it after the originating link is removed, so Escape and Tab still work.
  useEffect(() => { frame.current?.focus(); }, []);
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
        if (!controller.signal.aborted) setResult({ file: data.file, checkoutId: candidate });
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
    if (!file || error || loading) return;
    const target = source ? content.current?.querySelector('[data-file-line]')
      : Array.from(content.current?.querySelectorAll('h1,h2,h3,h4,h5,h6') || []).find(element =>
        element.textContent?.toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').trim().replace(/\s+/g, '-') === link.anchor);
    if (target) target.scrollIntoView({ block: 'center' });
    else if (content.current) content.current.scrollTop = 0;
  }, [file, error, loading, source, link.anchor]);
  return <section ref={frame} tabIndex={-1} className="repository-inspector diff-inspector repository-file-viewer">
      <header className="diff-inspector-header">
        <div><span className="eyebrow">{repositories.find(item => item.id === result?.checkoutId)?.name || 'Repository'} · read only</span><strong id={titleId} title={file?.path || link.path}>Repository file: {file?.path || link.path}</strong></div>
        <IconButton aria-label="Refresh file" disabled={loading} onClick={() => setRevision(value => value + 1)}><ShellIcon name="refresh" /></IconButton>
        <IconButton aria-label="Close file" onClick={onClose}>×</IconButton>
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
