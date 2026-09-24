import { useEffect, useMemo, useRef, useState } from 'react';
import type { ThemeName } from '@/shared/design/tokens';
import { PROVIDER_LABELS } from '@/shared/participants';
import type { AgentMode, AgentProvider } from '@/shared/types';
import { immersiveChatLines } from '@/features/diagram/spatial/immersiveTranscript';
import { reportCaptureLabel, reportDescription, reportTitle } from '@/features/reports/reportModel';
import { immersiveReportPath } from '@/features/reports/useImmersiveReports';
import { permissionKey, permissionRequestUpdate, SESSION_ACTIONS, type ImmersiveSessionControls, type PermissionTarget, type SessionActionName } from './sessionControls';
import { createConversationTextResource, createReportPreviewResource, createWorkspaceButtonResource } from './workspaceResources';
import { recordImmersiveDiagnostic } from './immersiveDiagnostics';
import { useTextureResource } from './useTextureResource';
import { WorkspacePager, WorldButton } from './WorkspacePanel';

const nextValue = <T,>(values: T[], current: T) => values[(values.indexOf(current) + 1) % values.length];

/** The selected report's screenshot, decoded once, copied into a bounded texture, then released. */
function ReportPreview({ url, theme }: { url: string; theme: ThemeName }) {
  const [image, setImage] = useState<ImageBitmap>();
  useEffect(() => {
    let current = true;
    let decoded: ImageBitmap | undefined;
    setImage(undefined);
    void fetch(url, { cache: 'no-store' })
      .then((response) => response.ok ? response.blob() : Promise.reject(new Error(`Preview ${response.status}`)))
      .then((blob) => createImageBitmap(blob))
      .then((bitmap) => {
        if (current) { decoded = bitmap; setImage(bitmap); } else bitmap.close();
      })
      .catch(() => { if (current) recordImmersiveDiagnostic('report-preview-failed'); });
    return () => { current = false; decoded?.close(); };
  }, [url]);
  const resource = useTextureResource((ledger) => image ? createReportPreviewResource(image, theme, ledger) : undefined, [image, theme]);
  return resource ? <mesh name="Report preview" geometry={resource.geometry} material={resource.material}
    position={[0.38, 0.26, 0.002]} userData={{ reportPreview: url }} /> : null;
}

