'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import IconButton from '@mui/material/IconButton';
import NativeSelect from '@mui/material/NativeSelect';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { AttachmentChip } from '@/features/conversation/AttachmentChip';
import { CheckoutChoice } from '@/features/conversation/CheckoutChoice';
import { ModelMenu } from '@/features/conversation/InstructionComposer';
import { DesktopPopover } from '@/features/shell/DesktopPopover';
import { useDialogFocus } from '@/features/shell/useDialogFocus';
import { reportCaptureLabel, reportDescription, reportTitle } from '@/features/reports/reportModel';
import { immersiveReportPath } from '@/features/reports/useImmersiveReports';
import { pastedImageFiles } from '@/features/conversation/imageAttachments';
import { launchInstructions } from '@/features/shell/devicePreferences';
import { AGENT_MODE_LABELS } from '@/features/agents/toolActivity';
import { PROVIDER_LABELS } from '@/shared/participants';
import { SESSION_LAUNCH_MODES, type SessionLaunchMode } from '@/shared/agentModes';
import { isolatesLocalCodex } from '@/shared/globalInstructions';
import { launchText } from './sessionLaunch';
import type { SessionLauncher } from './useSessionLauncher';

export function SessionSetupDialog({ launcher, immersive }: { launcher: SessionLauncher; immersive: boolean }) {
  const [preview, setPreview] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);
  const settingsId = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const focusedDraft = useRef(false);
  const open = launcher.isOpen && !immersive;
  const restoreFocus = useDialogFocus(open, '.more-menu > button', launcher.opener.current);
  useEffect(() => {
    if (!open) { setPreview(undefined); setSettingsOpen(false); setReportsOpen(false); }
    if (!open || launcher.busy) focusedDraft.current = false;
    if (open && !launcher.busy && launcher.draft && !focusedDraft.current && input.current) { input.current.focus(); focusedDraft.current = true; }
  }, [open, launcher.busy, Boolean(launcher.draft)]);
  const draft = launcher.draft;
  const settings = draft?.settings;
  const locked = launcher.settingsLocked;
  const previewImage = draft?.images.find((image) => image.id === preview);
  const previewReport = launcher.reports.reports.find((report) => report.id === preview && report.screenshot);
  const previewUrl = previewImage?.dataUrl ?? (previewReport && launcher.reports.available && launcher.reports.projectId
    ? immersiveReportPath(launcher.reports.projectId, previewReport.id, true) : undefined);
  const projectName = launcher.selectedProject?.name ?? launcher.checkoutChoice.source?.name ?? 'No project';
  const targetDetails = [
    !settings?.projectId && launcher.checkoutChoice.source?.name,
    !settings?.codeai && launcher.machines.length > 1 && (launcher.machine?.machine.label ?? 'Unavailable machine'),
    settings?.execution === 'docker' && 'Docker',
    settings?.checkoutMode === 'worktree' && 'New worktree',
  ].filter(Boolean).join(' · ');
  const canDiscard = launcher.hasDraftChanges || launcher.error || launcher.targetNotice || launcher.createdSession;
  return <Dialog open={open} keepMounted disableRestoreFocus fullWidth maxWidth="sm" aria-labelledby="session-setup-title"
    onClose={(_, reason) => { if (reason === 'escapeKeyDown') { if (preview) setPreview(undefined); else launcher.close(); } }}
    slotProps={{ paper: { className: 'session-setup-dialog' }, transition: {
      onEntered: () => { if (!focusedDraft.current && input.current) { input.current.focus(); focusedDraft.current = true; } },
      onExited: () => { if (!immersive) restoreFocus(); },
    } }}>
    <DialogTitle component="header" id="session-setup-header"><h2 id="session-setup-title">{settings?.codeai ? 'New CodeAI session' : 'New session'}</h2>
      <IconButton type="button" aria-label="Close setup" title="Close and keep draft" onClick={launcher.close}>×</IconButton></DialogTitle>
    <DialogContent className="session-setup-body">
    {launcher.busy ? <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 3 }}>
      <CircularProgress size={20} />
      {launcher.createdSession && launcher.hasContent ? 'Session created. Sending message…' : 'Starting session…'}
    </Box> : <>
    {launcher.preparing && !draft && <p role="status">Preparing CodeAI project…</p>}
    {open && draft && settings && <>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
        {settings.codeai ? <Typography variant="body2" color="text.secondary">{projectName}</Typography>
          : <NativeSelect disableUnderline inputProps={{ 'aria-label': 'Project' }} value={settings.projectId ?? ''} disabled={locked}
            sx={{ minWidth: 0, maxWidth: '100%', '& select': { textOverflow: 'ellipsis' } }}
            onChange={(event) => launcher.setSettings({ projectId: event.target.value || undefined, checkoutId: undefined })}>
            <option value="">No project</option>{launcher.machine?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </NativeSelect>}
        {targetDetails && <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{targetDetails}</Typography>}
      </Box>
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
        <TextField multiline fullWidth variant="standard" inputRef={input} value={draft.text} rows={4}
          slotProps={{ input: { disableUnderline: true }, htmlInput: { maxLength: 8_000, 'aria-label': 'First message (optional)' } }} disabled={launcher.frozen}
          placeholder="What would you like to work on?"
          onChange={(event) => launcher.setText(event.target.value)}
          onPaste={(event) => { const images = pastedImageFiles(event.clipboardData); if (images.length) { event.preventDefault(); void launcher.addFiles(images); } }}
          onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
          onDrop={(event) => { event.preventDefault(); void launcher.addFiles(Array.from(event.dataTransfer.files)); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !event.repeat) {
              event.preventDefault(); if (launcher.canSubmit) void launcher.submit();
            }
          }} />
        <div className="session-setup-attachments">
          {draft.images.map((image, index) => <AttachmentChip className="image" key={image.id}
            removeLabel={`Remove image ${index + 1}`} disabled={launcher.frozen} onRemove={() => launcher.removeImage(image.id)}>
            <Button type="button" variant="text" className="image-open" onClick={() => setPreview(image.id)} aria-label={`Preview image ${index + 1}`}><img src={image.dataUrl} alt={`Pending image ${index + 1}`} /></Button><span>Image {index + 1}</span>
          </AttachmentChip>)}
          {draft.files.map((file, index) => <AttachmentChip key={index} removeLabel={`Remove file ${file.name}`} disabled={launcher.frozen} onRemove={() => launcher.removeFile(index)}>
            <span>{file.name} · {new TextEncoder().encode(file.text).length} bytes</span>
          </AttachmentChip>)}
          {draft.reportIds.map((id) => <AttachmentChip className="report" key={id} removeLabel="Remove report attachment" disabled={launcher.frozen} onRemove={() => launcher.removeReport(id)}>
            <span>{launcher.reports.reports.find((report) => report.id === id) ? reportTitle(launcher.reports.reports.find((report) => report.id === id)!) : `Report ${id}`}</span>
          </AttachmentChip>)}
        </div>
        <input ref={files} hidden type="file" multiple onChange={(event) => { void launcher.addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
        <DesktopPopover group="composer-picker" className="session-setup-attach" label="Attach" summary={<>+ Attach</>} placement="bottom-start" disabled={launcher.preparing || launcher.frozen}>
          {(close) => <Box role="menu" aria-label="Attach to first message" sx={{ display: 'grid' }}>
            <Button role="menuitem" onClick={() => { files.current?.click(); close(); }}>Files or screenshot…</Button>
            {launcher.reports.available && <Button role="menuitem" onClick={() => { setReportsOpen(true); close(); }}>Attach CodeAI report</Button>}
          </Box>}
        </DesktopPopover>
      </Paper>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mt: 1 }}>
        <NativeSelect disableUnderline inputProps={{ 'aria-label': 'Provider' }} value={settings.provider} disabled={locked} onChange={(event) => launcher.setSettings({ provider: event.target.value as 'claude' | 'codex' })}>
          {(['claude', 'codex'] as const).map((provider) => <option key={provider} value={provider} disabled={!launcher.providers?.[provider]?.available}>{PROVIDER_LABELS[provider]}</option>)}
        </NativeSelect>
        <NativeSelect disableUnderline inputProps={{ 'aria-label': 'Mode' }} value={settings.mode} disabled={launcher.turnSettingsLocked} onChange={(event) => launcher.setSettings({ mode: event.target.value as SessionLaunchMode })}>
          {SESSION_LAUNCH_MODES.filter((mode) => mode !== 'auto' || launcher.modes.includes(mode)).map((mode) => <option key={mode} value={mode} disabled={!launcher.modes.includes(mode)}>{AGENT_MODE_LABELS[mode]}</option>)}
        </NativeSelect>
        <Button sx={{ ml: 'auto' }} aria-expanded={settingsOpen} aria-controls={settingsId} onClick={() => setSettingsOpen(!settingsOpen)}><span aria-hidden="true">⚙</span>&nbsp;Settings</Button>
      </Box>
      <Collapse in={settingsOpen} id={settingsId}>
        <div className="session-setup-fields">
        {settings.codeai ? <Typography component="p" variant="body2" color="text.secondary">{launcher.machine?.machine.label} · Local</Typography> : <>
          {(launcher.machines.length > 1 || !launcher.machine || launcher.machine.machine.state !== 'online') && <label><span>Machine</span><NativeSelect inputProps={{ 'aria-label': 'Machine' }} value={settings.machineId} disabled={locked} onChange={(event) => launcher.setSettings({ machineId: event.target.value })}>
            {!launcher.machine && <option value={settings.machineId} disabled>Unavailable machine</option>}
            {launcher.machines.map((entry) => <option key={entry.machine.id} value={entry.machine.id} disabled={entry.machine.state !== 'online'}>{entry.machine.label}{entry.machine.state !== 'online' && ' · Offline'}</option>)}
          </NativeSelect></label>}
          {!settings.projectId && <label><span>Repository</span><NativeSelect inputProps={{ 'aria-label': 'Repository' }} value={settings.checkoutId ?? ''} disabled={locked} onChange={(event) => launcher.setSettings({ checkoutId: event.target.value || undefined })}>
            <option value="">No repository</option>{launcher.machine?.checkouts.map((checkout) => <option key={checkout.id} value={checkout.id}>{checkout.name}</option>)}
          </NativeSelect></label>}
          {launcher.machine?.machine.kind === 'local' && launcher.dockerOffered && <label><span>Execution</span><NativeSelect inputProps={{ 'aria-label': 'Execution' }} value={settings.execution} disabled={locked} onChange={(event) => launcher.setSettings({ execution: event.target.value as 'local' | 'docker' })}>
            <option value="local">Local</option><option value="docker">Docker</option>
          </NativeSelect></label>}
        </>}
        <CheckoutChoice value={settings.checkoutMode} choice={launcher.checkoutChoice} disabled={locked} onChange={(checkoutMode) => launcher.setSettings({ checkoutMode })} />
        {Boolean(launcher.health?.models?.length || launcher.health?.efforts?.length) && <Box sx={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, my: 1 }}>
          <span>Model and effort</span>
          <ModelMenu choices={launcher.health} selection={settings.modelSelection} disabled={launcher.turnSettingsLocked} onChange={(modelSelection) => launcher.setSettings({ modelSelection })} />
        </Box>}
        <label><span>Global instructions</span><NativeSelect inputProps={{ 'aria-label': 'Global instructions' }} value={launchInstructions(settings.instructions, settings.execution, settings.provider) ?? 'default'} disabled={locked} onChange={(event) => launcher.setSettings({ instructions: event.target.value === 'default' ? undefined : event.target.value as 'global' | 'isolated' })}>
          <option value="default">Default</option><option value="global">Use</option><option value="isolated" title={settings.execution === 'local' && settings.provider === 'codex' ? 'Local Codex always loads your global AGENTS.md. Use Docker for an isolated Codex.' : undefined} disabled={isolatesLocalCodex('isolated', settings.execution, settings.provider)}>Isolate{settings.execution === 'local' && settings.provider === 'codex' ? ' · Docker only for Codex' : ''}</option>
        </NativeSelect></label>
        </div>
        {canDiscard && <Button color="inherit" disabled={launcher.frozen || launcher.preparing} title="Discard the message, attachments and session choices. Created sessions are kept." onClick={launcher.clear}>Discard draft</Button>}
      </Collapse>
      <Collapse in={reportsOpen && launcher.reports.available}>
        <Box component="section" aria-label="CodeAI reports" className="session-setup-reports" sx={{ mt: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button onClick={() => void launcher.reports.refresh()}>Refresh reports</Button>
            <Button onClick={() => setReportsOpen(false)}>Close reports</Button>
          </Box>
          {launcher.reports.loading && <p role="status">Loading reports…</p>}
          {!launcher.reports.loading && !launcher.reports.reports.length && <p>No reports available.</p>}
          {launcher.reports.reports.map((report) => <label key={report.id}>
            <Checkbox disabled={launcher.frozen} checked={draft.reportIds.includes(report.id)}
              onChange={(event) => event.target.checked ? launcher.attachReport(report.id) : launcher.removeReport(report.id)} />
            <span>{reportTitle(report)} · {reportDescription(report)} · {report.receivedAt} · {reportCaptureLabel(report.context, launcher.machines, settings.projectId)}</span>
            {report.screenshot && launcher.reports.projectId && <Button onClick={() => setPreview(report.id)}>Preview report screenshot</Button>}
          </label>)}
        </Box>
      </Collapse>
      {launcher.hasContent && !draft.text.trim() && <p className="session-setup-fallback">Initial message: {launchText({ text: draft.text, images: draft.images, files: draft.files, reportIds: draft.reportIds })}</p>}
      {settings.execution === 'docker' && <p>Agent edits this repository directly and runs commands without individual approvals. Mounted files, including ignored files, are accessible.</p>}
      {launcher.createdSession && <Button onClick={launcher.openCreated}>Open created session</Button>}
    </>}
    {open && previewUrl && <div className="session-setup-preview"><img src={previewUrl} alt="Attachment preview" /><Button onClick={() => setPreview(undefined)}>Close preview</Button></div>}
    {launcher.blocker && !launcher.error && <p role="status">{launcher.blocker}</p>}
    {launcher.targetNotice && <Alert severity="info" role="status">{launcher.targetNotice}</Alert>}
    {launcher.error && <Alert severity="error">{launcher.error}</Alert>}
    </>}
    </DialogContent>
    <DialogActions>
      {launcher.busy || !draft ? <Button autoFocus onClick={launcher.close}>Close</Button> : <Button variant="contained" disabled={!launcher.canSubmit} onClick={() => void launcher.submit()}>
        {launcher.error ? 'Retry' : launcher.hasContent ? 'Start in background' : 'Create and open'}
      </Button>}
    </DialogActions>
  </Dialog>;
}
