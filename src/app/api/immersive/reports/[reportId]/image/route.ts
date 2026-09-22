import { immersiveReportsDirectory, readImmersiveReportImage } from '@/server/diagnostics/immersiveReports';
import { PRIVATE_NO_STORE, privateJson, reportAccess } from '@/server/diagnostics/reportAccess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ReportRouteContext = { params: Promise<{ reportId: string }> };

export async function GET(request: Request, context: ReportRouteContext): Promise<Response> {
  const { reportId } = await context.params;
  const access = await reportAccess(request, reportId);
  if ('denied' in access) return access.denied;
  const image = await readImmersiveReportImage(immersiveReportsDirectory(access.config.dataDir), reportId);
  if (!image) return privateJson({ error: 'This report has no screenshot.' }, { status: 404 });
  return new Response(new Uint8Array(image), {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': PRIVATE_NO_STORE, 'X-Content-Type-Options': 'nosniff' },
  });
}
