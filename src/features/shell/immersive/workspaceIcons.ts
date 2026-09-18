import { texturePanel } from '@/features/diagram/spatial/immersiveResources';
import type { SpatialResourceLedger } from '@/features/diagram/spatial/resourceLedger';
import type { ThemeName } from '@/shared/design/tokens';
import { IMMERSIVE_GLYPH_MASK, dpToWorld, immersiveFont, immersiveTheme } from './immersiveTheme';

// Path data is adapted from Lucide (https://lucide.dev), ISC License.
// Copyright (c) 2020 Lucide Contributors.
const LUCIDE_PATHS = {
  Pencil: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z M15 5l4 4',
  RectangleHorizontal: 'M3 5h18v14H3z',
  MoveUpRight: 'M13 5h6v6 M19 5 5 19',
  Type: 'M4 7V4h16v3 M9 20h6 M12 4v16',
  Eraser: 'm7 21-4-4 10-10 4 4L7 21z M14 4l6 6-8 8',
  Undo2: 'M9 14 4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-1',
  Redo2: 'm15 14 5-5-5-5 M20 9H10a6 6 0 0 0 0 12h1',
  Trash2: 'M3 6h18 M8 6V4h8v2 M19 6l-1 15H6L5 6 M10 11v6 M14 11v6',
  Delete: 'M10 5 3 12l7 7h11V5z M14 9l4 6 M18 9l-4 6',
  CornerDownLeft: 'M20 4v7a4 4 0 0 1-4 4H4 M9 10l-5 5 5 5',
  Mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z M19 10v2a7 7 0 0 1-14 0v-2 M12 19v3 M8 22h8',
  CircleStop: 'M9 9h6v6H9z M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20',
  SendHorizontal: 'm3 3 3 9-3 9 19-9z M6 12h16',
  ArrowDown: 'M12 5v14 M19 12l-7 7-7-7',
  ArrowLeft: 'm12 19-7-7 7-7 M19 12H5',
  History: 'M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5 M12 7v5l4 2',
  Users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  SlidersHorizontal: 'M21 4h-7 M10 4H3 M21 12h-9 M8 12H3 M21 20h-5 M12 20H3 M14 2v4 M8 10v4 M16 18v4',
  RefreshCw: 'M21 12a9 9 0 0 0-15.2-6.5L3 9 M3 4v5h5 M3 12a9 9 0 0 0 15.2 6.5L21 15 M21 20v-5h-5',
  ZoomIn: 'M11 8v6 M8 11h6 M21 21l-4.35-4.35 M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16',
  ZoomOut: 'M8 11h6 M21 21l-4.35-4.35 M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16',
  GripHorizontal: 'M9 12h.01 M15 12h.01 M9 7h.01 M15 7h.01 M9 17h.01 M15 17h.01',
  Scaling: 'M21 3h-6 M21 3v6 M21 3l-7 7 M3 21h6 M3 21v-6 M3 21l7-7',
  X: 'M18 6 6 18 M6 6l12 12',
  ChevronLeft: 'm15 18-6-6 6-6',
  ChevronRight: 'm9 18 6-6-6-6',
} as const;

export type WorkspaceGlyph = keyof typeof LUCIDE_PATHS;
export type WorkspaceIconAction =
  | `canvas:${'pen' | 'rectangle' | 'arrow' | 'text' | 'eraser' | 'undo' | 'redo'}`
  | `conversation:${'delete' | 'clear' | 'newline' | 'record' | 'stop' | 'send' | 'latest' | 'back' | 'read' | 'undo' | 'list' | 'agents'}`
  | 'session:tools' | 'refresh-evidence' | 'larger' | 'smaller'
  | 'panel:drag' | 'panel:resize' | 'panel:close' | 'pager:previous' | 'pager:next';

