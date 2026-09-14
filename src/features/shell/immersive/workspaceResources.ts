import { PANEL_COMMAND_LABELS, type PanelCommand } from './workspaceLayout';
import type { ImmersiveTexturePanel } from '@/features/diagram/spatial/immersiveResources';
import { palette, type ThemeName } from '@/shared/design/tokens';
import { texturePanel } from '@/features/diagram/spatial/immersiveResources';
import type { SpatialResourceLedger } from '@/features/diagram/spatial/resourceLedger';

export function createWorkspaceTextResource(title: string, detail: string, theme: ThemeName, ledger: SpatialResourceLedger, headerActions = false, headerBack = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Workspace text rasterization is unavailable.');
  const colors = palette[theme];
  context.fillStyle = colors.raised;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = colors.ink;
  context.font = '600 26px system-ui, sans-serif';
  const left = headerBack ? 100 : 16;
  context.fillText(title, left, 36, (headerActions ? 336 : 496) - left);
  context.fillStyle = colors.muted;
  context.font = '20px system-ui, sans-serif';
  context.fillText(detail, left, 73, 496 - left);
  return texturePanel(canvas, [1.36, 0.255], ledger);
}

export function createWorkspaceButtonResource(label: string, theme: ThemeName, ledger: SpatialResourceLedger) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 80;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Panel controls unavailable.');
  context.fillStyle = palette[theme].sheetSunk;
  context.beginPath(); context.roundRect(0, 0, 256, 80, 22); context.fill();
  context.fillStyle = palette[theme].ink;
  context.font = '500 25px system-ui, sans-serif';
  context.textAlign = 'center';
  context.fillText(label, 128, 49, 238);
  return texturePanel(canvas, [0.42, 0.16], ledger);
}

export function createConversationTextResource(title: string, lines: readonly string[], theme: ThemeName, ledger: SpatialResourceLedger, status = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = status ? 144 : 640;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Conversation text unavailable.');
  context.fillStyle = palette[theme].raised;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = palette[theme].ink;
  context.font = '600 30px system-ui, sans-serif';
  if (title) context.fillText(title, 24, 35, 976);
  context.font = `${status ? 32 : 38}px Arial, sans-serif`;
  lines.forEach((line, i) => context.fillText(line, 24, (status ? (title ? 78 : 34) : 92) + i * (status ? 40 : 48), 976));
  return texturePanel(canvas, [1.32, canvas.height / 1024 * 1.32], ledger);
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
  context.fillStyle = palette[theme].sheetSunk;
  context.strokeStyle = palette[theme].lineStrong;
  context.lineWidth = 2;
  context.beginPath(); context.roundRect(1, 1, 382, 62, 12); context.fill(); context.stroke();
  context.fillStyle = palette[theme].ink2;
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
