import { readImmersiveReportDetail } from '@/server/diagnostics/immersiveReports';
import { privateJson, reportAccess } from '@/server/diagnostics/reportAccess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ReportRouteContext = { params: Promise<{ reportId: string }> };

export async function GET(request: Request, context: ReportRouteContext): Promise<Response> {
  const { reportId } = await context.params;
  const access = await reportAccess(request, reportId);
  if ('denied' in access) return access.denied;
  const detail = await readImmersiveReportDetail(reportId, access.config.dataDir);
  return detail ? privateJson(detail) : privateJson({ error: 'This report is no longer available.' }, { status: 404 });
}
