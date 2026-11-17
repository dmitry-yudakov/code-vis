'use client';

import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import Alert from '@mui/material/Alert';

import Link from 'next/link';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Paper from '@mui/material/Paper';
import Chip from '@mui/material/Chip';
import ListItemButton from '@mui/material/ListItemButton';
import Tooltip from '@mui/material/Tooltip';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import useMediaQuery from '@mui/material/useMediaQuery';
import { ShellIcon } from '@/features/shell/ShellIcon';
import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { relativeActivityTime } from '@/features/shell/immersive/conversationListModel';
import type {
  ArenaMachineSnapshot, ArenaSessionSummary, CheckoutSummary,
  DurableProject,
} from '@/shared/types';
import {
  ARENA_ARCHIVE_PAGE_SIZE, buildMultiMachineInbox, groupArenaSessions, groupArchivedArenaSessions, unreadArenaAttention,
  type ArenaActiveOrder, type ArenaAttentionItem, type DeviceArenaState,
} from './arenaModel';
import { SecurityLevelNotice } from './SecurityLevelNotice';
import { ARENA_SECTION_PATHS, type ArenaSection } from './routes';
import { ProjectLogoButton } from '@/features/projects/ProjectLogo';
import { machineApiBase } from '@/features/machines/routes';
import { workspaceHref } from '@/features/shell/workspaceLocation';
import { ContextUsage, contextUsageLabel } from '@/features/agents/ContextUsage';
import { ArenaTileBody } from './ArenaTileBody';
import { useArenaNow } from './useArenaNow';
import type { ArenaReplyOptions, useArenaReplies } from './useArenaReplies';

const LAYOUT_KEY = 'code-ai:device:arena-layout';

const STATE_LABELS = {
  idle: 'Idle',
  ready: 'Ready',
  running: 'Running',
  'needs-you': 'Needs you',
  queued: 'Queued',
  failed: 'Failed',
  offline: 'Offline',
} as const;

function repositoryNames(checkoutIds: readonly string[], checkouts: Map<string, CheckoutSummary>): string {
  if (!checkoutIds.length) return 'No repository';
  return checkoutIds.map((checkoutId) => checkouts.get(checkoutId)?.name || 'Repository').join(', ');
}

function SessionFacts({ session, checkouts, inLink = false, showTitle = true, showRepository = true }: {
  session: ArenaSessionSummary; checkouts: Map<string, CheckoutSummary>; inLink?: boolean; showTitle?: boolean; showRepository?: boolean;
}) {
  return (
    <>
      {showTitle && <strong>{session.title}</strong>}
      <span className="arena-card-meta arena-card-agents">{session.agents.length ? session.agents.map(agent => <span key={agent.id} className="arena-card-agent">
        <span>{agent.displayName}</span><ContextUsage name={agent.displayName} usage={agent.contextUsage} focusable={!inLink} />
      </span>) : 'No agent'}</span>
      {showRepository && <span className="arena-card-meta">{repositoryNames(session.repositoryCheckoutIds, checkouts)}</span>}
      {session.worktree && <span className="arena-card-meta">Worktree · {checkouts.get(session.repositoryCheckoutIds[0])?.branch || 'branch unavailable'} · Source: {checkouts.get(session.worktree.originCheckoutId)?.name || 'Unavailable source'}</span>}
      {session.execution === 'docker' && <Chip component="span" className="execution-badge" variant="outlined" label="Docker" />}
    </>
  );
}

function AttentionKind({ item, id }: { item: ArenaAttentionItem; id: string }) {
  return (
    <Chip component="span" id={id} className={`arena-attention-kind ${item.kind}`} variant="outlined"
      color={item.kind === 'permission' || item.kind === 'unavailable' ? 'warning' : item.kind === 'failed' ? 'error' : 'success'}
      label={item.kind === 'permission' || item.kind === 'unavailable' ? 'Needs you' : item.kind === 'failed' ? 'Failed' : 'Finished'} />
  );
}

function machineTime(machine: ArenaMachineSnapshot): string {
  if (machine.machine.state === 'online') return machine.machine.kind === 'local' ? 'This machine' : 'Online';
  if (!machine.machine.lastSeenAt) return 'Offline · never reached';
  return `Offline · last seen ${new Date(machine.machine.lastSeenAt).toLocaleString()}`;
}

