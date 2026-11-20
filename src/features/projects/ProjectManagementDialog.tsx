'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useRef, useState, type FormEvent } from 'react';
import type { DurableProject } from '@/shared/types';
import type { ProjectAction } from './ProjectActions';

export function ProjectManagementDialog({ project, action, online, blockedReason, onSubmit, onClose }: {
  project: DurableProject;
  action: ProjectAction;
  online: boolean;
  blockedReason?: string;
  onSubmit(name?: string): Promise<void>;
  onClose(): void;
}) {
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const saving = useRef(false);
  const renaming = action === 'rename';
  const valid = online && !blockedReason && (!renaming || Boolean(name.trim() && name.trim() !== project.name));
  const submit = async () => {
    if (saving.current || !valid) return;
    saving.current = true;
    setBusy(true);
    setError(undefined);
    try { await onSubmit(renaming ? name.trim() : undefined); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update the project.'); }
    finally { saving.current = false; setBusy(false); }
  };
  return <Dialog open fullWidth maxWidth="xs" aria-labelledby="project-management-title"
    onClose={() => { if (!saving.current) onClose(); }}
    slotProps={{ paper: { component: 'form', onSubmit: (event: FormEvent) => { event.preventDefault(); void submit(); } } }}>
    <DialogTitle id="project-management-title">{renaming ? 'Rename project' : 'Delete project'}</DialogTitle>
    <DialogContent dividers sx={{ display: 'grid', gap: 2 }}>
      {renaming ? <TextField autoFocus fullWidth label="Project name" value={name} disabled={busy}
        slotProps={{ htmlInput: { maxLength: 200 } }} onChange={event => setName(event.target.value)} />
        : <>
          <Typography sx={{ overflowWrap: 'anywhere' }}>Delete “{project.name}”?</Typography>
          <Typography variant="body2">Repository files and conversations are kept. Conversations move to No project.</Typography>
        </>}
      {!online && <Alert severity="warning">This machine is offline.</Alert>}
      {blockedReason && <Alert severity="info">{blockedReason}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
    </DialogContent>
    <DialogActions>
      <Button autoFocus={!renaming} type="button" disabled={busy} onClick={onClose}>Cancel</Button>
      <Button type="submit" variant="contained" color={renaming ? 'primary' : 'error'} disabled={busy || !valid}>
        {busy ? (renaming ? 'Saving…' : 'Deleting…') : (renaming ? 'Save' : 'Delete project')}
      </Button>
    </DialogActions>
  </Dialog>;
}
