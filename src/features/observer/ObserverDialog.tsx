'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { AgentProvider, ArenaMachineSnapshot, ModelSelection, ProviderHealth } from '@/shared/types';
import { workspaceHref } from '@/features/shell/workspaceLocation';
import { useArenaNow } from '@/features/arena/useArenaNow';
import { observerContext } from './observerModel';
import { useObserver } from './useObserver';
import { runObserverVoice } from './observerVoice';
import type { ReplyOptions } from './observerDelivery';

export function ObserverDialog(props: {
  open: boolean; compact: boolean; location: string; machines: ArenaMachineSnapshot[]; localMachineId?: string;
  provider: AgentProvider; providers?: Record<AgentProvider, ProviderHealth>; selection: ModelSelection;
  onProvider(provider: AgentProvider): void; options: ReplyOptions; blockedReason?: string; onClose(): void;
}) {
  const observer = useObserver({ open: props.open, machines: props.machines, localMachineId: props.localMachineId,
    options: props.options, blockedReason: props.blockedReason });
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('');
  const [voiceName, setVoiceName] = useState('');
  const voice = useRef<AbortController | undefined>(undefined);
  const latest = useRef({ observer, props }); latest.current = { observer, props };
  const end = useRef<HTMLDivElement>(null);
  const now = useArenaNow();
  const context = useMemo(() => observerContext(props.machines, 0, '', now), [props.machines, now]);
  const ready = Boolean(props.providers?.[props.provider]?.available);
  const stopVoice = () => {
    if (voice.current || voiceActive) setVoiceStatus('Voice stopped.');
    voice.current?.abort(); voice.current = undefined; setVoiceActive(false);
  };
  const startVoice = () => {
    if (voice.current || !ready || observer.busy) return;
    const controller = voice.current = new AbortController();
    setVoiceActive(true); setVoiceName('');
    void runObserverVoice({ signal: controller.signal, status: setVoiceStatus, voice: setVoiceName,
      onText: text => latest.current.observer.ask(text, latest.current.props.provider, latest.current.props.selection),
    }).then(() => { if (!controller.signal.aborted) setVoiceStatus('Voice stopped.'); }, error => {
      if (!controller.signal.aborted) setVoiceStatus(error instanceof Error ? error.message : 'Voice unavailable. Use text or retry Voice.');
    }).finally(() => { if (voice.current === controller) { voice.current = undefined; setVoiceActive(false); } });
  };
  useEffect(() => {
    stopVoice();
    const hidden = () => { if (document.hidden) stopVoice(); };
    document.addEventListener('visibilitychange', hidden);
    return () => { document.removeEventListener('visibilitychange', hidden); voice.current?.abort(); voice.current = undefined; };
  }, [props.open, props.location]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [observer.messages.length, observer.delivery]);
  const close = () => { stopVoice(); props.onClose(); };
  const ask = () => { void observer.ask(observer.draft, props.provider, props.selection); };
  return <Dialog open={props.open} onClose={close} fullWidth maxWidth="sm" fullScreen={props.compact}
    aria-labelledby="observer-title" slotProps={{ paper: { sx: { height: props.compact ? '100%' : 'min(780px, 90dvh)' } } }}>
    <DialogTitle id="observer-title">Observer</DialogTitle>
    <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, minHeight: 0 }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField select label="Provider" size="small" value={props.provider} disabled={observer.busy || voiceActive}
          slotProps={{ select: { native: true } }} onChange={event => props.onProvider(event.target.value as AgentProvider)}>
          <option value="claude">Claude</option><option value="codex">Codex</option>
        </TextField>
        <Typography variant="caption">{props.selection.model ?? 'Default model'}{props.selection.effort ? ` · ${props.selection.effort}` : ''}</Typography>
        <Button onClick={voiceActive ? stopVoice : startVoice} disabled={!voiceActive && (!ready || observer.busy)}>{voiceActive ? 'Stop voice' : 'Voice'}</Button>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {context.total} active {context.total === 1 ? 'session' : 'sessions'}{Object.entries(context.counts).map(([state, count]) => ` · ${count} ${state}`).join('')}
      </Typography>
      <Typography variant="caption" color="text.secondary">Session excerpts are shared with {props.provider === 'claude' ? 'Claude' : 'Codex'} on the home machine, including attached machines.</Typography>
      {voiceStatus && <Typography role="status" variant="body2">{voiceStatus}{voiceName ? ` · ${voiceName}` : ''}</Typography>}
      <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 80 }} aria-label="Observer conversation" tabIndex={0}>
        {!observer.messages.length && <Typography color="text.secondary" sx={{ mb: 2 }}>Ask “What needs me?” or ask about a session.</Typography>}
        {observer.messages.map((message, index) => <Box key={index} sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary">{message.role === 'user' ? 'You' : 'Observer'}</Typography>
          <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message.text}</Typography>
          {message.result && <>
            <Typography variant="caption" color="text.secondary">Observed {new Date(message.result.observedAt).toLocaleTimeString()} · {message.result.included}/{message.result.total} sessions in this briefing</Typography>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>{message.result.mentions.map(target => {
              const machine = props.machines.find(m => m.machine.id === target.machineId);
              const session = machine?.sessions.find(s => s.id === target.sessionId);
              return <Button key={`${target.machineId}:${target.sessionId}`} component={Link} size="small" onClick={close}
                href={workspaceHref({ machineId: target.machineId, sessionId: target.sessionId }, props.localMachineId)}>
                {session?.title ?? 'Open session'}
              </Button>;
            })}</Stack>
          </>}
        </Box>)}
        <div ref={end} />
      </Box>
      {observer.delivery && <Alert severity="info" icon={false} sx={{ flexShrink: 0, maxHeight: '35dvh', overflowY: 'auto' }}>
        <Typography variant="subtitle2">{observer.delivery.title}</Typography>
        <Typography variant="caption">{observer.delivery.mode} · {observer.delivery.modelSelection.model ?? 'Default model'}{observer.delivery.modelSelection.effort ? ` · ${observer.delivery.modelSelection.effort}` : ''}</Typography>
        <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', my: 1 }}>{observer.delivery.text}</Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Button disabled={observer.busy || voiceActive} variant="contained" onClick={() => void observer.confirm()}>{observer.delivery.attempted ? 'Retry send' : 'Send follow-up'}</Button>
          {observer.delivery.attempted
            ? <Button disabled={observer.busy || voiceActive} onClick={() => void observer.check()}>Check delivery</Button>
            : <Button disabled={observer.busy || voiceActive} onClick={() => { observer.cancel(); }}>Cancel message</Button>}
          <Button component={Link} href={workspaceHref(observer.delivery, props.localMachineId)} onClick={close}>Open session</Button>
        </Stack>
      </Alert>}
      {observer.error && <Alert severity="error">{observer.error}</Alert>}
      {!ready && <Alert severity="warning">{props.providers?.[props.provider]?.message || 'Provider unavailable. Choose another provider or open Machine settings.'}</Alert>}
      {observer.busy && <Typography role="status">Working…</Typography>}
      <Box component="form" onSubmit={event => { event.preventDefault(); ask(); }} sx={{ display: 'grid', gap: 1, flexShrink: 0 }}>
        <TextField label="Ask Observer" multiline maxRows={4} value={observer.draft} autoFocus
          disabled={observer.busy || voiceActive}
          slotProps={{ htmlInput: { maxLength: 8000 } }} onChange={event => observer.edit(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); ask(); } }} />
        <Stack direction="row" spacing={1}>
          <Button type="submit" variant="contained" disabled={!ready || observer.busy || voiceActive || !observer.draft.trim()}>Ask</Button>
          <Button disabled={!ready || observer.busy || voiceActive} onClick={() => void observer.ask('What needs me?', props.provider, props.selection)}>Briefing</Button>
          {observer.nextOffset !== undefined && <Button disabled={observer.busy || voiceActive} onClick={() => void observer.ask('Show more', props.provider, props.selection, observer.nextOffset)}>More sessions</Button>}
        </Stack>
      </Box>
    </DialogContent>
    <DialogActions><Button onClick={close}>Close</Button></DialogActions>
  </Dialog>;
}
