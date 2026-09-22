import {
  MAX_IMMERSIVE_REPORT_ERRORS, MAX_IMMERSIVE_REPORT_MESSAGE, MAX_IMMERSIVE_REPORT_STACK, isImmersiveReportId,
  type ImmersiveReport, type ImmersiveReportAccepted, type ImmersiveReportContext, type ImmersiveReportError,
  type ImmersiveReportSummary,
} from '@/shared/immersiveReport';
import { getImmersiveDiagnostics, recordImmersiveDiagnostic } from './immersiveDiagnostics';

export const IMMERSIVE_REPORT_PATH = '/api/immersive/report';
/** A repeating failure must not flood the pairing link or the home machine's disk. */
export const MIN_AUTO_REPORT_INTERVAL_MS = 3_000;
export const MAX_AUTO_REPORTS_PER_DOCUMENT = 20;
const UPLOAD_TIMEOUT_MS = 15_000;

export type ImmersiveReportOutcome = 'sent' | 'failed' | 'skipped';

export interface ImmersiveReportResult {
  outcome: ImmersiveReportOutcome;
  /** The stored report, when the home machine accepted it. */
  summary?: ImmersiveReportSummary;
}

export interface ImmersiveReportingState {
  view?: string;
  availability?: string;
  /** The selected machine/project/session, read when a report is sent: a label, never authority. */
  selection?: ImmersiveReportContext;
}

let errors: ImmersiveReportError[] = [];
let context: ImmersiveReportingState = {};
let autoReports = 0;
let lastAutoReportAt = 0;

/** Errors are held in memory only: device storage keeps the existing message-free history. */
export function immersiveErrorTail(): ImmersiveReportError[] {
  return errors.map((error) => ({ ...error }));
}

export function setImmersiveReportContext(next: ImmersiveReportingState): void {
  context = { ...context, ...next };
}

export function resetImmersiveReporting(): void {
  errors = [];
  context = {};
  autoReports = 0;
  lastAutoReportAt = 0;
}

function describe(cause: unknown): { message: string; stack?: string } {
  if (typeof cause === 'string') return { message: cause };
  if (cause instanceof Error) return { message: `${cause.name}: ${cause.message}`, stack: cause.stack };
  if (cause && typeof cause === 'object') {
    const event = cause as { message?: unknown; reason?: unknown; filename?: unknown; lineno?: unknown; error?: unknown };
    if (event.reason !== undefined) return describe(event.reason);
    if (event.error instanceof Error) {
      const described = describe(event.error);
      return typeof event.filename === 'string' && event.filename
        ? { ...described, message: `${described.message} (${event.filename}:${event.lineno ?? '?'})` }
        : described;
    }
    if (typeof event.message === 'string') {
      return {
        message: typeof event.filename === 'string' && event.filename
          ? `${event.message} (${event.filename}:${event.lineno ?? '?'})` : event.message,
      };
    }
  }
  try { return { message: JSON.stringify(cause) ?? 'Unknown immersive error.' }; }
  catch { return { message: 'Unknown immersive error.' }; }
}

/**
 * Records the message beside the existing diagnostic event and forwards it to the paired home
 * machine, so an error found in the headset needs no cable to read.
 */
export function noteImmersiveError(kind: string, cause: unknown, forward = true): void {
  try {
    const { message, stack } = describe(cause);
    errors.push({
      at: new Date().toISOString(), kind: kind.slice(0, 40),
      message: message.slice(0, MAX_IMMERSIVE_REPORT_MESSAGE),
      ...(stack ? { stack: stack.slice(0, MAX_IMMERSIVE_REPORT_STACK) } : {}),
    });
    errors.splice(0, Math.max(0, errors.length - MAX_IMMERSIVE_REPORT_ERRORS));
    if (forward) void sendImmersiveReport({ kind: 'error', note: kind, automatic: true });
  } catch { /* Reporting must never interrupt XR. */ }
}

function diagnostics(): ImmersiveReport['diagnostics'] {
  try {
    const report = getImmersiveDiagnostics();
    return { version: report.version, browser: report.browser.slice(0, 400), events: report.events };
  } catch { return { version: 0, browser: '', events: [] }; }
}

/**
 * Uploads one report. Failures are recorded and reported back, never thrown into the session. The
 * selection is read here, synchronously, so a capture carries where it was taken.
 */
export async function sendImmersiveReport({ kind, note, screenshot, automatic = false }: {
  kind: ImmersiveReport['kind'];
  note?: string;
  screenshot?: string;
  automatic?: boolean;
}): Promise<ImmersiveReportResult> {
  if (automatic) {
    const now = Date.now();
    if (autoReports >= MAX_AUTO_REPORTS_PER_DOCUMENT || now - lastAutoReportAt < MIN_AUTO_REPORT_INTERVAL_MS) return { outcome: 'skipped' };
    autoReports += 1;
    lastAutoReportAt = now;
  }
  try {
    const selection = Object.fromEntries(Object.entries(context.selection || {}).filter(([, value]) => value));
    const report: ImmersiveReport = {
      version: 1, kind, at: new Date().toISOString(),
      browser: navigator.userAgent.slice(0, 400),
      ...(context.view ? { view: context.view.slice(0, 200) } : {}),
      ...(Object.keys(selection).length ? { context: selection } : {}),
      ...(context.availability ? { availability: context.availability.slice(0, 40) } : {}),
      ...(note ? { note: note.slice(0, 400) } : {}),
      errors: immersiveErrorTail(),
      diagnostics: diagnostics(),
      ...(screenshot ? { screenshot } : {}),
    };
    const response = await fetch(IMMERSIVE_REPORT_PATH, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report), signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Report rejected with ${response.status}.`);
    const accepted = await response.json().catch(() => ({})) as Partial<ImmersiveReportAccepted>;
    return isImmersiveReportId(accepted.summary?.id) ? { outcome: 'sent', summary: accepted.summary } : { outcome: 'sent' };
  } catch {
    recordImmersiveDiagnostic('report-failed');
    return { outcome: 'failed' };
  }
}
