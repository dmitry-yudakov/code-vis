'use client';

import type { ReactNode } from 'react';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Disclosure } from '@/features/shell/Disclosure';
import type { PendingPermission } from '@/features/agents/toolActivity';
import type { TurnRecord, ToolStatus } from '@/shared/turnActivity';
import { activityNavigationId } from './messageNavigation';

const statusLabels: Record<ToolStatus, string> = { running: 'Running', succeeded: 'Succeeded', failed: 'Failed', denied: 'Denied', cancelled: 'Cancelled', unknown: 'Outcome unknown' };
export function StreamingMarkdown({ text }: { text: string }) {
  return <div className="assistant-blocks"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ href, children }) => <a href={href && /^(https?:|mailto:|#)/i.test(href) ? href : undefined} target="_blank" rel="noreferrer noopener">{children}</a>,
    img: ({ alt }) => <span>{alt ? `[Image: ${alt}]` : '[Image omitted]'}</span>,
  }}>{text}</ReactMarkdown></div>;
}
export function TurnActivity({ turn, agentName, permissions, onReview, renderFinal, renderNavigation }: {
  turn: TurnRecord; agentName: string; permissions: PendingPermission[];
  onReview(id: string): void; renderFinal(id: string): ReactNode;
  renderNavigation?(id: string): ReactNode;
}) {
  const renderedFinal = new Set<string>();
  return <div className="turn-activity" aria-label="Turn activity">
    {turn.entries.map(entry => {
      const name = entry.actor?.name || agentName;
      if (entry.kind === 'assistant') {
        if (entry.canonicalMessageId) {
          const final = renderFinal(entry.canonicalMessageId);
          if (final != null) {
            if (renderedFinal.has(entry.canonicalMessageId)) return null;
            renderedFinal.add(entry.canonicalMessageId);
            return <div key={entry.id} data-activity-id={entry.id}>{final}</div>;
          }
        }
        return <article key={entry.id} data-activity-id={entry.id} className="chat-message assistant activity-commentary"
          data-navigation-id={activityNavigationId(turn.runId, entry.id)} tabIndex={-1}>
          <div className="message-meta"><span>{name}</span></div><StreamingMarkdown text={entry.text} />
          {entry.omittedBytes ? <small>{entry.omittedBytes} bytes omitted</small> : null}
          {renderNavigation?.(activityNavigationId(turn.runId, entry.id))}
        </article>;
      }
      if (entry.kind === 'gap') return <p key={entry.id} data-activity-id={entry.id} className="activity-gap">{entry.reason} ({entry.count})</p>;
      if (entry.kind === 'approval') {
        const live = permissions.find(request => request.requestId === entry.requestId);
        return <div key={entry.id} data-activity-id={entry.id} className="activity-approval">
          <span>{name} · {entry.tool} · {entry.state === 'pending' ? live ? 'Needs approval' : 'No longer pending' : entry.decision === 'allow' ? 'Allowed' : entry.decision === 'deny' ? 'Denied' : entry.decision === 'timeout' ? 'Expired' : 'Cancelled'}</span>
          {live && <Button onClick={() => onReview(entry.requestId)}>Review</Button>}
        </div>;
      }
      return <article key={entry.id} data-activity-id={entry.id} className={`activity-tool ${entry.status}`}>
        <Disclosure title={<span className="tool-summary">
          {entry.status === 'running'
            ? <CircularProgress size={10} thickness={5} color="inherit" aria-label="Running" sx={{ flexShrink: 0, color: 'warning.main' }} />
            : <span className="tool-result-dot" role="img" aria-label={statusLabels[entry.status]} title={statusLabels[entry.status]} />}
          <span className="tool-summary-text" title={`${entry.tool} · ${entry.summary || 'Details'}`}>{entry.tool} · {entry.summary || 'Details'}</span>
        </span>}>
          <p>{name} · {statusLabels[entry.status]}{entry.actor?.parentToolId ? ` · delegated by ${entry.actor.parentToolId}` : ''}</p>
          {(['input', 'output', 'diff', 'error'] as const).map(field => entry[field] !== undefined && <div key={field} className={field === 'error' ? 'tool-error' : undefined}><strong>{field === 'input' ? 'Arguments' : field === 'diff' ? 'Diff' : field === 'error' ? 'Error' : 'Output'}</strong><pre>{entry[field]}</pre></div>)}
          {entry.input === undefined && entry.output === undefined && entry.diff === undefined && entry.error === undefined && <p>Details were not supplied by the provider.</p>}
          {entry.exitCode !== undefined && <span>Exit {entry.exitCode} </span>}{entry.durationMs !== undefined && <span>{entry.durationMs} ms</span>}
          {entry.omittedBytes ? <p><small>{entry.omittedBytes} bytes omitted</small></p> : null}
        </Disclosure>
      </article>;
    })}
    {turn.history === 'unsaved' && <small className="history-state" role="status">Saving activity… history may be incomplete</small>}
  </div>;
}
