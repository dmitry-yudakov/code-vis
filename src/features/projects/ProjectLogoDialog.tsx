'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import { useRef, useState, type FormEvent } from 'react';
import type { CheckoutSummary, DurableProject } from '@/shared/types';
import { ProjectLogo } from './ProjectLogo';
import { ProjectLogoFilePicker } from './ProjectLogoFilePicker';

export function ProjectLogoDialog({ project, checkouts, machineId, apiBase, online, onSave, onClose }: {
  project: DurableProject;
  checkouts: CheckoutSummary[];
  machineId: string;
  apiBase: string;
  online: boolean;
  onSave(logo: DurableProject['logo'] | null): Promise<void>;
  onClose(): void;
}) {
  const repositories = project.repositories.filter(binding => binding.hostId === machineId);
  const [repositoryId, setRepositoryId] = useState(project.logo?.repositoryId
    ?? repositories.find(binding => binding.role === 'primary')?.id ?? repositories[0]?.id ?? '');
  const [path, setPath] = useState(project.logo?.path ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const saving = useRef(false);
  const selectedRepositoryId = repositories.some(binding => binding.id === repositoryId) ? repositoryId : repositories[0]?.id ?? '';
  const selectedRepository = repositories.find(binding => binding.id === selectedRepositoryId);
  const valid = online && path.trim() && Boolean(selectedRepositoryId);
  const save = async (logo: DurableProject['logo'] | null) => {
    if (saving.current || !online) return;
    saving.current = true;
    setBusy(true);
    setError(undefined);
    try { await onSave(logo); onClose(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not save the project logo.'); }
    finally { saving.current = false; setBusy(false); }
  };
  return <Dialog open fullWidth maxWidth="sm" aria-labelledby="project-logo-title"
    onClose={() => { if (!saving.current) onClose(); }}
    slotProps={{ paper: { component: 'form', onSubmit: (event: FormEvent) => {
      event.preventDefault();
      if (valid) void save({ repositoryId: selectedRepositoryId, path: path.trim() });
    } } }}>
    <DialogTitle id="project-logo-title">Project logo</DialogTitle>
    <DialogContent dividers sx={{ display: 'grid', gap: 2 }}>
      <div className="project-logo-name"><ProjectLogo project={project} apiBase={apiBase} /><strong>{project.name}</strong></div>
      {repositories.length > 0 && <TextField select label="Repository" value={selectedRepositoryId} disabled={busy}
        slotProps={{ select: { native: true } }} onChange={event => setRepositoryId(event.target.value)}>
        {repositories.map(binding => <option key={binding.id} value={binding.id}>
          {checkouts.find(checkout => checkout.id === binding.checkoutId)?.name ?? 'Unavailable repository'}
        </option>)}
      </TextField>}
      {repositories.length ? <TextField autoFocus label="Image path" value={path} disabled={busy}
        placeholder="public/logo.svg" helperText="Relative to the repository · PNG, JPEG, GIF, WebP, SVG or ICO · up to 2 MiB"
        slotProps={{ htmlInput: { maxLength: 4096 } }} onChange={event => setPath(event.target.value)} />
        : <Alert severity="info">Add a repository to this project to choose a logo.</Alert>}
      {selectedRepository && <ProjectLogoFilePicker key={`${selectedRepository.id}:${selectedRepository.checkoutId}`}
        projectId={project.id} repository={selectedRepository} apiBase={apiBase} selectedPath={path}
        disabled={busy || !online} onSelect={setPath} />}
      {!online && <Alert severity="warning">This machine is offline.</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
    </DialogContent>
    <DialogActions>
      {project.logo && <Button type="button" color="inherit" disabled={busy || !online} onClick={() => void save(null)} sx={{ mr: 'auto' }}>Remove logo</Button>}
      <Button type="button" disabled={busy} onClick={onClose}>Cancel</Button>
      <Button type="submit" variant="contained" disabled={busy || !valid}>{busy ? 'Saving…' : 'Save'}</Button>
    </DialogActions>
  </Dialog>;
}
