'use client';

import Alert from '@mui/material/Alert';

import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import { AttachmentChip } from '@/features/conversation/AttachmentChip';
import TextField from '@mui/material/TextField';
import { Disclosure } from '@/features/shell/Disclosure';
import Checkbox from '@mui/material/Checkbox';
import NativeSelect from '@mui/material/NativeSelect';

import { useEffect, useRef, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import { useDialogFocus } from '@/features/shell/useDialogFocus';
import { CheckoutChoice } from '@/features/conversation/CheckoutChoice';
import { ModelMenu } from '@/features/conversation/InstructionComposer';
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
  const input = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const focusedDraft = useRef(false);
  const open = launcher.isOpen && !immersive;
  const restoreFocus = useDialogFocus(open, '.more-menu > button', launcher.opener.current);
  useEffect(() => {
    if (!launcher.isOpen) setPreview(undefined);
    if (!open) focusedDraft.current = false;
    if (open && launcher.draft && !focusedDraft.current && input.current) { input.current.focus(); focusedDraft.current = true; }
  }, [open, launcher.isOpen, Boolean(launcher.draft)]);
  const draft = launcher.draft;
  const settings = draft?.settings;
  const locked = launcher.settingsLocked;
  const previewImage = draft?.images.find((image) => image.id === preview);
  const previewReport = launcher.reports.reports.find((report) => report.id === preview && report.screenshot);
  const previewUrl = previewImage?.dataUrl ?? (previewReport && launcher.reports.available && launcher.reports.projectId
    ? immersiveReportPath(launcher.reports.projectId, previewReport.id, true) : undefined);
  return <Dialog open={open} keepMounted disableRestoreFocus aria-labelledby="session-setup-title"
    onClose={(_, reason) => { if (reason === 'escapeKeyDown') { if (preview) setPreview(undefined); else launcher.close(); } }}
    slotProps={{ paper: { className: 'session-setup-dialog' }, transition: {
      onEntered: () => { if (!focusedDraft.current && input.current) { input.current.focus(); focusedDraft.current = true; } },
      onExited: () => { if (!immersive) restoreFocus(); },
    } }}>
    <DialogTitle component="header" id="session-setup-header"><h2 id="session-setup-title">{settings?.codeai ? 'New CodeAI session' : 'New session'}</h2>
      <IconButton type="button" aria-label="Close setup" onClick={launcher.close}>×</IconButton></DialogTitle>
    <DialogContent dividers className="session-setup-body">
    {launcher.preparing && !draft && <p role="status">Preparing CodeAI project…</p>}
    {draft && settings && <>
      <label className="session-setup-message"><span>First message (optional)</span>
        <TextField multiline inputRef={input} value={draft.text} rows={4} slotProps={{ htmlInput: { maxLength: 8_000 } }} disabled={launcher.busy || launcher.frozen}
          placeholder="Describe the task, or leave empty to open a conversation…"
          onChange={(event) => launcher.setText(event.target.value)}
          onPaste={(event) => { const images = pastedImageFiles(event.clipboardData); if (images.length) { event.preventDefault(); void launcher.addFiles(images); } }}
          onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
          onDrop={(event) => { event.preventDefault(); void launcher.addFiles(Array.from(event.dataTransfer.files)); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !event.repeat) {
              event.preventDefault(); if (launcher.canSubmit) void launcher.submit();
            }
          }} />
      </label>
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
      <Button type="button" disabled={launcher.preparing || launcher.frozen} onClick={() => files.current?.click()}>Attach files or screenshot</Button>
      {launcher.reports.available && <Disclosure className="session-setup-reports" title={<>Attach CodeAI report</>}>
        <Button type="button" onClick={() => void launcher.reports.refresh()}>Refresh reports</Button>
        {launcher.reports.reports.map((report) => <label key={report.id}>
          <Checkbox disabled={launcher.frozen} checked={draft.reportIds.includes(report.id)}
            onChange={(event) => event.target.checked ? launcher.attachReport(report.id) : launcher.removeReport(report.id)} />
          <span>{reportTitle(report)} · {reportDescription(report)} · {report.receivedAt} · {reportCaptureLabel(report.context, launcher.machines, settings.projectId)}</span>
          {report.screenshot && launcher.reports.projectId && <Button type="button" onClick={() => setPreview(report.id)}>Preview report screenshot</Button>}
        </label>)}
      </Disclosure>}
      {launcher.hasContent && !draft.text.trim() && <p className="session-setup-fallback">Initial message: {launchText({ text: draft.text, images: draft.images, files: draft.files, reportIds: draft.reportIds })}</p>}
      <p className="session-setup-target">{launcher.machine?.machine.label} · {launcher.selectedProject?.name ?? launcher.checkoutChoice.source?.name ?? 'No project'} · {settings.execution === 'local' ? 'Local' : 'Docker'} · {PROVIDER_LABELS[settings.provider]} · {AGENT_MODE_LABELS[settings.mode]}</p>
      <Disclosure className="session-setup-settings" defaultExpanded title={<>Session settings</>}>
        <div className="session-setup-fields">
        {settings.codeai ? <p>CodeAI · {launcher.machine?.machine.label} · Local · {launcher.selectedProject?.name}</p> : <>
          <label><span>Machine</span><NativeSelect inputProps={{ 'aria-label': "Machine" }} value={settings.machineId} disabled={locked} onChange={(event) => launcher.setSettings({ machineId: event.target.value })}>
            {launcher.machines.filter((entry) => entry.machine.state === 'online').map((entry) => <option key={entry.machine.id} value={entry.machine.id}>{entry.machine.label}</option>)}
          </NativeSelect></label>
          <label><span>Project</span><NativeSelect inputProps={{ 'aria-label': "Project" }} value={settings.projectId ?? ''} disabled={locked} onChange={(event) => launcher.setSettings({ projectId: event.target.value || undefined, checkoutId: undefined })}>
            <option value="">No project</option>{launcher.machine?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </NativeSelect></label>
          {!settings.projectId && <label><span>Repository</span><NativeSelect inputProps={{ 'aria-label': "Repository" }} value={settings.checkoutId ?? ''} disabled={locked} onChange={(event) => launcher.setSettings({ checkoutId: event.target.value || undefined })}>
            <option value="">No repository</option>{launcher.machine?.checkouts.map((checkout) => <option key={checkout.id} value={checkout.id}>{checkout.name}</option>)}
          </NativeSelect></label>}
          {launcher.machine?.machine.kind === 'local' && launcher.dockerOffered && <label><span>Execution</span><NativeSelect inputProps={{ 'aria-label': "Execution" }} value={settings.execution} disabled={locked} onChange={(event) => launcher.setSettings({ execution: event.target.value as 'local' | 'docker' })}>
            <option value="local">Local</option><option value="docker">Docker</option>
          </NativeSelect></label>}
        </>}
        {settings.execution === 'docker' && <p>Agent edits this repository directly and runs commands without individual approvals. Mounted files, including ignored files, are accessible.</p>}
        <CheckoutChoice value={settings.checkoutMode} choice={launcher.checkoutChoice} disabled={locked} onChange={(checkoutMode) => launcher.setSettings({ checkoutMode })} />
        <label><span>Provider</span><NativeSelect inputProps={{ 'aria-label': "Provider" }} value={settings.provider} disabled={locked} onChange={(event) => launcher.setSettings({ provider: event.target.value as 'claude' | 'codex' })}>
          {(['claude', 'codex'] as const).map((provider) => <option key={provider} value={provider} disabled={!launcher.providers?.[provider]?.available}>{PROVIDER_LABELS[provider]}</option>)}
        </NativeSelect></label>
        <label><span>Mode</span><NativeSelect inputProps={{ 'aria-label': "Mode" }} value={settings.mode} disabled={launcher.turnSettingsLocked} onChange={(event) => launcher.setSettings({ mode: event.target.value as SessionLaunchMode })}>
          {SESSION_LAUNCH_MODES.filter((mode) => mode !== 'auto' || launcher.modes.includes(mode)).map((mode) => <option key={mode} value={mode} disabled={!launcher.modes.includes(mode)}>{AGENT_MODE_LABELS[mode]}</option>)}
        </NativeSelect></label>
        <ModelMenu choices={launcher.health} selection={settings.modelSelection} disabled={launcher.turnSettingsLocked} onChange={(modelSelection) => launcher.setSettings({ modelSelection })} />
        </div>
      </Disclosure>
      <Disclosure className="session-advanced-settings" title={<>Advanced settings</>}>

        <label><span>Global instructions</span><NativeSelect inputProps={{ 'aria-label': "Global instructions" }} value={launchInstructions(settings.instructions, settings.execution, settings.provider) ?? 'default'} disabled={locked} onChange={(event) => launcher.setSettings({ instructions: event.target.value === 'default' ? undefined : event.target.value as 'global' | 'isolated' })}>
          <option value="default">Default</option><option value="global">Use</option><option value="isolated" title={settings.execution === 'local' && settings.provider === 'codex' ? 'Local Codex always loads your global AGENTS.md. Use Docker for an isolated Codex.' : undefined} disabled={isolatesLocalCodex('isolated', settings.execution, settings.provider)}>Isolate{settings.execution === 'local' && settings.provider === 'codex' ? ' · Docker only for Codex' : ''}</option>
        </NativeSelect></label>
      </Disclosure>
      <p>{launcher.hasContent ? 'Start in the background. Your current workspace stays open.' : 'Open the new session and start a conversation.'}</p>
      {launcher.createdSession && <Button type="button" onClick={launcher.openCreated}>Open created session</Button>}
    </>}
    {launcher.isOpen && previewUrl && <div className="session-setup-preview"><img src={previewUrl} alt="Attachment preview" /><Button type="button" onClick={() => setPreview(undefined)}>Close preview</Button></div>}
    {launcher.blocker && !launcher.error && <p role="status">{launcher.blocker}</p>}
    {launcher.error && <Alert severity="error">{launcher.error}</Alert>}
    </DialogContent>
    <DialogActions><Button type="button" onClick={launcher.close}>Cancel</Button>
      <Button type="button" disabled={launcher.busy || launcher.frozen} onClick={launcher.clear}>Clear setup</Button>
      <Button type="button" className="arena-primary" disabled={!launcher.canSubmit} onClick={() => void launcher.submit()}>
        {launcher.busy ? 'Starting…' : launcher.error ? 'Retry' : launcher.hasContent ? 'Start in background' : 'Create and open'}
      </Button></DialogActions>
  </Dialog>;
}
