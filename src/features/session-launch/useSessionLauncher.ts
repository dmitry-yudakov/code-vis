'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArenaMachineSnapshot, DurableProject, ExecutionHealth, PublicSession } from '@/shared/types';
import type { CodeAiSessionAvailability, PreparedCodeAiContext } from '@/shared/codeAiSession';
import { nativeClaudeIsolationIssue } from '@/shared/globalInstructions';
import { offeredModelSelection } from '@/shared/modelChoices';
import { createUuid } from '@/shared/uuid';
import { MAX_IMAGES_PER_MESSAGE, MAX_REPORTS_PER_MESSAGE } from '@/shared/limits';
import { validateTextFiles, type TextFile } from '@/shared/textFiles';
import { prepareTextFile } from '@/features/conversation/textFiles';
import { prepareImage, type PendingImage } from '@/features/conversation/imageAttachments';
import { worktreeChoice } from '@/features/conversation/worktreeChoice';
import { useImmersiveReports } from '@/features/reports/useImmersiveReports';
import type { ImmersiveReportSummary } from '@/shared/immersiveReport';
import { launchChoice, launchModes, type DevicePreferences } from '@/features/shell/devicePreferences';
import { LaunchFailure, launchSession, launchText, type LaunchAttempt, type LaunchResult, type LaunchSettings } from './sessionLaunch';

interface Draft { settings: LaunchSettings; text: string; images: PendingImage[]; files: TextFile[]; reportIds: string[] }
interface SetupState { open: boolean; draft?: Draft; busy: boolean; preparing: boolean; voicePending: boolean; error?: string; frozen: boolean; outcome?: LaunchResult & { settings: LaunchSettings } }
export interface LauncherOptions {
  authorized: boolean; localMachineId?: string; machines: ArenaMachineSnapshot[]; executions?: ExecutionHealth;
  preferences: DevicePreferences; currentMachineId?: string; currentProjectId?: string; origin: string;
  onSubmit(): void;
  onCreated(session: PublicSession, settings: LaunchSettings): void;
  onResult(result: LaunchResult, settings: LaunchSettings, autoOpen: boolean): void;
  onOpen(session: PublicSession, settings: LaunchSettings): void;
}

