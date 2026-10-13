'use client';

import Alert from '@mui/material/Alert';

import NativeSelect from '@mui/material/NativeSelect';
import Button from '@mui/material/Button';
import { Disclosure } from '@/features/shell/Disclosure';

import { DesktopPopover } from '@/features/shell/DesktopPopover';
import { useEffect, useRef, useState } from 'react';
import type {
  AgentExecution, AgentProvider, CheckoutSummary, DurableProject, ExecutionHealth, GlobalInstructionsChoice, ProviderHealth,
  SessionSnapshot, WorktreeCapability,
} from '@/shared/types';
import { launchInstructions, namedLaunchInstructions, type LaunchInstructions } from '@/features/shell/devicePreferences';
import { LOCAL_CODEX_ISOLATION_MESSAGE, isolatesLocalCodex } from '@/shared/globalInstructions';
import { findAgentParticipant, PROVIDER_LABELS } from '@/shared/participants';
import { CheckoutChoice, useCreationRequestId } from './CheckoutChoice';
import { worktreeChoice } from './worktreeChoice';

interface SessionCreationProps {
  worktrees?: WorktreeCapability;
  initialExecution?: AgentExecution;
  executionHealth?: ExecutionHealth;
  providerHealth?: Record<AgentProvider, ProviderHealth>;
  project?: DurableProject;
  checkouts: CheckoutSummary[];
  hostId?: string;
  newProvider: AgentProvider;
  /** This device's last Global instructions choice; absent is Default. */
  preferredInstructions?: GlobalInstructionsChoice;
  creating: boolean;
  submitLabel?: string;
  error?: string;
  onNewProvider(value: AgentProvider): void;
  onOpenMachineSettings?(): void;
  onNew(provider: AgentProvider, options: {
    checkoutMode?: 'current' | 'worktree'; creationRequestId?: string;
    execution: AgentExecution; checkoutId?: string;
    /** Absent only when the form had to set the choice aside. */
    instructions?: LaunchInstructions;
  }): Promise<boolean>;
}

