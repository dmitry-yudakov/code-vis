import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ImmersiveReportSummary } from '@/shared/immersiveReport';
import type { ThemeName } from '@/shared/design/tokens';
import { offeredEfforts } from '@/shared/modelChoices';
import { isolatesLocalCodex } from '@/shared/globalInstructions';
import { launchInstructions } from '@/features/shell/devicePreferences';
import { launchText } from '@/features/session-launch/sessionLaunch';
import type { SessionLauncher } from '@/features/session-launch/useSessionLauncher';
import { reportTitle, reportDescription, reportCaptureLabel } from '@/features/reports/reportModel';
import { immersiveReportPath } from '@/features/reports/useImmersiveReports';
import { immersiveChatLines } from '@/features/diagram/spatial/immersiveTranscript';
import { ConversationTools } from './ConversationTools';
import { centeredControlRow, centeredControlRows } from './conversationControls';
import type { ImmersiveConversationControls, ConversationActionName } from './conversationControls';
import { ReportPreview } from './SessionTools';
import { createConversationTextResource, createWorkspaceButtonResource } from './workspaceResources';
import { useTextureResource } from './useTextureResource';
import { WorkspacePager, WorldButton } from './WorkspacePanel';
import { immersiveTheme } from './immersiveTheme';
import { WORKTREE_BASELINE } from '@/features/conversation/worktreeChoice';

import { SETUP_ACTIONS, type SetupActionName } from './setupControls';
const cycle = <T,>(values: readonly T[], value: T) => values[(values.indexOf(value) + 1) % values.length];

