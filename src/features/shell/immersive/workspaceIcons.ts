import { texturePanel } from '@/features/diagram/spatial/immersiveResources';
import type { SpatialResourceLedger } from '@/features/diagram/spatial/resourceLedger';
import { palette, type ThemeName } from '@/shared/design/tokens';

// A single 24-unit stroke grid keeps the workspace controls consistent at headset scale.
const iconPaths = {
  chat: 'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3H3V6a2 2 0 0 1 2-2Z M7 9h10 M7 13h7',
  compose: 'M13 5H5v15h15v-8 M10 14l1-4L19 2l3 3-8 8-4 1Z M17 4l3 3',
  agents: 'M8 8a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M2 21v-3a6 6 0 0 1 12 0v3 M17 3a4 4 0 0 1 0 8 M18 15a5 5 0 0 1 4 5v1',
  microphone: 'M8 6a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0V6 M5 11v1a7 7 0 0 0 14 0v-1 M12 19v3 M8 22h8',
  stop: 'M5 5h14v14H5Z',
  send: 'M3 3l19 9-19 9 4-9-4-9Z M7 12h15',
  edit: 'M4 16 17 3l4 4L8 20l-5 1 1-5Z M14 6l4 4',
  undo: 'M9 4 3 10l6 6 M3 10h11a7 7 0 0 1 0 14',
  close: 'M6 6l12 12 M18 6 6 18',
  'chevron-left': 'M15 5l-7 7 7 7',
  'chevron-right': 'M9 5l7 7-7 7',
  down: 'M12 3v17 M5 13l7 7 7-7',
  plus: 'M12 4v16 M4 12h16',
  replace: 'M3 7h18l-4-4 M21 17H3l4 4 M21 7v4 M3 17v-4',
  spell: 'M3 16 8 3l5 13 M5 11h6 M14 18l3 3 5-7',
  trash: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
  newline: 'M20 4v8a3 3 0 0 1-3 3H4 M9 10l-5 5 5 5',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20 M8 8a4 4 0 1 1 7 3l-3 2v2 M12 18v.1',
  refresh: 'M20 9a8 8 0 0 0-14-4L3 8 M3 3v5h5 M4 15a8 8 0 0 0 14 4l3-3 M16 16h5v5',
  canvas: 'M2 3h8v6H2Z M14 15h8v6h-8Z M10 6h8v9 M6 9v9h8',
  sessions: 'M3 3h18v14H9l-6 4V3Z M7 7h10 M7 11h7',
  history: 'M3 10a9 9 0 1 1 2 8 M3 4v6h6 M12 7v6l4 2',
  evidence: 'M5 2h9l5 5v15H5Z M14 2v6h5 M8 12h8 M8 16h6',
  reset: 'M4 10a8 8 0 1 1 1 8 M4 4v6h6 M12 8v5l3 2',
  exit: 'M10 3H3v18h7 M9 12h13 M17 7l5 5-5 5',
  'zoom-in': 'M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16 M16 16l6 6 M6 10h8 M10 6v8',
  'zoom-out': 'M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16 M16 16l6 6 M6 10h8',
  check: 'M4 12l5 5L21 5',
  settings: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',
} as const;

export type WorkspaceIcon = keyof typeof iconPaths;

export function createWorkspaceIconResource(icon: WorkspaceIcon, theme: ThemeName, ledger: SpatialResourceLedger) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 96;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Workspace icons unavailable.');
  context.fillStyle = palette[theme].sheetSunk;
  context.beginPath(); context.roundRect(0, 0, 96, 96, 28); context.fill();
  context.translate(20, 20);
  context.scale(56 / 24, 56 / 24);
  context.strokeStyle = palette[theme].ink;
  context.lineWidth = 1.8;
  context.lineCap = context.lineJoin = 'round';
  context.stroke(new Path2D(iconPaths[icon]));
  const resource = texturePanel(canvas, [0.18, 0.18], ledger);
  resource.material.depthWrite = false;
  return resource;
}

export function createWorkspaceTooltipResource(label: string, theme: ThemeName, ledger: SpatialResourceLedger) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Workspace tooltips unavailable.');
  context.fillStyle = palette[theme].sheetSunk;
  context.strokeStyle = palette[theme].lineStrong;
  context.lineWidth = 2;
  context.beginPath(); context.roundRect(1, 1, 254, 62, 14); context.fill(); context.stroke();
  context.fillStyle = palette[theme].ink2;
  context.font = '26px system-ui, sans-serif';
  context.textAlign = 'center';
  context.fillText(label, 128, 41, 232);
  const resource = texturePanel(canvas, [0.56, 0.14], ledger);
  resource.material.depthWrite = false;
  return resource;
}
