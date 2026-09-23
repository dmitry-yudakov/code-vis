'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PROVIDER_LABELS } from '@/shared/participants';
import type {
  AgentProvider, DockerCheck, DockerCliOffer, DockerUpdateOperation, DockerUpdateState, DockerVersionsStatus,
} from '@/shared/types';

const POLL_INTERVAL_MS = 2_000;
const RUNNING: ReadonlySet<DockerUpdateState> = new Set(['building', 'checking', 'switching']);
const CHECK_LABELS: Record<DockerCheck, string> = {
  build: 'The build',
  version: 'The version check',
  'claude-flags': 'The Claude flag check',
  'codex-handshake': 'The Codex handshake check',
  'codex-models': 'The Codex model check',
};

export function dockerUpdateText(operation: DockerUpdateOperation): string {
  const target = `${PROVIDER_LABELS[operation.provider]} ${operation.version}`;
  switch (operation.state) {
    case 'building': return `Building ${target}…`;
    case 'checking': return `Checking ${target} offline…`;
    case 'switching': return `Switching to ${target}…`;
    case 'failed': return operation.check
      ? `${CHECK_LABELS[operation.check]} failed: ${operation.message} Nothing changed.`
      : `The update failed: ${operation.message}`;
    default: return operation.message || '';
  }
}

type Busy = 'check' | 'start';

export function DockerVersionsView({ status, error, busy, onUpdate, onCheck }: {
  status?: DockerVersionsStatus;
  error?: string;
  busy?: Busy;
  onUpdate(provider: AgentProvider, target: 'latest' | 'previous', offer: DockerCliOffer): void;
  onCheck(): void;
}) {
  const running = Boolean(status?.operation && RUNNING.has(status.operation.state));
  const disabled = Boolean(busy) || running;
  return (
    <div className="arena-docker-versions" role="group" aria-label="Docker CLI versions">
      {status && (['claude', 'codex'] as const).map((provider) => {
        const cli = status.providers[provider];
        return (
          <div className="arena-docker-version" key={provider}>
            <strong>{PROVIDER_LABELS[provider]}</strong>
            <span className="arena-docker-version-current">{cli.version}</span>
            <span className="arena-docker-version-offer">
              {cli.latest ? `${cli.latest.version} available` : status.releases.failed ? '' : 'up to date'}
            </span>
            <span className="arena-docker-version-actions">
              {cli.latest && (
                <button type="button" disabled={disabled} onClick={() => onUpdate(provider, 'latest', cli.latest!)}>Update</button>
              )}
              {cli.previous && (
                <button type="button" disabled={disabled} onClick={() => onUpdate(provider, 'previous', cli.previous!)}>
                  {cli.previous.downgrade ? 'Roll back' : 'Return'} to {cli.previous.version}
                </button>
              )}
            </span>
          </div>
        );
      })}
      <div className="arena-docker-version-footer">
        <div>
          {status?.operation && <p role="status">{dockerUpdateText(status.operation)}</p>}
          {status?.releases.failed && <p>Couldn’t check for updates.</p>}
          {error && <p role="alert">{error}</p>}
        </div>
        <button type="button" disabled={disabled} onClick={onCheck}>{busy === 'check' ? 'Checking…' : 'Check for updates'}</button>
      </div>
    </div>
  );
}

/** This machine's Docker CLI rows. The server runs each update; this view only starts and watches it. */
export function DockerVersions({ onSwitched }: { onSwitched(): void }) {
  const [status, setStatus] = useState<DockerVersionsStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<Busy>();
  const watching = useRef<string>(undefined);
  const loading = useRef(false);

  const load = useCallback(async (refresh = false) => {
    // A poll may skip while another read is in flight; Check for updates may not.
    if (loading.current && !refresh) return;
    loading.current = true;
    try {
      const response = await fetch(`/api/execution/docker/versions${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({})) as DockerVersionsStatus & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not read the Docker CLI versions.');
      setStatus(data);
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not read the Docker CLI versions.');
    } finally {
      loading.current = false;
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const operation = status?.operation;
  const running = Boolean(operation && RUNNING.has(operation.state));
  // An interval, not a timer re-armed by each answer: a failed read must not end the watch.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => { void load(); }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [load, running]);

  // Readiness and Docker model choices change only when an update this view watched switched.
  useEffect(() => {
    if (!operation) return;
    if (RUNNING.has(operation.state)) watching.current = operation.id;
    else if (watching.current === operation.id) {
      watching.current = undefined;
      if (operation.state === 'switched') onSwitched();
    }
  }, [onSwitched, operation]);

  const update = (provider: AgentProvider, target: 'latest' | 'previous', offer: DockerCliOffer) => {
    const label = PROVIDER_LABELS[provider];
    if (offer.downgrade && !window.confirm(`Go back to ${label} ${offer.version}? The newer CLI may already have migrated ${label}’s shared Docker home, so watch the first turn afterwards.`)) return;
    setBusy('start');
    setError(undefined);
    void fetch('/api/execution/docker/versions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, target }),
    }).then(async (response) => {
      const data = await response.json().catch(() => ({})) as { operation?: DockerUpdateOperation; error?: string };
      // The machine runs one update at a time: show the one already running, perhaps from another device.
      if (response.status === 409) await load();
      if (!response.ok) throw new Error(data.error || 'Could not start the update.');
      const { operation: started } = data;
      if (started) setStatus((current) => current && { ...current, operation: started });
      await load();
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Could not start the update.');
    }).finally(() => setBusy(undefined));
  };

  const check = () => {
    setBusy('check');
    void load(true).finally(() => setBusy(undefined));
  };

  return <DockerVersionsView status={status} error={error} busy={busy} onUpdate={update} onCheck={check} />;
}
