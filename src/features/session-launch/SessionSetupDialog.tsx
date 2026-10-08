'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckoutChoice } from '@/features/conversation/CheckoutChoice';
import { ModelMenu } from '@/features/conversation/InstructionComposer';
import { reportCaptureLabel, reportDescription, reportTitle } from '@/features/reports/reportModel';
import { immersiveReportPath } from '@/features/reports/useImmersiveReports';
import { pastedImageFiles } from '@/features/conversation/imageAttachments';
import { launchInstructions } from '@/features/shell/devicePreferences';
import { AGENT_MODE_LABELS } from '@/features/agents/toolActivity';
import { PROVIDER_LABELS } from '@/shared/participants';
import { isolatesLocalCodex } from '@/shared/globalInstructions';
import { launchText } from './sessionLaunch';
import type { SessionLauncher } from './useSessionLauncher';

export function SessionSetupDialog({ launcher, immersive }: { launcher: SessionLauncher; immersive: boolean }) {
  const [preview, setPreview] = useState<string>();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const focusedDraft = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!launcher.isOpen) setPreview(undefined);
    const element = dialog.current;
    if (!element) return;
    if (launcher.isOpen && !immersive) {
      if (!element.open) {
        opener.current = launcher.opener.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
        element.showModal();
        focusedDraft.current = false;
      }
      if (launcher.draft && !focusedDraft.current) { input.current?.focus(); focusedDraft.current = true; }
    } else if (element.open) {
      const focused = document.activeElement;
      const restore = !immersive && (element.contains(focused) || focused === document.body);
      element.close();
      if (restore && opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    }
  }, [immersive, launcher.isOpen, Boolean(launcher.draft)]);
  const draft = launcher.draft;
  const settings = draft?.settings;
  const locked = launcher.settingsLocked;
  const previewImage = draft?.images.find((image) => image.id === preview);
  const previewReport = launcher.reports.reports.find((report) => report.id === preview && report.screenshot);
  const previewUrl = previewImage?.dataUrl ?? (previewReport && launcher.reports.available && launcher.reports.projectId
    ? immersiveReportPath(launcher.reports.projectId, previewReport.id, true) : undefined);
  return <dialog ref={dialog} className="session-setup-dialog" aria-labelledby="session-setup-title"
    onCancel={(event) => { event.preventDefault(); launcher.close(); }}>
    <header><h2 id="session-setup-title">{settings?.codeai ? 'New CodeAI session' : 'New session'}</h2>
      <button type="button" aria-label="Close setup" onClick={launcher.close}>×</button></header>
    <div className="session-setup-body">
    {launcher.preparing && !draft && <p role="status">Preparing CodeAI project…</p>}
    {draft && settings && <>
      <label className="session-setup-message"><span>First message (optional)</span>
        <textarea ref={input} value={draft.text} rows={4} maxLength={8_000} disabled={launcher.busy || launcher.frozen}
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
        {draft.images.map((image, index) => <span className="attachment-chip image" key={image.id}>
          <button type="button" className="image-open" onClick={() => setPreview(image.id)} aria-label={`Preview image ${index + 1}`}><img src={image.dataUrl} alt={`Pending image ${index + 1}`} /></button><span>Image {index + 1}</span>
          <button type="button" aria-label={`Remove image ${index + 1}`} disabled={launcher.frozen} onClick={() => launcher.removeImage(image.id)}>×</button>
        </span>)}
        {draft.files.map((file, index) => <span className="attachment-chip" key={index}><span>{file.name} · {new TextEncoder().encode(file.text).length} bytes</span>
          <button type="button" aria-label={`Remove file ${file.name}`} disabled={launcher.frozen} onClick={() => launcher.removeFile(index)}>×</button></span>)}
        {draft.reportIds.map((id) => <span className="attachment-chip report" key={id}><span>{launcher.reports.reports.find((report) => report.id === id) ? reportTitle(launcher.reports.reports.find((report) => report.id === id)!) : `Report ${id}`}</span>
          <button type="button" aria-label="Remove report attachment" disabled={launcher.frozen} onClick={() => launcher.removeReport(id)}>×</button></span>)}
      </div>
      <input ref={files} hidden type="file" multiple onChange={(event) => { void launcher.addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      <button type="button" disabled={launcher.preparing || launcher.frozen} onClick={() => files.current?.click()}>Attach files or screenshot</button>
      {launcher.reports.available && <details className="session-setup-reports"><summary>Attach CodeAI report</summary>
        <button type="button" onClick={() => void launcher.reports.refresh()}>Refresh reports</button>
        {launcher.reports.reports.map((report) => <label key={report.id}>
          <input type="checkbox" disabled={launcher.frozen} checked={draft.reportIds.includes(report.id)}
            onChange={(event) => event.target.checked ? launcher.attachReport(report.id) : launcher.removeReport(report.id)} />
          <span>{reportTitle(report)} · {reportDescription(report)} · {report.receivedAt} · {reportCaptureLabel(report.context, launcher.machines, settings.projectId)}</span>
          {report.screenshot && launcher.reports.projectId && <button type="button" onClick={() => setPreview(report.id)}>Preview report screenshot</button>}
        </label>)}
      </details>}
      {launcher.hasContent && !draft.text.trim() && <p className="session-setup-fallback">Initial message: {launchText({ text: draft.text, images: draft.images, files: draft.files, reportIds: draft.reportIds })}</p>}
      <p className="session-setup-target">{launcher.machine?.machine.label} · {launcher.selectedProject?.name ?? launcher.checkoutChoice.source?.name ?? 'No project'} · {settings.execution === 'local' ? 'Local' : 'Docker'} · {PROVIDER_LABELS[settings.provider]} · {AGENT_MODE_LABELS[settings.mode]}</p>
      <details className="session-setup-settings" open><summary>Session settings</summary>
        <div className="session-setup-fields">
        {settings.codeai ? <p>CodeAI · {launcher.machine?.machine.label} · Local · {launcher.selectedProject?.name}</p> : <>
          <label><span>Machine</span><select aria-label="Machine" value={settings.machineId} disabled={locked} onChange={(event) => launcher.setSettings({ machineId: event.target.value })}>
            {launcher.machines.filter((entry) => entry.machine.state === 'online').map((entry) => <option key={entry.machine.id} value={entry.machine.id}>{entry.machine.label}</option>)}
          </select></label>
          <label><span>Project</span><select aria-label="Project" value={settings.projectId ?? ''} disabled={locked} onChange={(event) => launcher.setSettings({ projectId: event.target.value || undefined, checkoutId: undefined })}>
            <option value="">No project</option>{launcher.machine?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select></label>
          {!settings.projectId && <label><span>Repository</span><select aria-label="Repository" value={settings.checkoutId ?? ''} disabled={locked} onChange={(event) => launcher.setSettings({ checkoutId: event.target.value || undefined })}>
            <option value="">No repository</option>{launcher.machine?.checkouts.map((checkout) => <option key={checkout.id} value={checkout.id}>{checkout.name}</option>)}
          </select></label>}
          {launcher.machine?.machine.kind === 'local' && launcher.dockerOffered && <label><span>Execution</span><select aria-label="Execution" value={settings.execution} disabled={locked} onChange={(event) => launcher.setSettings({ execution: event.target.value as 'local' | 'docker' })}>
            <option value="local">Local</option><option value="docker">Docker</option>
          </select></label>}
        </>}
        {settings.execution === 'docker' && <p>Agent edits this repository directly and runs commands without individual approvals. Mounted files, including ignored files, are accessible.</p>}
        <CheckoutChoice value={settings.checkoutMode} choice={launcher.checkoutChoice} disabled={locked} onChange={(checkoutMode) => launcher.setSettings({ checkoutMode })} />
        <label><span>Provider</span><select aria-label="Provider" value={settings.provider} disabled={locked} onChange={(event) => launcher.setSettings({ provider: event.target.value as 'claude' | 'codex' })}>
          {(['claude', 'codex'] as const).map((provider) => <option key={provider} value={provider} disabled={!launcher.providers?.[provider]?.available}>{PROVIDER_LABELS[provider]}</option>)}
        </select></label>
        <label><span>Mode</span><select aria-label="Mode" value={settings.mode} disabled={launcher.turnSettingsLocked} onChange={(event) => launcher.setSettings({ mode: event.target.value as 'ask' | 'plan' | 'agent' })}>
          {(['ask', 'plan', 'agent'] as const).map((mode) => <option key={mode} value={mode} disabled={!launcher.modes.includes(mode)}>{AGENT_MODE_LABELS[mode]}</option>)}
        </select></label>
        <label><span>Global instructions</span><select aria-label="Global instructions" value={launchInstructions(settings.instructions, settings.execution, settings.provider) ?? 'default'} disabled={locked} onChange={(event) => launcher.setSettings({ instructions: event.target.value === 'default' ? undefined : event.target.value as 'global' | 'isolated' })}>
          <option value="default">Default</option><option value="global">Use</option><option value="isolated" title={settings.execution === 'local' && settings.provider === 'codex' ? 'Local Codex always loads your global AGENTS.md. Use Docker for an isolated Codex.' : undefined} disabled={isolatesLocalCodex('isolated', settings.execution, settings.provider)}>Isolate{settings.execution === 'local' && settings.provider === 'codex' ? ' · Docker only for Codex' : ''}</option>
        </select></label>
        <ModelMenu choices={launcher.health} selection={settings.modelSelection} disabled={launcher.turnSettingsLocked} onChange={(modelSelection) => launcher.setSettings({ modelSelection })} />
        </div>
      </details>
      <p>{launcher.hasContent ? 'Start in the background. Your current workspace stays open.' : 'Open the new session and start a conversation.'}</p>
      {launcher.createdSession && <button type="button" onClick={launcher.openCreated}>Open created session</button>}
    </>}
    {launcher.isOpen && previewUrl && <div className="session-setup-preview"><img src={previewUrl} alt="Attachment preview" /><button type="button" onClick={() => setPreview(undefined)}>Close preview</button></div>}
    {launcher.blocker && !launcher.error && <p role="status">{launcher.blocker}</p>}
    {launcher.error && <p role="alert">{launcher.error}</p>}
    </div>
    <footer><button type="button" onClick={launcher.close}>Cancel</button>
      <button type="button" disabled={launcher.busy || launcher.frozen} onClick={launcher.clear}>Clear setup</button>
      <button type="button" className="arena-primary" disabled={!launcher.canSubmit} onClick={() => void launcher.submit()}>
        {launcher.busy ? 'Starting…' : launcher.error ? 'Retry' : launcher.hasContent ? 'Start in background' : 'Create and open'}
      </button></footer>
  </dialog>;
}
