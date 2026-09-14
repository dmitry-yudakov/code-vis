'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AGENT_MODE_LABELS } from '@/features/agents/toolActivity';
import { PROVIDER_LABELS } from '@/shared/participants';
import type {
  AgentExecution, AgentMode, AgentProvider, ArenaMachineSnapshot, ArenaSessionSummary, CheckoutSummary,
  ExecutionHealth,
} from '@/shared/types';
import {
  buildMultiMachineInbox, groupArenaSessions, unreadArenaAttention,
  type ArenaAttentionItem, type DeviceArenaState,
} from './arenaModel';
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
  if (!session.repositoryCheckoutIds.length) return 'No repositories';
  return session.repositoryCheckoutIds.map((checkoutId) => checkouts.get(checkoutId)?.name || 'Repository').join(', ');
}

function AttentionKind({ item }: { item: ArenaAttentionItem }) {
  return (
    <span className={`arena-attention-kind ${item.kind}`}>
      {item.kind === 'permission' ? 'Needs you' : item.kind === 'failed' ? 'Failed' : 'Finished'}
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
  onCreateSession,
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
  onCreateSession(input: { machineId: string; projectId?: string; checkoutId?: string; execution: AgentExecution; provider: AgentProvider; mode: AgentMode }): Promise<boolean>;
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
  const [machineId, setMachineId] = useState(onlineMachines[0]?.machine.id || '');
  const selectedMachine = machines.find((machine) => machine.machine.id === machineId && machine.machine.state === 'online')
    || onlineMachines[0];
  const [execution, setExecution] = useState<AgentExecution>('local');
  const [savingDocker, setSavingDocker] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dockerError, setDockerError] = useState<string>();
  const docker = executionHealth?.docker;
  const dockerAvailableForSelected = selectedMachine?.machine.kind === 'local' && docker?.enabled;
  const [checkoutId, setCheckoutId] = useState(selectedMachine?.checkouts[0]?.id || '');
  const selectedHealth = selectedMachine?.machine.kind === 'local'
    ? executionHealth?.[execution].providers || selectedMachine.providers
    : selectedMachine?.providers;
  const availableProviders = selectedHealth ? (Object.keys(selectedHealth) as AgentProvider[])
    .filter((provider) => selectedHealth[provider].available && selectedHealth[provider].supportedModes.length) : [];
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [projectId, setProjectId] = useState(selectedMachine?.projects[0]?.id || 'none');
  const bindings = selectedMachine?.projects.find((project) => project.id === projectId)?.repositories || [];
  const invalidDockerBinding = execution === 'docker' && (projectId === 'none' ? !checkoutId
    : bindings.length !== 1 || bindings[0].role !== 'primary' || bindings[0].hostId !== selectedMachine?.machine.id);
  const [provider, setProvider] = useState<AgentProvider>(availableProviders[0] || 'claude');
  const supportedModes = selectedHealth?.[provider]?.supportedModes || [];
  const [mode, setMode] = useState<AgentMode>(supportedModes[0] || 'ask');
  const [deciding, setDeciding] = useState<string>();
  const [archiving, setArchiving] = useState<string>();
  const [restoring, setRestoring] = useState<string>();

  useEffect(() => {
    if (!selectedMachine) return;
    if (machineId !== selectedMachine.machine.id) setMachineId(selectedMachine.machine.id);
  }, [machineId, selectedMachine]);

  useEffect(() => {
    if (!selectedMachine) return;
    if (projectId !== 'none' && !selectedMachine.projects.some((project) => project.id === projectId)) {
      setProjectId(selectedMachine.projects[0]?.id || 'none');
    }
  }, [projectId, selectedMachine]);

  useEffect(() => {
    if (!dockerAvailableForSelected) setExecution('local');
  }, [dockerAvailableForSelected]);

  useEffect(() => {
    if (!availableProviders.includes(provider)) setProvider(availableProviders[0] || 'claude');
  }, [availableProviders, provider]);

  useEffect(() => {
    const availableModes = selectedHealth?.[provider]?.supportedModes || [];
    if (!availableModes.includes(mode)) setMode(availableModes[0] || 'ask');
  }, [mode, provider, selectedHealth]);

  const terminalUnreadIds = unread.filter((item) => item.kind !== 'permission').map((item) => item.id);
  const actionKey = (targetMachineId: string, sessionId: string) => `${targetMachineId}:${sessionId}`;

  const refresh = () => {
    setRefreshing(true);
    void onRefresh().finally(() => setRefreshing(false));
  };

  const archive = (targetMachineId: string, session: ArenaSessionSummary) => {
    if (!window.confirm(`Archive “${session.title}”? You can restore it later from Archived.`)) return;
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
          <span className="eyebrow">
            {machines.length} {machines.length === 1 ? 'machine' : 'machines'}
            {machines.some((machine) => machine.machine.state === 'offline') ? ` · ${machines.filter((machine) => machine.machine.state === 'offline').length} offline` : ''}
          </span>
          <h1>Your arena</h1>
          <p>See every session across your execution machines, answer what is blocked, and start the next piece of work.</p>
        </div>
        <div className="arena-heading-actions">
          <button type="button" disabled={savingDocker || refreshing} onClick={refresh}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
          <button type="button" className="arena-primary" disabled={!onlineMachines.length} onClick={() => setShowCreate(true)}>
            New session
          </button>
        </div>
      </header>

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
          <p>Make Docker available for new sessions on this machine. Local remains the default.</p>
          {docker.enabled && !docker.providers.claude.available && (
            <div className="arena-docker-setup">
              <p>{docker.providers.claude.message}</p>
              <p>Start Docker, then run <code>npm run docker:provision</code> in your installed CodeAI directory for first-time setup.</p>
              <button type="button" disabled={savingDocker || refreshing} onClick={refresh}>{refreshing ? 'Checking…' : 'Check again'}</button>
            </div>
          )}
          {docker.enabled && (
            <div className="arena-docker-setup">
              <p>Sign in once for each provider you use: <code>npm run docker:login -- claude</code> or <code>npm run docker:login -- codex</code>.</p>
              <p>New Docker conversations share that provider’s login, settings and history in persistent Docker storage. Your host provider setup stays separate.</p>
            </div>
          )}
          {dockerError && <p role="alert">{dockerError}</p>}
        </section>
      )}

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

      {showCreate && selectedMachine && (
        <section className="arena-create" aria-label="Create session">
          <div>
            <span className="eyebrow">Start work</span>
          <h2>New session</h2>
          </div>
          {dockerAvailableForSelected && (
            <label>
              <span>Execution</span>
              <select value={execution} onChange={(event) => setExecution(event.target.value as AgentExecution)}>
                <option value="local">Local</option>
                <option value="docker">Docker</option>
              </select>
            </label>
          )}
          {execution === 'docker' && (
            <p>Agent edits this repository directly and runs commands without individual approvals. Mounted files, including ignored files, are accessible.</p>
          )}
          <label>
            <span>Machine</span>
            <select value={selectedMachine.machine.id} onChange={(event) => {
              const next = machines.find((machine) => machine.machine.id === event.target.value);
              setMachineId(event.target.value);
              setProjectId(next?.projects[0]?.id || 'none');
              setCheckoutId(next?.checkouts[0]?.id || '');
              setExecution('local');
            }}>
              {onlineMachines.map((machine) => (
                <option value={machine.machine.id} key={machine.machine.id}>{machine.machine.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Project</span>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="none">No project</option>
              {selectedMachine.projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
            </select>
          </label>
          {execution === 'docker' && projectId === 'none' && (
            <label>
              <span>Repository</span>
              <select value={checkoutId} onChange={(event) => setCheckoutId(event.target.value)}>
                <option value="">Choose one repository</option>
                {selectedMachine.checkouts.map((checkout) => <option key={checkout.id} value={checkout.id}>{checkout.name}</option>)}
              </select>
            </label>
          )}
          {execution === 'docker' && !availableProviders.length && <p role="status">{selectedHealth?.claude.message}</p>}
          {invalidDockerBinding && <p role="status">Docker requires exactly one primary repository on this machine. Select a repository or a project with that binding.</p>}
          <label>
            <span>Provider</span>
            <select value={availableProviders.includes(provider) ? provider : ''} disabled={!availableProviders.length} onChange={(event) => setProvider(event.target.value as AgentProvider)}>
              {!availableProviders.length && <option value="">No provider available</option>}
              {availableProviders.map((value) => <option value={value} key={value}>{PROVIDER_LABELS[value]}</option>)}
            </select>
          </label>
          <fieldset>
            <legend>Mode</legend>
            <div className="arena-mode-options">
              {(['ask', 'plan', 'agent'] as AgentMode[]).map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="arena-new-session-mode"
                    value={value}
                    checked={mode === value}
                    disabled={!supportedModes.includes(value)}
                    onChange={() => setMode(value)}
                  />
                  <span>{AGENT_MODE_LABELS[value]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="arena-create-actions">
            <button type="button" onClick={() => setShowCreate(false)}>Cancel</button>
            <button
              type="button"
              className="arena-primary"
              disabled={creating || !availableProviders.includes(provider) || !supportedModes.includes(mode)
                || invalidDockerBinding}
              onClick={() => {
                setCreating(true);
                void onCreateSession({
                  machineId: selectedMachine.machine.id,
                  ...(projectId === 'none' ? {} : { projectId }),
                  provider,
                  execution,
                  ...(execution === 'docker' && projectId === 'none' ? { checkoutId } : {}),
                  mode,
                }).then((created) => { if (created) setShowCreate(false); }).finally(() => setCreating(false));
              }}
            >
              {creating ? 'Creating…' : 'Create and open'}
            </button>
          </div>
        </section>
      )}

      {section === 'sessions' ? (
        <div className="arena-groups" role="tabpanel">
          {!sessions.length && <div className="arena-empty"><h2>No active sessions</h2><p>Start a new session when you are ready.</p></div>}
          {machines.map((machine) => {
            const online = machine.machine.state === 'online';
            const groups = groupArenaSessions(machine.projects, machine.sessions, machine.runs, online);
            const checkoutById = new Map(machine.checkouts.map((checkout) => [checkout.id, checkout]));
            return (
              <section className={`arena-machine ${online ? 'online' : 'offline'}`} aria-labelledby={`arena-machine-${machine.machine.id}`} key={machine.machine.id}>
                <header className="arena-machine-heading">
                  <div><h2 id={`arena-machine-${machine.machine.id}`}>{machine.machine.label}</h2><span>{machineTime(machine)}</span></div>
                  <span className={`arena-machine-state ${machine.machine.state}`}>{online ? 'Online' : 'Offline'}</span>
                </header>
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
                              <strong>{card.session.title}</strong>
                              <span className="arena-card-activity">{card.activity}</span>
                              <span className="arena-card-meta"><b>Agents</b>{participantNames(card.session)}</span>
                              <span className="arena-card-meta"><b>Repositories</b>{repositoryNames(card.session, checkoutById)}</span>
                              <span className="arena-card-footer"><span>{machine.machine.label} · {card.session.execution === 'docker' ? 'Docker' : 'Local'}</span>{attention > 0 && <span className="arena-card-attention">{attention} unread</span>}</span>
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
              <section className={`arena-machine ${online ? 'online' : 'offline'}`} aria-labelledby={`arena-archive-machine-${machine.machine.id}`} key={machine.machine.id}>
                <header className="arena-machine-heading"><div><h2 id={`arena-archive-machine-${machine.machine.id}`}>{machine.machine.label}</h2><span>{machineTime(machine)}</span></div><span className={`arena-machine-state ${machine.machine.state}`}>{online ? 'Online' : 'Offline'}</span></header>
                {groups.map((group) => (
                  <section className="arena-group" aria-labelledby={`arena-archive-project-${machine.machine.id}-${group.id}`} key={group.id}>
                    <header><div><h3 id={`arena-archive-project-${machine.machine.id}-${group.id}`}>{group.name}</h3><span>{group.sessions.length} archived</span></div></header>
                    <div className="arena-card-grid">
                      {group.sessions.map((card) => {
                        const key = actionKey(machine.machine.id, card.session.id);
                        return (
                          <article className="arena-card archived" key={card.session.id}>
                            <div className="arena-card-content"><span className={`arena-state ${online ? 'state-archived' : 'state-offline'}`}><i aria-hidden="true" />{online ? 'Archived' : 'Offline'}</span><strong>{card.session.title}</strong><span className="arena-card-activity">Archived {new Date(card.session.archivedAt || card.session.updatedAt).toLocaleString()}</span><span className="arena-card-meta"><b>Agents</b>{participantNames(card.session)}</span><span className="arena-card-meta"><b>Repositories</b>{repositoryNames(card.session, checkoutById)}</span><span className="arena-card-footer"><span>{machine.machine.label} · {card.session.execution === 'docker' ? 'Docker' : 'Local'}</span></span></div>
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