/** A separate floating setup surface: no source panel, camera, or layout is changed to show it. */
export function SessionSetup({ launcher, theme, onCapture, onController }: {
  launcher: SessionLauncher; theme: ThemeName; onCapture(): void;
  onController(perform?: (action: SetupActionName | ConversationActionName, conversation?: boolean) => void): void;
}) {
  const [page, setPage] = useState<'message' | 'attachments' | 'settings' | 'agents'>('message');
  const [detailPage, setDetailPage] = useState(0);
  const [attachmentIndex, setAttachmentIndex] = useState(0);
  const conversation = useRef<((action: ConversationActionName) => void) | undefined>(undefined);
  const setConversation = useCallback((perform?: (action: ConversationActionName) => void) => { conversation.current = perform; }, []);
  const draft = launcher.draft; const settings = draft?.settings;
  const reports = launcher.reports.reports;
  const attachments: Array<{ label: string; report?: ImmersiveReportSummary; remove(): void }> = [...(draft?.images.map((image, index) => ({ label: `Image ${index + 1}`, image, remove: () => launcher.removeImage(image.id) })) ?? []),
    ...(draft?.files.map((file, index) => ({ label: `${file.name} · UTF-8 text`, remove: () => launcher.removeFile(index) })) ?? []),
    ...reports.map((report) => ({ label: reportTitle(report), report, remove: () => launcher.removeReport(report.id) })),
    ...(draft?.reportIds.filter((id) => !reports.some((report) => report.id === id)).map((id) => ({ label: `Report ${id}`, remove: () => launcher.removeReport(id) })) ?? [])];
  const selected = attachments[Math.min(attachmentIndex, attachments.length - 1)];
  const report = selected?.report;
  const locked = launcher.settingsLocked;
  const detail = launcher.error || launcher.blocker || (!draft ? launcher.preparing ? 'Preparing CodeAI project…' : 'Choose New session to start.'
    : page === 'attachments' ? [selected?.label ?? 'No attachments', report ? `${reportDescription(report)}\n${reportCaptureLabel(report.context, launcher.machines, settings?.projectId)}` : '',
      report ? draft.reportIds.includes(report.id) ? 'Attached to this message' : 'Choose Attach report' : '',
      'Prepare images and UTF-8 files on desktop; this headset has no verified file picker that keeps VR active.',
      launcher.reports.available ? 'Capture hides setup for the three-second aim countdown.' : 'CodeAI reports are available in CodeAI’s own project.'].filter(Boolean).join('\n\n')
    : page === 'settings' ? [`Machine: ${launcher.machine?.machine.label ?? 'Offline'}`, `Project: ${launcher.selectedProject?.name ?? 'No project'}`,
      `Repository: ${launcher.checkoutChoice.source?.name ?? settings?.checkoutId ?? 'No repository'}`, `Execution: ${settings?.execution}`,
      `Checkout: ${settings?.checkoutMode === 'worktree' ? 'Create a worktree' : 'Current checkout'}`,
      settings?.checkoutMode === 'worktree' ? WORKTREE_BASELINE : launcher.checkoutChoice.reason ?? ''].join('\n\n')
    : page === 'agents' ? [`Provider: ${settings?.provider}`, `Mode: ${settings?.mode}`, `Global instructions: ${settings ? launchInstructions(settings.instructions, settings.execution, settings.provider) ?? 'Default' : 'Default'}`,
      `Model: ${settings?.modelSelection.model ?? 'Default'}`, `Effort: ${settings?.modelSelection.effort ?? 'Default'}`,
      settings?.execution === 'docker' ? 'Docker Agent edits directly without individual approvals.' : ''].join('\n\n')
    : `${launcher.hasContent ? 'Start in background; keep this workspace open.' : 'An empty submission opens the new conversation.'}\n\n${launcher.hasContent && !draft.text.trim() ? launchText({ text: draft.text, images: draft.images, files: draft.files, reportIds: draft.reportIds }) : 'Type with the headset keyboard, or dictate and review your words.'}`);
  const text = settings ? `${launcher.machine?.machine.label ?? 'Offline'} · ${launcher.selectedProject?.name ?? settings.checkoutId ?? 'No project'} · ${settings.execution} · ${settings.provider} · ${settings.mode}\n\n${detail}` : detail;
  const surface = useTextureResource((ledger) => ({ geometry: ledger.trackGeometry(new THREE.PlaneGeometry(1.52, 1.92)),
    material: ledger.trackMaterial(new THREE.MeshBasicMaterial({ color: immersiveTheme[theme].raised, toneMapped: false })) }), [theme]);
  const lines = immersiveChatLines(text, page === 'attachments' && report?.screenshot ? 560 : 976, 38);
  const detailPages = Math.max(1, Math.ceil(lines.length / 8));
  const safeDetailPage = Math.min(detailPage, detailPages - 1);
  const body = useTextureResource((ledger) => createConversationTextResource(
    `${settings?.codeai ? 'New CodeAI session' : 'New session'}${detailPages > 1 ? ` · ${safeDetailPage + 1}/${detailPages}` : ''}`,
    lines.slice(safeDetailPage * 8, safeDetailPage * 8 + 8), theme, ledger), [text, theme, page, safeDetailPage, detailPages, settings?.codeai]);
  const buttons: SetupActionName[] = ['message', 'attachments', 'settings', 'close', ...(page === 'settings' || page === 'agents' ? ['agents' as const] : []),
    ...(page === 'attachments' ? ['previous', 'next', 'attach', 'remove', 'files', 'capture'] as const : page === 'settings'
      ? ['machine', 'project', 'repository', 'execution', 'checkout'] as const : page === 'agents'
        ? ['provider', 'mode', 'instructions', 'model', 'effort'] as const : []),
    'clear', ...(launcher.createdSession ? ['open' as const] : []), ...(page !== 'message' || launcher.error ? ['submit' as const] : [])];
  const resources = useTextureResource((ledger) => Object.fromEntries(buttons.map((action) => [action, createWorkspaceButtonResource(SETUP_ACTIONS[action], theme, ledger)])), [buttons.join(','), theme]);
  const disabled = (action: SetupActionName) => {
    if (action === 'close') return false;
    if (action === 'files') return true;
    if (action === 'older') return safeDetailPage === 0;
    if (action === 'newer') return safeDetailPage >= detailPages - 1;
    if (launcher.voicePending) return true;
    if (['message', 'attachments', 'settings', 'agents'].includes(action)) return false;
    if (action === 'open') return launcher.busy;
    if (action === 'submit') return !launcher.canSubmit;
    if (action === 'clear') return launcher.busy || launcher.frozen;
    if (['machine', 'project', 'repository', 'execution'].includes(action) && settings?.codeai) return true;
    if (['mode', 'model', 'effort'].includes(action)) return launcher.turnSettingsLocked;
    if (['machine', 'project', 'repository', 'execution', 'checkout', 'provider', 'instructions'].includes(action)) return locked;
    if (action === 'capture') return launcher.captureToken() === undefined;
    if (action === 'attach') return !report || draft?.reportIds.includes(report.id) || launcher.frozen;
    if (action === 'remove') return !selected || launcher.frozen;
    return launcher.busy || launcher.frozen;
  };
  const perform = (action: SetupActionName | ConversationActionName, isConversation = false) => {
    if (isConversation) { if (page === 'message') conversation.current?.(action as ConversationActionName); return; }
    const command = action as SetupActionName;
    if (disabled(command)) return;
    if (['message', 'attachments', 'settings', 'agents'].includes(command)) { setPage(command as typeof page); setDetailPage(0); return; }
    if (command === 'older' || command === 'newer') { setDetailPage((value) => value + (command === 'newer' ? 1 : -1)); return; }
    if (command === 'close') { launcher.close(); return; }
    if (command === 'clear') { launcher.clear(); return; }
    if (command === 'submit') { void launcher.submit(); return; }
    if (command === 'open') { launcher.openCreated(); return; }
    if (command === 'previous' || command === 'next') { setAttachmentIndex((value) => (value + (command === 'next' ? 1 : -1) + attachments.length) % Math.max(1, attachments.length)); return; }
    if (command === 'attach' && report) { launcher.attachReport(report.id); return; }
    if (command === 'remove') { selected?.remove(); return; }
    if (command === 'capture') { onCapture(); return; }
    if (!settings) return;
    if (command === 'machine') launcher.setSettings({ machineId: cycle(launcher.machines.filter((entry) => entry.machine.state === 'online').map((entry) => entry.machine.id), settings.machineId) });
    else if (command === 'project') launcher.setSettings({ projectId: cycle([undefined, ...launcher.machine?.projects.map((project) => project.id) ?? []], settings.projectId), checkoutId: undefined });
    else if (command === 'repository' && !settings.projectId) launcher.setSettings({ checkoutId: cycle([undefined, ...launcher.machine?.checkouts.map((checkout) => checkout.id) ?? []], settings.checkoutId) });
    else if (command === 'execution' && launcher.dockerOffered && launcher.machine?.machine.kind === 'local') launcher.setSettings({ execution: settings.execution === 'local' ? 'docker' : 'local' });
    else if (command === 'checkout') launcher.setSettings({ checkoutMode: settings.checkoutMode === 'current' && launcher.checkoutChoice.available ? 'worktree' : 'current' });
    else if (command === 'provider') launcher.setSettings({ provider: cycle((['claude', 'codex'] as const).filter((value) => launcher.providers?.[value].available), settings.provider) });
    else if (command === 'mode') launcher.setSettings({ mode: cycle(launcher.modes, settings.mode) });
    else if (command === 'instructions') launcher.setSettings({ instructions: cycle(([undefined, 'global', 'isolated'] as const).filter((value) => !isolatesLocalCodex(value, settings.execution, settings.provider)), settings.instructions) });
    else if (command === 'model') launcher.setSettings({ modelSelection: { model: cycle([undefined, ...launcher.health?.models?.map((model) => model.id) ?? []], settings.modelSelection.model) } });
    else if (command === 'effort') launcher.setSettings({ modelSelection: { ...settings.modelSelection, effort: cycle([undefined, ...offeredEfforts(launcher.health, settings.modelSelection.model)], settings.modelSelection.effort) } });
  };
  useEffect(() => { onController(perform); return () => onController(undefined); });
  const controls: ImmersiveConversationControls | undefined = draft && settings ? { draft: draft.text,
    target: 'New session', attachments: [...draft.files.map((file) => file.name), ...draft.images.map((_, i) => `Image ${i + 1}`), ...draft.reportIds.map(() => 'Report')],
    canSend: launcher.canSubmit, sendBlocked: launcher.error || launcher.blocker, running: launcher.busy || launcher.frozen, runStatus: launcher.error ?? 'Starting…', busy: launcher.preparing,
    agents: [], providers: [settings.provider], mode: settings.mode, unsupportedModes: ['auto', 'edits', 'full'],
    onDraft: launcher.setText, onSend: () => { void launcher.submit(); }, onCancel: () => undefined,
    onMode: () => undefined, onSelectAgent: () => undefined, onAddAgent: () => undefined, onMakePrimary: () => undefined } : undefined;
  const topRow = centeredControlRow(buttons.slice(0, 4).map((key) => ({ key, width: resources?.[key]?.width ?? .3 })));
  const footerRow = centeredControlRow(buttons.filter((item) => ['clear', 'open', 'submit'].includes(item)).map((key) => ({ key, width: resources?.[key]?.width ?? .3 })));
  const middleActions = buttons.filter((item) => !['message', 'attachments', 'settings', 'close', 'clear', 'open', 'submit'].includes(item));
  const middleRows = centeredControlRows(middleActions.map((key) => ({ key, width: resources?.[key]?.width ?? .3 })), 1.32, .03);
  const bodyMesh = body && <mesh name="Session setup details" geometry={body.geometry} material={body.material} position-y={.2} userData={{ text }} />;
  return <group name="Session setup" userData={{ setupPage: page, draft: draft?.text, frozen: launcher.frozen }}>
    {surface && <mesh geometry={surface.geometry} material={surface.material} position-z={-0.01} />}
    {page !== 'message' && bodyMesh}
    {detailPages > 1 && page !== 'message' && <WorkspacePager label="Details" previousAction="setup:older" nextAction="setup:newer" previousLabel="Previous details" nextLabel="More details"
      theme={theme} position={[0, -.28, .002]} previousDisabled={safeDetailPage === 0} nextDisabled={safeDetailPage === detailPages - 1}
      onAction={(action) => perform(action.slice(6) as SetupActionName)} />}
    {page === 'attachments' && report?.screenshot && launcher.reports.projectId && <ReportPreview url={immersiveReportPath(launcher.reports.projectId, report.id, true)} theme={theme} />}
    {buttons.map((action, index) => {
      const top = index < 4; const middle = !top && !['clear', 'open', 'submit'].includes(action);
      const row = middleRows.findIndex((positions) => positions.has(action));
      const position: [number, number, number] = top ? [topRow.get(action) ?? 0, .85, .002]
        : middle ? [middleRows[row]?.get(action) ?? 0, -.40 - row * .17, .002]
          : [footerRow.get(action) ?? 0, -.89, .002];
      return <WorldButton key={action} action={`setup:${action}`} label={SETUP_ACTIONS[action]} resource={resources?.[action]} iconTheme={theme}
        disabled={disabled(action)} position={position} selected={page === action} onAction={() => perform(action)} />;
    })}
    {page === 'message' && <ConversationTools setupInput controls={controls} theme={theme} enabled={!launcher.busy && !launcher.frozen} tab="compose" atBottom
      collapsedContent={bodyMesh} renderHistory={() => null} onTab={() => undefined} onLatest={() => undefined} onVoicePending={launcher.setVoicePending} onController={setConversation} />}
  </group>;
}

export function SessionSetupOutcome({ launcher, theme }: { launcher: SessionLauncher; theme: ThemeName }) {
  const resource = useTextureResource((ledger) => launcher.outcome ? createWorkspaceButtonResource('Open new session', theme, ledger) : undefined, [launcher.outcome?.session.id, theme]);
  return launcher.outcome && <WorldButton action="setup:outcome" label="Open new session" resource={resource} iconTheme={theme}
    position={[0, .43, 0]} onAction={launcher.openOutcome} />;
}
