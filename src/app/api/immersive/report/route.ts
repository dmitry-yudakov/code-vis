import { authorizePersonalDeviceRequest } from '@/server/devices/deviceAuthorization';
import { storeImmersiveReport } from '@/server/diagnostics/immersiveReports';
import { boundedRequestBody } from '@/server/machines/boundedBody';
import {
  MAX_IMMERSIVE_REPORT_BYTES, immersiveReportSchema, validImmersiveScreenshot, type ImmersiveReportAccepted,
} from '@/shared/immersiveReport';
import { safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const denied = await authorizePersonalDeviceRequest(request);
  if (denied) return denied;
  let body: Uint8Array<ArrayBuffer>;
  try { body = await boundedRequestBody(request, MAX_IMMERSIVE_REPORT_BYTES, AbortSignal.any([request.signal, AbortSignal.timeout(20_000)])); } catch {
    return safeJsonResponse({ error: 'The report is too large or could not be read.' }, { status: 413 });
  }
  let report: ReturnType<typeof immersiveReportSchema.safeParse>;
  try { report = immersiveReportSchema.safeParse(JSON.parse(new TextDecoder().decode(body))); } catch {
    return safeJsonResponse({ error: 'The report is not valid JSON.' }, { status: 400 });
  }
  if (!report.success) return safeJsonResponse({ error: 'The report does not match the expected shape.' }, { status: 400 });
  let screenshot: Uint8Array | undefined;
  if (report.data.screenshot) {
    screenshot = Uint8Array.from(Buffer.from(report.data.screenshot, 'base64'));
    if (!validImmersiveScreenshot(screenshot)) {
      return safeJsonResponse({ error: 'The screenshot must be a JPEG.' }, { status: 400 });
    }
  }
  try {
    const { name, summary } = await storeImmersiveReport(report.data, screenshot);
    const accepted: ImmersiveReportAccepted = { name, summary };
    return safeJsonResponse(accepted);
  } catch {
    return safeJsonResponse({ error: 'The report could not be written on the home machine.' }, { status: 503 });
  }
}
