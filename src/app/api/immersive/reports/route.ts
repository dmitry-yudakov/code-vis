import { listImmersiveReports } from '@/server/diagnostics/immersiveReports';
import { privateJson, reportAccess } from '@/server/diagnostics/reportAccess';
import type { ImmersiveReportList } from '@/shared/immersiveReport';
import { publicError } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const access = await reportAccess(request);
  if ('denied' in access) return access.denied;
  try {
    const list: ImmersiveReportList = { available: true, ...await listImmersiveReports(access.config.dataDir) };
    return privateJson(list);
  } catch (error) {
    return privateJson({ error: publicError(error) }, { status: 503 });
  }
}
