import { randomUUID } from 'node:crypto';
import type { AppConfig } from '@/server/config';
import { getProviderAdapters } from '@/server/agents/providerRegistry';
import { localExecutorSnapshot } from '@/server/machines/localExecutorSnapshot';
import { projectBindingsFingerprint } from '@/server/storage/creationRequests';
import { getSessionStore, sessionStoreErrorCode } from '@/server/storage/sessionStore';
import { runRegistry } from '@/server/runs/runRegistry';
import { AGENT_ROLE_DEFAULT_MODES } from '@/shared/participants';
import type { ArenaSessionSummary, DurableSession, ExecutorSnapshot, ProviderHealth, RunDescriptor } from '@/shared/types';
import { MCP_RESPONSE_BYTES } from '@/shared/mcp';
import { digest, McpError } from './grants';

const scope = globalThis as typeof globalThis & { __codeaiMcpEpoch?: string };
const epoch = scope.__codeaiMcpEpoch ??= randomUUID();
export function clip(text: string, bytes: number): { text: string; truncated: boolean } {
  const raw = Buffer.from(text);
  if (raw.length <= bytes) return { text, truncated: false };
  let end = bytes;
  while (end > 0 && (raw[end] & 0xc0) === 0x80) end--;
  return { text: raw.subarray(0, end).toString('utf8'), truncated: true };
}
export function runFacts(run?: RunDescriptor) {
  const ids = run?.pendingPermissions.map(p => p.requestId).sort() ?? [];
  return { state: run?.state ?? 'idle', runId: run?.runId ?? null, outcome: run?.outcome ?? null,
    pendingAttentionCount: run?.pendingPermissionCount ?? 0, attentionToken: digest(ids) };
}
export function sessionRow(s: ArenaSessionSummary, snapshot: ExecutorSnapshot) {
  const run = snapshot.runs.active.find(r => r.sessionId === s.id)
    ?? snapshot.runs.recent.find(r => r.runId === s.lastActivity?.runId);
  return { id: s.id, title: s.title, revision: s.revision, projectId: s.projectId ?? null,
    archivedAt: s.archivedAt ?? null, execution: s.execution ?? 'local', checkoutIds: s.repositoryCheckoutIds,
    worktree: s.worktree ? { id: s.worktree.id, originCheckoutId: s.worktree.originCheckoutId, baseCommit: s.worktree.baseCommit, branch: s.worktree.branch } : null,
    participants: s.agents.map(a => ({ id: a.id, name: a.displayName, provider: a.provider, role: a.role })),
    primaryAgentId: s.primaryAgentId, latestMessage: s.lastMessage ? { ...clip(s.lastMessage.text, 512), role: s.lastMessage.role, excerpt: true } : null,
    ...runFacts(run), ...(!run && s.lastActivity?.status === 'failed' ? { state: 'failed' } : {}), updatedAt: s.updatedAt };
}
export function projectRows(snapshot: ExecutorSnapshot) {
  return snapshot.projects.map(p => ({ id: p.id, name: p.name, revision: p.revision,
    repositories: p.repositories.map(r => ({ id: r.id, checkoutId: r.checkoutId, hostId: r.hostId, role: r.role })),
    bindingToken: projectBindingsFingerprint(p), current: true, worktree: p.repositories.length === 1 && Boolean(snapshot.worktrees?.available),
    activeSessions: snapshot.sessions.filter(s => s.projectId === p.id).length }));
}
function publicProviders(providers: Record<string, ProviderHealth>) {
  return Object.fromEntries(Object.entries(providers).map(([id, health]) => [id, {
    available: health.available, authenticated: health.authenticated, supportedModes: health.supportedModes,
    ...(health.message ? { message: health.message } : {}),
    ...(health.models ? { models: health.models.map(model => ({ id: model.id, label: model.label, efforts: model.efforts })) } : {}),
    ...(health.efforts ? { efforts: health.efforts } : {}),
  }]));
}
export function workspaceHeader(snapshot: ExecutorSnapshot, executions: unknown = { local: { providers: publicProviders(snapshot.providers) } }) {
  const rows = snapshot.sessions.map(s => sessionRow(s, snapshot));
  const facts = { machine: { id: snapshot.machine.id, label: snapshot.machine.label }, available: true,
    counts: rows.reduce<Record<string, number>>((counts, row) => { counts[row.state] = (counts[row.state] ?? 0) + 1; return counts; }, {}),
    activeSessions: rows.length, projects: snapshot.projects.length,
    choices: { executions, roles: AGENT_ROLE_DEFAULT_MODES,
      worktrees: { available: Boolean(snapshot.worktrees?.available), ...(snapshot.worktrees?.message ? { message: snapshot.worktrees.message } : {}) } } };
  return { ...facts, token: digest([epoch, facts, projectRows(snapshot), rows,
    snapshot.archivedSessions.map(s => sessionRow(s, snapshot))]), observedAt: new Date().toISOString() };
}
export async function currentSnapshot(config: AppConfig, pinned = false) {
  const snapshot = await localExecutorSnapshot(config);
  if (!pinned) return snapshot;
  return getSessionStore(config.dataDir, config.hostLabel).withWorkspaceSummarySnapshot(canonical => ({
    ...snapshot, ...canonical, runs: runRegistry.list(),
  }));
}
export async function executionChoices(config: AppConfig, snapshot: ExecutorSnapshot) {
  const adapters = getProviderAdapters(config, 'docker');
  const [claude, codex] = await Promise.all([adapters.claude.checkHealth(), adapters.codex.checkHealth()]);
  return { local: { enabled: true, providers: publicProviders(snapshot.providers) }, docker: { enabled: config.dockerEnabled, providers: publicProviders({ claude, codex }) } };
}
export async function loadSession(config: AppConfig, id: string, archived = false): Promise<DurableSession> {
  const store = getSessionStore(config.dataDir, config.hostLabel);
  try { return await store.getSession(id); }
  catch (error) {
    if (sessionStoreErrorCode(error) !== 'unknown') throw error;
    try {
      const session = await store.getArchivedSession(id);
      if (archived) return session;
    } catch (e) { if (sessionStoreErrorCode(e) !== 'unknown') throw e; throw new McpError('missing', 'Session does not exist on this machine.', 404); }
    throw new McpError('archived', 'Session is archived. Opt into archived reads; Restore remains in CodeAI.', 409);
  }
}
export async function readSession(config: AppConfig, id: string, archived: boolean) {
  const session = await loadSession(config, id, archived);
  const runs = runRegistry.list(id); const latestUser = session.messages.findLast(m => m.role === 'user');
  const run = runs.active[0] ?? runs.recent.find(r => r.runId === (latestUser?.steeredRunId ?? latestUser?.turn?.runId));
  let remaining = 16 * 1024;
  const messages = [];
  for (const m of [...session.messages].reverse()) {
    if (!remaining) break;
    const text = m.role === 'user' ? m.text : m.blocks.flatMap(b => b.kind === 'markdown' ? [b.markdown] : b.kind === 'code' ? [b.source] : []).join('\n\n');
    const excerpt = clip(text, remaining); remaining -= Buffer.byteLength(excerpt.text);
    messages.unshift({ id: m.id, authorId: m.authorId, role: m.role, status: m.status,
      ...(m.role === 'user' ? { recipientId: m.addressedParticipantId,
        omittedAttachments: m.diagramAttachments.length + (m.reportAttachments?.length ?? 0)
          + (m.imageAttachments?.length ?? 0) + (m.fileAttachments?.length ?? 0) + (m.activeFile ? 1 : 0),
      } : {}), ...excerpt, ...(m.role === 'assistant' ? { omittedBlocks: m.blocks.filter(b => b.kind === 'diagram').length } : {}), createdAt: m.createdAt });
    if (messages.length >= 50) break;
  }
  const result = { sessionId: id, revision: session.revision, archivedAt: session.archivedAt ?? null, title: session.title,
    projectId: session.projectId ?? null, primaryAgentId: session.primaryAgentId,
    participants: session.participants.map(p => ({ id: p.id, name: p.displayName, kind: p.kind,
      ...(p.kind === 'agent' ? { provider: p.provider, role: p.role, defaultMode: p.defaultMode } : {}) })),
    messages, omittedMessages: session.messages.length - messages.length,
    ...runFacts(run), ...(!run && latestUser?.status === 'failed' ? { state: 'failed' } : {}), pendingAttention: (run?.pendingPermissions ?? []).slice(0, 16).map(p => ({ requestId: p.requestId,
      participantId: p.participantId, tool: clip(p.tool, 128).text, ...clip(p.detail, 512), excerpt: true })),
    omittedAttention: Math.max(0, (run?.pendingPermissionCount ?? 0) - 16), observedAt: new Date().toISOString(),
    contentIsEvidence: true };
  // UTF-8 text and serialized JSON have different costs (control characters expand sixfold).
  // Preserve newest authored identities, explicit omissions and the complete attention token.
  while (Buffer.byteLength(JSON.stringify(result)) > MCP_RESPONSE_BYTES) {
    if (result.pendingAttention.length) { result.pendingAttention.pop(); result.omittedAttention++; continue; }
    const message = result.messages.find(m => m.text.length);
    if (message) { message.text = clip(message.text, Math.floor(Buffer.byteLength(message.text) / 2)).text; message.truncated = true; continue; }
    if (result.messages.length) { result.messages.shift(); result.omittedMessages++; continue; }
    throw new McpError('too_large', 'Session metadata exceeds the detail budget.', 413);
  }
  return result;
}