export const WORKSPACE_GLYPH_MAP: Readonly<Record<WorkspaceIconAction, { glyph: WorkspaceGlyph; meaning: string }>> = {
  'canvas:pen': { glyph: 'Pencil', meaning: 'Draw freehand' },
  'canvas:rectangle': { glyph: 'RectangleHorizontal', meaning: 'Draw rectangle' },
  'canvas:arrow': { glyph: 'MoveUpRight', meaning: 'Draw arrow' },
  'canvas:text': { glyph: 'Type', meaning: 'Place text' },
  'canvas:eraser': { glyph: 'Eraser', meaning: 'Erase mark' },
  'canvas:undo': { glyph: 'Undo2', meaning: 'Undo' },
  'conversation:undo': { glyph: 'Undo2', meaning: 'Undo' },
  'canvas:redo': { glyph: 'Redo2', meaning: 'Redo' },
  'conversation:delete': { glyph: 'Trash2', meaning: 'Delete selected word' },
  'conversation:clear': { glyph: 'Delete', meaning: 'Clear text field' },
  'conversation:newline': { glyph: 'CornerDownLeft', meaning: 'Insert new line' },
  'conversation:record': { glyph: 'Mic', meaning: 'Dictate' },
  'conversation:stop': { glyph: 'CircleStop', meaning: 'Stop recording' },
  'conversation:send': { glyph: 'SendHorizontal', meaning: 'Send' },
  'conversation:latest': { glyph: 'ArrowDown', meaning: 'Jump to latest' },
  'conversation:back': { glyph: 'ArrowLeft', meaning: 'Back' },
  'conversation:read': { glyph: 'ArrowLeft', meaning: 'Back' },
  'conversation:list': { glyph: 'History', meaning: 'Conversation list' },
  'conversation:agents': { glyph: 'Users', meaning: 'Agents' },
  'session:tools': { glyph: 'SlidersHorizontal', meaning: 'Session tools' },
  'refresh-evidence': { glyph: 'RefreshCw', meaning: 'Refresh changes' },
  larger: { glyph: 'ZoomIn', meaning: 'Zoom in' },
  smaller: { glyph: 'ZoomOut', meaning: 'Zoom out' },
  'panel:drag': { glyph: 'GripHorizontal', meaning: 'Move panel' },
  'panel:resize': { glyph: 'Scaling', meaning: 'Size panel' },
  'panel:close': { glyph: 'X', meaning: 'Close panel' },
  'pager:previous': { glyph: 'ChevronLeft', meaning: 'Previous page' },
  'pager:next': { glyph: 'ChevronRight', meaning: 'Next page' },
};

export function isWorkspaceIconAction(action: string): action is WorkspaceIconAction {
  return Object.hasOwn(WORKSPACE_GLYPH_MAP, action);
}

export function createWorkspaceIconResource(action: WorkspaceIconAction, theme: ThemeName, ledger: SpatialResourceLedger) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 96;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Workspace icons unavailable.');
  context.translate(20, 20);
  context.scale(56 / 24, 56 / 24);
  context.strokeStyle = IMMERSIVE_GLYPH_MASK;
  context.lineWidth = 2;
  context.lineCap = context.lineJoin = 'round';
  context.stroke(new Path2D(LUCIDE_PATHS[WORKSPACE_GLYPH_MAP[action].glyph]));
  const size = dpToWorld(48);
  const resource = texturePanel(canvas, [size, size], ledger);
  resource.presentation = 'icon-mask';
  resource.material.color.set(immersiveTheme[theme].text);
  return resource;
}

export function createWorkspaceTooltipResource(label: string, theme: ThemeName, ledger: SpatialResourceLedger) {
  const height = dpToWorld(32);
  const pixelsPerMeter = 64 / height;
  const canvas = document.createElement('canvas');
  canvas.height = 64; canvas.width = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Workspace tooltips unavailable.');
  context.font = immersiveFont('label', pixelsPerMeter);
  const width = Math.min(256, Math.ceil(context.measureText(label).width + dpToWorld(24) * pixelsPerMeter));
  canvas.width = Math.max(64, width);
  context.fillStyle = immersiveTheme[theme].raised;
  context.beginPath(); context.roundRect(0, 0, canvas.width, canvas.height, canvas.height / 2); context.fill();
  context.fillStyle = immersiveTheme[theme].text;
  context.font = immersiveFont('label', pixelsPerMeter);
  context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillText(label, canvas.width / 2, canvas.height / 2, canvas.width - 16);
  const resource = texturePanel(canvas, [canvas.width / pixelsPerMeter, height], ledger);
  resource.material.depthWrite = false;
  return resource;
}
