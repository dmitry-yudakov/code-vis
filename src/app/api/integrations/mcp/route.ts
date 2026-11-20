import { bridgeOperation, bridgeSubscription } from '@/server/integrations/mcp/bridge';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Private grant-authenticated bridge, not an MCP HTTP transport. */
export const POST = bridgeOperation;
export const GET = bridgeSubscription;
