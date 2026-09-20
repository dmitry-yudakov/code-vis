import { useEffect, useMemo, useRef, useState } from 'react';
import type { ThemeName } from '@/shared/design/tokens';
import { texturePanel } from '@/features/diagram/spatial/immersiveResources';
import type { SpatialResourceLedger } from '@/features/diagram/spatial/resourceLedger';
import {
  ARENA_ACTIONS, type ArenaActionName, type ImmersiveArenaControls,
} from './arenaControls';
import {
  buildImmersiveArenaRows, IMMERSIVE_ARENA_PAGE_SIZE, pageImmersiveArenaRows,
  type ImmersiveArenaRow, type ImmersiveArenaTab,
} from './immersiveArenaModel';
import { immersiveFont, immersiveTheme } from './immersiveTheme';
import { createWorkspaceButtonResource, type PanelControlResources } from './workspaceResources';
import { useTextureResource } from './useTextureResource';
import { WorkspacePager, WorldButton } from './WorkspacePanel';

const STATE_LABELS = {
  idle: 'Idle', running: 'Running', 'needs-you': 'Needs you', queued: 'Queued', failed: 'Failed', offline: 'Offline',
} as const;

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function createArenaSummaryResource(
  rows: readonly ImmersiveArenaRow[],
  selectedKey: string | undefined,
  theme: ThemeName,
  ledger: SpatialResourceLedger,
) {
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 400;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Arena summary rasterization is unavailable.');
  const colors = immersiveTheme[theme];
  const pixelsPerMeter = canvas.width / 1.32;
  context.fillStyle = colors.surface;
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (!rows.length) {
    context.fillStyle = colors.secondaryText;
    context.font = immersiveFont('reading', pixelsPerMeter);
    context.fillText('Nothing here yet.', 28, 72);
  }
  rows.forEach((row, index) => {
    const top = 6 + index * 65;
    context.fillStyle = row.key === selectedKey ? colors.selected : colors.raised;
    context.beginPath(); context.roundRect(8, top, 624, 59, 14); context.fill();
    context.fillStyle = row.unread ? colors.link : colors.secondaryText;
    context.beginPath(); context.arc(24, top + 19, 5, 0, Math.PI * 2); context.fill();
    context.fillStyle = row.key === selectedKey ? colors.selectedInk : colors.text;
    context.font = immersiveFont('heading', pixelsPerMeter);
    context.fillText(truncate(row.title, 34), 36, top + 23, 562);
    context.fillStyle = row.key === selectedKey ? colors.selectedInk : colors.secondaryText;
    context.font = immersiveFont('label', pixelsPerMeter);
    context.fillText(`${STATE_LABELS[row.state]} · ${truncate(row.detail, 52)}`, 36, top + 48, 575);
  });
  return texturePanel(canvas, [1.32, 0.825], ledger);
}

