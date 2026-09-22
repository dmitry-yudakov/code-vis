import { z } from 'zod';

/** Errors kept per report; older entries are dropped from the in-memory tail first. */
export const MAX_IMMERSIVE_REPORT_ERRORS = 10;
export const MAX_IMMERSIVE_REPORT_MESSAGE = 2_000;
export const MAX_IMMERSIVE_REPORT_STACK = 4_000;
export const MAX_IMMERSIVE_REPORT_EVENTS = 512;
/** A 1024×768 JPEG of the workspace stays far below this; the ceiling only bounds the upload. */
export const MAX_IMMERSIVE_REPORT_IMAGE_BYTES = 2_000_000;
export const MAX_IMMERSIVE_REPORT_BYTES = 4_000_000;
export const MAX_RETAINED_IMMERSIVE_REPORTS = 50;
/** Latest error text shown in a list row; the full message stays in the report detail. */
export const MAX_IMMERSIVE_REPORT_SUMMARY_ERROR = 300;

/**
 * A report's id is its stored base name: the arrival time with `:` replaced by `-`, its kind, and
 * an optional same-millisecond suffix. The server generates it; it names no directory.
 */
export const IMMERSIVE_REPORT_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z-(capture|error)(-\d{1,2})?$/;

const text = (max: number) => z.string().max(max);
const base64 = z.string().max(Math.ceil(MAX_IMMERSIVE_REPORT_IMAGE_BYTES / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/);

export const immersiveReportErrorSchema = z.object({
  at: z.string().datetime(),
  kind: text(40),
  message: text(MAX_IMMERSIVE_REPORT_MESSAGE),
  stack: text(MAX_IMMERSIVE_REPORT_STACK).optional(),
});

/** Where a report was captured. A label only: no route uses it to authorize anything. */
export const immersiveReportContextSchema = z.object({
  machineId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
}).strict();

export const immersiveReportSchema = z.object({
  version: z.literal(1),
  kind: z.enum(['capture', 'error']),
  at: z.string().datetime(),
  browser: text(400),
  view: text(200).optional(),
  context: immersiveReportContextSchema.optional(),
  availability: text(40).optional(),
  note: text(400).optional(),
  errors: z.array(immersiveReportErrorSchema).max(MAX_IMMERSIVE_REPORT_ERRORS),
  diagnostics: z.object({
    version: z.number().finite(),
    browser: text(400),
    events: z.array(z.record(text(40), z.union([text(200), z.number().finite(), z.boolean()]))).max(MAX_IMMERSIVE_REPORT_EVENTS),
  }),
  screenshot: base64.optional(),
});

/** What the home machine keeps: the screenshot travels beside the record as a JPEG file. */
export const storedImmersiveReportSchema = immersiveReportSchema.omit({ screenshot: true });

export type ImmersiveReportError = z.infer<typeof immersiveReportErrorSchema>;
export type ImmersiveReportContext = z.infer<typeof immersiveReportContextSchema>;
export type ImmersiveReport = z.infer<typeof immersiveReportSchema>;
export type StoredImmersiveReport = z.infer<typeof storedImmersiveReportSchema>;

export interface ImmersiveReportSummary {
  id: string;
  /** Parsed from the id, so it is the home machine's arrival time, not the device clock. */
  receivedAt: string;
  kind: ImmersiveReport['kind'];
  context?: ImmersiveReportContext;
  note?: string;
  errorCount: number;
  latestError?: string;
  screenshot: boolean;
}

export type ImmersiveReportList =
  | { available: false }
  | { available: true; reports: ImmersiveReportSummary[]; skipped: number };

export interface ImmersiveReportDetail {
  summary: ImmersiveReportSummary;
  report: StoredImmersiveReport;
}

export function isImmersiveReportId(value: unknown): value is string {
  return typeof value === 'string' && IMMERSIVE_REPORT_ID.test(value);
}

/** The arrival instant encoded in a report id; ids are validated before this is called. */
export function immersiveReportReceivedAt(id: string): string {
  return id.slice(0, 24).replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3');
}

export function summarizeImmersiveReport(
  id: string,
  report: StoredImmersiveReport,
  screenshot: boolean,
): ImmersiveReportSummary {
  const latest = report.errors.at(-1)?.message;
  return {
    id,
    receivedAt: immersiveReportReceivedAt(id),
    kind: report.kind,
    ...(report.context ? { context: report.context } : {}),
    ...(report.note ? { note: report.note } : {}),
    errorCount: report.errors.length,
    ...(latest ? { latestError: latest.slice(0, MAX_IMMERSIVE_REPORT_SUMMARY_ERROR) } : {}),
    screenshot,
  };
}

/** The capture and the route share one image contract: a baseline or progressive JPEG. */
export function validImmersiveScreenshot(bytes: Uint8Array): boolean {
  return bytes.byteLength > 4 && bytes.byteLength <= MAX_IMMERSIVE_REPORT_IMAGE_BYTES
    && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    && bytes[bytes.byteLength - 2] === 0xff && bytes[bytes.byteLength - 1] === 0xd9;
}