export function Arena({
  machines,
  activeOrder,
  deviceState,
  section,
  refreshError,
  refreshing,
  onRefresh,
  onOpenSession,
  onNewProjectSession,
  onProjectLogo,
  onArchiveSession,
  onRestoreSession,
  onDecidePermission,
  onAcknowledge,
  replies,
  replyOptions,
}: {
  machines: ArenaMachineSnapshot[];
  activeOrder: ReadonlyMap<string, ArenaActiveOrder>;
  deviceState: DeviceArenaState;
  section: ArenaSection;
  refreshError?: string;
  refreshing: boolean;
  onRefresh(): Promise<void>;
  onOpenSession(machine: ArenaMachineSnapshot, session: ArenaSessionSummary): void;
  onNewProjectSession(machineId: string, projectId?: string): void;
  onProjectLogo(machineId: string, project: DurableProject): void;
  onArchiveSession(machineId: string, session: ArenaSessionSummary): Promise<boolean>;
  onRestoreSession(machineId: string, session: ArenaSessionSummary): Promise<boolean>;
  onDecidePermission(machineId: string, runId: string, requestId: string, decision: 'allow' | 'deny'): Promise<void>;
  onAcknowledge(itemIds: string[]): void;
  replies: ReturnType<typeof useArenaReplies>;
  replyOptions(machine: ArenaMachineSnapshot, session: ArenaSessionSummary): ArenaReplyOptions;
}) {
  const inbox = useMemo(() => buildMultiMachineInbox(machines, deviceState), [deviceState, machines]);
  const unread = unreadArenaAttention(inbox);
  const sessions = machines.flatMap((machine) => machine.sessions);
  const archivedSessions = machines.flatMap((machine) => machine.archivedSessions);
  const onlineMachines = machines.filter((machine) => machine.machine.state === 'online');
  const localMachine = machines.find((machine) => machine.machine.kind === 'local');
  const [deciding, setDeciding] = useState<string>();
  const [archiving, setArchiving] = useState<string>();
  const [restoring, setRestoring] = useState<string>();
  const [archiveLimit, setArchiveLimit] = useState(ARENA_ARCHIVE_PAGE_SIZE);
  const archiveGroups = useMemo(() => section === 'archived' ? groupArchivedArenaSessions(machines, archiveLimit) : [], [machines, archiveLimit, section]);
  const desktop = useMediaQuery('(min-width: 741px)');
  const [layout, setLayout] = useState<'list' | 'tiles'>('list');
  useEffect(() => { try { if (localStorage.getItem(LAYOUT_KEY) === 'tiles') setLayout('tiles'); } catch { /* optional device preference */ } }, []);
  const tiles = desktop && layout === 'tiles';

  // One online machine is simply "here"; naming it on every screen says nothing.
  const offlineMachines = machines.length - onlineMachines.length;
  const showMachines = machines.length > 1 || offlineMachines > 0;
  const now = useArenaNow();
  const terminalUnreadIds = unread.filter((item) => item.kind !== 'permission').map((item) => item.id);
  const actionKey = (targetMachineId: string, sessionId: string) => `${targetMachineId}:${sessionId}`;

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
    <main className={`arena${tiles && section === 'sessions' ? ' arena-project-tiles' : ''}`} aria-label="Arena">
      {localMachine && <SecurityLevelNotice key={`${localMachine.machine.id}:${localMachine.securityLevel}`}
        machineId={localMachine.machine.id} level={localMachine.securityLevel || 'guarded'} />}

      {refreshError && (
        <Alert className="arena-refresh-error" severity="warning" role="status" action={<Button type="button" disabled={refreshing} onClick={() => { void onRefresh(); }}>Try again</Button>}>{refreshError} Showing the last good overview.</Alert>
      )}

      <div className="arena-view-controls">
      <Tabs className="arena-sections" value={section} aria-label="Arena views" variant="scrollable" scrollButtons={false}>
        <Tab component={Link} href={ARENA_SECTION_PATHS.sessions} scroll={false} value="sessions" label={`Active (${sessions.length})`} />
        <Tab component={Link} href={ARENA_SECTION_PATHS.inbox} scroll={false} value="inbox" label={unread.length ? `Inbox (${unread.length})` : 'Inbox'} />
        <Tab component={Link} href={ARENA_SECTION_PATHS.archived} scroll={false} value="archived" label="Archived" />
      </Tabs>
      {desktop && section === 'sessions' && <ToggleButtonGroup exclusive value={layout} aria-label="Session arrangement" onChange={(_, value: 'list' | 'tiles' | null) => {
        if (!value) return;
        setLayout(value);
        try { localStorage.setItem(LAYOUT_KEY, value); } catch { /* optional device preference */ }
      }}>
        <ToggleButton value="list"><ShellIcon name="plan" />List</ToggleButton>
        <ToggleButton value="tiles"><ShellIcon name="arena" />Tiles</ToggleButton>
      </ToggleButtonGroup>}
      </div>

      {section === 'sessions' ? (
        <div className={`arena-groups ${tiles ? 'arena-tiles' : ''}`} role="tabpanel">
          {!sessions.length && !machines.some(machine => machine.projects.length) && <div className="arena-empty"><h2>No active sessions</h2><p>Create a project or start a new session.</p></div>}
          {machines.map((machine) => {
            const online = machine.machine.state === 'online';
            const groups = groupArenaSessions(machine.projects, machine.sessions, machine.runs, online, machine.snapshotFresh !== false, true, activeOrder.get(machine.machine.id), now);
            const checkoutById = new Map(machine.checkouts.map((checkout) => [checkout.id, checkout]));
            return (
              <section className={`arena-machine ${online ? 'online' : 'offline'} ${showMachines ? '' : 'solo'}`} aria-label={machine.machine.label} key={machine.machine.id}>
                {showMachines && (
                  <header className="arena-machine-heading">
                    <div><h2>{machine.machine.label}</h2><span>{machineTime(machine)}</span></div>
                    <Chip component="span" className="arena-machine-state" variant="outlined" color={online ? 'success' : 'default'} label={online ? 'Online' : 'Offline'} />
                  </header>
                )}
                {!groups.length && <div className="arena-machine-empty">No active sessions on this machine.</div>}
                <div className="arena-project-grid">
                {groups.map((group) => {
                  const project = machine.projects.find(project => project.id === group.id);
                  const projectCheckoutIds = project?.repositories.map(binding => binding.checkoutId);
                  return (
                  <Paper component="section" className={`arena-group${group.sessions.length ? '' : ' arena-group-empty'}`} sx={tiles ? undefined : { border: 0, background: 'transparent', borderRadius: 0 }} aria-labelledby={`arena-project-${machine.machine.id}-${group.id}`} key={group.id}>
                    <header>
                      <div><div className="project-logo-name">
                        {project && <ProjectLogoButton project={project} apiBase={machineApiBase(machine.machine.id, localMachine?.machine.id)}
                          disabled={!online} onClick={() => onProjectLogo(machine.machine.id, project)} />}
                        <h3 id={`arena-project-${machine.machine.id}-${group.id}`} aria-label={group.name}>
                        {project ? <ButtonBase component={Link} aria-label={`Open project ${group.name}`}
                          href={workspaceHref({ projectId: project.id, machineId: machine.machine.id }, localMachine?.machine.id)}
                          disabled={!online} sx={{ font: 'inherit', textAlign: 'left', borderRadius: 1 }}>
                          {group.name}
                        </ButtonBase> : group.name}
                        </h3></div><span>{group.sessions.length} {group.sessions.length === 1 ? 'session' : 'sessions'}</span>
                        {projectCheckoutIds && <span className="arena-project-repositories">{repositoryNames(projectCheckoutIds, checkoutById)}</span>}
                      </div>
                      <div className="arena-project-actions">
                      {(group.id === 'none' || project) && <IconButton type="button" disabled={!online}
                        aria-label={`New session in ${group.name}`} title={`New session in ${group.name}`}
                        onClick={() => onNewProjectSession(machine.machine.id, group.id === 'none' ? undefined : group.id)}><ShellIcon name="newChat" /></IconButton>}
                      </div>
                    </header>
                    <div className="arena-card-grid">
                      {group.sessions.map((card) => {
                        const attention = unread.filter((item) => item.machineId === machine.machine.id && item.sessionId === card.session.id).length;
                        const key = actionKey(machine.machine.id, card.session.id);
                        const sharedRepository = projectCheckoutIds && projectCheckoutIds.length === card.session.repositoryCheckoutIds.length
                          && card.session.repositoryCheckoutIds.every(id => projectCheckoutIds.includes(id));
                        const facts = <>
                          <Chip component="span" className={`arena-state state-${card.state}`} variant="outlined" title={card.state === 'ready' ? 'Reply completed within the last hour' : card.activity}
                            color={card.state === 'needs-you' ? 'warning' : card.state === 'running' ? 'info' : card.state === 'ready' ? 'success' : card.state === 'failed' ? 'error' : 'default'} label={STATE_LABELS[card.state]} />
                          <SessionFacts session={card.session} checkouts={checkoutById} inLink={online} showTitle={!tiles} showRepository={!sharedRepository} />
                          {/* The status already conveys completion; tile activity is available on it. */}
                          {!tiles && !(['idle', 'ready'].includes(card.state) && card.session.lastActivity?.status === 'complete') && <span className="arena-card-activity">{card.activity}</span>}
                          {attention > 0 && <span className="arena-card-attention">{attention} unread</span>}
                          <span className="arena-card-time">{relativeActivityTime(card.session.updatedAt, now)}</span>
                        </>;
                        return (
                          <Paper component="article" className={`arena-card state-${card.state}`} key={card.session.id}>
                            <Tooltip describeChild disableHoverListener disableTouchListener disableFocusListener={!online}
                              title={[...(tiles ? [card.activity] : []), ...card.session.agents.map(agent => contextUsageLabel(agent.displayName, agent.contextUsage))].join('; ')}>
                              <ListItemButton component={online ? Link : 'div'} prefetch={online ? false : undefined}
                                href={online ? workspaceHref({ sessionId: card.session.id, machineId: machine.machine.id }, localMachine?.machine.id) : undefined}
                                sx={{ flexWrap: 'wrap' }} className="arena-card-open" disabled={!online}
                                onKeyDown={(event: KeyboardEvent<HTMLElement>) => { if (event.key === ' ' && online) { event.preventDefault(); event.currentTarget.click(); } }}
                                onClick={(event: MouseEvent<HTMLElement>) => {
                                  if (!online) { event.preventDefault(); return; }
                                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                                  event.preventDefault();
                                  onOpenSession(machine, card.session);
                                }} aria-label={`Open ${card.session.title}`}>
                                {tiles && <strong title={card.session.title}>{card.session.title}</strong>}
                                {tiles ? <span className="arena-card-status">{facts}</span> : facts}
                              </ListItemButton>
                            </Tooltip>
                            <IconButton type="button" className="arena-card-archive"
                              aria-label={archiving === key ? 'Archiving…' : 'Archive session'}
                              disabled={!online || Boolean(card.run) || archiving === key}
                              loading={archiving === key}
                              title={!online ? 'This execution machine is offline.' : card.run ? 'Wait for the current turn to finish before archiving.' : archiving === key ? 'Archiving…' : 'Archive session'}
                              onClick={() => archive(machine.machine.id, card.session)}>
                              <ShellIcon name="archive" />
                            </IconButton>
                            {tiles && <ArenaTileBody machine={machine} card={card} replies={replies} replyOptions={replyOptions} onDecidePermission={onDecidePermission} />}
                          </Paper>
                        );
                      })}
                    </div>
                  </Paper>
                  );
                })}
                </div>
              </section>
            );
          })}
        </div>
      ) : section === 'inbox' ? (
        <section className="arena-inbox" role="tabpanel" aria-label="Inbox">
          <header><div><h2>Inbox</h2><p>Permissions interrupt; finished work waits quietly until you read it.</p></div><Button type="button" disabled={!terminalUnreadIds.length} onClick={() => onAcknowledge(terminalUnreadIds)}>Mark all read</Button></header>
          {!inbox.length && <div className="arena-empty"><h3>Nothing needs your attention</h3><p>Running and idle sessions stay quiet.</p></div>}
          <div className="arena-inbox-list">
            {inbox.map((item) => {
              const machine = machines.find((entry) => entry.machine.id === item.machineId);
              const target = machine?.sessions.find((session) => session.id === item.sessionId);
              const active = machine?.runs.active.find((run) => run.sessionId === item.sessionId);
              const key = `${item.machineId}:${item.id}`;
              const descriptionId = `arena-inbox-${key}`;
              const canOpen = Boolean(item.machineOnline && machine && target);
              const openSession = () => {
                if (!item.machineOnline || !machine || !target) return;
                if (item.kind !== 'permission' && !item.read) onAcknowledge([item.id]);
                onOpenSession(machine, target);
              };
              return (
                <Paper component="article" className={`arena-inbox-item ${item.read ? 'read' : ''}`} key={key}>
                  <ListItemButton component={Link} prefetch={false}
                    href={workspaceHref({ sessionId: item.sessionId, machineId: item.machineId }, localMachine?.machine.id)}
                    className="arena-inbox-open" sx={{ display: 'grid' }} disabled={!canOpen}
                    onKeyDown={(event) => { if (event.key === ' ' && canOpen) { event.preventDefault(); event.currentTarget.click(); } }}
                    onClick={(event) => {
                      if (!canOpen) { event.preventDefault(); return; }
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                      event.preventDefault();
                      openSession();
                    }} aria-label={`Open ${item.sessionTitle}`} aria-describedby={`${descriptionId}-kind ${descriptionId}-copy`}>
                    <AttentionKind item={item} id={`${descriptionId}-kind`} />
                    <span className="arena-inbox-copy" id={`${descriptionId}-copy`}><strong>{item.sessionTitle}</strong><small>{item.projectName} · {item.machineLabel} · {new Date(item.createdAt).toLocaleString()}</small><span>{item.reason}</span></span>
                  </ListItemButton>
                  <div className="arena-inbox-actions">
                    {item.kind === 'permission' && item.runId && item.requestId && item.machineId ? (
                      <>
                        <Button type="button" disabled={!item.machineOnline || deciding === key} onClick={() => { setDeciding(key); void onDecidePermission(item.machineId!, item.runId!, item.requestId!, 'deny').finally(() => setDeciding(undefined)); }}>Deny</Button>
                        <Button type="button" className="arena-primary" variant="contained" disabled={!item.machineOnline || deciding === key} onClick={() => { setDeciding(key); void onDecidePermission(item.machineId!, item.runId!, item.requestId!, 'allow').finally(() => setDeciding(undefined)); }}>Allow</Button>
                      </>
                    ) : !item.read ? <Button type="button" onClick={() => onAcknowledge([item.id])}>Mark read</Button> : null}
                    {item.kind !== 'permission' && target && machine && <Button type="button" disabled={!item.machineOnline || Boolean(active) || archiving === actionKey(machine.machine.id, item.sessionId)} onClick={() => archive(machine.machine.id, target)}>Archive</Button>}
                    <Button type="button" disabled={!canOpen} onClick={openSession}>Open session</Button>
                  </div>
                </Paper>
              );
            })}
          </div>
        </section>
      ) : (
        <div className="arena-groups" role="tabpanel">
          {!archivedSessions.length && <div className="arena-empty"><h2>No archived sessions</h2><p>Archived work stays recoverable here until permanent cleanup is added.</p></div>}
          {archiveGroups.map((group, index) => (
            <section className="arena-group" aria-labelledby={`arena-archive-date-${index}`} key={group.date}>
              <header><div><h3 id={`arena-archive-date-${index}`}>{group.date}</h3><span>{group.sessions.length} archived</span></div></header>
              <div className="arena-card-grid">
                {group.sessions.map(({ machine, session, projectName }) => {
                  const online = machine.machine.state === 'online';
                  const key = actionKey(machine.machine.id, session.id);
                  const checkoutById = new Map(machine.checkouts.map(checkout => [checkout.id, checkout]));
                  return (
                    <Paper component="article" className="arena-card archived" key={key} sx={{ '& .arena-card-content': { flexWrap: 'wrap' } }}>
                      <div className="arena-card-content">
                        <span className={`arena-state ${online ? 'state-archived' : 'state-offline'}`}><i aria-hidden="true" />{online ? session.agentArchiveCheck?.status === 'archived' ? 'Archived by agent' : 'Archived' : 'Offline'}</span>
                        <SessionFacts session={session} checkouts={checkoutById} />
                        <span className="arena-card-meta" title={projectName}>{projectName}</span>
                        {showMachines && <span className="arena-card-meta" title={`${machine.machine.label} · ${machineTime(machine)}`}>{machine.machine.label}</span>}
                        {session.agentArchiveCheck?.status === 'archived' && session.lastMessage?.text && <p>{session.lastMessage.text}</p>}
                        <time className="arena-card-time" dateTime={session.archivedAt || session.updatedAt} title={new Date(session.archivedAt || session.updatedAt).toLocaleString()}>
                          Archived {new Date(session.archivedAt || session.updatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                        </time>
                      </div>
                      <div className="arena-card-restore"><Button type="button" disabled={!online || restoring === key} onClick={() => restore(machine.machine.id, session)}>{restoring === key ? 'Restoring…' : 'Restore'}</Button></div>
                    </Paper>
                  );
                })}
              </div>
            </section>
          ))}
          {archivedSessions.length > archiveLimit && <Button type="button" sx={{ mt: 2 }} onClick={() => setArchiveLimit(limit => limit + ARENA_ARCHIVE_PAGE_SIZE)}>Show older sessions</Button>}
        </div>
      )}
    </main>
  );
}
