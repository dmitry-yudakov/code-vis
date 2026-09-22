import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  immersiveReportsDirectory, readImmersiveReportImage, readImmersiveReportRecord,
} from '@/server/diagnostics/immersiveReports';
import { immersiveReportReceivedAt, type StoredImmersiveReport } from '@/shared/immersiveReport';
import { syncDirectory } from '@/server/storage/sessionStore';
import type { ReportAttachmentRecord } from '@/shared/types';

/**
 * A session's own copies of the reports its messages carry. Unlike the diagnostics directory,
 * nothing prunes them: they follow the session through archive and restore, bounded per session.
 */
export function sessionReportsDirectory(dataDir: string, sessionId: string): string {
  return path.join(dataDir, 'attachments', sessionId, 'reports');
}

export interface ResolvedReportEvidence {
  record: ReportAttachmentRecord;
  /** The diagnostics bytes still to copy; absent when the session already holds its promoted copy. */
  copy?: { json: Buffer; jpeg?: Buffer };
}

function attachmentRecord(reportId: string, report: StoredImmersiveReport, screenshotIncluded: boolean): ReportAttachmentRecord {
  return {
    reportId,
    receivedAt: immersiveReportReceivedAt(reportId),
    kind: report.kind,
    screenshotIncluded,
    errorCount: report.errors.length,
  };
}

/**
 * Resolves one report for a session: its promoted copy first, so a message keeps working after the
 * diagnostics directory prunes the original, then that directory. The bytes read are the bytes
 * copied, and a screenshot counts only when it is a well-formed JPEG the run can use.
 */
export async function resolveReportEvidence(
  dataDir: string,
  sessionId: string,
  reportId: string,
): Promise<ResolvedReportEvidence | undefined> {
  const promotedDirectory = sessionReportsDirectory(dataDir, sessionId);
  const promoted = await readImmersiveReportRecord(promotedDirectory, reportId);
  if (promoted) {
    return { record: attachmentRecord(reportId, promoted.report, Boolean(await readImmersiveReportImage(promotedDirectory, reportId))) };
  }
  const diagnostics = immersiveReportsDirectory(dataDir);
  const source = await readImmersiveReportRecord(diagnostics, reportId);
  if (!source) return undefined;
  const jpeg = await readImmersiveReportImage(diagnostics, reportId);
  return { record: attachmentRecord(reportId, source.report, Boolean(jpeg)), copy: { json: source.json, jpeg } };
}

/** Bytes of promoted evidence the session already holds, counted against its ceiling. */
export async function promotedReportBytes(dataDir: string, sessionId: string): Promise<number> {
  const directory = sessionReportsDirectory(dataDir, sessionId);
  const names = await readdir(directory).catch(() => [] as string[]);
  const sizes = await Promise.all(names.map((name) => stat(path.join(directory, name))
    .then((metadata) => metadata.isFile() ? metadata.size : 0, () => 0)));
  return sizes.reduce((total, size) => total + size, 0);
}

export function reportCopyBytes(evidence: readonly ResolvedReportEvidence[]): number {
  return evidence.reduce((total, item) => total + (item.copy ? item.copy.json.byteLength + (item.copy.jpeg?.byteLength ?? 0) : 0), 0);
}

async function writeFileAtomically(target: string, bytes: Buffer): Promise<void> {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

/**
 * Copies diagnostics evidence into the session before any message points at it. The screenshot
 * lands first and the JSON last, so a JSON file marks a complete copy; an existing copy is reused
 * as is. The directory is flushed before the message that references it is written.
 */
export async function promoteReportEvidence(
  dataDir: string,
  sessionId: string,
  evidence: readonly ResolvedReportEvidence[],
): Promise<void> {
  const pending = evidence.filter((item) => item.copy);
  if (!pending.length) return;
  const directory = sessionReportsDirectory(dataDir, sessionId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const level of [path.dirname(path.dirname(directory)), path.dirname(directory), directory]) await chmod(level, 0o700);
  for (const { record, copy } of pending) {
    if (await readImmersiveReportRecord(directory, record.reportId)) continue;
    if (copy!.jpeg) await writeFileAtomically(path.join(directory, `${record.reportId}.jpg`), copy!.jpeg);
    await writeFileAtomically(path.join(directory, `${record.reportId}.json`), copy!.json);
  }
  await syncDirectory(directory);
}

export interface ReportManifestRecord {
  reportId: string;
  receivedAt: string;
  kind: ReportAttachmentRecord['kind'];
  errorCount: number;
  reportFile: string;
  imageFile?: string;
}

/** Copies a message's promoted reports into the per-run directory beside a manifest. */
export async function writeReportAttachments(
  runDirectory: string,
  dataDir: string,
  sessionId: string,
  records: readonly ReportAttachmentRecord[],
): Promise<ReportManifestRecord[]> {
  if (!records.length) return [];
  const directory = sessionReportsDirectory(dataDir, sessionId);
  const manifest: ReportManifestRecord[] = [];
  for (const [index, record] of records.entries()) {
    const source = await readImmersiveReportRecord(directory, record.reportId);
    const jpeg = record.screenshotIncluded ? await readImmersiveReportImage(directory, record.reportId) : undefined;
    if (!source || (record.screenshotIncluded && !jpeg)) {
      throw new Error('An attached CodeAI report is missing from this session’s evidence.');
    }
    const stem = `report-${index + 1}`;
    const entry: ReportManifestRecord = {
      reportId: record.reportId, receivedAt: record.receivedAt, kind: record.kind, errorCount: record.errorCount,
      reportFile: `${stem}.json`,
    };
    // `runDirectory` is a per-run temp directory, never a repository path; no build tracing is needed.
    await writeFile(path.join(/* turbopackIgnore: true */ runDirectory, entry.reportFile), source.json, { mode: 0o600 });
    if (jpeg) {
      entry.imageFile = `${stem}.jpg`;
      await writeFile(path.join(/* turbopackIgnore: true */ runDirectory, entry.imageFile), jpeg, { mode: 0o600 });
    }
    manifest.push(entry);
  }
  await writeFile(path.join(runDirectory, 'report-attachments.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return manifest;
}
