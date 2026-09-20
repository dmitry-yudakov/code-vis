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

const text = (max: number) => z.string().max(max);
const base64 = z.string().max(Math.ceil(MAX_IMMERSIVE_REPORT_IMAGE_BYTES / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/);

export const immersiveReportErrorSchema = z.object({
  at: z.string().datetime(),
  kind: text(40),
  message: text(MAX_IMMERSIVE_REPORT_MESSAGE),
  stack: text(MAX_IMMERSIVE_REPORT_STACK).optional(),
});

export const immersiveReportSchema = z.object({
  version: z.literal(1),
  kind: z.enum(['capture', 'error']),
  at: z.string().datetime(),
  browser: text(400),
  view: text(200).optional(),
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

export type ImmersiveReportError = z.infer<typeof immersiveReportErrorSchema>;
export type ImmersiveReport = z.infer<typeof immersiveReportSchema>;

/** The capture and the route share one image contract: a baseline or progressive JPEG. */
export function validImmersiveScreenshot(bytes: Uint8Array): boolean {
  return bytes.byteLength > 4 && bytes.byteLength <= MAX_IMMERSIVE_REPORT_IMAGE_BYTES
    && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    && bytes[bytes.byteLength - 2] === 0xff && bytes[bytes.byteLength - 1] === 0xd9;
}
