'use client';

import { memo, useEffect, useId, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from '@/features/conversation/CodeBlock';
import { machineApiPath } from '@/features/machines/routes';
import { MarkdownTable } from '@/features/markdown/MarkdownTable';
import type { ArenaMachineSnapshot, ArenaSessionSummary, ChatMessage } from '@/shared/types';

export const ArenaMessagePreview = memo(function ArenaMessagePreview({ session, machine, localMachineId }: {
  session: ArenaSessionSummary;
  machine: ArenaMachineSnapshot['machine'];
  localMachineId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [detail, setDetail] = useState<{ revision?: number; text?: string; failed?: boolean }>();
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const message = session.lastMessage;
  const role = message?.role;
  const messageId = session.lastActivity?.messageId;
  const needsDetail = message?.truncated || role === 'assistant' && !message?.text;
  const detailPath = needsDetail && messageId && (machine.kind === 'local' || localMachineId)
    ? machineApiPath(`/api/sessions/${session.id}?view=message&messageId=${encodeURIComponent(messageId)}`, machine.id, localMachineId)
    : undefined;
  // A queued user message can be edited in place. Assistant replies are immutable.
  const revision = role === 'user' ? session.revision : undefined;
  const current = detail?.revision === revision ? detail : undefined;
  const loaded = current?.text !== undefined;
  const text = (expanded ? current?.text : undefined) ?? message?.text;

  useEffect(() => {
    const box = viewport.current, body = content.current;
    if (expanded || !box || !body) return;
    const measure = () => setClipped(box.scrollHeight > box.clientHeight || box.scrollWidth > box.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(body);
    measure();
    return () => observer.disconnect();
  }, [expanded]);

  useEffect(() => {
    if (!expanded || !detailPath || loaded) return;
    const controller = new AbortController();
    const { signal } = controller;
    async function load(path: string) {
      try {
        const response = await fetch(path, { cache: 'no-store', signal });
        if (!response.ok) throw new Error('Message unavailable');
        const data = await response.json() as { revision: number; message?: ChatMessage };
        const saved = data.message;
        if (!saved || saved.id !== messageId || saved.role !== role || (revision !== undefined && data.revision < revision)) {
          throw new Error('Message changed');
        }
        const text = saved.role === 'assistant' ? saved.rawMarkdown : saved.text;
        if (typeof text !== 'string') throw new Error('Message text unavailable');
        if (!signal.aborted) setDetail({ revision, text });
      } catch {
        if (!signal.aborted) setDetail({ revision, failed: true });
      }
    }
    void load(detailPath);
    return () => controller.abort();
  }, [attempt, detailPath, expanded, loaded, messageId, revision, role]);

  return <div className="arena-tile-preview">
    <span className="arena-tile-caption">{message ? `Latest message · ${message.author}` : session.lastActivity ? 'Preview unavailable' : 'No messages yet'}</span>
    <div ref={viewport} id={panelId} className={`arena-tile-message${expanded ? ' expanded' : clipped ? ' clipped' : ''}`}>
      <div ref={content} className="assistant-blocks">
        {role === 'assistant' && text ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
          a: ({ href, children }) => (expanded || !clipped) && href && /^(https?:|mailto:)/i.test(href)
            ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
          img: ({ alt }) => <span>{alt || '[Image]'}</span>,
          ...(expanded ? { pre: CodeBlock, table: MarkdownTable } : {}),
        }}>{text}</ReactMarkdown> : <p className="arena-tile-plain">{text || (message
          ? 'This message contains code or canvas content.' : session.lastActivity
            ? 'Open the session to read its latest message.' : 'Send an instruction to start this session.')}</p>}
      </div>
    </div>
    {expanded && needsDetail && !detailPath && <span className="arena-tile-caption">Open the session to read the full message.</span>}
    {expanded && detailPath && !loaded && (current?.failed
      ? <Alert severity="warning" action={<Button color="inherit" onClick={() => { setDetail(undefined); setAttempt(value => value + 1); }}>Retry</Button>}>
        Could not load the full message.
      </Alert> : <span role="status" className="arena-tile-caption">Loading full message…</span>)}
    {message && (needsDetail || clipped || expanded) && <Button type="button" variant="text" color="inherit"
      aria-expanded={expanded} aria-controls={panelId} onClick={() => {
        if (current?.failed) setDetail(undefined);
        setExpanded(!expanded);
      }}>
      {expanded ? 'Show less' : 'Show more'}
    </Button>}
  </div>;
});
