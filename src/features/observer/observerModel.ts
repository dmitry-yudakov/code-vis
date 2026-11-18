import { arenaSessionState } from '@/features/arena/arenaModel';
import type { ArenaMachineSnapshot } from '@/shared/types';

export function observerContext(machines: ArenaMachineSnapshot[], offset = 0, question = '', now = Date.now()) {
  const counts: Record<string, number> = {};
  const priority = ['needs-you', 'failed', 'ready', 'running', 'queued', 'offline', 'idle'];
  const all = machines.flatMap(machine => machine.sessions.map(session => {
    const run = machine.runs.active.find(run => run.sessionId === session.id);
    const state = machine.machine.state !== 'online' || machine.snapshotFresh === false ? 'offline' : arenaSessionState(session, run, now);
    counts[state] = (counts[state] ?? 0) + 1;
    return { machineId: machine.machine.id, sessionId: session.id, machine: machine.machine.label.slice(0, 100),
      title: session.title.slice(0, 200), project: machine.projects.find(project => project.id === session.projectId)?.name.slice(0, 200) ?? 'No project',
      state, runId: run?.runId, revision: session.revision, lastSeenAt: machine.machine.lastSeenAt,
      lastMessage: session.lastMessage && { ...session.lastMessage, author: session.lastMessage.author.slice(0, 100), text: session.lastMessage.text.slice(0, 600) },
      pendingCount: run?.pendingPermissionCount ?? 0,
      pending: run?.pendingPermissions.slice(0, 3).map(p => ({ requestId: p.requestId, tool: p.tool.slice(0, 120), detail: p.detail?.slice(0, 240) })) };
  }));
  const normalized = (text: string) => ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
  const query = normalized(question);
  const matches = (row: typeof all[number]) => question.includes(row.sessionId)
    || [row.title, row.project].some(name => name.length >= 3 && query.includes(normalized(name)));
  all.sort((a, b) => Number(matches(b)) - Number(matches(a)) || priority.indexOf(a.state) - priority.indexOf(b.state)
    || a.machineId.localeCompare(b.machineId) || a.sessionId.localeCompare(b.sessionId));
  const rows: typeof all = [];
  let bytes = 0;
  for (const row of all.slice(offset)) {
    const size = new TextEncoder().encode(JSON.stringify(row)).length;
    if (bytes + size > 30 * 1024) break;
    rows.push(row); bytes += size;
  }
  return { counts, total: all.length, matchedTotal: all.filter(matches).length, offset, rows,
    ...(offset + rows.length < all.length ? { nextOffset: offset + rows.length } : {}) };
}

/** Only these exact utterances can confirm the currently displayed preview. */
export function observerCommand(text: string): 'send' | 'approve' | 'deny' | 'correct' | 'cancel-turn' | 'cancel' | 'stop' | 'more' | 'check' | undefined {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/, '');
  if (['send it', 'yes, send it', 'yes send it', 'confirm send'].includes(normalized)) return 'send';
  if (['approve it', 'confirm approval'].includes(normalized)) return 'approve';
  if (['deny it', 'confirm denial'].includes(normalized)) return 'deny';
  if (['save correction', 'confirm correction'].includes(normalized)) return 'correct';
  if (['confirm cancel turn', 'stop that turn'].includes(normalized)) return 'cancel-turn';
  if (['cancel', 'cancel that', 'discard'].includes(normalized)) return 'cancel';
  if (['stop listening', 'stop voice'].includes(normalized)) return 'stop';
  if (['more', 'show more'].includes(normalized)) return 'more';
  if (['check delivery', 'check the delivery'].includes(normalized)) return 'check';
}
