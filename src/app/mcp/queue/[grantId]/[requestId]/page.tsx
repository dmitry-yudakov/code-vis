import { DeviceAccessGate } from '@/features/devices/DeviceAccess';
import { McpQueueConfirmation } from '@/features/session-launch/McpQueueConfirmation';

export default async function QueueReviewPage({ params }: { params: Promise<{ grantId: string; requestId: string }> }) {
  const { grantId, requestId } = await params;
  const endpoint = `/api/integrations/mcp/queue/${encodeURIComponent(grantId)}/${encodeURIComponent(requestId)}`;
  return <DeviceAccessGate><McpQueueConfirmation endpoint={endpoint} /></DeviceAccessGate>;
}
