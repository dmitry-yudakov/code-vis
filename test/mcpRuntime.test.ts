import { createServer, type RequestListener, type Server as HttpServer } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { getConfig } from '@/server/config';
import { getSessionStore } from '@/server/storage/sessionStore';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { provisionGrant, revokeGrant } from '@/server/integrations/mcp/grants';
import { bridgeOperation, bridgeSubscription } from '@/server/integrations/mcp/bridge';
import { runRegistry } from '@/server/runs/runRegistry';
import { readWorktreeRecords } from '@/server/repository/managedWorktrees';
import { archiveSession } from '@/server/conversation/archiveSession';
import { getDeviceAuthStore } from '@/server/devices/deviceAuthStore';
import { GET as GET_QUEUE_REVIEW, POST as APPROVE_QUEUE_REVIEW } from '@/app/api/integrations/mcp/queue/[grantId]/[requestId]/route';

const git = promisify(execFile); let root: string, server: HttpServer, origin: string, connectionPath: string, grantId: string;
const clients: Client[] = []; const transports: StdioClientTransport[] = [];
const script = path.resolve('scripts/mcp.ts'); const loader = path.resolve('node_modules/tsx/dist/loader.mjs');
async function connect(file = connectionPath, env?: Record<string, string>) {
  let protocol: string | undefined;
  class ObservedTransport extends StdioClientTransport {
    override async start() {
      const receive = this.onmessage;
      this.onmessage = message => {
        if ('result' in message && message.result && typeof message.result === 'object' && 'protocolVersion' in message.result) protocol = String(message.result.protocolVersion);
        receive?.(message);
      };
      return super.start();
    }
  }
  const transport = new ObservedTransport({ command: process.execPath, args: ['--import', loader, script, file], cwd: '/tmp', stderr: 'pipe', env });
  transports.push(transport); let errors = ''; transport.stderr?.on('data', b => { errors += b.toString(); });
  const client = new Client({ name: 'codeai-runtime-test-host', version: '1.0.0' }); clients.push(client);
  try { await client.connect(transport); } catch (error) { throw new Error(`${error}: ${errors}`); }
  return { client, transport, protocol };
}
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(JSON.stringify(result.content));
  return result.structuredContent as Record<string, any>;
}
async function settled(id: string) { await vi.waitFor(() => expect(runRegistry.hasLiveSession(id)).toBe(false), { timeout: 15000 }); }
function serveBridge(getOrigin: () => string, marker?: string): RequestListener {
  return async (req, res) => {
    const abort = new AbortController(); res.once('close', () => abort.abort());
    try {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const headers = new Headers(); for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
      if (marker) headers.set('x-codeai-internal-transport', marker);
      const request = new Request(`${getOrigin()}${req.url}`, { method: req.method, headers, signal: abort.signal,
        ...(req.method === 'POST' ? { body: Buffer.concat(chunks).toString('utf8') } : {}) });
      const response = await (req.method === 'GET' ? bridgeSubscription(request) : bridgeOperation(request));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) {
        const reader = response.body.getReader(); abort.signal.addEventListener('abort', () => void reader.cancel().catch(() => undefined), { once: true });
        try { while (!abort.signal.aborted) { const { done, value } = await reader.read(); if (done) break; if (!res.write(value)) await once(res, 'drain'); } }
        finally { await reader.cancel().catch(() => undefined); }
      }
      res.end();
    } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
  };
}
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'codeai-mcp-runtime-')); const repo = path.join(root, 'repos', 'sample'); await mkdir(repo, { recursive: true });
  await git('git', ['init', '-q', repo]); await git('git', ['-C', repo, 'config', 'user.name', 'MCP fixture']); await git('git', ['-C', repo, 'config', 'user.email', 'test@example.invalid']);
  await writeFile(path.join(repo, 'file.txt'), 'source\n'); await git('git', ['-C', repo, 'add', '.']); await git('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-C', repo, 'commit', '-qm', 'fixture']);
  vi.stubEnv('CODEAI_DATA_DIR', path.join(root, 'data')); vi.stubEnv('CODEAI_REPOSITORIES_ROOT', path.join(root, 'repos')); vi.stubEnv('CODEAI_WORKTREES_ROOT', path.join(root, 'worktrees'));
  vi.stubEnv('CODEAI_REMOTE_ACCESS', 'local'); vi.stubEnv('CODEAI_DOCKER_ENABLED', 'false'); vi.stubEnv('CODEAI_CODEX_AGENT', 'true'); vi.stubEnv('CODEAI_DEBUG_AGENT', 'false'); vi.stubEnv('CODEAI_CLAUDE_BIN', path.resolve('test/fixtures/fake-claude.mjs'));
  vi.stubEnv('CODEAI_CODEX_BIN', path.resolve('test/fixtures/fake-codex.mjs')); vi.stubEnv('CODEAI_FAKE_TOOL_DELAY_MS', '5'); vi.stubEnv('CODEAI_FAKE_MODE', 'normal');
  server = createServer(serveBridge(() => origin));
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`; vi.stubEnv('CODEAI_MCP_ORIGIN', origin);
  await getSessionStore(getConfig().dataDir).host();
  const grant = await provisionGrant(getConfig(), 'Runtime host', ['sessions:create', 'sessions:archive', 'participants:add', 'messages:send']);
  connectionPath = grant.connectionPath; grantId = grant.grant.id;
}, 20000);
afterAll(async () => {
  for (const client of clients) await client.close().catch(() => undefined);
  for (const transport of transports) await transport.close().catch(() => undefined);
  for (const run of runRegistry.currentRuns) await runRegistry.cancel(run.runId);
  if (server?.listening) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  await getSessionStore(path.join(root, 'data')).close(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true });
});

it('negotiates SDK stdio from outside the checkout and advertises only scoped tools', async () => {
  const readonly = await provisionGrant(getConfig(), 'Read only');
  const { client, protocol } = await connect(readonly.connectionPath);
  expect(protocol).toBe('2025-11-25'); expect((await client.listTools()).tools.map(t => t.name)).toEqual(['get_workspace', 'list_projects', 'list_sessions', 'read_session']);
  const header = await call(client, 'get_workspace'); expect(header.machine.id).toBe(readonly.grant.machineId);
  expect(header.choices.executions.docker.enabled).toBe(false);
  expect((await client.listResources()).resources[0].uri).toBe('codeai://local/workspace');
  await client.close();
}, 20000);
it('advertises new-session tools separately from addressed sends', async () => {
  const config = getConfig();
  const creator = await provisionGrant(config, 'Creation only', ['sessions:create']);
  const sender = await provisionGrant(config, 'Send only', ['messages:send']);
  const { client: creationClient } = await connect(creator.connectionPath);
  const { client: sendClient } = await connect(sender.connectionPath);
  const creationTools = (await creationClient.listTools()).tools;
  const emptySchema = creationTools.find(tool => tool.name === 'create_session')?.inputSchema;
  expect(emptySchema?.required).toContain('creationRequestId');
  expect(emptySchema?.properties).not.toHaveProperty('firstMessage');
  for (const name of ['start_session', 'queue_session']) {
    const schema = creationTools.find(tool => tool.name === name)?.inputSchema;
    expect(schema?.required).toContain('firstMessage');
    expect(schema?.properties).not.toHaveProperty('launch');
    expect(schema?.properties).not.toHaveProperty('sessionId');
    await expect(sendClient.callTool({ name, arguments: {} })).rejects.toThrow('Tool is not available');
  }
  expect(creationTools.map(tool => tool.name)).not.toContain('send_message');
  await expect(sendClient.callTool({ name: 'create_session', arguments: {} })).rejects.toThrow('Tool is not available');
  const sendSchema = (await sendClient.listTools()).tools.find(tool => tool.name === 'send_message')?.inputSchema;
  expect(sendSchema?.required).toEqual(expect.arrayContaining(['sessionId', 'participantId', 'messageId']));
  const [checkout] = await getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth).list();
  const empty = { creationRequestId: randomUUID(), checkoutId: checkout.id, provider: 'codex', execution: 'local', checkoutMode: 'current' };
  const created = await call(creationClient, 'create_session', empty);
  expect(created.state).toBe('empty');
  expect((await call(creationClient, 'create_session', { ...empty, launch: 'empty' })).sessionId).toBe(created.sessionId);
  const followUp = { sessionId: created.sessionId, participantId: created.primaryAgentId, messageId: randomUUID(), text: 'Existing session', mode: 'ask' };
  await expect(creationClient.callTool({ name: 'send_message', arguments: followUp })).rejects.toThrow('Tool is not available');
  await creationClient.close();
  await sendClient.close();
}, 20000);
it('delivers creation, queue release, worktree placement, addressed review/correction and exact replay through a real MCP client', async () => {
  const { client } = await connect(); const config = getConfig(); const store = getSessionStore(config.dataDir);
  const creator = await provisionGrant(config, 'Launch only', ['sessions:create']);
  const { client: launchClient } = await connect(creator.connectionPath);
  const checkout = (await getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth).list())[0];
  const project = await store.createProject('MCP project', [checkout.id]); await store.createProject('Empty project', []);
  const projects = await call(client, 'list_projects'); expect(projects.rows).toHaveLength(2);
  const token = projects.rows.find((p: { id: string }) => p.id === project.id).bindingToken;
  const first = { creationRequestId: randomUUID(), projectId: project.id, expectedProjectBindings: token, provider: 'codex', execution: 'local', checkoutMode: 'current',
    firstMessage: { messageId: randomUUID(), text: 'Implement a bounded example', mode: 'ask' } };
  const created = await call(launchClient, 'start_session', first); expect(created.accepted).toBe(true); await settled(created.sessionId);
  const replay = await call(launchClient, 'create_session', { ...first, launch: 'run' }); expect(replay.runId).toBe(created.runId);
  const queueInput = { ...first, creationRequestId: randomUUID(), firstMessage: { ...first.firstMessage, messageId: randomUUID(), text: 'Queued successor' } };
  const invalid = await launchClient.callTool({ name: 'queue_session', arguments: { ...queueInput, launch: 'run' } });
  expect(invalid.isError).toBe(true);
  const oversized = await launchClient.callTool({ name: 'queue_session', arguments: {
    ...queueInput, firstMessage: { ...queueInput.firstMessage, text: ' '.repeat(16 * 1024) + 'Queued successor' },
  } });
  expect(oversized).toMatchObject({ isError: true, content: [{ text: 'MCP operation exceeds 16 KiB.' }] });
  const queued = await call(launchClient, 'queue_session', queueInput);
  expect(queued.state).toBe('queued');
  const worktreeInput = { ...first, creationRequestId: randomUUID(), checkoutMode: 'worktree', firstMessage: { ...first.firstMessage, messageId: randomUUID(), text: 'Independent worktree' } };
  const worktree = await call(launchClient, 'queue_session', worktreeInput); expect(worktree.accepted).toBe(true); expect(worktree.worktree.originCheckoutId).toBe(checkout.id);
  expect(runRegistry.list(worktree.sessionId).active[0]?.queuePosition ?? 0).toBeLessThanOrEqual(2); await settled(worktree.sessionId);
  expect((await call(launchClient, 'queue_session', worktreeInput)).sessionId).toBe(worktree.sessionId);
  expect((await readWorktreeRecords(config.dataDir))).toHaveLength(1);
  const reviewerInput = { sessionId: created.sessionId, requestId: randomUUID(), provider: 'claude', role: 'reviewer' };
  const reviewer = await call(client, 'add_participant', reviewerInput);
  expect((await call(client, 'add_participant', reviewerInput)).participant.id).toBe(reviewer.participant.id);
  const review = { sessionId: created.sessionId, participantId: reviewer.participant.id, messageId: randomUUID(), text: 'Review the implementation in this conversation.', mode: 'ask' };
  const reviewed = await call(client, 'send_message', review); expect(reviewed.accepted).toBe(true); await settled(created.sessionId);
  const correction = await call(client, 'send_message', { ...review, participantId: created.primaryAgentId, messageId: randomUUID(), text: 'Apply the requested corrections.', mode: 'agent' });
  expect(correction.accepted).toBe(true); await settled(created.sessionId);
  const saved = await store.getSession(created.sessionId); expect(saved.primaryAgentId).toBe(created.primaryAgentId);
  const agents = saved.participants.filter(p => p.kind === 'agent'); expect(agents.every(p => p.kind === 'agent' && p.session.started)).toBe(true);
  expect(saved.messages.filter(m => m.role === 'user')).toHaveLength(3);
  const archive = await call(client, 'archive_session', { sessionId: saved.id, expectedRevision: saved.revision }); expect(archive.state).toBe('archived');
  await settled(queued.sessionId); expect((await store.getSession(queued.sessionId)).messages.some(m => m.role === 'assistant')).toBe(true);
  await launchClient.close();
  await client.close();
}, 60000);
it('negotiates a paired project queue grant, then releases one approved launch on archive', async () => {
  const cert = path.join(root, 'queue-cert.pem'); const key = path.join(root, 'queue-key.pem');
  await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', key, '-out', cert]);
  const globals = globalThis as typeof globalThis & { __codeaiInternalTlsMarker?: string };
  const previousMarker = globals.__codeaiInternalTlsMarker;
  const marker = randomUUID();
  let pairedOrigin = '';
  const tlsServer = createTlsServer({ key: await readFile(key), cert: await readFile(cert) }, serveBridge(() => pairedOrigin, marker));
  await new Promise<void>((resolve, reject) => { tlsServer.once('error', reject); tlsServer.listen(0, '127.0.0.1', resolve); });
  pairedOrigin = `https://127.0.0.1:${(tlsServer.address() as { port: number }).port}`;
  const previousPublicOrigin = process.env.CODEAI_PUBLIC_ORIGIN;
  const previousAdditionalOrigins = process.env.CODEAI_ADDITIONAL_ORIGINS;
  vi.stubEnv('CODEAI_PUBLIC_ORIGIN', pairedOrigin);
  vi.stubEnv('CODEAI_ADDITIONAL_ORIGINS', '');
  vi.stubEnv('CODEAI_REMOTE_ACCESS', 'paired');
  globals.__codeaiInternalTlsMarker = marker;
  let client: Client | undefined;
  try {
    const config = getConfig(); const store = getSessionStore(config.dataDir);
    const repo = path.join(config.repositoriesRoot, 'scoped');
    await git('git', ['clone', '-q', path.join(config.repositoriesRoot, 'sample'), repo]);
    const checkout = (await getCheckoutRegistry(config.repositoriesRoot, config.repositoryDiscoveryDepth).refresh()).find(item => item.realPath === repo)!;
    const project = await store.createProject('CodeAI Dev', [checkout.id]);
    const blocker = await store.createSession({ provider: 'codex', projectId: project.id });
    await store.appendUserMessage(blocker.id, { id: randomUUID(), role: 'user', authorId: blocker.participants[0].id,
      addressedParticipantId: blocker.primaryAgentId, text: 'Earlier work', createdAt: new Date().toISOString(), status: 'sent', diagramAttachments: [] });
    const grant = await provisionGrant(config, 'CodeAI Dev queue', [], project.id);
    ({ client } = await connect(grant.connectionPath, { NODE_EXTRA_CA_CERTS: cert }));
    const tools = (await client.listTools()).tools;
    expect(tools.map(tool => tool.name)).toEqual(['list_projects', 'queue_session']);
    expect(tools[1].inputSchema.required).toEqual(expect.arrayContaining(['projectId', 'expectedProjectBindings', 'firstMessage']));
    expect(tools[1].inputSchema.properties).not.toHaveProperty('checkoutId');
    expect(tools[1].inputSchema.properties).not.toHaveProperty('launch');
    expect(client.getServerCapabilities()?.resources).toBeUndefined();
    const projects = await call(client, 'list_projects');
    expect(projects.rows.map((row: { id: string }) => row.id)).toEqual([project.id]);
    const input = { projectId: project.id, expectedProjectBindings: projects.rows[0].bindingToken, provider: 'codex', execution: 'local',
      checkoutMode: 'current', creationRequestId: randomUUID(),
      firstMessage: { messageId: randomUUID(), text: 'Approved queued task', mode: 'ask' } };
    await expect(client.callTool({ name: 'start_session', arguments: input })).rejects.toThrow('Tool is not available');
    const proposal = await call(client, 'queue_session', input);
    expect(proposal.state).toBe('confirmation_required');
    expect((await store.listSessions()).filter(session => session.projectId === project.id)).toHaveLength(1);

    const devices = getDeviceAuthStore(config.dataDir);
    const challenge = await devices.issuePairingCode();
    const owner = await devices.pair(challenge.code, 'Paired owner');
    const headers = { 'x-codeai-internal-transport': marker, Cookie: `__Host-codeai-device=${owner.credential}`, Origin: pairedOrigin };
    const approve = async (confirmationUrl: string, creationRequestId: string) => {
      const reviewUrl = confirmationUrl.replace('/mcp/queue/', '/api/integrations/mcp/queue/');
      const context = { params: Promise.resolve({ grantId: grant.grant.id, requestId: creationRequestId }) };
      const review = await (await GET_QUEUE_REVIEW(new Request(reviewUrl, { headers }), context)).json();
      expect(review).toMatchObject({ checkoutId: checkout.id, checkoutName: 'scoped' });
      const approved = await APPROVE_QUEUE_REVIEW(new Request(reviewUrl, { method: 'POST', headers,
        body: JSON.stringify({ fingerprint: review.fingerprint }) }), context);
      expect(approved.status).toBe(200);
    };
    await approve(proposal.confirmationUrl, input.creationRequestId);
    const [queued, replay] = await Promise.all([
      call(client, 'queue_session', input), call(client, 'create_session', { ...input, launch: 'queue' }),
    ]);
    expect(queued).toMatchObject({ accepted: true, state: 'queued', messageId: input.firstMessage.messageId });
    expect(replay).toMatchObject({ accepted: true, sessionId: queued.sessionId, runId: queued.runId });
    expect((await store.getSession(queued.sessionId)).messages).toHaveLength(1);
    const worktreeInput = { ...input, checkoutMode: 'worktree', creationRequestId: randomUUID(),
      firstMessage: { ...input.firstMessage, messageId: randomUUID(), text: 'Independent approved worktree' } };
    const worktreeReview = await call(client, 'queue_session', worktreeInput);
    await approve(worktreeReview.confirmationUrl, worktreeInput.creationRequestId);
    const worktree = await call(client, 'queue_session', worktreeInput);
    expect(worktree).toMatchObject({ accepted: true, worktree: { originCheckoutId: checkout.id } });
    await settled(worktree.sessionId);
    expect((await store.getSession(worktree.sessionId)).messages.some(message => message.role === 'assistant')).toBe(true);
    expect((await call(client, 'queue_session', input)).state).toBe('queued');
    const earlier = await store.getSession(blocker.id);
    expect(earlier.archivedAt).toBeUndefined();
    await archiveSession(earlier.id, earlier.revision, config);
    await settled(queued.sessionId);
    expect((await store.getSession(queued.sessionId)).messages.some(message => message.role === 'assistant')).toBe(true);
  } finally {
    await client?.close().catch(() => undefined);
    tlsServer.closeAllConnections();
    await new Promise<void>(resolve => tlsServer.close(() => resolve()));
    vi.stubEnv('CODEAI_REMOTE_ACCESS', 'local');
    vi.stubEnv('CODEAI_PUBLIC_ORIGIN', previousPublicOrigin);
    vi.stubEnv('CODEAI_ADDITIONAL_ORIGINS', previousAdditionalOrigins);
    globals.__codeaiInternalTlsMarker = previousMarker;
  }
}, 30000);
it('stops the example and its uncooperative inference child while leaving CodeAI work live', async () => {
  const config = getConfig(); const store = getSessionStore(config.dataDir);
  const session = await store.createSession({ provider: 'codex' });
  const runId = randomUUID();
  const reserved = runRegistry.reserve({ runId, sessionId: session.id, participantId: session.primaryAgentId, providerKey: `observer-${runId}`,
    checkoutId: 'observer-fixture', access: 'read', cancel: () => runRegistry.release(runId) });
  expect(reserved.accepted).toBe(true);
  runRegistry.activate(runId, { execute: () => new Promise<void>(() => undefined), cancelQueued: async () => undefined });
  await Promise.resolve();
  runRegistry.record(runId, { type: 'permission-request', runId, requestId: randomUUID(), participantId: session.primaryAgentId, tool: 'shell', detail: 'Synthetic attention' });
  const grant = await provisionGrant(config, 'External loop'); const marker = path.join(root, 'inference-started');
  const agent = path.join(root, 'external-agent.mjs');
  await writeFile(agent, `import { writeFileSync } from 'node:fs';
process.on('SIGTERM', () => {});
process.stdin.resume();
process.stdin.on('end', () => { writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(() => {}, 1000); });
`);
  const child = spawn(process.execPath, ['--import', loader, path.resolve('scripts/mcp-observer.ts'), grant.connectionPath, process.execPath, agent], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.resume(); child.stderr.resume(); let pid: number | undefined;
  try {
    await vi.waitFor(async () => { pid = Number(await readFile(marker, 'utf8')); expect(pid).toBeGreaterThan(0); }, { timeout: 10000 });
    child.kill('SIGTERM');
    await vi.waitFor(() => expect(child.exitCode !== null || child.signalCode !== null).toBe(true), { timeout: 6000 });
    expect(() => process.kill(pid!, 0)).toThrow();
    expect(runRegistry.hasLiveSession(session.id)).toBe(true);
  } finally {
    child.kill('SIGKILL'); if (pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    runRegistry.release(runId);
  }
}, 20000);
it('notifies resource changes and rejects revocation without stopping canonical work', async () => {
  const { client } = await connect(); const notices = vi.fn(); client.setNotificationHandler(ResourceUpdatedNotificationSchema, notices);
  await client.subscribeResource({ uri: 'codeai://local/workspace' }); await vi.waitFor(() => expect(notices).toHaveBeenCalled(), { timeout: 5000 });
  const before = notices.mock.calls.length; await getSessionStore(getConfig().dataDir).createProject('Notification', []);
  await vi.waitFor(() => expect(notices.mock.calls.length).toBeGreaterThan(before), { timeout: 5000 });
  await revokeGrant(getConfig(), grantId);
  const result = await client.callTool({ name: 'get_workspace', arguments: {} }); expect(result.isError).toBe(true);
  expect((await getSessionStore(getConfig().dataDir).listSessions()).length).toBeGreaterThan(0);
  await client.close();
}, 15000);
it('exits on host stdin EOF without a termination signal', async () => {
  const grant = await provisionGrant(getConfig(), 'EOF');
  const child = spawn(process.execPath, ['--import', loader, script, grant.connectionPath], { cwd: '/tmp', stdio: ['pipe', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', b => { output += b.toString(); });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'EOF host', version: '1' } } })}\n`);
  await vi.waitFor(() => expect(output).toContain('protocolVersion'), { timeout: 5000 });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  child.stdin.end();
  try { await Promise.race([once(child, 'exit'), new Promise((_, reject) => { timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Adapter did not exit after EOF')); }, 5000); })]); }
  finally { if (timeout) clearTimeout(timeout); }
  expect(child.exitCode).toBe(0);
}, 15000);
