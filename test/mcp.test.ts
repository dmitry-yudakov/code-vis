import { mkdtemp, readFile, stat, symlink, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { bridgeOperation, bridgeSubscription } from '@/server/integrations/mcp/bridge';
import { provisionGrant, revokeGrant, authorizeIntegration } from '@/server/integrations/mcp/grants';
import { McpListings, clip, workspaceHeader, runFacts } from '@/server/integrations/mcp/reads';
import { getConfig } from '@/server/config';
import { getSessionStore, publicSession, SessionStore } from '@/server/storage/sessionStore';
import { readActivity } from '@/server/storage/activityLog';
import { mcpToolSchemas, type McpConnection, type McpScope } from '@/shared/mcp';
import { createTurn } from '@/shared/turnActivity';
import type { ExecutorSnapshot } from '@/shared/types';

const mocks = vi.hoisted(() => ({ submissions: 0, healthy: true, rejectSend: false, loseSendResponse: false }));
vi.mock('@/server/agents/providerRegistry', () => {
  const health = async () => ({ available: mocks.healthy, authenticated: true, supportedModes: ['ask', 'plan', 'agent'],
    models: [{ id: 'test-model', label: 'Test', efforts: ['low', 'high'] }], efforts: ['low', 'high'] });
  return { cachedLocalProviderHealth: async () => ({ claude: await health(), codex: await health() }),
    getProviderAdapters: () => ({ claude: { checkHealth: health }, codex: { checkHealth: health } }) };
});
vi.mock('@/server/conversation/submitMessage', () => ({ submitMessage: async (request: Request, _r: unknown, _q: unknown,
  integration: { fingerprint: string; authorize(): Promise<void> }) => {
  const data = await request.json(); const config = getConfig(); const store = getSessionStore(config.dataDir);
  const session = await store.getSession(data.sessionId); const runId = randomUUID();
  mocks.submissions++;
  if (mocks.rejectSend) return Response.json({ error: 'Synthetic queue rejection' }, { status: 409 });
  await store.appendUserMessage(session.id, { id: data.messageId, role: 'user', authorId: session.participants[0].id,
    addressedParticipantId: data.participantId, text: data.text, createdAt: new Date().toISOString(), status: 'sent',
    diagramAttachments: [], mode: data.mode, turn: createTurn(runId, data.messageId, data.participantId, new Date().toISOString()),
    mcpFingerprint: integration.fingerprint }, integration.authorize);
  if (mocks.loseSendResponse) throw new Error('Lost submission response');
  return Response.json({ runId }, { status: 202 });
} }));
let root: string, connection: McpConnection;
async function grant(scopes: McpScope[] = []) {
  const created = await provisionGrant(getConfig(), 'Test observer', scopes);
  return JSON.parse(await readFile(created.connectionPath, 'utf8')) as McpConnection;
}
function request(operation: string, input: unknown = {}, conn = connection) {
  return new Request(`${conn.origin}/api/integrations/mcp`, { method: 'POST', headers: { host: new URL(conn.origin).host,
    Origin: conn.origin, Authorization: `CodeAI-MCP ${conn.credential}`, 'x-codeai-grant-id': conn.grantId, 'x-codeai-machine-id': conn.machineId },
  body: JSON.stringify({ operation, input }) });
}
async function call(operation: string, input: unknown = {}, conn = connection) {
  const response = await bridgeOperation(request(operation, input, conn));
  return { status: response.status, body: await response.json() };
}
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'codeai-mcp-')); mocks.submissions = 0; mocks.healthy = true; mocks.rejectSend = false; mocks.loseSendResponse = false;
  vi.stubEnv('CODEAI_DATA_DIR', path.join(root, 'data')); vi.stubEnv('CODEAI_REPOSITORIES_ROOT', path.join(root, 'repos'));
  vi.stubEnv('CODEAI_WORKTREES_ROOT', path.join(root, 'worktrees')); vi.stubEnv('CODEAI_REMOTE_ACCESS', 'local');
  vi.stubEnv('CODEAI_MCP_ORIGIN', 'http://127.0.0.1:3023');
  await mkdir(path.join(root, 'repos')); await getSessionStore(getConfig().dataDir).host(); connection = await grant();
});
afterEach(async () => { await getSessionStore(getConfig().dataDir).close(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

describe('scoped running-server MCP bridge', () => {
  it('rejects ordinary authorization, wrong origin/host/identity, revoked grants and unknown operations', async () => {
    const missing = request('get_workspace'); missing.headers.delete('authorization'); expect((await bridgeOperation(missing)).status).toBe(401);
    for (const [key, value] of [['Origin', 'http://evil.test'], ['Host', 'evil.test'], ['x-codeai-machine-id', randomUUID()]]) {
      const foreign = request('get_workspace'); foreign.headers.set(key, value); expect((await bridgeOperation(foreign)).status).toBeGreaterThanOrEqual(400);
    }
    expect((await call('approve_permission')).status).toBe(400);
    expect((await call('archive_session', { sessionId: randomUUID(), expectedRevision: 0 })).status).toBe(403);
    await revokeGrant(getConfig(), connection.grantId); expect((await call('get_workspace')).status).toBe(401);
    const { entries } = (await readActivity(getConfig().dataDir, 'mcp'))!;
    expect(entries).toEqual([
      expect.objectContaining({ action: 'mcp.call', operation: 'archive_session', status: 403, outcome: 'denied',
        actor: { source: 'mcp', id: connection.grantId, label: 'Test observer' } }),
      expect.objectContaining({ action: 'mcp.call', operation: 'request', status: 400, outcome: 'failed' }),
    ]);
    expect(JSON.stringify(entries)).not.toContain(connection.credential);
  });
  it('writes only private digest/connection records and rejects credential placement through symlinks', async () => {
    const directory = path.join(getConfig().dataDir, 'integrations/mcp');
    const raw = await readFile(path.join(directory, `${connection.grantId}.grant.json`), 'utf8');
    expect(raw).not.toContain(connection.credential); expect((await stat(path.join(directory, `${connection.grantId}.connection.json`))).mode & 0o077).toBe(0);
    await rm(directory, { recursive: true }); await symlink(path.join(root, 'repos'), directory);
    await expect(provisionGrant(getConfig(), 'Unsafe')).rejects.toThrow('outside');
  });
  it('requires secure paired transport and cannot use MCP credentials on device routes', async () => {
    vi.stubEnv('CODEAI_REMOTE_ACCESS', 'paired'); vi.stubEnv('CODEAI_PUBLIC_ORIGIN', 'https://codeai.test'); vi.stubEnv('CODEAI_ADDITIONAL_ORIGINS', '');
    connection = await grant();
    expect((await call('get_workspace')).status).toBe(403);
    (globalThis as typeof globalThis & { __codeaiInternalTlsMarker?: string }).__codeaiInternalTlsMarker = 'mcp-test';
    const secure = request('get_workspace'); secure.headers.set('x-codeai-internal-transport', 'mcp-test');
    expect((await authorizeIntegration(secure, getConfig())).id).toBe(connection.grantId);
    const { authorizeDeviceRequest, authorizeMachineRequest } = await import('@/server/devices/deviceAuthorization');
    expect((await authorizeDeviceRequest(secure))?.status).toBe(401); expect((await authorizeMachineRequest(secure))?.status).toBe(401);
  });
  it('includes empty projects and all active/unassigned sessions with pinned pages and archive opt-in', async () => {
    const store = getSessionStore(getConfig().dataDir); const p = await store.createProject('Empty', []);
    const a = await store.createSession({ provider: 'codex' }); const b = await store.createSession({ provider: 'claude', projectId: p.id });
    const projects = await call('list_projects'); expect(projects.body.rows[0]).toMatchObject({ id: p.id, activeSessions: 1 });
    const first = await call('list_sessions', { limit: 1 }); expect(first.body.total).toBe(2);
    await store.archiveSession(b.id, b.revision);
    const next = await call('list_sessions', { limit: 1, cursor: first.body.nextCursor });
    expect(new Set([first.body.rows[0].id, next.body.rows[0].id])).toEqual(new Set([a.id, b.id]));
    expect(next.body.nextCursor).toBeNull(); expect((await call('list_sessions')).body.total).toBe(1);
    expect((await call('list_sessions', { archived: true })).body.total).toBe(2);
    expect((await call('list_sessions', { projectId: p.id })).body.total).toBe(0);
    expect((await call('read_session', { sessionId: b.id })).body.error.code).toBe('archived');
    expect((await call('read_session', { sessionId: randomUUID() })).body.error.code).toBe('missing');
  });
  it('binds empty and full launches before submission and reconciles once through store reopen', async () => {
    connection = await grant(['sessions:create']);
    const store = getSessionStore(getConfig().dataDir); const p = await store.createProject('Work', []);
    const token = (await call('list_projects')).body.rows[0].bindingToken;
    const input = { creationRequestId: randomUUID(), projectId: p.id, expectedProjectBindings: token, provider: 'codex', execution: 'local', checkoutMode: 'current', launch: 'empty' };
    const created = await call('create_session', input); expect(created.body.state).toBe('empty');
    expect((await call('create_session', input)).body.sessionId).toBe(created.body.sessionId);
    const changed = { ...input, launch: 'run', firstMessage: { messageId: randomUUID(), text: 'Implement', mode: 'ask' } };
    expect((await call('create_session', changed)).status).toBe(409);
    expect((await call('send_message', { sessionId: created.body.sessionId, participantId: created.body.primaryAgentId, ...changed.firstMessage })).status).toBe(403);
    const run = { ...changed, creationRequestId: randomUUID() };
    const accepted = await call('create_session', run); expect(accepted.body.accepted).toBe(true);
    await store.close();
    const replay = await call('create_session', run); expect(replay.body.runId).toBe(accepted.body.runId); expect(mocks.submissions).toBe(1);
    expect((await call('create_session', { ...run, firstMessage: { ...run.firstMessage, model: 'test-model' } })).status).toBe(409);
    const saved = await getSessionStore(getConfig().dataDir).getSession(accepted.body.sessionId);
    expect(saved.version).toBe(18); expect(saved.messages[0]).toHaveProperty('mcpFingerprint');
    expect(JSON.stringify(publicSession(saved))).not.toMatch(/mcpFingerprint|mcpLaunchFingerprint|creationReceipt/);
    expect(JSON.stringify((await call('read_session', { sessionId: saved.id })).body)).not.toMatch(/mcpFingerprint|mcpLaunchFingerprint|providerSessionId|lastObservedMessageId/);
  });
  it('retains a rejected first launch and reconciles a lost submission response without another session or message', async () => {
    connection = await grant(['sessions:create']); const store = getSessionStore(getConfig().dataDir);
    const project = await store.createProject('Partial', []); const token = (await call('list_projects')).body.rows[0].bindingToken;
    const input = { creationRequestId: randomUUID(), projectId: project.id, expectedProjectBindings: token, provider: 'codex', execution: 'local', checkoutMode: 'current', launch: 'run',
      firstMessage: { messageId: randomUUID(), text: 'Original launch', mode: 'ask' } };
    mocks.rejectSend = true; const partial = await call('create_session', input);
    expect(partial.body.state).toBe('first_message_not_accepted'); expect(partial.body.sessionId).toBeTruthy();
    expect((await call('create_session', { ...input, firstMessage: { ...input.firstMessage, messageId: randomUUID() } })).status).toBe(409);
    mocks.rejectSend = false; mocks.loseSendResponse = true;
    const accepted = await call('create_session', input); expect(accepted.body.accepted).toBe(true); expect(accepted.body.sessionId).toBe(partial.body.sessionId);
    expect((await call('create_session', input)).body.runId).toBe(accepted.body.runId);
    expect(mocks.submissions).toBe(2); expect(await store.listSessions()).toHaveLength(1);
    expect((await store.getSession(partial.body.sessionId)).messages).toHaveLength(1);
    const { entries } = (await readActivity(getConfig().dataDir, 'mcp'))!;
    expect(entries.filter(entry => entry.action === 'session.create')).toEqual([
      expect.objectContaining({ sessionId: partial.body.sessionId, requestId: input.creationRequestId }),
    ]);
    expect(entries).toContainEqual(expect.objectContaining({
      action: 'mcp.call', operation: 'create_session', outcome: 'partial', status: 200,
      sessionId: partial.body.sessionId, messageId: input.firstMessage.messageId,
    }));
    expect(entries).toContainEqual(expect.objectContaining({ action: 'mcp.call', operation: 'list_projects', outcome: 'succeeded' }));
    expect(JSON.stringify(entries)).not.toContain(input.firstMessage.text);
    const retained = await store.getSession(partial.body.sessionId);
    await store.archiveSession(retained.id, retained.revision);
    expect((await call('create_session', input)).body.state).toBe('archived');
    expect((await readActivity(getConfig().dataDir, 'mcp'))?.entries[0]).toMatchObject({
      action: 'mcp.call', operation: 'create_session', outcome: 'replayed', sessionId: retained.id,
    });
  });
  it('fits escaping-heavy transcript detail within serialized JSON bytes with explicit clipping', async () => {
    const store = getSessionStore(getConfig().dataDir); const session = await store.createSession({ provider: 'codex' });
    for (let i = 0; i < 2; i++) await store.appendUserMessage(session.id, { id: randomUUID(), role: 'user', authorId: session.participants[0].id,
      addressedParticipantId: session.primaryAgentId, text: String.fromCharCode(1).repeat(8000), status: 'sent', diagramAttachments: [], createdAt: new Date().toISOString() });
    const detail = await call('read_session', { sessionId: session.id });
    expect(detail.status).toBe(200); expect(Buffer.byteLength(JSON.stringify(detail.body))).toBeLessThanOrEqual(64 * 1024);
    expect(detail.body.messages.some((m: { truncated: boolean }) => m.truncated)).toBe(true); expect(detail.body.messages.at(-1).text).toHaveLength(8000);
  });
  it('pins both sides of an archive move under the store writer boundary', async () => {
    let unblock!: () => void; let entered!: () => void; let hold = false;
    const held = new Promise<void>(resolve => { unblock = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
    const store = new SessionStore(path.join(root, 'pinned'), { beforeRename: async target => {
      if (hold && target.includes('/sessions/')) { entered(); await held; }
    } });
    try {
      const session = await store.createSession({ provider: 'codex' }); hold = true;
      const archive = store.archiveSession(session.id, session.revision); await started;
      let read = false; const snapshot = store.withWorkspaceSummarySnapshot(s => { read = true; return s; });
      await new Promise(resolve => setTimeout(resolve, 5)); expect(read).toBe(false);
      unblock(); await archive;
      const pinned = await snapshot; expect(pinned.sessions).toHaveLength(0); expect(pinned.archivedSessions.map(s => s.id)).toEqual([session.id]);
    } finally { unblock(); await store.close(); }
  });
  it('validates the entire request and project binding before creating a session', async () => {
    connection = await grant(['sessions:create']); const store = getSessionStore(getConfig().dataDir); const p = await store.createProject('Project', []);
    const input = { creationRequestId: randomUUID(), projectId: p.id, expectedProjectBindings: '0'.repeat(64), provider: 'codex', execution: 'local', checkoutMode: 'current', launch: 'run', firstMessage: { messageId: randomUUID(), text: 'x'.repeat(17000), mode: 'ask' } };
    expect((await call('create_session', input)).status).toBe(400); expect(await store.listSessions()).toHaveLength(0);
    const result = await call('create_session', { ...input, firstMessage: { ...input.firstMessage, text: 'Valid' } });
    expect(result.body.creationState).toBe('none'); expect(await store.listSessions()).toHaveLength(0);
  });
  it('keeps separate participant/send scopes, exact recipient and model/effort retry identities', async () => {
    const session = await getSessionStore(getConfig().dataDir).createSession({ provider: 'codex' });
    connection = await grant(['participants:add']); const add = { sessionId: session.id, requestId: randomUUID(), provider: 'claude', role: 'reviewer' };
    const reviewer = await call('add_participant', add); expect(reviewer.body.participant.defaultMode).toBe('ask');
    mocks.healthy = false; expect((await call('add_participant', add)).body.participant.id).toBe(reviewer.body.participant.id); mocks.healthy = true;
    expect((await call('add_participant', { ...add, role: 'coder' })).status).toBe(409);
    const send = { sessionId: session.id, participantId: reviewer.body.participant.id, messageId: randomUUID(), text: 'Review this', mode: 'ask', model: 'test-model', effort: 'high' };
    expect((await call('send_message', send)).status).toBe(403);
    connection = await grant(['messages:send']); const accepted = await call('send_message', send); expect(accepted.body.accepted).toBe(true);
    const store = getSessionStore(getConfig().dataDir); let saved = await store.getSession(session.id);
    expect(saved.primaryAgentId).toBe(session.primaryAgentId);
    await store.setPrimaryAgent(session.id, reviewer.body.participant.id, saved.revision); await store.close();
    expect((await call('send_message', send)).body.runId).toBe(accepted.body.runId); expect(mocks.submissions).toBe(1);
    for (const patch of [{ effort: 'low' }, { participantId: session.primaryAgentId }, { text: 'Changed' }]) expect((await call('send_message', { ...send, ...patch })).status).toBe(409);
    saved = await store.getSession(session.id); expect(saved.participants).toHaveLength(3);
  });
  it('reclaims revoked polling-only listings before admitting another grant', async () => {
    const store = getSessionStore(getConfig().dataDir);
    await store.createSession({ provider: 'codex' }); await store.createSession({ provider: 'codex' });
    const retained: McpConnection[] = [];
    for (let i = 0; i < 8; i++) { const conn = await grant(); retained.push(conn); expect((await call('list_sessions', { limit: 1 }, conn)).status).toBe(200); }
    const ninth = await grant(); expect((await call('list_sessions', { limit: 1 }, ninth)).status).toBe(429);
    await revokeGrant(getConfig(), retained[0].grantId);
    expect((await call('list_sessions', { limit: 1 }, ninth)).status).toBe(200);
    for (const conn of [...retained.slice(1), ninth]) await call('release_listing', {}, conn);
  });
  it('holds at most two operations per grant and releases admission after completion', async () => {
    const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
    const operation = () => {
      const original = request('get_workspace');
      const stream = new ReadableStream<Uint8Array>({ start(controller) { controllers.push(controller); } });
      return bridgeOperation(new Request(original.url, { method: 'POST', headers: original.headers, body: stream, duplex: 'half' } as RequestInit));
    };
    const first = operation(); const second = operation();
    await new Promise(resolve => setTimeout(resolve, 30));
    expect((await call('get_workspace')).status).toBe(429);
    for (const controller of controllers) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ operation: 'get_workspace', input: {} }))); controller.close(); }
    expect((await first).status).toBe(200); expect((await second).status).toBe(200); expect((await call('get_workspace')).status).toBe(200);
  });
  it('admits eight independent subscriptions, releases slow readers and closes revoked streams at heartbeat', async () => {
    const responses: Response[] = [];
    const subscribe = async () => {
      const original = request('get_workspace');
      return bridgeSubscription(new Request(original.url, { headers: original.headers }));
    };
    for (let i = 0; i < 8; i++) { const response = await subscribe(); responses.push(response); expect(response.status).toBe(200); }
    expect((await subscribe()).status).toBe(429);
    await responses.pop()!.body!.cancel();
    const replacement = await subscribe(); expect(replacement.status).toBe(200);
    for (const response of responses) await response.body!.cancel();
    const reader = replacement.body!.getReader(); await reader.read();
    await revokeGrant(getConfig(), connection.grantId);
    await expect(reader.read()).rejects.toThrow('no longer authorized'); reader.releaseLock();
    connection = await grant(); const fresh = await subscribe(); expect(fresh.status).toBe(200); await fresh.body!.cancel();
    const subscriptions = (await readActivity(getConfig().dataDir, 'mcp'))!.entries;
    expect(subscriptions).toHaveLength(11);
    expect(subscriptions.filter(entry => entry.action === 'mcp.call' && entry.operation === 'subscribe' && entry.status === 200)).toHaveLength(10);
    expect(subscriptions).toContainEqual(expect.objectContaining({ action: 'mcp.call', operation: 'subscribe', status: 429, outcome: 'failed' }));
  }, 15000);
  it('reconciles an archive response and rejects stale retries after Restore and rearchive', async () => {
    connection = await grant(['sessions:archive']); const store = getSessionStore(getConfig().dataDir); const s = await store.createSession({ provider: 'codex' });
    const input = { sessionId: s.id, expectedRevision: s.revision };
    const archived = await call('archive_session', input); expect(archived.body.state).toBe('archived');
    expect((await call('archive_session', input)).body.state).toBe('already_archived');
    const restored = await store.restoreSession(s.id, archived.body.revision);
    expect((await call('archive_session', input)).status).toBe(409);
    await store.archiveSession(s.id, restored.revision); expect((await call('archive_session', input)).status).toBe(409);
  });
});

