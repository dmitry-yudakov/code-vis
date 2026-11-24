import { z } from 'zod';
import { getConfig } from '@/server/config';
import { authorizePersonalDeviceRequest } from '@/server/devices/deviceAuthorization';
import { bridgeError } from '@/server/integrations/mcp/bridge';
import { McpError } from '@/server/integrations/mcp/grants';
import { readQueueReview } from '@/server/integrations/mcp/queueApproval';
import { boundedRequestBody } from '@/server/machines/boundedBody';
import { safeJsonResponse } from '@/shared/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ grantId: string; requestId: string }> };
const ids = z.object({ grantId: z.string().uuid(), requestId: z.string().uuid() });
const approval = z.object({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

async function review(request: Request, context: Context) {
  const config = getConfig();
  if (config.remoteAccess !== 'paired') return bridgeError(new McpError('missing', 'Queue review is unavailable.', 404));
  const denied = await authorizePersonalDeviceRequest(request);
  if (denied) return denied;
  const parsed = ids.safeParse(await context.params);
  if (!parsed.success) return bridgeError(new McpError('missing', 'Queue review is unavailable.', 404));
  let fingerprint: string | undefined;
  if (request.method === 'POST') {
    try {
      fingerprint = approval.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await boundedRequestBody(request, 512)))).fingerprint;
    } catch {
      return bridgeError(new McpError('invalid', 'Invalid queue confirmation. Open the review again.', 400));
    }
  }
  try {
    return safeJsonResponse(await readQueueReview(config, parsed.data.grantId, parsed.data.requestId, fingerprint ? {
      fingerprint,
      async authorize() {
        const denied = await authorizePersonalDeviceRequest(request);
        if (denied) throw new McpError('forbidden', 'Queue confirmation requires a paired device.', denied.status);
      },
    } : undefined));
  } catch (error) {
    return bridgeError(error);
  }
}

export { review as GET, review as POST };