/** One private, memory-only draft, shared by the desktop dialog and immersive setup. */
export function useSessionLauncher(options: LauncherOptions) {
  const [state, setState] = useState<SetupState>({ open: false, busy: false, preparing: false, voicePending: false, frozen: false });
  const current = useRef(state); current.current = state;
  const props = useRef(options); props.current = options;
  const generation = useRef(0);
  const opener = useRef<HTMLElement | null>(null);
  const captureGeneration = useRef(0);
  const attempt = useRef<LaunchAttempt | undefined>(undefined);
  const [availabilityError, setAvailabilityError] = useState<string>();
  const [availability, setAvailability] = useState<CodeAiSessionAvailability>();
  const availabilityRequest = useRef(0);
  const [selfProject, setSelfProject] = useState<DurableProject>();
  const patch = (update: Partial<SetupState>) => { current.current = { ...current.current, ...update }; setState(current.current); };
  const draft = state.draft;
  const machine = options.machines.find((entry) => entry.machine.id === draft?.settings.machineId);
  const selectedProject = draft?.settings.codeai ? selfProject : machine?.projects.find((project) => project.id === draft?.settings.projectId);
  const providers = draft?.settings.execution === 'docker' && machine?.machine.kind === 'local'
    ? options.executions?.docker.providers : machine?.machine.kind === 'local' ? options.executions?.local.providers ?? machine.providers : machine?.providers;
  const health = draft && providers?.[draft.settings.provider];
  const modes = launchModes(health?.supportedModes);
  const checkoutChoice = worktreeChoice({ execution: draft?.settings.execution, project: selectedProject,
    checkoutId: draft?.settings.checkoutId, checkouts: machine?.checkouts ?? [], hostId: machine?.machine.id, capability: machine?.worktrees });
  const reports = useImmersiveReports(state.open && draft && draft.settings.machineId === options.localMachineId ? draft.settings.projectId : undefined);
  const refreshAvailability = async () => {
    const serial = ++availabilityRequest.current;
    if (!props.current.authorized) { setAvailability(undefined); return; }
    try {
      const response = await fetch('/api/codeai-session', { cache: 'no-store' });
      const data = await response.json() as CodeAiSessionAvailability;
      if (serial === availabilityRequest.current) { if (!response.ok) throw new Error('Could not check CodeAI session availability.'); setAvailability(data); setAvailabilityError(undefined); }
    } catch { if (serial === availabilityRequest.current) setAvailabilityError('Could not check CodeAI session availability. Retry.'); }
  };
  useEffect(() => {
    void refreshAvailability();
    if (!options.authorized) {
      generation.current++; captureGeneration.current++; attempt.current = undefined; setSelfProject(undefined);
      patch({ open: false, draft: undefined, outcome: undefined, frozen: false, busy: false, preparing: false, voicePending: false, error: undefined });
    }
    // Availability belongs to the paired home, independently of the selected project or executor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.authorized]);
  useEffect(() => () => { generation.current++; availabilityRequest.current++; }, []);

  const defaults = (target?: ArenaMachineSnapshot, projectId?: string): LaunchSettings | undefined => {
    if (!target) return;
    const providers = target.machine.kind === 'local' ? props.current.executions?.local.providers ?? target.providers : target.providers;
    const fallback = Object.entries(providers ?? {}).find(([, value]) => value.available && launchModes(value.supportedModes).length)?.[0] as LaunchSettings['provider'] | undefined;
    const choice = launchChoice(props.current.preferences, providers, { provider: fallback ?? 'claude', mode: 'ask' });
    return { machineId: target.machine.id, projectId, execution: 'local', checkoutMode: 'current', ...choice,
      instructions: props.current.preferences.instructions,
      modelSelection: offeredModelSelection(props.current.preferences.models?.[choice.provider], providers?.[choice.provider]) };
  };
  const open = () => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!props.current.authorized) return;
    if (current.current.draft) { patch({ open: true }); return; }
    const target = props.current.machines.find((entry) => entry.machine.id === props.current.currentMachineId && entry.machine.state === 'online')
      ?? props.current.machines.find((entry) => entry.machine.state === 'online');
    const settings = defaults(target, target?.projects.some((project) => project.id === props.current.currentProjectId) ? props.current.currentProjectId : undefined);
    if (settings) { captureGeneration.current++; patch({ open: true, error: undefined, frozen: false, draft: { settings, text: '', images: [], files: [], reportIds: [] } }); }
  };
  const openCodeAi = async (source?: HTMLElement | null) => {
    opener.current = source ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    if (!props.current.authorized) return;
    if (current.current.preparing && !current.current.draft) { patch({ open: true }); return; }
    if (current.current.draft) { patch({ open: true, error: current.current.draft.settings.codeai ? current.current.error : 'A setup draft is already pending. Clear it before starting a CodeAI session.' }); return; }
    const serial = ++generation.current;
    patch({ open: true, preparing: true, error: undefined });
    try {
      const response = await fetch('/api/codeai-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'prepare' }) });
      const data = await response.json() as { preparedContext?: PreparedCodeAiContext; project?: DurableProject; error?: string };
      if (!response.ok || !data.preparedContext || !data.project) throw new Error(data.error || 'Could not prepare CodeAI session.');
      const target = props.current.machines.find((entry) => entry.machine.id === props.current.localMachineId);
      const settings = defaults(target, data.project.id);
      if (!settings) throw new Error('Refresh the home machine before starting a CodeAI session.');
      if (generation.current === serial) {
        captureGeneration.current++;
        setSelfProject(data.project);
        patch({ preparing: false, frozen: false, draft: { settings: { ...settings, codeai: data.preparedContext }, text: '', images: [], files: [], reportIds: [] } });
      }
    } catch (error) { if (generation.current === serial) patch({ preparing: false, error: error instanceof Error ? error.message : 'Setup is unavailable.' }); }
  };
  const edit = (update: Partial<Draft>) => {
    if (!current.current.draft || current.current.busy || current.current.frozen) return;
    // A definitive first-message rejection may be edited, while keeping the exact created session.
    if (attempt.current?.session) {
      attempt.current.messageId = createUuid(); attempt.current.messageAttempted = false;
    } else attempt.current = undefined;
    patch({ draft: { ...current.current.draft, ...update }, error: undefined });
  };
  const setSettings = (update: Partial<LaunchSettings>) => {
    const draft = current.current.draft;
    if (!draft || attempt.current?.session) return;
    const settings = { ...draft.settings, ...update };
    if (settings.codeai && (update.machineId || update.projectId || update.execution)) return;
    if (settings.machineId !== draft.settings.machineId || settings.projectId !== draft.settings.projectId || settings.checkoutId !== draft.settings.checkoutId) captureGeneration.current++;
    const target = props.current.machines.find((entry) => entry.machine.id === settings.machineId);
    const nextHealth = settings.execution === 'docker' && target?.machine.kind === 'local' ? props.current.executions?.docker.providers : target?.machine.kind === 'local' ? props.current.executions?.local.providers ?? target.providers : target?.providers;
    if (update.machineId) {
      settings.projectId = undefined; settings.checkoutId = undefined; settings.execution = 'local'; settings.checkoutMode = 'current';
    }
    if (update.machineId || update.provider || update.execution) {
      const fallback = Object.entries(nextHealth ?? {}).find(([, value]) => value.available)?.[0] as LaunchSettings['provider'] | undefined;
      if (!nextHealth?.[settings.provider]?.available) settings.provider = fallback ?? 'claude';
      const supported = launchModes(nextHealth?.[settings.provider]?.supportedModes);
      if (!supported.includes(settings.mode)) settings.mode = supported[0] ?? 'ask';
      settings.modelSelection = offeredModelSelection(props.current.preferences.models?.[settings.provider], nextHealth?.[settings.provider]);
    }
    edit({ settings });
  };
  useEffect(() => {
    if (options.executions?.docker.enabled === false && draft?.settings.execution === 'docker' && !state.frozen && !state.busy) setSettings({ execution: 'local' });
  }, [options.executions?.docker.enabled, draft?.settings.execution, state.frozen, state.busy]);
  const addFiles = async (files: File[]) => {
    if (!current.current.draft || current.current.busy || current.current.frozen || current.current.preparing) return;
    const serial = generation.current;
    patch({ preparing: true, error: undefined });
    try {
      const failures: string[] = [];
      for (const file of files) {
        try {
          const prepared = file.type.startsWith('image/') ? { ...await prepareImage(file), id: createUuid() } : await prepareTextFile(file);
          if (serial !== generation.current || !current.current.draft) return;
          if ('dataUrl' in prepared) {
            if (current.current.draft.images.length >= MAX_IMAGES_PER_MESSAGE) throw new Error(`Attach at most ${MAX_IMAGES_PER_MESSAGE} images.`);
            edit({ images: [...current.current.draft.images, prepared] });
          } else {
            const combined = [...current.current.draft.files, prepared]; validateTextFiles(combined); edit({ files: combined });
          }
        } catch (error) { failures.push(`${file.name}: ${error instanceof Error ? error.message : 'Could not attach.'}`); }
      }
      if (failures.length && serial === generation.current) patch({ error: failures.join(' ') });
    } catch (error) { if (serial === generation.current) patch({ error: error instanceof Error ? error.message : 'Could not attach files.' }); }
    finally { if (serial === generation.current) patch({ preparing: false }); }
  };
  const attachReport = (id: string) => {
    const draft = current.current.draft;
    if (!draft || draft.reportIds.includes(id)) return;
    if (draft.reportIds.length >= MAX_REPORTS_PER_MESSAGE) { patch({ error: `Attach at most ${MAX_REPORTS_PER_MESSAGE} reports.` }); return; }
    edit({ reportIds: [...draft.reportIds, id] });
  };
  const captureToken = () => current.current.open && current.current.draft && !current.current.busy && !current.current.frozen
    && reports.available ? captureGeneration.current : undefined;
  const attachCapture = (token: number, summary: ImmersiveReportSummary): boolean => {
    if (token !== captureGeneration.current || !reports.available || !current.current.open || !current.current.draft || current.current.busy || current.current.frozen) return false;
    attachReport(summary.id); void reports.refresh(); return current.current.draft.reportIds.includes(summary.id);
  };
  const clear = () => {
    if (current.current.busy || current.current.frozen) return;
    generation.current++; captureGeneration.current++; attempt.current = undefined; setSelfProject(undefined);
    patch({ draft: undefined, error: undefined, preparing: false, voicePending: false, open: false });
  };
  const submit = async () => {
    const draft = current.current.draft;
    if (!draft || current.current.busy || current.current.preparing || current.current.voicePending || !props.current.localMachineId) return;
    const serial = generation.current; const origin = props.current.origin;
    props.current.onSubmit();
    if (!attempt.current) attempt.current = { settings: structuredClone(draft.settings), content: { text: draft.text,
      images: draft.images.map(({ dataUrl }) => ({ dataUrl })), files: structuredClone(draft.files), reportIds: [...draft.reportIds] },
      creationRequestId: createUuid(), messageId: createUuid() };
    else attempt.current.content = { text: draft.text, images: draft.images.map(({ dataUrl }) => ({ dataUrl })), files: structuredClone(draft.files), reportIds: [...draft.reportIds] };
    patch({ busy: true, frozen: true, error: undefined });
    try {
      const result = await launchSession(attempt.current, props.current.localMachineId, fetch, (session) => { if (generation.current === serial) props.current.onCreated(session, draft.settings); });
      if (generation.current !== serial) return;
      const autoOpen = !result.started && current.current.open && props.current.origin === origin;
      props.current.onResult(result, draft.settings, autoOpen);
      attempt.current = undefined; generation.current++; captureGeneration.current++;
      patch({ open: false, busy: false, preparing: false, voicePending: false, frozen: false, draft: undefined, outcome: { ...result, settings: draft.settings } });
    } catch (error) {
      if (generation.current !== serial) return;
      const failure = error instanceof LaunchFailure ? error : new LaunchFailure('Setup failed. Retry keeps this request.', false, true);
      if (failure.editable && !attempt.current?.session) attempt.current = undefined;
      patch({ busy: false, frozen: !failure.editable, error: failure.message });
    }
  };
  const invalidateCapture = useCallback(() => { captureGeneration.current++; }, []);
  const setVoicePending = useCallback((value: boolean) => { if (current.current.voicePending !== value) patch({ voicePending: value }); }, []);
  const hasContent = Boolean(draft && launchText({ text: draft.text, images: draft.images, files: draft.files, reportIds: draft.reportIds }));
  const invalidDocker = draft?.settings.execution === 'docker' && (selectedProject ? selectedProject.repositories.length !== 1
    || selectedProject.repositories[0].role !== 'primary' || selectedProject.repositories[0].hostId !== machine?.machine.id : !draft.settings.checkoutId);
  const primary = selectedProject ? selectedProject.repositories.some((binding) => binding.role === 'primary') : Boolean(draft?.settings.checkoutId);
  const blocker = machine?.machine.state !== 'online' ? 'The target machine is offline. Refresh when it reconnects.'
    : hasContent && !primary ? 'Choose a primary repository before starting a message.'
    : draft?.reportIds.length && (reports.loading || !reports.available) ? 'Remove the reports or choose CodeAI’s own project on the home machine.'
    : !health?.available ? health?.message || 'Choose an available provider.'
    : draft && !modes.includes(draft.settings.mode) ? 'Choose a supported mode.'
    : invalidDocker ? 'Docker requires exactly one primary repository on this machine.'
    : draft?.settings.checkoutMode === 'worktree' && !checkoutChoice.available ? checkoutChoice.reason
    : draft ? nativeClaudeIsolationIssue({ provider: draft.settings.provider, execution: draft.settings.execution,
      level: machine?.securityLevel, mode: draft.settings.mode, choice: draft.settings.instructions }) : undefined;
  const blocked = state.busy || state.preparing || state.voicePending || !draft || machine?.machine.state !== 'online'
    || (!state.frozen && Boolean(blocker));
  return { ...state, opener, availabilityError, blocker, isOpen: state.open, dockerOffered: Boolean(options.executions?.docker.enabled), availability, machines: options.machines, machine, providers, modes, health, reports, selectedProject, checkoutChoice,
    hasContent, canSubmit: !blocked, settingsLocked: state.frozen || state.busy || Boolean(attempt.current?.session),
    createdSession: attempt.current?.session, refreshAvailability, open, openCodeAi, close: () => { captureGeneration.current++; if (current.current.preparing && !current.current.draft && !current.current.busy) { generation.current++; patch({ preparing: false }); } patch({ open: false }); }, clear,
    setText: (text: string) => edit({ text }), setSettings, setVoicePending, addFiles,
    removeFile: (index: number) => edit({ files: current.current.draft?.files.filter((_, i) => i !== index) ?? [] }),
    removeImage: (id: string) => edit({ images: current.current.draft?.images.filter((image) => image.id !== id) ?? [] }),
    attachReport, removeReport: (id: string) => edit({ reportIds: current.current.draft?.reportIds.filter((value) => value !== id) ?? [] }),
    captureToken, attachCapture, invalidateCapture, submit, openCreated: () => { if (attempt.current?.session && current.current.draft) props.current.onOpen(attempt.current.session, current.current.draft.settings); },
    openOutcome: () => { if (current.current.outcome) props.current.onOpen(current.current.outcome.session, current.current.outcome.settings); },
  };
}
export type SessionLauncher = ReturnType<typeof useSessionLauncher>;
