import { authorizeMachineRequest } from '@/server/devices/deviceAuthorization';
import { localExecutorSnapshot } from '@/server/machines/localExecutorSnapshot';
import { publicError, safeJsonResponse } from '@/shared/protocol';
import { workspaceFeeds } from '@/server/workspace/workspaceFeed';
import { snapshotStream } from '@/server/workspace/snapshotStream';
import { EXECUTOR_SNAPSHOT_BYTES, WORKSPACE_STREAM_TYPE } from '@/shared/workspaceStream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const denied = await authorizeMachineRequest(request);
  if (denied) return denied;
  try {
    if (request.headers.get('accept')?.includes(WORKSPACE_STREAM_TYPE)) {
      const feed = workspaceFeeds().executor;
      feed.refresh();
      return snapshotStream(request, {
        subscribe: (receive, fail) => feed.subscribe(receive, fail),
        authorize: () => authorizeMachineRequest(request), maximumBytes: EXECUTOR_SNAPSHOT_BYTES + 1_024,
      });
    }
    return safeJsonResponse(await localExecutorSnapshot());
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 503 });
  }
}