/** A single bounded viewport for session setup and complete, sanitized permission summaries. */
export function SessionTools({ controls, theme, enabled, request, onController, onArchived }: {
  controls: ImmersiveSessionControls; theme: ThemeName; enabled: boolean;
  request?: { tab: 'launcher' | 'permissions'; key: string };
  onController(perform?: (action: SessionActionName) => void): void;
  onArchived(): void;
}) {
  const [tab, setTab] = useState<'home' | 'launcher' | 'permissions' | 'reports' | 'codeai'>('home');
  const [reportId, setReportId] = useState<string>();
  const [machineId, setMachineId] = useState(controls.machineId);
  const [projectId, setProjectId] = useState('');
  const [provider, setProvider] = useState<AgentProvider>('claude');
  const [mode, setMode] = useState<AgentMode>('ask');
  const [checkoutId, setCheckoutId] = useState('');
  const [selected, setSelected] = useState<PermissionTarget>();
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  useEffect(() => {
    if (!request) return;
    setTab(request.tab); setPage(0); setConfirmRevoke(false); setConfirmArchive(false);
  }, [request]);
  // A confirmation belongs to the session it was shown for, and only while it can be archived.
  useEffect(() => { setConfirmArchive(false); }, [controls.machineId, controls.sessionId, controls.canArchive]);
  const machines = controls.machines.filter((item) => item.machine.state === 'online');
  // Keep an explicitly chosen offline machine selected; never silently submit to another one.
  const machine = controls.machines.find((item) => item.machine.id === machineId) || (!machineId ? machines[0] : undefined);
  const project = machine?.projects.find((item) => item.id === projectId);
  const providers = (Object.keys(machine?.providers || {}) as AgentProvider[])
    .filter((id) => machine?.providers[id].available && machine.providers[id].supportedModes.length);
  const modes = machine?.providers[provider]?.supportedModes || [];
  const checkout = controls.checkouts.find((item) => item.id === checkoutId) || controls.checkouts[0];
  const current = selected && controls.permissions.find((item) => permissionKey(item) === permissionKey(selected));
  const result = selected && controls.results[permissionKey(selected)];
  useEffect(() => {
    if (!selected && controls.permissions[0]) setSelected(controls.permissions[0]);
  }, [selected, controls.permissions]);
  const appliedRequest = useRef<string | undefined>(undefined);
  useEffect(() => {
    const requested = controls.requestedPermissionKey
      && controls.permissions.find((item) => permissionKey(item) === controls.requestedPermissionKey);
    const update = permissionRequestUpdate(appliedRequest.current, controls.requestedPermissionKey, Boolean(requested));
    appliedRequest.current = update.applied;
    if (update.apply && requested) { setSelected(requested); setTab('permissions'); setPage(0); }
  }, [controls.permissions, controls.requestedPermissionKey]);
  useEffect(() => { if (result) setPage(0); }, [result]);
  const createEnabled = machine?.machine.state === 'online' && providers.includes(provider) && modes.includes(mode)
    && (!projectId || Boolean(project)) && !controls.creating && !busy;
  const reportControls = controls.reports;
  const reports = reportControls?.reports || [];
  // Selected by id, so a report arriving at the top of the list does not move the selection.
  const report = reports.find((item) => item.id === reportId) || reports[0];
  const reportIndex = report ? reports.indexOf(report) : -1;
  const reportPending = Boolean(report && reportControls?.pendingIds.includes(report.id));
  // CodeAI's own tools: its reports, and Build & restart where this server can do it.
  const codeai = controls.codeai;
  // Leaving the section by any route, a routed request included, withdraws a confirmation.
  const dismissCodeAi = useRef(codeai?.onDismiss);
  dismissCodeAi.current = codeai?.onDismiss;
  useEffect(() => { if (tab !== 'codeai') dismissCodeAi.current?.(); }, [tab]);
  const permissionStatus = result?.message || (!selected ? 'No permission requests.' : !controls.online ? 'Machine is offline. Reconnect and refresh status.'
    : !current ? 'This request is no longer pending. It was answered elsewhere or the run ended.' : 'Review the details, then choose Allow or Deny.');
  const text = tab === 'launcher' ? [
    `Machine: ${machine?.machine.label || 'Choose a machine'} · ${machine?.machine.state || 'unavailable'}`,
    `Project: ${project?.name || (projectId ? 'Unavailable project' : 'No project')}`,
    `Provider: ${PROVIDER_LABELS[provider]}${providers.includes(provider) ? '' : ' · unavailable'}`,
    `Mode: ${mode}${modes.includes(mode) ? '' : ' · unavailable'}`,
    `Repositories: ${project?.repositories.map((binding) => `${machine?.checkouts.find((item) => item.id === binding.checkoutId)?.name || binding.checkoutId} (${binding.role})`).join(', ') || 'None; attach a primary repository before sending.'}`,
    controls.creating ? 'Creating session…' : controls.status,
  ].join('\n\n') : tab === 'permissions' ? selected ? [
    permissionStatus, selected.sessionTitle, `${selected.machineLabel} · ${selected.agentLabel}`,
    `Tool: ${selected.tool}`, selected.detail || 'No additional explanation supplied.',
  ].join('\n\n') : permissionStatus : tab === 'reports' ? !reportControls ? 'Reports are available in CodeAI’s own project.'
    : reportControls.error || (!report ? reportControls.loading ? 'Reading reports…' : 'No reports yet. Use Report in the tool strip to capture what you see.' : [
      reportTitle(report),
      reportCaptureLabel(report.context, controls.machines, reportControls.projectId),
      reportDescription(report),
      reportPending ? 'Attached to the next message.'
        : reportControls.canAttach ? 'Attach it to send with the next message.' : 'Open a session with room for another report to attach it.',
    ].join('\n\n')) : tab === 'codeai' ? [
      !codeai ? 'Build & restart is offered when CodeAI runs under npm run start:managed. Refresh to check again.'
        : codeai.confirming ? codeai.confirmation : codeai.status,
      reportControls ? 'Reports lists what you captured here, to attach to the next message.' : '',
    ].filter(Boolean).join('\n\n') : [
    controls.status,
    `${controls.permissions.length} pending permission request(s).`,
    controls.needsRepository ? `Primary repository required before sending.\nRepository: ${checkout?.name || 'No checkout available'}` : '',
    confirmRevoke ? 'Forget this device? Private content will close. A new pairing code will be required.' : '',
    confirmArchive ? `Archive “${controls.sessionTitle}”? You can restore it from the Arena’s Archived list.` : '',
  ].filter(Boolean).join('\n\n');
  // A screenshot preview takes the right side of the details, so the text wraps beside it.
  const preview = tab === 'reports' && report?.screenshot && reportControls
    ? immersiveReportPath(reportControls.projectId, report.id, true) : undefined;
  const lines = useMemo(() => immersiveChatLines(text, preview ? 560 : 976, 44), [preview, text]);
  const pageCount = Math.max(1, Math.ceil(lines.length / 10));
  const safePage = Math.min(page, pageCount - 1);
  const body = useTextureResource((ledger) => createConversationTextResource(
    `${tab === 'launcher' ? 'New session' : tab === 'permissions' ? 'Permission request'
      : tab === 'reports' ? `Report ${reportIndex + 1} of ${reports.length}` : tab === 'codeai' ? 'CodeAI' : 'Session tools'} · ${safePage + 1}/${pageCount}`,
    lines.slice(safePage * 10, safePage * 10 + 10), theme, ledger,
  ), [lines, safePage, pageCount, tab, reportIndex, reports.length, theme]);
  const buttons = useTextureResource((ledger) => Object.fromEntries(Object.entries(SESSION_ACTIONS).map(([action, label]) =>
    [action, createWorkspaceButtonResource(label, theme, ledger)])), [theme]);
  const perform = (action: SessionActionName) => {
    if (!enabled || busyRef.current) return;
    if (action === 'older') setPage(Math.max(0, safePage - 1));
    else if (action === 'newer') setPage(Math.min(pageCount - 1, safePage + 1));
    else if (action === 'launcher' || action === 'permissions' || action === 'back' || (action === 'reports' && reportControls)
      || (action === 'codeai' && (reportControls || codeai))) {
      // Reports is reached from the CodeAI section, so it goes back there.
      setTab(action === 'back' ? tab === 'reports' ? 'codeai' : 'home' : action); setPage(0); setConfirmRevoke(false); setConfirmArchive(false);
      if (action === 'reports') reportControls?.onRefresh();
      if (action === 'codeai') controls.onRefresh();
    } else if (action === 'refresh') {
      if (tab === 'reports') reportControls?.onRefresh();
      else controls.onRefresh();
    } else if (tab === 'reports') {
      if ((action === 'previous-report' || action === 'next-report') && reports.length) {
        setReportId(reports[(reportIndex + (action === 'next-report' ? 1 : -1) + reports.length) % reports.length].id); setPage(0);
      } else if (action === 'attach-report' && report && !reportPending && reportControls?.canAttach) reportControls.onAttach(report.id);
      else if (action === 'remove-report' && report && reportPending) reportControls?.onRemove(report.id);
    } else if (tab === 'codeai') {
      // The first activation shows the warning; only the second, a different control, starts it.
      if (action === 'build-restart' && codeai?.canRequest) { codeai.onAsk(); setPage(0); }
      else if (action === 'confirm-build-restart' && codeai?.confirming) codeai.onConfirm();
    }
    else if (tab === 'launcher') {
      if (controls.creating) return;
      if (action === 'machine') {
        setMachineId(nextValue(machines.map((item) => item.machine.id), machine?.machine.id || ''));
        setProjectId(''); setPage(0);
      } else if (action === 'project') { setProjectId(nextValue(['', ...machine?.projects.map((item) => item.id) || []], projectId)); setPage(0); }
      else if (action === 'provider') { const next = nextValue(providers, provider); if (next) { setProvider(next); setMode(machine!.providers[next].supportedModes[0]); } }
      else if (action === 'mode') { const next = nextValue(modes, mode); if (next) setMode(next); }
      else if (action === 'create' && createEnabled && machine) {
        busyRef.current = true; setBusy(true);
        void controls.onCreate({ machineId: machine.machine.id, projectId: projectId || undefined, provider, mode })
          .then((created) => { if (!created) setPage(Number.MAX_SAFE_INTEGER); })
          .finally(() => { busyRef.current = false; setBusy(false); });
      }
    } else if (tab === 'permissions') {
      if (action === 'return' && controls.onReturn) controls.onReturn();
      else if ((action === 'allow' || action === 'deny') && selected && current && controls.online && !result && body) controls.onDecide(selected, action);
      else if (action === 'previous' || action === 'next') {
        const index = controls.permissions.findIndex((item) => selected && permissionKey(item) === permissionKey(selected));
        const next = controls.permissions[(index + (action === 'next' ? 1 : -1) + controls.permissions.length) % controls.permissions.length];
        if (next) { setSelected(next); setPage(0); }
      }
    } else {
      if (action === 'checkout' && checkout) { setCheckoutId(nextValue(controls.checkouts.map((item) => item.id), checkout.id)); setPage(0); }
      else if (action === 'attach' && checkout && controls.canAttach) {
        busyRef.current = true; setBusy(true);
        void controls.onAttach(checkout.id).finally(() => { busyRef.current = false; setBusy(false); });
      } else if (action === 'cancel' && controls.canCancel) controls.onCancel();
      else if (action === 'retry' && controls.canRetry) controls.onRetry();
      else if (action === 'archive' && controls.canArchive) { setConfirmArchive(true); setConfirmRevoke(false); setPage(0); }
      else if (action === 'confirm-archive' && confirmArchive && controls.canArchive) {
        busyRef.current = true; setBusy(true); setConfirmArchive(false);
        void controls.onArchive().then((archived) => { if (archived) onArchived(); })
          .finally(() => { busyRef.current = false; setBusy(false); });
      }
      else if (action === 'revoke') { setConfirmRevoke(true); setConfirmArchive(false); setPage(0); }
      else if (action === 'confirm-revoke' && confirmRevoke) controls.onRevoke();
    }
  };
  useEffect(() => { onController(perform); return () => onController(undefined); });
  const button = (action: SessionActionName, x: number, y: number, disabled = false) => <WorldButton
    key={`${action}:${action === 'cancel' ? controls.cancelKey : tab === 'permissions' && selected ? permissionKey(selected) : ''}`}
    action={`session:${action}`} label={SESSION_ACTIONS[action]} resource={buttons?.[action]}
    iconTheme={theme} position={[x, y, 0]} disabled={!enabled || busy || disabled}
    variant={action === 'allow' || action === 'create' ? 'primary'
      : action === 'revoke' || action === 'confirm-revoke' || action === 'cancel' || action === 'confirm-build-restart'
        || action === 'archive' || action === 'confirm-archive' ? 'destructive' : 'secondary'}
    onAction={() => perform(action)} />;
  return <group name="VR session tools" userData={{ tab, text, page: safePage, pageCount, permissionKey: selected && permissionKey(selected), permissionStatus, busy,
    reportId: report?.id, reportPending, codeaiConfirming: Boolean(codeai?.confirming) }}>
    {body && <mesh name="Session details" geometry={body.geometry} material={body.material} position={[0, 0.12, 0]} />}
    {preview && <ReportPreview url={preview} theme={theme} />}
    <WorkspacePager label={`Page ${safePage + 1} of ${pageCount}`} previousAction="session:older" nextAction="session:newer"
      previousLabel="Previous details" nextLabel="More details" position={[-0.18, -0.37, 0]} theme={theme}
      previousDisabled={safePage === 0} nextDisabled={safePage >= pageCount - 1}
      onAction={(action) => perform(action.slice('session:'.length) as SessionActionName)} />
    {button('refresh', 0.48, -0.37)}
    {tab === 'launcher' ? <>
      {button('machine', -0.44, -0.56, controls.creating)}{button('project', 0, -0.56, controls.creating)}{button('provider', 0.44, -0.56, controls.creating)}
      {button('mode', -0.44, -0.76, controls.creating)}{button('create', 0, -0.76, !createEnabled)}{button('back', 0.44, -0.76)}
    </> : tab === 'permissions' ? <>
      <WorkspacePager label={`Request ${Math.max(1, controls.permissions.findIndex((item) => selected && permissionKey(item) === permissionKey(selected)) + 1)} of ${Math.max(1, controls.permissions.length)}`}
        previousAction="session:previous" nextAction="session:next" previousLabel="Previous request" nextLabel="Next request"
        position={[-0.20, -0.56, 0]} theme={theme} previousDisabled={!controls.permissions.length} nextDisabled={!controls.permissions.length}
        onAction={(action) => perform(action.slice('session:'.length) as SessionActionName)} />
      {button(controls.onReturn ? 'return' : 'back', 0.48, -0.56)}
      {button('deny', -0.22, -0.76, !current || Boolean(result) || !controls.online || !body)}
      {button('allow', 0.22, -0.76, !current || Boolean(result) || !controls.online || !body)}
    </> : tab === 'reports' ? <>
      <WorkspacePager label={`Report ${reportIndex + 1} of ${reports.length}`}
        previousAction="session:previous-report" nextAction="session:next-report" previousLabel="Previous report" nextLabel="Next report"
        position={[-0.20, -0.56, 0]} theme={theme} previousDisabled={reports.length < 2} nextDisabled={reports.length < 2}
        onAction={(action) => perform(action.slice('session:'.length) as SessionActionName)} />
      {button('back', 0.48, -0.56)}
      {button('attach-report', -0.22, -0.76, !report || reportPending || !reportControls?.canAttach)}
      {button('remove-report', 0.22, -0.76, !reportPending)}
    </> : tab === 'codeai' ? <>
      {button('reports', -0.44, -0.56, !reportControls)}{button('back', 0.44, -0.56)}
      {codeai?.confirming ? button('confirm-build-restart', 0, -0.76) : button('build-restart', 0, -0.76, !codeai?.canRequest)}
    </> : <>
      {button('launcher', -0.44, -0.56)}{button('permissions', 0, -0.56)}
      {/* Cancel needs a live turn and archiving needs none, so the two share one slot. */}
      {controls.canArchive ? button(confirmArchive ? 'confirm-archive' : 'archive', 0.44, -0.56)
        : button('cancel', 0.44, -0.56, !controls.canCancel)}
      {controls.needsRepository ? <>{button('checkout', -0.44, -0.76, !checkout)}{button('attach', 0, -0.76, !checkout || !controls.canAttach)}</>
        : <>{button('retry', -0.44, -0.76, !controls.canRetry)}{button('codeai', 0, -0.76, !reportControls && !codeai)}</>}
      {button(confirmRevoke ? 'confirm-revoke' : 'revoke', 0.44, -0.76)}
    </>}
  </group>;
}
