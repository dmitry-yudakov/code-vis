import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from '@/server/config';
import {
  MAX_IMMERSIVE_REPORT_BYTES, MAX_IMMERSIVE_REPORT_IMAGE_BYTES, MAX_RETAINED_IMMERSIVE_REPORTS,
  isImmersiveReportId, storedImmersiveReportSchema, summarizeImmersiveReport, validImmersiveScreenshot,
  type ImmersiveReport, type ImmersiveReportDetail, type ImmersiveReportSummary, type StoredImmersiveReport,
} from '@/shared/immersiveReport';

export interface StoredImmersiveReportFile {
  name: string;
  directory: string;
}

/** One report's validated record, with the exact JSON bytes it was read from. */
export interface ImmersiveReportRecord {
  json: Buffer;
  report: StoredImmersiveReport;
}

/** One flat directory of reports beside the store, readable on the home machine without tooling. */
export function immersiveReportsDirectory(dataDir = getConfig().dataDir): string {
  return path.join(dataDir, 'diagnostics');
}

/** Named by arrival, not by the device clock, so ordering and pruning stay trustworthy. */
function reportName(report: ImmersiveReport, receivedAt: Date): string {
  return `${receivedAt.toISOString().replaceAll(':', '-')}-${report.kind}`;
}

/** Reads a regular file no larger than `maxBytes`; a missing, oversized, or odd entry reads as absent. */
async function readBounded(file: string, maxBytes: number): Promise<Buffer | undefined> {
  const metadata = await stat(file).catch(() => undefined);
  if (!metadata?.isFile() || metadata.size > maxBytes) return undefined;
  const bytes = await readFile(file).catch(() => undefined);
  return bytes && bytes.byteLength <= maxBytes ? bytes : undefined;
}

/**
 * Reads one report's JSON from `directory`. The id is checked before any path is built, so a
 * caller-supplied value can never name another file.
 */
export async function readImmersiveReportRecord(directory: string, id: string): Promise<ImmersiveReportRecord | undefined> {
  if (!isImmersiveReportId(id)) return undefined;
  const json = await readBounded(path.join(directory, `${id}.json`), MAX_IMMERSIVE_REPORT_BYTES);
  if (!json) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(json.toString('utf8')); } catch { return undefined; }
  const report = storedImmersiveReportSchema.safeParse(parsed);
  return report.success ? { json, report: report.data } : undefined;
}

/** The report's screenshot, only when it is a bounded, well-formed JPEG. */
export async function readImmersiveReportImage(directory: string, id: string): Promise<Buffer | undefined> {
  if (!isImmersiveReportId(id)) return undefined;
  const bytes = await readBounded(path.join(directory, `${id}.jpg`), MAX_IMMERSIVE_REPORT_IMAGE_BYTES);
  return bytes && validImmersiveScreenshot(bytes) ? bytes : undefined;
}

export async function hasImmersiveReportImage(directory: string, id: string): Promise<boolean> {
  if (!isImmersiveReportId(id)) return false;
  const metadata = await stat(path.join(directory, `${id}.jpg`)).catch(() => undefined);
  return Boolean(metadata?.isFile() && metadata.size <= MAX_IMMERSIVE_REPORT_IMAGE_BYTES);
}

/** Newest first. A malformed or unreadable report is counted, never fatal. */
export async function listImmersiveReports(
  dataDir?: string,
): Promise<{ reports: ImmersiveReportSummary[]; skipped: number }> {
  const directory = immersiveReportsDirectory(dataDir);
  const names = (await readdir(directory).catch(() => [] as string[]))
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length))
    .sort()
    .reverse();
  const summaries = await Promise.all(names.map(async (id) => {
    const record = await readImmersiveReportRecord(directory, id);
    return record && summarizeImmersiveReport(id, record.report, await hasImmersiveReportImage(directory, id));
  }));
  const reports = summaries.filter((summary) => summary !== undefined);
  return { reports, skipped: summaries.length - reports.length };
}

export async function readImmersiveReportDetail(id: string, dataDir?: string): Promise<ImmersiveReportDetail | undefined> {
  const directory = immersiveReportsDirectory(dataDir);
  const record = await readImmersiveReportRecord(directory, id);
  return record && { summary: summarizeImmersiveReport(id, record.report, await hasImmersiveReportImage(directory, id)), report: record.report };
}

/**
 * Keeps the newest reports and removes whole reports, JSON and image together, so the directory
 * never grows without bound during a long acceptance run.
 */
async function prune(directory: string): Promise<void> {
  const names = new Set((await readdir(directory)).map((file) => file.replace(/\.(json|jpg)$/, '')));
  const stale = [...names].sort().slice(0, Math.max(0, names.size - MAX_RETAINED_IMMERSIVE_REPORTS));
  for (const name of stale) {
    await rm(path.join(directory, `${name}.json`), { force: true });
    await rm(path.join(directory, `${name}.jpg`), { force: true });
  }
}

/** Writes one report, returning the stored base name. Screenshot bytes are already validated. */
export async function storeImmersiveReport(
  report: ImmersiveReport,
  screenshot?: Uint8Array,
  dataDir?: string,
): Promise<StoredImmersiveReportFile> {
  const directory = immersiveReportsDirectory(dataDir);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const base = reportName(report, new Date());
  const { screenshot: _omitted, ...record } = report;
  // Reports arriving within the same millisecond must not overwrite one another.
  let name = base;
  for (let attempt = 2; ; attempt++) {
    try {
      await writeFile(path.join(directory, `${name}.json`), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt > 99) throw error;
      name = `${base}-${attempt}`;
    }
  }
  if (screenshot) await writeFile(path.join(directory, `${name}.jpg`), screenshot, { mode: 0o600 });
  await prune(directory);
  const detail = [
    report.kind === 'capture' ? 'screenshot' : `${report.errors.length} error${report.errors.length === 1 ? '' : 's'}`,
    report.errors.at(-1)?.message,
  ].filter(Boolean).join(': ');
  console.error(`[vr-report] ${path.join(directory, name)}.json — ${detail}`);
  return { name, directory };
}
