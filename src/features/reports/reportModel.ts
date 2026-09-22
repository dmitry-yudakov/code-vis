import { immersiveReportReceivedAt, type ImmersiveReportContext, type ImmersiveReportSummary } from '@/shared/immersiveReport';
import type { ArenaMachineSnapshot, ReportAttachmentRecord } from '@/shared/types';

/** Sent when the user attaches a report and sends without typing anything. */
export const REPORT_ONLY_INSTRUCTION = 'Investigate the attached CodeAI report.';

export function reportTime(receivedAt: string): string {
  return new Date(receivedAt).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function evidence(screenshot: boolean, errorCount: number): string[] {
  return [
    screenshot ? 'screenshot' : '',
    errorCount ? `${errorCount} error${errorCount === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
}

/** One line naming a report by what it is and what it carries. */
export function reportTitle(summary: Pick<ImmersiveReportSummary, 'kind' | 'receivedAt' | 'screenshot' | 'errorCount'>): string {
  return [
    `${summary.kind === 'capture' ? 'Capture' : 'Error'} · ${reportTime(summary.receivedAt)}`,
    ...evidence(summary.screenshot, summary.errorCount),
  ].join(' · ');
}

/** A pending attachment's label; a report no longer listed is still named by its id. */
export function pendingReportLabel(id: string, summary?: ImmersiveReportSummary): string {
  return `CodeAI report · ${summary ? reportTitle(summary) : reportTime(immersiveReportReceivedAt(id))}`;
}

/** What the reporter said, or else the latest error, bounded to what a row can hold. */
export function reportDescription(summary: Pick<ImmersiveReportSummary, 'note' | 'latestError' | 'kind'>): string {
  return summary.latestError && summary.kind === 'error' ? summary.latestError
    : summary.note || summary.latestError || 'No note or error text.';
}

/**
 * Where a report was captured, named from this device's catalog. Only a label: a report from
 * another project can show that project's conversation or canvas, so the row says so.
 */
export function reportCaptureLabel(
  context: ImmersiveReportContext | undefined,
  machines: readonly ArenaMachineSnapshot[],
  currentProjectId?: string,
): string {
  if (!context?.projectId && !context?.sessionId) return 'Captured with no session selected';
  const machine = machines.find((entry) => entry.machine.id === context.machineId);
  const project = machine?.projects.find((entry) => entry.id === context.projectId);
  const session = [...machine?.sessions || [], ...machine?.archivedSessions || []]
    .find((entry) => entry.id === context.sessionId);
  if (context.projectId && !project) return 'Captured in a project that is no longer available';
  if (!context.projectId) return session ? `Captured in ${session.title}, outside any project` : 'Captured outside any project';
  const where = [context.projectId === currentProjectId ? 'this project' : project!.name, session?.title].filter(Boolean).join(' › ');
  return `Captured in ${where}`;
}

/** The transcript's statement of the reports a message carried. */
export function reportAttachmentSummary(records: readonly ReportAttachmentRecord[]): string {
  const screenshots = records.filter((record) => record.screenshotIncluded).length;
  const errors = records.reduce((total, record) => total + record.errorCount, 0);
  return [
    `${records.length} CodeAI report${records.length === 1 ? '' : 's'} attached`,
    screenshots ? `${screenshots === records.length ? '' : `${screenshots} with `}screenshot${screenshots === 1 ? '' : 's'}` : '',
    errors ? `${errors} error${errors === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ');
}
