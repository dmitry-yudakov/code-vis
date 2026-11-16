'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import ListItemText from '@mui/material/ListItemText';
import TextField from '@mui/material/TextField';
import type { RepositoryFileList } from '@/shared/repositoryFiles';
import { useRepositoryFiles } from './RepositoryFilesProvider';
import { fuzzyFiles } from './fuzzyFiles';

interface FileOption { path: string; checkoutId: string; repository: string }

/** A fresh snapshot per opening; close or workspace navigation aborts every pending request. */
export function QuickFilePicker({ onClose }: { onClose(): void }) {
  const files = useRepositoryFiles()!;
  const { repositories, apiBase } = files;
  const titleId = useId();
  const [returnFocus] = useState(() => document.activeElement as HTMLElement | null);
  const [revision, setRevision] = useState(0);
  const [results, setResults] = useState<Record<string, { paths?: string[]; error?: string }>>({});
  useEffect(() => {
    const controller = new AbortController();
    setResults({});
    for (const repository of repositories) {
      const query = new URLSearchParams({ checkoutId: repository.id });
      void fetch(`${apiBase}/repository/file-search?${query}`, { cache: 'no-store', signal: controller.signal })
        .then(async response => {
          const data = await response.json() as { files?: RepositoryFileList; error?: string };
          if (!response.ok || !data.files) throw new Error(data.error || 'Could not list project files.');
          if (!controller.signal.aborted) setResults(current => ({ ...current, [repository.id]: { paths: data.files!.paths } }));
        }).catch((error: unknown) => {
          if (!controller.signal.aborted) setResults(current => ({ ...current, [repository.id]: {
            error: error instanceof Error ? error.message : 'Could not list project files.',
          } }));
        });
    }
    return () => controller.abort();
  }, [apiBase, repositories, revision]);
  const options = useMemo(() => repositories.flatMap(repository => (results[repository.id]?.paths ?? [])
    .map(path => ({ path, checkoutId: repository.id, repository: repository.name }))), [repositories, results]);
  const loading = repositories.some(repository => !results[repository.id]);
  const cancel = () => {
    onClose();
    requestAnimationFrame(() => { if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }); });
  };
  return <Dialog open fullWidth maxWidth="sm" disableRestoreFocus aria-labelledby={titleId} onClose={cancel}
    onKeyDownCapture={event => {
      if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
        event.preventDefault(); event.stopPropagation(); cancel();
      }
    }} slotProps={{ paper: { sx: { alignSelf: 'flex-start', mt: '10vh' } } }}>
    <DialogTitle id={titleId}>Open file</DialogTitle>
    <DialogContent>
      <Autocomplete<FileOption> open disablePortal autoHighlight blurOnSelect clearOnBlur={false} value={null}
        options={options} loading={loading} loadingText="Reading project files…" noOptionsText="No matching files"
        filterOptions={(items, state) => fuzzyFiles(items, state.inputValue)}
        getOptionLabel={option => option.path} getOptionKey={option => `${option.checkoutId}:${option.path}`}
        onChange={(_, option) => {
          if (!option) return;
          files.openFile({ path: option.path }, option.checkoutId);
          onClose();
        }}
        renderOption={(props, option) => {
          const { key, ...rest } = props;
          return <li key={key} {...rest}><ListItemText primary={option.path.split('/').pop()}
            secondary={`${repositories.length > 1 ? `${option.repository} · ` : ''}${option.path}`}
            slotProps={{ primary: { noWrap: true }, secondary: { sx: { overflowWrap: 'anywhere' } } }} /></li>;
        }}
        renderInput={params => <TextField {...params} autoFocus margin="dense" label="File name or path" placeholder="Search project files…"
          slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps.htmlInput, maxLength: 256 } }} />}
        slotProps={{
          popper: { sx: { position: 'static !important', transform: 'none !important', width: '100% !important' } },
          paper: { elevation: 0 }, listbox: { sx: { maxHeight: '45vh' } },
        }} />
      {repositories.map(repository => results[repository.id]?.error && <Alert key={repository.id} severity="error" sx={{ mt: 1 }}
        action={<Button color="inherit" onClick={() => setRevision(value => value + 1)}>Try again</Button>}>
        {repositories.length > 1 ? `${repository.name}: ` : ''}{results[repository.id].error}
      </Alert>)}
    </DialogContent>
    <DialogActions><Button onClick={cancel}>Cancel</Button></DialogActions>
  </Dialog>;
}
