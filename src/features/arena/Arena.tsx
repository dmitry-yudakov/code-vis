'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { relativeActivityTime } from '@/features/shell/immersive/conversationListModel';
import type {
  ArenaMachineSnapshot, ArenaSessionSummary, CheckoutSummary, ExecutionHealth,
} from '@/shared/types';
import {
  buildMultiMachineInbox, groupArenaSessions, unreadArenaAttention,
  type ArenaAttentionItem, type DeviceArenaState,
} from './arenaModel';
import { DockerVersions } from './DockerVersions';
import { GlobalInstructions } from './GlobalInstructions';
import { ARENA_SECTION_PATHS, type ArenaSection } from './routes';

const STATE_LABELS = {
  idle: 'Idle',
  running: 'Running',
  'needs-you': 'Needs you',
  queued: 'Queued',
  failed: 'Failed',
  offline: 'Offline',
} as const;

function participantNames(session: ArenaSessionSummary): string {
  return session.agents.map((agent) => agent.displayName).join(', ') || 'No agent';
}

function repositoryNames(session: ArenaSessionSummary, checkouts: Map<string, CheckoutSummary>): string {
  if (!session.repositoryCheckoutIds.length) return 'No repository';
  return session.repositoryCheckoutIds.map((checkoutId) => checkouts.get(checkoutId)?.name || 'Repository').join(', ');
}

function SessionFacts({ session, checkouts }: { session: ArenaSessionSummary; checkouts: Map<string, CheckoutSummary> }) {
  return (
    <>
      <strong>{session.title}</strong>
      <span className="arena-card-meta arena-card-agents">{participantNames(session)}</span>
      <span className="arena-card-meta">{repositoryNames(session, checkouts)}</span>
      {session.worktree && <span className="arena-card-meta">Worktree · {checkouts.get(session.repositoryCheckoutIds[0])?.branch || 'branch unavailable'} · Source: {checkouts.get(session.worktree.originCheckoutId)?.name || 'Unavailable source'}</span>}
      {session.execution === 'docker' && <span className="execution-badge execution-docker">Docker</span>}
    </>
  );
}

function AttentionKind({ item }: { item: ArenaAttentionItem }) {
  return (
    <span className={`arena-attention-kind ${item.kind}`}>
      {item.kind === 'permission' || item.kind === 'unavailable' ? 'Needs you' : item.kind === 'failed' ? 'Failed' : 'Finished'}
    </span>
  );
}

function machineTime(machine: ArenaMachineSnapshot): string {
  if (machine.machine.state === 'online') return machine.machine.kind === 'local' ? 'This machine' : 'Online';
  if (!machine.machine.lastSeenAt) return 'Offline · never reached';
  return `Offline · last seen ${new Date(machine.machine.lastSeenAt).toLocaleString()}`;
}