export function SessionCreationForm({ initialExecution = 'local', executionHealth, providerHealth, project, checkouts, hostId, worktrees,
  newProvider, preferredInstructions, creating, submitLabel = 'Start session', error, onNewProvider, onNew, onOpenMachineSettings }: SessionCreationProps) {
  const dockerEnabled = Boolean(executionHealth?.docker.enabled);
  const [execution, setExecution] = useState<AgentExecution>(initialExecution === 'docker' && dockerEnabled ? 'docker' : 'local');
  const [checkoutId, setCheckoutId] = useState(initialExecution === 'docker' ? checkouts[0]?.id || '' : '');
  const [checkoutMode, setCheckoutMode] = useState<'current' | 'worktree'>('current');
  const requestId = useCreationRequestId();
  const busyRef = useRef(false);
  const [failed, setFailed] = useState(false);
  const [chosenInstructions, setChosenInstructions] = useState(preferredInstructions);
  const selectedHealth = execution === 'docker' ? executionHealth?.docker.providers : executionHealth?.local.providers || providerHealth;
  const providers = (['claude', 'codex'] as AgentProvider[]).filter((provider) => selectedHealth?.[provider].available && selectedHealth[provider].supportedModes.length);
  const provider = providers.includes(newProvider) ? newProvider : providers[0];
  const instructions = launchInstructions(chosenInstructions, execution, provider);
  const bindings = project?.repositories || [];
  const invalidBinding = execution === 'docker' && (project
    ? bindings.length !== 1 || bindings[0].role !== 'primary' || bindings[0].hostId !== hostId
      || !checkouts.some((checkout) => checkout.id === bindings[0].checkoutId)
    : !checkouts.some((checkout) => checkout.id === checkoutId));
  const choice = worktreeChoice({ execution, project, checkoutId, checkouts, hostId, capability: worktrees });
  const invalidWorktree = checkoutMode === 'worktree' && !choice.available;

  useEffect(() => { if (!dockerEnabled) setExecution('local'); }, [dockerEnabled]);

  return (
    <form className="session-creation-form" aria-label="Create project session" onSubmit={(event) => {
      event.preventDefault();
      if (creating || busyRef.current || !provider || invalidBinding || invalidWorktree) return;
      busyRef.current = true;
      setFailed(false);
      const options = {
        execution, checkoutMode, ...(!project && checkoutId ? { checkoutId } : {}),
        instructions: namedLaunchInstructions(chosenInstructions, execution, provider),
      };
      void onNew(provider, { ...options, ...(checkoutMode === 'worktree' ? {
        creationRequestId: requestId.forRequest(JSON.stringify({ provider, projectId: project?.id, ...options })),
      } : {}) }).then((created) => { setFailed(!created); if (created) requestId.reset(); })
        .finally(() => { busyRef.current = false; });
    }}>
      <label>
        <span>Execution</span>
        <NativeSelect value={execution} disabled={creating} onChange={(event) => setExecution(event.target.value as AgentExecution)}>
          <option value="local">Local</option>
          <option value="docker" disabled={!dockerEnabled}>Docker{dockerEnabled ? '' : ' · enable in Machine settings'}</option>
        </NativeSelect>
      </label>
      {!dockerEnabled && (onOpenMachineSettings
        ? <Button type="button" onClick={onOpenMachineSettings}>Enable Docker in Machine settings</Button>
        : <p>Enable Docker in Machine settings on the executing machine.</p>)}
      {execution === 'docker' && <p>Ask and Plan use a read-only repository. Agent edits it directly without individual approvals.</p>}
      {!project && (
        <label>
          <span>Repository</span>
          <NativeSelect value={checkoutId} disabled={creating} onChange={(event) => setCheckoutId(event.target.value)}>
            <option value="">{execution === 'docker' ? 'Choose one repository' : 'No repository'}</option>
            {checkouts.map((checkout) => <option key={checkout.id} value={checkout.id}>{checkout.name}</option>)}
          </NativeSelect>
        </label>
      )}
      <CheckoutChoice value={checkoutMode} choice={choice} disabled={creating} onChange={setCheckoutMode} />
      {invalidBinding && <p role="status">Docker requires exactly one primary repository on this machine. {project ? 'Update this project’s repositories to continue.' : 'Choose a repository to continue.'}</p>}
      <label>
        <span>New session with</span>
        <NativeSelect value={provider || ''} disabled={creating || !providers.length} onChange={(event) => onNewProvider(event.target.value as AgentProvider)} inputProps={{ "aria-label": "New session provider" }}>
          {!providers.length && <option value="">No provider available</option>}
          {providers.map((value) => <option value={value} key={value}>{PROVIDER_LABELS[value]}</option>)}
        </NativeSelect>
      </label>
      <Disclosure className="session-advanced-settings" title={<>Advanced settings</>}>

        <label>
          <span>Global instructions</span>
          <NativeSelect value={instructions ?? 'default'} disabled={creating} onChange={(event) => (
            setChosenInstructions(event.target.value === 'default' ? undefined : event.target.value as GlobalInstructionsChoice)
          )}>
            <option value="default">Default</option>
            <option value="global">Use</option>
            {provider && isolatesLocalCodex('isolated', execution, provider)
              ? <option value="isolated" disabled title={LOCAL_CODEX_ISOLATION_MESSAGE}>Isolate · Docker only for Codex</option>
              : <option value="isolated">Isolate</option>}
          </NativeSelect>
        </label>
      </Disclosure>
      {!providers.length && <p role="status">{execution === 'docker'
        ? <>{selectedHealth?.claude.message || 'Docker needs setup.'} {onOpenMachineSettings
          ? <Button type="button" onClick={onOpenMachineSettings}>Open Docker setup</Button>
          : 'Open Machine settings on the executing machine for Docker setup.'}</>
        : 'Install and authenticate Claude Code or Codex for Local, or select Docker.'}</p>}
      {failed && <Alert severity="error">{error || 'Could not create the session. Try again.'}</Alert>}
      <Button type="submit" disabled={creating || !provider || invalidBinding || invalidWorktree}>{creating ? 'Creating…' : failed ? 'Retry' : submitLabel}</Button>
    </form>
  );
}

export function SessionPicker({ sessions, value, onChange, ...creation }: SessionCreationProps & {
  sessions: SessionSnapshot[];
  value?: string;
  onChange(value: string): void;
}) {
  return (
    <div className="session-picker">
      <label className="all-sessions-picker">
        <span aria-hidden="true">⌄</span>
        <NativeSelect disableUnderline IconComponent={() => null}
          sx={{ position: 'absolute', inset: 0, width: 28, height: 28, '& select': { color: 'transparent', p: 0, height: '100%', width: '100%' }, '& option': { color: 'text.primary', bgcolor: 'background.paper' } }} id="all-sessions" title="All sessions" value={value || ''} disabled={!sessions.length} onChange={(event) => onChange(event.target.value)} inputProps={{ "aria-label": "All sessions", title: "All sessions" }}>
          {!value && <option value="" disabled>{sessions.length ? 'Choose a session' : 'No sessions yet'}</option>}
          {sessions.map((session) => (
            <option value={session.id} key={session.id}>
              {findAgentParticipant(session.participants, session.primaryAgentId)?.displayName || 'Agent'} · {session.title} · {session.execution === 'docker' ? 'Docker' : 'Local'}
            </option>
          ))}
        </NativeSelect>
      </label>
      <DesktopPopover keepMounted className="new-session-menu" label="New session" summary="＋" icon placement="bottom-end">
        {(close) => <div>
          <SessionCreationForm {...creation}
            onOpenMachineSettings={creation.onOpenMachineSettings ? () => { close(); creation.onOpenMachineSettings?.(); } : undefined} key={`${creation.project?.id || 'loose'}:${value || 'empty'}`}
            onNew={async (provider, options) => {
              const created = await creation.onNew(provider, options);
              if (created) close();
              return created;
            }} />
        </div>}
      </DesktopPopover>
    </div>
  );
}
