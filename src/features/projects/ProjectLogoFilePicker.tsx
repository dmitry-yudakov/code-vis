'use client';

import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import { ShellIcon } from '@/features/shell/ShellIcon';
import type { RepositoryDirectory } from '@/shared/repositoryFiles';
import type { RepositoryBinding } from '@/shared/types';

function ImagePreview({ source }: { source: string }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  return <Box sx={{ minHeight: 144, display: 'grid', placeItems: 'center', textAlign: 'center', p: 1,
    border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'action.hover' }}>
    {/* Keep the authenticated image route and its SVG isolation policy on the preview. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img key={retry} src={`${source}&retry=${retry}`} alt="Logo preview"
      style={{ maxWidth: '100%', maxHeight: 144, objectFit: 'contain', display: status === 'ready' ? 'block' : 'none' }}
      onLoad={() => setStatus('ready')} onError={() => setStatus('error')} />
    {status === 'loading' && <Typography variant="body2" role="status">Loading preview…</Typography>}
    {status === 'error' && <Box><Typography variant="body2" role="status">Preview unavailable. Check the image path.</Typography>
      <Button type="button" sx={{ mt: 1 }} onClick={() => { setStatus('loading'); setRetry(value => value + 1); }}>Retry preview</Button></Box>}
  </Box>;
}

/** Browse one bounded repository directory at a time; preview never saves the choice. */
export function ProjectLogoFilePicker({ projectId, repository, apiBase, selectedPath, disabled, onSelect }: {
  projectId: string;
  repository: RepositoryBinding;
  apiBase: string;
  selectedPath: string;
  disabled: boolean;
  onSelect(path: string): void;
}) {
  const [folder, setFolder] = useState(() => selectedPath.split('/').slice(0, -1).join('/'));
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ url: string; directory?: RepositoryDirectory; error?: string }>();
  const url = `${apiBase}/repository/files?${new URLSearchParams({ checkoutId: repository.checkoutId, path: folder })}`;
  const current = result?.url === url ? result : undefined;
  useEffect(() => {
    if (disabled) return;
    const controller = new AbortController();
    setResult(undefined);
    void fetch(url, { cache: 'no-store', signal: controller.signal }).then(async response => {
      const data = await response.json() as { directory?: RepositoryDirectory; error?: string };
      if (!response.ok || !data.directory) throw new Error(data.error || 'Could not read this folder.');
      if (!controller.signal.aborted) setResult({ url, directory: data.directory });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setResult({ url, error: error instanceof Error ? error.message : 'Could not read this folder.' });
    });
    return () => controller.abort();
  }, [url, disabled, retry]);
  const entries = current?.directory?.entries.filter(entry => entry.kind === 'directory' || /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(entry.name));
  const preview = `${apiBase}/projects/${encodeURIComponent(projectId)}/logo?${new URLSearchParams({ repositoryId: repository.id, path: selectedPath.trim() })}`;
  return <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 1fr) 160px' }, gap: 1.5 }}>
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Button type="button" disabled={disabled || !folder} aria-label="Parent folder"
          onClick={() => setFolder(folder.split('/').slice(0, -1).join('/'))}>↑</Button>
        <Typography variant="body2" noWrap title={folder || 'Repository root'}>{folder || 'Repository root'}</Typography>
      </Box>
      <List dense disablePadding aria-label="Logo files" sx={{ height: 176, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
        {!current && <Typography component="li" variant="body2" role="status" sx={{ p: 1.5 }}>{disabled ? 'Folder unavailable.' : 'Reading folder…'}</Typography>}
        {current?.error && <Box component="li" sx={{ p: 1 }}><Alert severity="warning" action={
          <Button type="button" disabled={disabled} onClick={() => setRetry(value => value + 1)}>Retry</Button>
        }>{current.error}</Alert></Box>}
        {entries?.length === 0 && <Typography component="li" variant="body2" sx={{ p: 1.5 }}>No images in this folder.</Typography>}
        {entries?.map(entry => {
          const target = folder ? `${folder}/${entry.name}` : entry.name;
          return <ListItem key={entry.name} disablePadding><ListItemButton component="button" type="button" disabled={disabled}
            aria-pressed={entry.kind === 'file' ? target === selectedPath : undefined}
            aria-description={entry.kind === 'directory' ? 'Open folder' : 'Preview image'}
            selected={entry.kind === 'file' && target === selectedPath} sx={{ width: '100%' }}
            onClick={() => entry.kind === 'directory' ? setFolder(target) : onSelect(target)}>
            <ListItemIcon sx={{ minWidth: 28 }}><ShellIcon name={entry.kind === 'directory' ? 'folder' : 'image'} /></ListItemIcon>
            <ListItemText primary={entry.name} slotProps={{ primary: { noWrap: true, title: target } }} />
          </ListItemButton></ListItem>;
        })}
      </List>
    </Box>
    {selectedPath.trim() ? <ImagePreview key={preview} source={preview} />
      : <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 144, border: 1, borderColor: 'divider', borderRadius: 1 }}>
        <Typography variant="body2" color="text.secondary">Choose an image</Typography>
      </Box>}
  </Box>;
}