export function ArenaTools({ controls, theme, enabled, focused, pagerIcons, onNewSession, onController }: {
  controls: ImmersiveArenaControls;
  theme: ThemeName;
  enabled: boolean;
  focused: boolean;
  pagerIcons?: PanelControlResources['pager'];
  onNewSession(): void;
  onController(perform?: (action: ArenaActionName) => void): void;
}) {
  const [tab, setTab] = useState<ImmersiveArenaTab>('sessions');
  const [selectedKey, setSelectedKey] = useState<string>();
  const [busyKey, setBusyKey] = useState<string>();
  const [confirmArchiveKey, setConfirmArchiveKey] = useState<string>();
  const busy = useRef(false);
  const rows = useMemo(() => buildImmersiveArenaRows(controls.machines, controls.deviceState, tab), [controls.machines, controls.deviceState, tab]);
  const selectedIndex = Math.max(0, rows.findIndex((row) => row.key === selectedKey));
  const selected = rows[selectedIndex];
  const paged = useMemo(() => pageImmersiveArenaRows(rows, Math.floor(selectedIndex / IMMERSIVE_ARENA_PAGE_SIZE)), [rows, selectedIndex]);
  const { rows: visibleRows, page, pageCount } = paged;
  const activeRowKey = tab === 'sessions' && controls.active
    ? rows.find((row) => row.machineId === controls.active?.machineId && row.projectId === controls.active.projectId
      && row.sessionId === controls.active.sessionId)?.key
    : undefined;
  useEffect(() => {
    if (!rows.length) setSelectedKey(undefined);
    else if (!selectedKey || !rows.some((row) => row.key === selectedKey)) setSelectedKey(activeRowKey || rows[0].key);
  }, [activeRowKey, rows, selectedKey]);
  useEffect(() => { setConfirmArchiveKey(undefined); }, [selected?.key, tab]);
  const summaryKey = JSON.stringify(visibleRows.map((row) => [
    row.key, row.title, row.detail, row.state, row.unread, row.actionable,
  ]));
  const summary = useTextureResource((ledger) => createArenaSummaryResource(visibleRows, selected?.key, theme, ledger), [summaryKey, selected?.key, theme]);
  const primaryAction: ArenaActionName = selected?.attention?.kind === 'permission' ? 'inspect' : 'open';
  const secondaryAction: ArenaActionName = tab === 'archived' ? 'restore'
    : tab === 'sessions' && confirmArchiveKey === selected?.key ? 'confirm-archive'
    : tab === 'sessions' ? 'archive' : selected?.attention?.kind === 'permission' ? 'refresh' : 'acknowledge';
  const visibleActions = ['sessions', 'inbox', 'archived', 'new', primaryAction, secondaryAction, 'refresh'] as const;
  const visibleActionKey = [...new Set(visibleActions)].join(',');
  const buttons = useTextureResource((ledger) => Object.fromEntries([...new Set(visibleActions)].map((action) => [
    action, createWorkspaceButtonResource(ARENA_ACTIONS[action], theme, ledger),
  ])), [visibleActionKey, theme]);
  const chooseTab = (next: ImmersiveArenaTab) => { setTab(next); setSelectedKey(undefined); };
  const perform = (action: ArenaActionName) => {
    if (!enabled || busy.current) return;
    if (action === 'sessions' || action === 'inbox' || action === 'archived') { chooseTab(action); return; }
    if (action === 'previous' || action === 'next') {
      if (!rows.length) return;
      const delta = action === 'next' ? 1 : -1;
      setSelectedKey(rows[(selectedIndex + delta + rows.length) % rows.length].key);
      return;
    }
    if (action === 'new') { onNewSession(); return; }
    if (action === 'refresh') { void controls.onRefresh(); return; }
    if (!selected) return;
    if (action === 'open' || action === 'inspect') {
      if (!selected.actionable) return;
      if (selected.attention?.kind === 'permission') controls.onInspect(selected.attention);
      else {
        if (selected.attention && selected.unread) controls.onAcknowledge([selected.attention.id]);
        controls.onOpen(selected.choice);
      }
      return;
    }
    if (action === 'acknowledge' && selected.attention && selected.attention.kind !== 'permission') {
      controls.onAcknowledge([selected.attention.id]); return;
    }
    if (action === 'archive' && selected.session) { setConfirmArchiveKey(selected.key); return; }
    const confirmedArchive = action === 'confirm-archive' && confirmArchiveKey === selected.key;
    if ((confirmedArchive || action === 'restore') && selected.session) {
      busy.current = true; setBusyKey(selected.key);
      const request = action === 'confirm-archive' ? controls.onArchive(selected.machineId, selected.session)
        : controls.onRestore(selected.machineId, selected.session);
      void request.finally(() => { busy.current = false; setBusyKey(undefined); });
    }
  };
  useEffect(() => { onController(perform); return () => onController(undefined); });
  const button = (action: ArenaActionName, position: [number, number, number], options?: {
    disabled?: boolean; selected?: boolean; variant?: 'secondary' | 'primary' | 'destructive';
  }) => <WorldButton key={action} action={`arena:${action}`} label={ARENA_ACTIONS[action]} resource={buttons?.[action]}
    iconTheme={theme} position={position} disabled={!enabled || options?.disabled} selected={options?.selected}
    variant={options?.variant} onAction={() => perform(action)} />;
  return <group name="VR Arena tools" userData={{ tab, rows: rows.length, page, pageCount, selectedKey: selected?.key, busyKey }}>
    {button('sessions', [-0.42, 0.63, 0], { selected: tab === 'sessions' })}
    {button('inbox', [0, 0.63, 0], { selected: tab === 'inbox' })}
    {button('archived', [0.42, 0.63, 0], { selected: tab === 'archived' })}
    {summary && <mesh name="Arena summaries" geometry={summary.geometry} material={summary.material} position={[0, 0.06, 0]}
      userData={{ visibleKeys: visibleRows.map((row) => row.key), focused }} />}
    <WorkspacePager label={`Summary ${rows.length ? selectedIndex + 1 : 0} of ${rows.length}`}
      previousAction="arena:previous" nextAction="arena:next" previousLabel="Previous summary" nextLabel="Next summary"
      position={[0, -0.56, 0]} theme={theme} icons={pagerIcons} previousDisabled={!rows.length} nextDisabled={!rows.length}
      onAction={(action) => perform(action.slice('arena:'.length) as ArenaActionName)} />
    {button('new', [-0.48, -0.76, 0], { variant: 'primary' })}
    {button(primaryAction, [-0.16, -0.76, 0], { disabled: !selected?.actionable, variant: 'primary' })}
    {button(secondaryAction, [0.17, -0.76, 0], {
      disabled: !selected || Boolean(busyKey) || secondaryAction === 'acknowledge' && !selected.unread,
      variant: secondaryAction === 'archive' || secondaryAction === 'confirm-archive' ? 'destructive' : 'secondary',
    })}
    {button('refresh', [0.48, -0.76, 0])}
  </group>;
}