describe('bounded projections and listing retention', () => {
  it('clips UTF-8 safely and pins 1000 changing rows with at most eight leases', () => {
    expect(clip('A🙂B', 4)).toEqual({ text: 'A', truncated: true });
    const listings = new McpListings(); const rows = Array.from({ length: 1000 }, (_, id) => ({ id, text: '🙂'.repeat(40) }));
    let page = listings.page('grant', 'sessions', undefined, 50, rows); let count = page.rows.length;
    while (page.nextCursor) { page = listings.page('grant', 'sessions', page.nextCursor, 50); count += page.rows.length; }
    expect(count).toBe(1000);
    for (let i = 0; i < 8; i++) listings.page(String(i), 'sessions', undefined, 1, rows);
    expect(() => listings.page('ninth', 'sessions', undefined, 1, rows)).toThrow('Eight');
    listings.release('0'); expect(listings.page('ninth', 'sessions', undefined, 1, rows).rows).toHaveLength(1);
    for (let i = 0; i < 8; i++) listings.release(String(i)); listings.release('ninth');
  });
  it('invalidates superseded, expired, foreign and scope-changed cursors', () => {
    vi.useFakeTimers(); const listings = new McpListings(); const rows = [1, 2];
    const first = listings.page('a', 'projects', undefined, 1, rows);
    expect(() => listings.page('b', 'projects', first.nextCursor!, 1)).toThrow('Restart');
    expect(() => listings.page('a', 'sessions', first.nextCursor!, 1)).toThrow('Restart');
    const second = listings.page('a', 'projects', undefined, 1, rows);
    expect(() => listings.page('a', 'projects', first.nextCursor!, 1)).toThrow('Restart');
    vi.advanceTimersByTime(60001); expect(() => listings.page('a', 'projects', second.nextCursor!, 1)).toThrow('Restart'); vi.useRealTimers();
  });
  it('changes attention identity for replacement requests even when run and revision are unchanged', () => {
    const run = { runId: 'run', state: 'needs-you', pendingPermissionCount: 30,
      pendingPermissions: Array.from({ length: 30 }, (_, i) => ({ requestId: `request-${i}` })) } as unknown as import('@/shared/types').RunDescriptor;
    const first = runFacts(run); run.pendingPermissions[29].requestId = 'replacement';
    expect(runFacts(run).attentionToken).not.toBe(first.attentionToken);
    expect(runFacts(run).pendingAttentionCount).toBe(30);
  });
  it('keeps the workspace token stable across observation times and distinguishes successive attention requests', () => {
    const snapshot = { machine: { id: randomUUID(), label: 'Local' }, providers: {}, projects: [], sessions: [], archivedSessions: [], runs: { active: [], recent: [] } } as unknown as ExecutorSnapshot;
    const a = workspaceHeader(snapshot); expect(workspaceHeader(snapshot).token).toBe(a.token);
    snapshot.projects.push({ version: 1, id: randomUUID(), name: 'New', revision: 0, repositories: [], createdAt: '', updatedAt: '' }); expect(workspaceHeader(snapshot).token).not.toBe(a.token);
  });
});