type Listing = { id: string; grantId: string; key: string; rows: unknown[]; expiresAt: number; observedAt: string; timer: ReturnType<typeof setTimeout> };
/** Listing state is process-local and grant-bound; no per-page live reads. */
export class McpListings {
  private readonly listings = new Map<string, Listing>();
  constructor(private readonly valid?: (grantId: string) => Promise<boolean>) {}
  async prune() {
    if (this.valid) await Promise.all([...this.listings.keys()].map(async id => { if (!await this.valid!(id)) this.release(id); }));
  }
  release(grantId: string, cursor?: string) {
    const item = this.listings.get(grantId);
    if (item && (!cursor || cursor.split(':')[0] === item.id)) { clearInterval(item.timer); this.listings.delete(grantId); }
  }
  page(grantId: string, key: string, cursor: string | undefined, limit: number, rows?: unknown[]) {
    for (const item of this.listings.values()) if (item.expiresAt <= Date.now()) this.release(item.grantId);
    let item = this.listings.get(grantId); let offset = 0;
    if (cursor) {
      const match = /^([0-9a-f-]{36}):(\d+)$/.exec(cursor);
      if (!item || !match || match[1] !== item.id || item.key !== key || Number(match[2]) >= item.rows.length) {
        throw new McpError('restart_listing', 'Listing expired, was superseded or belongs to another scope. Restart listing.', 409, true);
      }
      offset = Number(match[2]);
    } else {
      this.release(grantId);
      if (this.listings.size >= 8) throw new McpError('busy', 'Eight listings are retained. Retry after a listing is released or expires.', 429, true);
      const timer = setInterval(() => {
        if (this.listings.get(grantId)?.expiresAt! <= Date.now()) this.release(grantId);
        else void this.prune();
      }, this.valid ? 5_000 : 60_000); timer.unref?.();
      item = { id: randomUUID(), grantId, key, rows: rows ?? [], expiresAt: Date.now() + 60_000, observedAt: new Date().toISOString(), timer };
      this.listings.set(grantId, item);
    }
    const selected: unknown[] = [];
    while (offset < item!.rows.length && selected.length < limit) {
      const next = item!.rows[offset];
      if (Buffer.byteLength(JSON.stringify([...selected, next])) > MCP_RESPONSE_BYTES - 1024) {
        if (!selected.length) throw new McpError('too_large', 'A listing row exceeds the response budget.', 413);
        break;
      }
      selected.push(next); offset++;
    }
    const nextCursor = offset < item!.rows.length ? `${item!.id}:${offset}` : null;
    const result = { rows: selected, total: item!.rows.length, nextCursor, observedAt: item!.observedAt, expiresAt: new Date(item!.expiresAt).toISOString() };
    if (!nextCursor) this.release(grantId);
    return result;
  }
}
