'use client';

import { useEffect, useRef, useState } from 'react';
import type { ExecutionHealth, SecurityLevel } from '@/shared/types';
import { DockerVersions } from './DockerVersions';
import { GlobalInstructions } from './GlobalInstructions';
import { SecurityLevelDetails } from './SecurityLevelNotice';

/** Settings always address the home machine, including while an executor's session is open. */
export function MachineSettingsDialog({ open, securityLevel, executionHealth, onClose, onRefresh, onSetDockerEnabled, onAvailableUpdates }: {
  open: boolean;
  securityLevel: SecurityLevel;
  executionHealth?: ExecutionHealth;
  onClose(): void;
  onRefresh(): Promise<void>;
  onSetDockerEnabled(enabled: boolean): Promise<void>;
  onAvailableUpdates(count: number): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [savingDocker, setSavingDocker] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dockerError, setDockerError] = useState<string>();
  const docker = executionHealth?.docker;
  const dockerSetupNeeded = Boolean(docker?.enabled && !docker.providers.claude.available);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal();
    } else if (!open && element.open) {
      element.close();
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    }
  }, [open]);

  const refresh = () => {
    setRefreshing(true);
    void onRefresh().finally(() => setRefreshing(false));
  };

  return <dialog ref={dialog} className="machine-settings-dialog" aria-labelledby="machine-settings-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header>
      <div><h2 id="machine-settings-title">Machine settings</h2><span>This machine</span></div>
      <button type="button" aria-label="Close settings" onClick={onClose}>×</button>
    </header>
    <div className="machine-settings-body">
      <section className="arena-docker-settings" aria-label="Security level">
        <strong>Security level</strong>
        <SecurityLevelDetails level={securityLevel} />
      </section>
      {docker && <section className="arena-docker-settings" aria-label="Docker execution">
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
        {/* Keep the owner mounted while closed: the gear badge and update watch stay current. */}
        {docker.enabled && docker.providers.claude.available && <DockerVersions active={open} onSwitched={refresh} onAvailableUpdates={onAvailableUpdates} />}
        {dockerSetupNeeded && <div className="arena-docker-setup">
          <p>{docker.providers.claude.message}</p>
          <p>Start Docker, then run <code>npm run docker:provision</code> in your installed CodeAI directory for first-time setup.</p>
          <button type="button" disabled={savingDocker || refreshing} onClick={refresh}>{refreshing ? 'Checking…' : 'Check again'}</button>
        </div>}
        <details className="arena-docker-setup" open={dockerSetupNeeded}>
          <summary>Setup and sign-in</summary>
          <p>Make Docker available for new sessions on this machine. Local remains the default.</p>
          <p>Sign in once for each provider you use: <code>npm run docker:login -- claude</code> or <code>npm run docker:login -- codex</code>.</p>
          <p>New Docker conversations share that provider’s login, settings and history in persistent Docker storage. Your host provider setup stays separate, apart from what Global instructions passes on.</p>
        </details>
        {dockerError && <p role="alert">{dockerError}</p>}
      </section>}
      <GlobalInstructions active={open} dockerEnabled={docker?.enabled} securityLevel={securityLevel} refreshing={refreshing} onChanged={refresh} />
    </div>
    <footer><button type="button" disabled={savingDocker || refreshing} onClick={refresh}>{refreshing ? 'Refreshing…' : 'Refresh'}</button></footer>
  </dialog>;
}
