'use client';

import Alert from '@mui/material/Alert';

import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import { Disclosure } from '@/features/shell/Disclosure';

import { useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import { useDialogFocus } from '@/features/shell/useDialogFocus';
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
  const restoreFocus = useDialogFocus(open, '.more-menu > button');
  const [savingDocker, setSavingDocker] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dockerError, setDockerError] = useState<string>();
  const docker = executionHealth?.docker;
  const dockerSetupNeeded = Boolean(docker?.enabled && !docker.providers.claude.available);

  const refresh = () => {
    setRefreshing(true);
    void onRefresh().finally(() => setRefreshing(false));
  };

  return <Dialog open={open} keepMounted disableRestoreFocus aria-labelledby="machine-settings-title"
    onClose={(_, reason) => { if (reason === 'escapeKeyDown') onClose(); }}
    slotProps={{ paper: { className: 'machine-settings-dialog' }, transition: { onExited: restoreFocus } }}>
    <DialogTitle component="header" id="machine-settings-header">
      <div><h2 id="machine-settings-title">Machine settings</h2><span>This machine</span></div>
      <IconButton type="button" aria-label="Close settings" onClick={onClose}>×</IconButton>
    </DialogTitle>
    <DialogContent dividers className="machine-settings-body">
      <Paper component="section" sx={{ p: 2, mt: 2 }} className="arena-docker-settings" aria-label="Security level">
        <strong>Security level</strong>
        <SecurityLevelDetails level={securityLevel} />
      </Paper>
      {docker && <Paper component="section" sx={{ p: 2, mt: 2 }} className="arena-docker-settings" aria-label="Docker execution">
        <div className="arena-docker-setting">
          <div>
            <strong>Docker execution</strong>
            <span role="status">{savingDocker ? 'Saving…' : !docker.enabled ? 'Off'
              : docker.providers.claude.available ? 'Ready' : 'Setup needed'}</span>
          </div>
          <FormControlLabel sx={{ m: 0 }} label="Enable Docker" control={
            <Checkbox checked={docker.enabled} disabled={savingDocker || refreshing} onChange={(event) => {
              setSavingDocker(true);
              setDockerError(undefined);
              void onSetDockerEnabled(event.target.checked).catch((error: unknown) => {
                setDockerError(error instanceof Error ? error.message : 'Could not save Docker settings.');
              }).finally(() => setSavingDocker(false));
            }} />
          } />
        </div>
        {/* Keep the owner mounted while closed: the gear badge and update watch stay current. */}
        {docker.enabled && docker.providers.claude.available && <DockerVersions active={open} onSwitched={refresh} onAvailableUpdates={onAvailableUpdates} />}
        {dockerSetupNeeded && <div className="arena-docker-setup">
          <p>{docker.providers.claude.message}</p>
          <p>Start Docker, then run <code>npm run docker:provision</code> in your installed CodeAI directory for first-time setup.</p>
          <Button type="button" disabled={savingDocker || refreshing} onClick={refresh}>{refreshing ? 'Checking…' : 'Check again'}</Button>
        </div>}
        <Disclosure className="arena-docker-setup" defaultExpanded={dockerSetupNeeded} title={<>Setup and sign-in</>}>

          <p>Make Docker available for new sessions on this machine. Local remains the default.</p>
          <p>Sign in once for each provider you use: <code>npm run docker:login -- claude</code> or <code>npm run docker:login -- codex</code>.</p>
          <p>New Docker conversations share that provider’s login, settings and history in persistent Docker storage. Your host provider setup stays separate, apart from what Global instructions passes on.</p>
        </Disclosure>
        {dockerError && <Alert severity="error">{dockerError}</Alert>}
      </Paper>}
      <GlobalInstructions active={open} dockerEnabled={docker?.enabled} securityLevel={securityLevel} refreshing={refreshing} onChanged={refresh} />
    </DialogContent>
    <DialogActions><Button type="button" disabled={savingDocker || refreshing} onClick={refresh}>{refreshing ? 'Refreshing…' : 'Refresh'}</Button></DialogActions>
  </Dialog>;
}
