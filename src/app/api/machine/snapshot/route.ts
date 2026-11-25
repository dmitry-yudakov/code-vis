import { authorizeMachineRequest } from '@/server/devices/deviceAuthorization';
import { localExecutorSnapshot } from '@/server/machines/localExecutorSnapshot';
import { publicError, safeJsonResponse } from '@/shared/protocol';
import { workspaceFeeds } from '@/server/workspace/workspaceFeed';
import { snapshotStream } from '@/server/workspace/snapshotStream';
import { EXECUTOR_SNAPSHOT_BYTES, RUN_NOW_CAPABILITY_HEADER, WORKSPACE_STREAM_TYPE } from '@/shared/workspaceStream';
import type { ExecutorSnapshot } from '@/shared/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const denied = await authorizeMachineRequest(request);
  if (denied) return denied;
  try {
    const runNowSupported = request.headers.get(RUN_NOW_CAPABILITY_HEADER) === 'true';
    // Older homes validate the snapshot strictly. Keep their active runs readable.
    const forPeer = (snapshot: ExecutorSnapshot): ExecutorSnapshot => runNowSupported ? snapshot
      : { ...snapshot, runs: { ...snapshot.runs, active: snapshot.runs.active.map(({ canRunNow: _, ...run }) => run) } };
    if (request.headers.get('accept')?.includes(WORKSPACE_STREAM_TYPE)) {
      const feed = workspaceFeeds().executor;
      feed.refresh();
      return snapshotStream(request, {
        subscribe: (receive, fail) => feed.subscribe(snapshot => receive(forPeer(snapshot)), fail),
        authorize: () => authorizeMachineRequest(request), maximumBytes: EXECUTOR_SNAPSHOT_BYTES + 1_024,
      });
    }
    return safeJsonResponse(forPeer(await localExecutorSnapshot()));
  } catch (error) {
    return safeJsonResponse({ error: publicError(error) }, { status: 503 });
  }
}
