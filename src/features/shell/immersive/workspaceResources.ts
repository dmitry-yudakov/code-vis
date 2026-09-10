import { PANEL_COMMAND_LABELS, type PanelCommand } from './workspaceLayout';
import type { ImmersiveTexturePanel } from '@/features/diagram/spatial/immersiveResources';
import { palette, type ThemeName } from '@/shared/design/tokens';
import { texturePanel } from '@/features/diagram/spatial/immersiveResources';
import type { SpatialResourceLedger } from '@/features/diagram/spatial/resourceLedger';

export function createWorkspaceTextResource(title: string, detail: string, theme: ThemeName, ledger: SpatialResourceLedger) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Workspace text rasterization is unavailable.');
  const colors = palette[theme];
  context.fillStyle = colors.raised;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = colors.plot;
  context.lineWidth = 4;
  context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  context.fillStyle = colors.ink;
  context.font = '700 26px system-ui, sans-serif';
  context.fillText(title, 16, 36, 480);
  context.fillStyle = colors.muted;
  context.font = '20px system-ui, sans-serif';
  context.fillText(detail, 16, 73, 480);
  return texturePanel(canvas, [1.36, 0.255], ledger);
}

export function createWorkspaceButtonResource(label: string, theme: ThemeName, ledger: SpatialResourceLedger) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 80;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Panel controls unavailable.');
  context.fillStyle = palette[theme].raised;
  context.fillRect(0, 0, 256, 80);
  context.strokeStyle = palette[theme].plot;
  context.lineWidth = 4;
  context.strokeRect(2, 2, 252, 76);
  context.fillStyle = palette[theme].ink;
  context.font = '700 25px system-ui, sans-serif';
  context.textAlign = 'center';
  context.fillText(label, 128, 49, 238);
  return texturePanel(canvas, [0.42, 0.14], ledger);
}

type ToolbarCommand = 'drag' | 'resize' | 'close';
export interface PanelControlResources {
  buttons: Record<PanelCommand, ImmersiveTexturePanel>;
  tooltips: Record<ToolbarCommand, ImmersiveTexturePanel>;
  toolbar: ImmersiveTexturePanel;
}

function createPanelIconResource(command: ToolbarCommand, theme: ThemeName, ledger: SpatialResourceLedger) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 80;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Panel icons unavailable.');
  context.fillStyle = context.strokeStyle = palette[theme].ink;
  context.lineWidth = 5;
  context.lineCap = context.lineJoin = 'round';
  if (command === 'drag') {
    for (const x of [31, 49]) for (const y of [22, 40, 58]) {
      context.beginPath(); context.arc(x, y, 4, 0, 2 * Math.PI); context.fill();
    }
  } else {
    context.beginPath();
    if (command === 'close') {
      context.moveTo(25, 25); context.lineTo(55, 55);
      context.moveTo(55, 25); context.lineTo(25, 55);
    } else {
      context.moveTo(24, 56); context.lineTo(56, 24);
      context.moveTo(38, 24); context.lineTo(56, 24); context.lineTo(56, 42);
      context.moveTo(24, 38); context.lineTo(24, 56); context.lineTo(42, 56);
    }
    context.stroke();
  }
  const resource = texturePanel(canvas, [0.16, 0.16], ledger);
  resource.material.depthWrite = false;
  return resource;
}

function createPanelTooltipResource(label: string, theme: ThemeName, ledger: SpatialResourceLedger) {
  const canvas = document.createElement('canvas');
  canvas.width = 384; canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Panel tooltips unavailable.');
  context.fillStyle = palette[theme].ink;
  context.beginPath(); context.roundRect(0, 0, 384, 64, 12); context.fill();
  context.fillStyle = palette[theme].raised;
  context.font = '26px system-ui, sans-serif';
  context.textAlign = 'center';
  context.fillText(label, 192, 41, 360);
  return texturePanel(canvas, [0.84, 0.14], ledger);
}

export function createPanelControlResources(theme: ThemeName, ledger: SpatialResourceLedger): PanelControlResources {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 96;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Panel toolbar unavailable.');
  context.fillStyle = palette[theme].raised;
  context.strokeStyle = palette[theme].lineStrong;
  context.lineWidth = 3;
  context.beginPath(); context.roundRect(2, 2, 252, 92, 44); context.fill(); context.stroke();
  return {
    toolbar: texturePanel(canvas, [0.6, 0.22], ledger),
    buttons: Object.fromEntries(Object.entries(PANEL_COMMAND_LABELS).map(([command, label]) =>
      [command, command === 'drag' || command === 'resize' || command === 'close'
        ? createPanelIconResource(command, theme, ledger)
        : createWorkspaceButtonResource(label, theme, ledger)])) as Record<PanelCommand, ImmersiveTexturePanel>,
    tooltips: {
      drag: createPanelTooltipResource('Move · push/pull for depth', theme, ledger),
      resize: createPanelTooltipResource('Panel size', theme, ledger),
      close: createPanelTooltipResource('Close panel', theme, ledger),
    },
  };
}

export function createEvidenceResource(title: string, lines: readonly string[], pageLabel: string, theme: ThemeName, ledger: SpatialResourceLedger) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 768;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Evidence text unavailable.');
  const colors = palette[theme];
  context.fillStyle = colors.raised;
  context.fillRect(0, 0, 1024, 768);
  context.fillStyle = colors.ink;
  context.font = '700 30px system-ui, sans-serif';
  context.fillText(title, 28, 45, 968);
  context.fillStyle = colors.muted;
  context.font = '24px system-ui, sans-serif';
  context.fillText(pageLabel, 28, 83, 968);
  context.font = '28px ui-monospace, monospace';
  lines.forEach((line, index) => {
    context.fillStyle = line.startsWith('+') ? colors.liveInk : line.startsWith('-') ? colors.stopInk : colors.ink2;
    context.fillText(line, 28, 130 + index * 38);
  });
  return texturePanel(canvas, [1.32, 0.99], ledger);
}
