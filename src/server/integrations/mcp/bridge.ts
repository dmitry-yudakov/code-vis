import type { AppConfig } from '@/server/config';
import { getConfig } from '@/server/config';
import { boundedRequestBody } from '@/server/machines/boundedBody';
import { workspaceFeeds } from '@/server/workspace/workspaceFeed';
import { snapshotStream } from '@/server/workspace/snapshotStream';
import { safeJsonResponse } from '@/shared/protocol';
import { MCP_REQUEST_BYTES, MCP_RESPONSE_BYTES, mcpBridgeRequestSchema, mcpToolScopes } from '@/shared/mcp';
import { sessionStoreStatus } from '@/server/storage/sessionStore';
import { authorizeIntegration, grantExists, McpError } from './grants';
import { currentSnapshot, executionChoices, McpListings, projectRows, readSession, sessionRow, workspaceHeader } from './reads';
import { addParticipant, archive, createSession, sendMessage } from './actions';

class BridgeState {
  readonly listings: McpListings;
  constructor(config: AppConfig) { this.listings = new McpListings(id => grantExists(config, id)); }
  readonly operations = new Map<string, number>();
  subscriptions = 0;
}
const scope = globalThis as typeof globalThis & { __codeaiMcpBridges?: Map<string, BridgeState> };
function stateFor(config: AppConfig) {
  const states = scope.__codeaiMcpBridges ??= new Map();
  let state = states.get(config.dataDir);
  if (!state) states.set(config.dataDir, state = new BridgeState(config));
  return state;
}
export function bridgeError(error: unknown): Response {
  const status = error instanceof McpError ? error.status : sessionStoreStatus(error);
  return safeJsonResponse({ error: { code: error instanceof McpError ? error.code : status === 409 ? 'conflict' : 'unavailable',
    message: error instanceof Error ? error.message.slice(0, 1000) : 'CodeAI integration is unavailable.',
    retryable: error instanceof McpError ? error.retryable : status >= 500 } }, { status,
    ...(status === 429 ? { headers: { 'Retry-After': '1' } } : {}) });
}
function boundedResult(result: unknown): Response {
  if (Buffer.byteLength(JSON.stringify(result)) > MCP_RESPONSE_BYTES) throw new McpError('too_large', 'Result exceeds 64 KiB. Request a smaller page or bounded detail.', 413);
  return safeJsonResponse(result);
}
export async function bridgeOperation(request: Request): Promise<Response> {
  const config = getConfig(); let release: (() => void) | undefined;
  try {
    const grant = await authorizeIntegration(request, config);
    const state = stateFor(config); const count = state.operations.get(grant.id) ?? 0;
    if (count >= 2) throw new McpError('busy', 'Two MCP operations are already in flight for this grant.', 429, true);
    state.operations.set(grant.id, count + 1);
    release = () => { const remaining = (state.operations.get(grant.id) ?? 1) - 1;
      if (remaining) state.operations.set(grant.id, remaining); else state.operations.delete(grant.id); };
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await boundedRequestBody(request, MCP_REQUEST_BYTES))); }
    catch { throw new McpError('invalid', 'MCP requests must be valid UTF-8 JSON within 16 KiB.', 400); }
    const parsed = mcpBridgeRequestSchema.safeParse(raw);
    if (!parsed.success) throw new McpError('invalid', 'Invalid MCP operation or arguments.', 400);
    const { operation } = parsed.data;
    const required = operation === 'release_listing' ? undefined : mcpToolScopes[operation];
    const authorize = async () => { await authorizeIntegration(request, config, required); };
    await authorize();
    let result: unknown;
    switch (operation) {
      case 'release_listing': state.listings.release(grant.id, parsed.data.input.cursor); result = { released: true }; break;
      case 'get_workspace': {
        const snapshot = await currentSnapshot(config);
        result = { ...workspaceHeader(snapshot, await executionChoices(config, snapshot)), scopes: grant.scopes }; break;
      }
      case 'list_projects': {
        await state.listings.prune();
        const data = parsed.data.input as Extract<typeof parsed.data, { operation: 'list_projects' }>['input'];
        result = state.listings.page(grant.id, operation, data.cursor, data.limit,
          data.cursor ? undefined : projectRows(await currentSnapshot(config, true))); break;
      }
      case 'list_sessions': {
        await state.listings.prune();
        const data = parsed.data as Extract<typeof parsed.data, { operation: 'list_sessions' }>;
        const snapshot = data.input.cursor ? undefined : await currentSnapshot(config, true);
        const rows = snapshot ? [...snapshot.sessions, ...(data.input.archived ? snapshot.archivedSessions : [])]
          .filter(s => !data.input.projectId || s.projectId === data.input.projectId).map(s => sessionRow(s, snapshot)) : undefined;
        result = state.listings.page(grant.id, JSON.stringify([operation, data.input.projectId, data.input.archived]), data.input.cursor, data.input.limit, rows); break;
      }
      case 'read_session': result = await readSession(config, parsed.data.input.sessionId, parsed.data.input.archived); break;
      case 'create_session': result = await createSession(parsed.data.input, config, authorize); break;
      case 'archive_session': result = await archive(parsed.data.input, config, authorize); break;
      case 'add_participant': result = await addParticipant(parsed.data.input, config, authorize); break;
      case 'send_message': result = await sendMessage(parsed.data.input, config, authorize); break;
    }
    await authorize();
    return boundedResult(result);
  } catch (error) { return bridgeError(error); }
  finally { release?.(); }
}
export async function bridgeSubscription(request: Request): Promise<Response> {
  const config = getConfig();
  try {
    const grant = await authorizeIntegration(request, config, 'sessions:read');
    const state = stateFor(config);
    if (request.signal.aborted) throw new McpError('cancelled', 'Subscription request was cancelled.', 400);
    if (state.subscriptions >= 8) throw new McpError('busy', 'Eight MCP subscriptions are already connected.', 429, true);
    state.subscriptions++;
    const feed = workspaceFeeds(config).executor;
    return snapshotStream(request, {
      browserBudget: false,
      maximumBytes: MCP_RESPONSE_BYTES,
      async authorize() {
        try { await authorizeIntegration(request, config, 'sessions:read'); return undefined; }
        catch (error) { state.listings.release(grant.id); return bridgeError(error); }
      },
      subscribe(receive, fail) {
        let latest: Parameters<typeof workspaceHeader>[0] | undefined;
        let loading = false; let closed = false;
        const drain = async () => {
          if (loading) return;
          loading = true;
          try {
            while (latest && !closed) {
              const snapshot = latest; latest = undefined;
              const choices = await executionChoices(config, snapshot);
              if (!closed) receive(workspaceHeader(snapshot, choices));
            }
          } catch (error) { if (!closed) fail(error); }
          finally { loading = false; }
        };
        const release = feed.subscribe(snapshot => { latest = snapshot; void drain(); }, fail);
        return () => { closed = true; latest = undefined; release(); state.subscriptions--; };
      },
    });
  } catch (error) { return bridgeError(error); }
}
