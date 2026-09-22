'use client';

import { useEffect, useState } from 'react';
import type { ImmersiveReportDetail } from '@/shared/immersiveReport';
import type { ArenaMachineSnapshot } from '@/shared/types';
import { reportCaptureLabel, reportDescription, reportTime, reportTitle } from './reportModel';
import { immersiveReportPath, type ImmersiveReportsOwner } from './useImmersiveReports';

/**
 * The Reports tab of the side panel, shown only while the selected project is CodeAI's own
 * checkout. Every report arrives from the headset; attaching one adds it to the next message.
 */
export function ReportsPanel({ owner, machines, pendingIds, canAttach, onToggleAttachment }: {
  owner: ImmersiveReportsOwner & { projectId: string };
  machines: readonly ArenaMachineSnapshot[];
  pendingIds: readonly string[];
  /** False without a session to attach to, or while the pending list is full. */
  canAttach: boolean;
  onToggleAttachment(id: string): void;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<ImmersiveReportDetail>();
  const [detailError, setDetailError] = useState<string>();
  const selected = owner.reports.find((report) => report.id === selectedId);

  useEffect(() => {
    setDetail(undefined);
    setDetailError(undefined);
    if (!selectedId) return;
    const controller = new AbortController();
    void fetch(immersiveReportPath(owner.projectId, selectedId), { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as Partial<ImmersiveReportDetail> & { error?: string };
        if (!response.ok || !data.report) throw new Error(data.error || 'This report is no longer available.');
        setDetail(data as ImmersiveReportDetail);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setDetailError(error instanceof Error ? error.message : 'The report could not be read.');
      });
    return () => controller.abort();
  }, [owner.projectId, selectedId]);

  const attachButton = (id: string) => {
    const pending = pendingIds.includes(id);
    return <button type="button" disabled={!pending && !canAttach} onClick={() => onToggleAttachment(id)}>
      {pending ? 'Remove attachment' : 'Attach next'}
    </button>;
  };

  if (selected) {
    return (
      <div className="report-detail">
        <button type="button" className="report-back" onClick={() => setSelectedId(undefined)}>← All reports</button>
        <strong>{reportTitle(selected)}</strong>
        <small>{reportCaptureLabel(selected.context, machines, owner.projectId)}</small>
        {selected.screenshot && (
          <img src={immersiveReportPath(owner.projectId, selected.id, true)} alt={`Screenshot from the report received ${reportTime(selected.receivedAt)}`} />
        )}
        {selected.note && <p>{selected.note}</p>}
        {detailError && <p className="report-error" role="alert">{detailError}</p>}
        {detail && detail.report.errors.length > 0 && (
          <ol className="report-errors" aria-label="Errors in this report">
            {detail.report.errors.map((error, index) => (
              <li key={`${error.at}:${index}`}>
                <small>{error.kind} · {new Date(error.at).toLocaleTimeString()}</small>
                <code>{error.message}</code>
              </li>
            ))}
          </ol>
        )}
        {detail && <small>{detail.report.browser}{detail.report.availability ? ` · VR ${detail.report.availability}` : ''}</small>}
        <div className="navigator-actions">{attachButton(selected.id)}</div>
      </div>
    );
  }

  return (
    <div className="report-list" aria-label="CodeAI reports">
      <div className="report-list-header">
        <span role="status">
          {owner.loading ? 'Reading reports…' : `${owner.reports.length} report${owner.reports.length === 1 ? '' : 's'}`}
          {owner.skipped ? ` · ${owner.skipped} unreadable skipped` : ''}
        </span>
        <button type="button" aria-label="Refresh reports" title="Refresh reports" disabled={owner.loading} onClick={() => void owner.refresh()}>↻</button>
      </div>
      {owner.error && <p className="report-error" role="alert">{owner.error}</p>}
      {owner.reports.map((report) => (
        <div className={`report-item ${pendingIds.includes(report.id) ? 'attached' : ''}`} key={report.id}>
          <button type="button" className="report-select" onClick={() => setSelectedId(report.id)}>
            {report.screenshot
              ? <img src={immersiveReportPath(owner.projectId, report.id, true)} alt="" loading="lazy" />
              : <span className="report-mark" aria-hidden="true">{report.kind === 'error' ? '!' : '◎'}</span>}
            <span>
              <strong>{reportTitle(report)}</strong>
              <span className="report-description">{reportDescription(report)}</span>
              <small>{reportCaptureLabel(report.context, machines, owner.projectId)}</small>
            </span>
          </button>
          <div className="navigator-actions">{attachButton(report.id)}</div>
        </div>
      ))}
      {!owner.loading && !owner.reports.length && !owner.error && (
        <p>No reports yet. Use Report in the headset’s tool strip to capture what you see.</p>
      )}
    </div>
  );
}
