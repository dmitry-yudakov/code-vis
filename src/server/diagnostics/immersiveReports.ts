import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from '@/server/config';
import { MAX_RETAINED_IMMERSIVE_REPORTS, type ImmersiveReport } from '@/shared/immersiveReport';

export interface StoredImmersiveReport {
  name: string;
  directory: string;
}

/** One flat directory of reports beside the store, readable on the home machine without tooling. */
export function immersiveReportsDirectory(dataDir = getConfig().dataDir): string {
  return path.join(dataDir, 'diagnostics');
}

/** Named by arrival, not by the device clock, so ordering and pruning stay trustworthy. */
function reportName(report: ImmersiveReport, receivedAt: Date): string {
  return `${receivedAt.toISOString().replaceAll(':', '-')}-${report.kind}`;
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
): Promise<StoredImmersiveReport> {
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
