'use client';

import { useEffect, useMemo, useState } from 'react';
import { AGENT_MODE_LABELS } from '@/features/agents/toolActivity';
import { PROVIDER_LABELS } from '@/shared/participants';
import type {
  AgentMode, AgentProvider, ArenaSessionSummary, CheckoutSummary, DurableProject, ProviderHealth,
  RunDiscovery,
} from '@/shared/types';
import {
  buildArenaInbox, groupArenaSessions, unreadArenaAttention,
  type ArenaAttentionItem, type DeviceArenaState,
} from './arenaModel';

export type ArenaSection = 'sessions' | 'inbox';

const STATE_LABELS = {
  idle: 'Idle',
  running: 'Running',
  'needs-you': 'Needs you',
  queued: 'Queued',
  failed: 'Failed',
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

export function Arena({
  projects,
  sessions,
  discovery,
  checkouts,
  hostLabel,
  providerHealth,
  deviceState,
  section,
  refreshError,
  onSection,
  onRefresh,
  onOpenSession,
  onCreateSession,
  onDecidePermission,
  onAcknowledge,
}: {
  projects: DurableProject[];
  sessions: ArenaSessionSummary[];
  discovery: RunDiscovery;
  checkouts: CheckoutSummary[];
  hostLabel: string;
  providerHealth: Record<AgentProvider, ProviderHealth>;
  deviceState: DeviceArenaState;
  section: ArenaSection;
  refreshError?: string;
  onSection(section: ArenaSection): void;
  onRefresh(): void;
  onOpenSession(session: ArenaSessionSummary): void;
  onCreateSession(input: { projectId?: string; provider: AgentProvider; mode: AgentMode }): Promise<boolean>;
  onDecidePermission(runId: string, requestId: string, decision: 'allow' | 'deny'): Promise<void>;
  onAcknowledge(itemIds: string[]): void;
}) {
  const groups = useMemo(() => groupArenaSessions(projects, sessions, discovery), [discovery, projects, sessions]);
  const inbox = useMemo(
    () => buildArenaInbox(projects, sessions, discovery, deviceState),
    [deviceState, discovery, projects, sessions],
  );
  const unread = unreadArenaAttention(inbox);
  const checkoutById = useMemo(() => new Map(checkouts.map((checkout) => [checkout.id, checkout])), [checkouts]);
  const availableProviders = (Object.keys(providerHealth) as AgentProvider[])
    .filter((provider) => providerHealth[provider].available && providerHealth[provider].supportedModes.length);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [projectId, setProjectId] = useState(projects[0]?.id || 'none');
  const [provider, setProvider] = useState<AgentProvider>(availableProviders[0] || 'claude');
  const supportedModes = providerHealth[provider]?.supportedModes || [];
  const [mode, setMode] = useState<AgentMode>(supportedModes[0] || 'ask');
  const [deciding, setDeciding] = useState<string>();

  useEffect(() => {
    if (projectId !== 'none' && !projects.some((project) => project.id === projectId)) {
      setProjectId(projects[0]?.id || 'none');
    }
  }, [projectId, projects]);

  useEffect(() => {
    if (!availableProviders.includes(provider)) setProvider(availableProviders[0] || 'claude');
  }, [availableProviders, provider]);

  useEffect(() => {
    const availableModes = providerHealth[provider]?.supportedModes || [];
    if (!availableModes.includes(mode)) setMode(availableModes[0] || 'ask');
  }, [mode, provider, providerHealth]);

  const terminalUnreadIds = unread.filter((item) => item.kind !== 'permission').map((item) => item.id);

  return (
    <main className="arena" aria-label="Arena">
      <header className="arena-heading">
        <div>
          <span className="eyebrow">This machine · {hostLabel}</span>
          <h1>Your arena</h1>
          <p>See every local session, answer what is blocked, and start the next piece of work.</p>
        </div>
        <div className="arena-heading-actions">
          <button type="button" onClick={onRefresh}>Refresh</button>
          <button type="button" className="arena-primary" disabled={!availableProviders.length} onClick={() => setShowCreate(true)}>
            New session
          </button>
        </div>
      </header>

      {refreshError && (
        <div className="arena-refresh-error" role="status">
          <span>{refreshError} Showing the last good overview.</span>
          <button type="button" onClick={onRefresh}>Try again</button>
        </div>
      )}

      <div className="arena-sections" role="tablist" aria-label="Arena views">
        <button type="button" role="tab" aria-selected={section === 'sessions'} onClick={() => onSection('sessions')}>
          Sessions <span>{sessions.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={section === 'inbox'} onClick={() => onSection('inbox')}>
          Inbox {unread.length > 0 && <span className="arena-count">{unread.length}</span>}
        </button>
      </div>

      {showCreate && (
        <section className="arena-create" aria-label="Create session">
          <div>
            <span className="eyebrow">Start work</span>
            <h2>New session</h2>
          </div>
          <label>
            <span>Project</span>
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="none">No project</option>
              {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
            </select>
          </label>
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
              disabled={creating || !availableProviders.includes(provider) || !supportedModes.includes(mode)}
              onClick={() => {
                setCreating(true);
                void onCreateSession({
                  ...(projectId === 'none' ? {} : { projectId }),
                  provider,
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
          {!groups.length && (
            <div className="arena-empty">
              <h2>No projects or sessions yet</h2>
              <p>Create a repository-free session or add a project when you are ready.</p>
            </div>
          )}
          {groups.map((group) => (
            <section className="arena-group" aria-labelledby={`arena-project-${group.id}`} key={group.id}>
              <header>
                <div>
                  <h2 id={`arena-project-${group.id}`}>{group.name}</h2>
                  <span>{group.sessions.length} {group.sessions.length === 1 ? 'session' : 'sessions'}</span>
                </div>
              </header>
              <div className="arena-card-grid">
                {group.sessions.map((card) => {
                  const attention = unread.filter((item) => item.sessionId === card.session.id).length;
                  return (
                    <article className={`arena-card state-${card.state}`} key={card.session.id}>
                      <button type="button" onClick={() => onOpenSession(card.session)} aria-label={`Open ${card.session.title}`}>
                        <span className={`arena-state state-${card.state}`}><i aria-hidden="true" />{STATE_LABELS[card.state]}</span>
                        <strong>{card.session.title}</strong>
                        <span className="arena-card-activity">{card.activity}</span>
                        <span className="arena-card-meta"><b>Agents</b>{participantNames(card.session)}</span>
                        <span className="arena-card-meta"><b>Repositories</b>{repositoryNames(card.session, checkoutById)}</span>
                        <span className="arena-card-footer">
                          <span>{hostLabel}</span>
                          {attention > 0 && <span className="arena-card-attention">{attention} unread</span>}
                        </span>
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <section className="arena-inbox" role="tabpanel" aria-label="Inbox">
          <header>
            <div>
              <h2>Inbox</h2>
              <p>Permissions interrupt; finished work waits quietly until you read it.</p>
            </div>
            <button type="button" disabled={!terminalUnreadIds.length} onClick={() => onAcknowledge(terminalUnreadIds)}>
              Mark all read
            </button>
          </header>
          {!inbox.length && <div className="arena-empty"><h3>Nothing needs your attention</h3><p>Running and idle sessions stay quiet.</p></div>}
          <div className="arena-inbox-list">
            {inbox.map((item) => (
              <article className={`arena-inbox-item ${item.read ? 'read' : ''}`} key={item.id}>
                <AttentionKind item={item} />
                <div>
                  <strong>{item.sessionTitle}</strong>
                  <small>{item.projectName} · {new Date(item.createdAt).toLocaleString()}</small>
                  <p>{item.reason}</p>
                </div>
                <div className="arena-inbox-actions">
                  {item.kind === 'permission' && item.runId && item.requestId ? (
                    <>
                      <button type="button" disabled={deciding === item.id} onClick={() => {
                        setDeciding(item.id);
                        void onDecidePermission(item.runId!, item.requestId!, 'deny').finally(() => setDeciding(undefined));
                      }}>Deny</button>
                      <button type="button" className="arena-primary" disabled={deciding === item.id} onClick={() => {
                        setDeciding(item.id);
                        void onDecidePermission(item.runId!, item.requestId!, 'allow').finally(() => setDeciding(undefined));
                      }}>Allow</button>
                    </>
                  ) : !item.read ? (
                    <button type="button" onClick={() => onAcknowledge([item.id])}>Mark read</button>
                  ) : null}
                  <button type="button" onClick={() => {
                    if (item.kind !== 'permission' && !item.read) onAcknowledge([item.id]);
                    onOpenSession(sessions.find((session) => session.id === item.sessionId)!);
                  }}>Open session</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
