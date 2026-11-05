'use client';

import { useRef, useState, type FormEvent } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import type { ArenaMachineSnapshot } from '@/shared/types';

export function NewProjectDialog({ machines, onCreate, onClose }: {
  machines: ArenaMachineSnapshot[];
  onCreate(machineId: string, name: string, checkoutIds: string[]): Promise<void>;
  onClose(): void;
}) {
  const [machineId, setMachineId] = useState(() => machines.find(entry => entry.machine.state === 'online')?.machine.id ?? '');
  const [name, setName] = useState('');
  const [checkoutId, setCheckoutId] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string>();
  const machine = machines.find(entry => entry.machine.id === machineId);
  const checkouts = machine?.checkouts.filter(checkout => !checkout.worktree) ?? [];
  const canCreate = Boolean(name.trim() && machine?.machine.state === 'online'
    && (!checkoutId || checkouts.some(checkout => checkout.id === checkoutId)));

  const submit = async () => {
    if (!canCreate || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await onCreate(machineId, name.trim(), checkoutId ? [checkoutId] : []);
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not create the project.');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return <Dialog open fullWidth maxWidth="xs" aria-labelledby="new-project-title"
    onClose={() => { if (!submitting.current) onClose(); }}
    slotProps={{ paper: { component: 'form', onSubmit: (event: FormEvent) => { event.preventDefault(); void submit(); } } }}>
    <DialogTitle id="new-project-title">New project</DialogTitle>
    <DialogContent dividers sx={{ display: 'grid', gap: 2 }}>
      <TextField autoFocus required label="Project name" value={name} disabled={busy}
        slotProps={{ htmlInput: { maxLength: 200 } }} onChange={event => setName(event.target.value)} />
      {machines.length > 1 && <TextField select label="Machine" value={machineId} disabled={busy}
        slotProps={{ select: { native: true } }} onChange={event => { setMachineId(event.target.value); setCheckoutId(''); }}>
        {machines.map(entry => <option key={entry.machine.id} value={entry.machine.id} disabled={entry.machine.state !== 'online'}>
          {entry.machine.label}{entry.machine.state !== 'online' ? ' (Offline)' : ''}
        </option>)}
      </TextField>}
      <TextField select label="Repository" value={checkoutId} disabled={busy}
        slotProps={{ select: { native: true } }} onChange={event => setCheckoutId(event.target.value)}>
        <option value="">No repository</option>
        {checkouts.map(checkout => <option key={checkout.id} value={checkout.id}>{checkout.name}</option>)}
      </TextField>
      {machine?.machine.state !== 'online' && <Alert severity="warning">This machine is offline.</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
    </DialogContent>
    <DialogActions>
      <Button type="button" disabled={busy} onClick={onClose}>Cancel</Button>
      <Button type="submit" variant="contained" disabled={busy || !canCreate}>{busy ? 'Creating…' : 'Create project'}</Button>
    </DialogActions>
  </Dialog>;
}
