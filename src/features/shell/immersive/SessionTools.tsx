import { useEffect, useMemo, useRef, useState } from 'react';
import type { ThemeName } from '@/shared/design/tokens';
import { PROVIDER_LABELS } from '@/shared/participants';
import type { AgentMode, AgentProvider } from '@/shared/types';
import { immersiveChatLines } from '@/features/diagram/spatial/immersiveTranscript';
import { permissionKey, SESSION_ACTIONS, type ImmersiveSessionControls, type PermissionTarget, type SessionActionName } from './sessionControls';
import { createConversationTextResource, createWorkspaceButtonResource } from './workspaceResources';
import { useTextureResource } from './useTextureResource';
import { WorldButton } from './WorkspacePanel';

const nextValue = <T,>(values: T[], current: T) => values[(values.indexOf(current) + 1) % values.length];

/** A single bounded viewport for session setup and complete, sanitized permission summaries. */
export function SessionTools({ controls, theme, enabled, onController }: {
  controls: ImmersiveSessionControls; theme: ThemeName; enabled: boolean;
  onController(perform?: (action: SessionActionName) => void): void;
}) {
  const [tab, setTab] = useState<'home' | 'launcher' | 'permissions'>('home');
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
  useEffect(() => { if (result) setPage(0); }, [result]);
  const createEnabled = machine?.machine.state === 'online' && providers.includes(provider) && modes.includes(mode)
    && (!projectId || Boolean(project)) && !controls.creating && !busy;
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
  ].join('\n\n') : permissionStatus : [
    controls.status,
    `${controls.permissions.length} pending permission request(s).`,
    controls.needsRepository ? `Primary repository required before sending.\nRepository: ${checkout?.name || 'No checkout available'}` : '',
    confirmRevoke ? 'Forget this device? Private content will close. A new pairing code will be required.' : '',
  ].filter(Boolean).join('\n\n');
  const lines = useMemo(() => immersiveChatLines(text, 976, 44), [text]);
  const pageCount = Math.max(1, Math.ceil(lines.length / 10));
  const safePage = Math.min(page, pageCount - 1);
  const body = useTextureResource((ledger) => createConversationTextResource(
    `${tab === 'launcher' ? 'New session' : tab === 'permissions' ? 'Permission request' : 'Session tools'} · ${safePage + 1}/${pageCount}`,
    lines.slice(safePage * 10, safePage * 10 + 10), theme, ledger, false, 44,
  ), [lines, safePage, pageCount, tab, theme]);
  const buttons = useTextureResource((ledger) => Object.fromEntries(Object.entries(SESSION_ACTIONS).map(([action, label]) =>
    [action, createWorkspaceButtonResource(label, theme, ledger)])), [theme]);
  const perform = (action: SessionActionName) => {
    if (!enabled || busyRef.current) return;
    if (action === 'older') setPage(Math.max(0, safePage - 1));
    else if (action === 'newer') setPage(Math.min(pageCount - 1, safePage + 1));
    else if (action === 'launcher' || action === 'permissions' || action === 'back') {
      setTab(action === 'back' ? 'home' : action); setPage(0); setConfirmRevoke(false);
    } else if (action === 'refresh') controls.onRefresh();
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
      if ((action === 'allow' || action === 'deny') && selected && current && controls.online && !result && body) controls.onDecide(selected, action);
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
      else if (action === 'revoke') { setConfirmRevoke(true); setPage(0); }
      else if (action === 'confirm-revoke' && confirmRevoke) controls.onRevoke();
    }
  };
  useEffect(() => { onController(perform); return () => onController(undefined); });
  const button = (action: SessionActionName, x: number, y: number, disabled = false) => <WorldButton
    key={`${action}:${action === 'cancel' ? controls.cancelKey : tab === 'permissions' && selected ? permissionKey(selected) : ''}`}
    action={`session:${action}`} label={SESSION_ACTIONS[action]} resource={buttons?.[action]}
    position={[x, y, 0.04]} disabled={!enabled || busy || disabled} onAction={() => perform(action)} />;
  return <group name="VR session tools" userData={{ tab, text, page: safePage, pageCount, permissionKey: selected && permissionKey(selected), permissionStatus, busy }}>
    {body && <mesh name="Session details" geometry={body.geometry} material={body.material} position={[0, 0.12, 0.02]} />}
    {button('older', -0.44, -0.37, safePage === 0)}{button('newer', 0, -0.37, safePage >= pageCount - 1)}{button('refresh', 0.44, -0.37)}
    {tab === 'launcher' ? <>
      {button('machine', -0.44, -0.56, controls.creating)}{button('project', 0, -0.56, controls.creating)}{button('provider', 0.44, -0.56, controls.creating)}
      {button('mode', -0.44, -0.76, controls.creating)}{button('create', 0, -0.76, !createEnabled)}{button('back', 0.44, -0.76)}
    </> : tab === 'permissions' ? <>
      {button('previous', -0.44, -0.56, !controls.permissions.length)}{button('next', 0, -0.56, !controls.permissions.length)}{button('back', 0.44, -0.56)}
      {button('deny', -0.22, -0.76, !current || Boolean(result) || !controls.online || !body)}
      {button('allow', 0.22, -0.76, !current || Boolean(result) || !controls.online || !body)}
    </> : <>
      {button('launcher', -0.44, -0.56)}{button('permissions', 0, -0.56)}{button('cancel', 0.44, -0.56, !controls.canCancel)}
      {controls.needsRepository ? <>{button('checkout', -0.44, -0.76, !checkout)}{button('attach', 0, -0.76, !checkout || !controls.canAttach)}</>
        : button('retry', -0.44, -0.76, !controls.canRetry)}
      {button(confirmRevoke ? 'confirm-revoke' : 'revoke', 0.44, -0.76)}
    </>}
  </group>;
}