export function Arena({
  machines,
  executionHealth,
  deviceState,
  section,
  refreshError,
  onRefresh,
  onSetDockerEnabled,
  onOpenSession,
  onNewSession,
  onArchiveSession,
  onRestoreSession,
  onDecidePermission,
  onAcknowledge,
}: {
  machines: ArenaMachineSnapshot[];
  deviceState: DeviceArenaState;
  section: ArenaSection;
  refreshError?: string;
  onRefresh(): Promise<void>;
  onOpenSession(machine: ArenaMachineSnapshot, session: ArenaSessionSummary): void;
  executionHealth?: ExecutionHealth;
  onNewSession(): void;
  onArchiveSession(machineId: string, session: ArenaSessionSummary): Promise<boolean>;
  onRestoreSession(machineId: string, session: ArenaSessionSummary): Promise<boolean>;
  onDecidePermission(machineId: string, runId: string, requestId: string, decision: 'allow' | 'deny'): Promise<void>;
  onSetDockerEnabled(enabled: boolean): Promise<void>;
  onAcknowledge(itemIds: string[]): void;
}) {
  const inbox = useMemo(() => buildMultiMachineInbox(machines, deviceState), [deviceState, machines]);
  const unread = unreadArenaAttention(inbox);
  const sessions = machines.flatMap((machine) => machine.sessions);
  const archivedSessions = machines.flatMap((machine) => machine.archivedSessions);
  const onlineMachines = machines.filter((machine) => machine.machine.state === 'online');
  const [savingDocker, setSavingDocker] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dockerError, setDockerError] = useState<string>();
  const docker = executionHealth?.docker;
  const securityLevel = machines.find((machine) => machine.machine.kind === 'local')?.securityLevel || 'guarded';
  const dockerSetupNeeded = Boolean(docker?.enabled && !docker.providers.claude.available);
  const [deciding, setDeciding] = useState<string>();
  const [archiving, setArchiving] = useState<string>();
  const [restoring, setRestoring] = useState<string>();

  // One online machine is simply "here"; naming it on every screen says nothing.
  const offlineMachines = machines.length - onlineMachines.length;
  const showMachines = machines.length > 1 || offlineMachines > 0;
  const now = Date.now();
  const terminalUnreadIds = unread.filter((item) => item.kind !== 'permission').map((item) => item.id);
  const actionKey = (targetMachineId: string, sessionId: string) => `${targetMachineId}:${sessionId}`;

  const refresh = () => {
    setRefreshing(true);
    void onRefresh().finally(() => setRefreshing(false));
  };

  const archive = (targetMachineId: string, session: ArenaSessionSummary) => {
    const key = actionKey(targetMachineId, session.id);
    setArchiving(key);
    void onArchiveSession(targetMachineId, session).finally(() => setArchiving(undefined));
  };

  const restore = (targetMachineId: string, session: ArenaSessionSummary) => {
    const key = actionKey(targetMachineId, session.id);
    setRestoring(key);
    void onRestoreSession(targetMachineId, session).finally(() => setRestoring(undefined));
  };

  return (
    <main className="arena" aria-label="Arena">
      <header className="arena-heading">
        <div>
          <h1>Arena</h1>
          {showMachines && <span>{machines.length} machines{offlineMachines ? `, ${offlineMachines} offline` : ''}</span>}
        </div>
        <div className="arena-heading-actions">
          <button type="button" disabled={savingDocker || refreshing} onClick={refresh}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
          <button type="button" className="arena-primary" disabled={!onlineMachines.length} onClick={onNewSession}>
            New session
          </button>
        </div>
      </header>

      <section className="arena-docker-settings" aria-label="Security level">
        <div className="arena-docker-setting"><strong>Security level</strong></div>
        <p>{securityLevel === 'native' ? 'Native — Local Claude and Codex write with your own setup' : 'Guarded — CodeAI sets the rules for Local turns'}</p>
        <p>Set <code>CODEAI_SECURITY_LEVEL</code> on this computer and restart CodeAI to change it.</p>
      </section>
      {docker && (
        <section className="arena-docker-settings" aria-label="Docker execution">
          <div className="arena-docker-setting">
            <div>
              <strong>Docker execution</strong>
              <span role="status">{savingDocker ? 'Saving…' : !docker.enabled ? 'Off'
                : docker.providers.claude.available ? 'Ready' : 'Setup needed'}</span>
            </div>
            <label>
              <input type="checkbox" checked={docker.enabled} disabled={savingDocker || refreshing} onChange={(event) => {
                setSavingDocker(true);
                setDockerError(undefined);
                void onSetDockerEnabled(event.target.checked).catch((error: unknown) => {
                  setDockerError(error instanceof Error ? error.message : 'Could not save Docker settings.');
                }).finally(() => setSavingDocker(false));
              }} />
              Enable Docker
            </label>
          </div>
          {docker.enabled && docker.providers.claude.available && <DockerVersions onSwitched={refresh} />}
          {dockerSetupNeeded && (
            <div className="arena-docker-setup">
              <p>{docker.providers.claude.message}</p>
              <p>Start Docker, then run <code>npm run docker:provision</code> in your installed CodeAI directory for first-time setup.</p>
              <button type="button" disabled={savingDocker || refreshing} onClick={refresh}>{refreshing ? 'Checking…' : 'Check again'}</button>
            </div>
          )}
          {/* Open while setup is unfinished; one row once Docker is ready or off. */}
          <details className="arena-docker-setup" open={dockerSetupNeeded}>
            <summary>Setup and sign-in</summary>
            <p>Make Docker available for new sessions on this machine. Local remains the default.</p>
            <p>Sign in once for each provider you use: <code>npm run docker:login -- claude</code> or <code>npm run docker:login -- codex</code>.</p>
            <p>New Docker conversations share that provider’s login, settings and history in persistent Docker storage. Your host provider setup stays separate, apart from what Global instructions passes on.</p>
          </details>
          {dockerError && <p role="alert">{dockerError}</p>}
        </section>
      )}

      <GlobalInstructions dockerEnabled={docker?.enabled} securityLevel={securityLevel} refreshing={refreshing} onChanged={refresh} />

      {refreshError && (
        <div className="arena-refresh-error" role="status">
          <span>{refreshError} Showing the last good overview.</span>
          <button type="button" disabled={savingDocker || refreshing} onClick={refresh}>Try again</button>
        </div>
      )}

      <div className="arena-sections" role="tablist" aria-label="Arena views">
        <Link href={ARENA_SECTION_PATHS.sessions} scroll={false} role="tab" aria-selected={section === 'sessions'}>
          Active <span>{sessions.length}</span>
        </Link>
        <Link href={ARENA_SECTION_PATHS.inbox} scroll={false} role="tab" aria-selected={section === 'inbox'}>
          Inbox {unread.length > 0 && <span className="arena-count">{unread.length}</span>}
        </Link>
        <Link href={ARENA_SECTION_PATHS.archived} scroll={false} role="tab" aria-selected={section === 'archived'}>
          Archived <span>{archivedSessions.length}</span>
        </Link>
      </div>

      {section === 'sessions' ? (
        <div className="arena-groups" role="tabpanel">
          {!sessions.length && <div className="arena-empty"><h2>No active sessions</h2><p>Start a new session when you are ready.</p></div>}
          {machines.map((machine) => {
            const online = machine.machine.state === 'online';
            const groups = groupArenaSessions(machine.projects, machine.sessions, machine.runs, online, machine.snapshotFresh !== false);
            const checkoutById = new Map(machine.checkouts.map((checkout) => [checkout.id, checkout]));
            return (
              <section className={`arena-machine ${online ? 'online' : 'offline'} ${showMachines ? '' : 'solo'}`} aria-label={machine.machine.label} key={machine.machine.id}>
                {showMachines && (
                  <header className="arena-machine-heading">
                    <div><h2>{machine.machine.label}</h2><span>{machineTime(machine)}</span></div>
                    <span className={`arena-machine-state ${machine.machine.state}`}>{online ? 'Online' : 'Offline'}</span>
                  </header>
                )}
                {!groups.length && <div className="arena-machine-empty">No active sessions on this machine.</div>}
                {groups.map((group) => (
                  <section className="arena-group" aria-labelledby={`arena-project-${machine.machine.id}-${group.id}`} key={group.id}>
                    <header><div><h3 id={`arena-project-${machine.machine.id}-${group.id}`}>{group.name}</h3><span>{group.sessions.length} {group.sessions.length === 1 ? 'session' : 'sessions'}</span></div></header>
                    <div className="arena-card-grid">
                      {group.sessions.map((card) => {
                        const attention = unread.filter((item) => item.machineId === machine.machine.id && item.sessionId === card.session.id).length;
                        const key = actionKey(machine.machine.id, card.session.id);
                        return (
                          <article className={`arena-card state-${card.state}`} key={card.session.id}>
                            <button className="arena-card-open" type="button" disabled={!online} onClick={() => onOpenSession(machine, card.session)} aria-label={`Open ${card.session.title}`}>
                              <span className={`arena-state state-${card.state}`}><i aria-hidden="true" />{STATE_LABELS[card.state]}</span>
                              <SessionFacts session={card.session} checkouts={checkoutById} />
                              {/* "Idle" already says a finished turn finished. */}
                              {!(card.state === 'idle' && card.session.lastActivity?.status === 'complete') && <span className="arena-card-activity">{card.activity}</span>}
                              {attention > 0 && <span className="arena-card-attention">{attention} unread</span>}
                              <span className="arena-card-time">{relativeActivityTime(card.session.updatedAt, now)}</span>
                            </button>
                            <details className="arena-card-menu">
                              <summary aria-label={`Actions for ${card.session.title}`}>•••</summary>
                              <div><button type="button" disabled={!online || Boolean(card.run) || archiving === key} title={!online ? 'This execution machine is offline.' : card.run ? 'Wait for the current turn to finish before archiving.' : undefined} onClick={() => archive(machine.machine.id, card.session)}>{archiving === key ? 'Archiving…' : 'Archive session'}</button></div>
                            </details>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </section>
            );
          })}
        </div>
      ) : section === 'inbox' ? (
        <section className="arena-inbox" role="tabpanel" aria-label="Inbox">
          <header><div><h2>Inbox</h2><p>Permissions interrupt; finished work waits quietly until you read it.</p></div><button type="button" disabled={!terminalUnreadIds.length} onClick={() => onAcknowledge(terminalUnreadIds)}>Mark all read</button></header>
          {!inbox.length && <div className="arena-empty"><h3>Nothing needs your attention</h3><p>Running and idle sessions stay quiet.</p></div>}
          <div className="arena-inbox-list">
            {inbox.map((item) => {
              const machine = machines.find((entry) => entry.machine.id === item.machineId);
              const target = machine?.sessions.find((session) => session.id === item.sessionId);
              const active = machine?.runs.active.find((run) => run.sessionId === item.sessionId);
              const key = `${item.machineId}:${item.id}`;
              return (
                <article className={`arena-inbox-item ${item.read ? 'read' : ''}`} key={key}>
                  <AttentionKind item={item} />
                  <div><strong>{item.sessionTitle}</strong><small>{item.projectName} · {item.machineLabel} · {new Date(item.createdAt).toLocaleString()}</small><p>{item.reason}</p></div>
                  <div className="arena-inbox-actions">
                    {item.kind === 'permission' && item.runId && item.requestId && item.machineId ? (
                      <>
                        <button type="button" disabled={!item.machineOnline || deciding === key} onClick={() => { setDeciding(key); void onDecidePermission(item.machineId!, item.runId!, item.requestId!, 'deny').finally(() => setDeciding(undefined)); }}>Deny</button>
                        <button type="button" className="arena-primary" disabled={!item.machineOnline || deciding === key} onClick={() => { setDeciding(key); void onDecidePermission(item.machineId!, item.runId!, item.requestId!, 'allow').finally(() => setDeciding(undefined)); }}>Allow</button>
                      </>
                    ) : !item.read ? <button type="button" onClick={() => onAcknowledge([item.id])}>Mark read</button> : null}
                    {item.kind !== 'permission' && target && machine && <button type="button" disabled={!item.machineOnline || Boolean(active) || archiving === actionKey(machine.machine.id, item.sessionId)} onClick={() => archive(machine.machine.id, target)}>Archive</button>}
                    <button type="button" disabled={!item.machineOnline || !machine || !target} onClick={() => { if (item.kind !== 'permission' && !item.read) onAcknowledge([item.id]); if (machine && target) onOpenSession(machine, target); }}>Open session</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <div className="arena-groups" role="tabpanel">
          {!archivedSessions.length && <div className="arena-empty"><h2>No archived sessions</h2><p>Archived work stays recoverable here until permanent cleanup is added.</p></div>}
          {machines.map((machine) => {
            const online = machine.machine.state === 'online';
            const groups = groupArenaSessions(machine.projects, machine.archivedSessions, { active: [], recent: [] }, online);
            const checkoutById = new Map(machine.checkouts.map((checkout) => [checkout.id, checkout]));
            if (!groups.length) return null;
            return (
              <section className={`arena-machine ${online ? 'online' : 'offline'} ${showMachines ? '' : 'solo'}`} aria-label={machine.machine.label} key={machine.machine.id}>
                {showMachines && <header className="arena-machine-heading"><div><h2>{machine.machine.label}</h2><span>{machineTime(machine)}</span></div><span className={`arena-machine-state ${machine.machine.state}`}>{online ? 'Online' : 'Offline'}</span></header>}
                {groups.map((group) => (
                  <section className="arena-group" aria-labelledby={`arena-archive-project-${machine.machine.id}-${group.id}`} key={group.id}>
                    <header><div><h3 id={`arena-archive-project-${machine.machine.id}-${group.id}`}>{group.name}</h3><span>{group.sessions.length} archived</span></div></header>
                    <div className="arena-card-grid">
                      {group.sessions.map((card) => {
                        const key = actionKey(machine.machine.id, card.session.id);
                        return (
                          <article className="arena-card archived" key={card.session.id}>
                            <div className="arena-card-content">
                              <span className={`arena-state ${online ? 'state-archived' : 'state-offline'}`}><i aria-hidden="true" />{online ? 'Archived' : 'Offline'}</span>
                              <SessionFacts session={card.session} checkouts={checkoutById} />
                              <span className="arena-card-time">Archived {new Date(card.session.archivedAt || card.session.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                            </div>
                            <div className="arena-card-restore"><button type="button" disabled={!online || restoring === key} onClick={() => restore(machine.machine.id, card.session)}>{restoring === key ? 'Restoring…' : 'Restore'}</button></div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
