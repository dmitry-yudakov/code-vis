/** Disposable device presentation only: positions are relative to a resettable workspace origin. */
export const IMMERSIVE_LAYOUT_KEY = 'code-ai:device:v1:immersive-layout';
export const PANEL_IDS = ['conversation', 'canvas', 'evidence'] as const;
export type WorkspacePanelId = typeof PANEL_IDS[number];
export const PANEL_TITLES: Record<WorkspacePanelId, string> = {
  conversation: 'Conversation', canvas: 'Canvas', evidence: 'Evidence',
};
export const PANEL_COMMAND_LABELS = {
  open: 'Open', toggle: 'Toggle', focus: 'Focus', drag: 'Drag to move', resize: 'Size', close: 'Close',
  small: 'Small', medium: 'Medium', large: 'Large', 'extra-large': 'Extra large', done: 'Done',
} as const;
export type PanelCommand = keyof typeof PANEL_COMMAND_LABELS;
export type PanelAction = `panel:${WorkspacePanelId}:${PanelCommand}`;
export const PANEL_ANGLES = [36, 0, -36] as const;
const VERSION_3_PANEL_ANGLES = [-36, 0, 36] as const;
const LEGACY_PANEL_IDS = ['sessions', 'conversation', 'canvas', 'evidence'] as const;
const LEGACY_PANEL_ANGLES = [-57, -19, 19, 57] as const;
export const PANEL_BOUNDS = { angle: [-65, 65], distance: [2, 4.5], height: [-0.3, 0.5] } as const;
export const PANEL_SIZES = { small: 0.85, medium: 1, large: 1.15, 'extra-large': 1.3 } as const;
export type PanelSize = keyof typeof PANEL_SIZES;
export const PANEL_WIDTH = 1.4;
export const PANEL_HEIGHT = 1.8;
export const MAX_IMMERSIVE_LAYOUTS = 100;

export interface WorkspacePanelLayout {
  angle: number;
  height: number;
  distance: number;
  size: PanelSize;
  open: boolean;
}
export interface ImmersiveLayout {
  panels: Record<WorkspacePanelId, WorkspacePanelLayout>;
  focused?: WorkspacePanelId;
}
export interface ImmersiveLayouts { version: 4; views: Record<string, ImmersiveLayout> }
export interface PanelEditing { id: WorkspacePanelId; mode: 'drag' | 'resize' }
export type PanelPlacement = Pick<WorkspacePanelLayout, 'angle' | 'height' | 'distance'>;

export function immersiveViewKey(machineId?: string, projectId?: string, sessionId?: string): string {
  return JSON.stringify([machineId || 'local', projectId || 'none', sessionId || 'launcher']);
}

export function defaultImmersiveLayout(): ImmersiveLayout {
  return {
    panels: Object.fromEntries(PANEL_IDS.map((id, slot) => [id, {
      angle: PANEL_ANGLES[slot], height: 0, distance: 2.6, size: 'medium', open: id !== 'evidence',
    }])) as ImmersiveLayout['panels'],
    focused: 'canvas',
  };
}

const clamp = (value: number, bounds: readonly [number, number]) => Math.max(bounds[0], Math.min(bounds[1], value));
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function parseImmersiveLayout(value: unknown, version = 4): ImmersiveLayout {
  const fallback = defaultImmersiveLayout();
  if (!record(value) || !record(value.panels)) return fallback;
  const slots = new Set<number>();
  for (const id of PANEL_IDS) {
    const panel = value.panels[id];
    if (!record(panel) || !finite(panel.height) || !finite(panel.distance) || typeof panel.open !== 'boolean') return defaultImmersiveLayout();
    let angle: number;
    let size: PanelSize;
    if (version === 1) {
      if (!finite(panel.slot) || !Number.isInteger(panel.slot) || panel.slot < 0 || panel.slot > 3
        || slots.has(panel.slot) || !finite(panel.scale)) return defaultImmersiveLayout();
      slots.add(panel.slot);
      angle = LEGACY_PANEL_ANGLES[panel.slot];
      const scale = panel.scale;
      size = (Object.keys(PANEL_SIZES) as PanelSize[]).reduce((best, next) =>
        Math.abs(PANEL_SIZES[next] - scale) < Math.abs(PANEL_SIZES[best] - scale) ? next : best, 'medium');
    } else {
      if (!finite(panel.angle) || typeof panel.size !== 'string' || !Object.hasOwn(PANEL_SIZES, panel.size)) return defaultImmersiveLayout();
      angle = panel.angle;
      size = panel.size as PanelSize;
    }
    fallback.panels[id] = {
      angle: clamp(angle, PANEL_BOUNDS.angle), height: clamp(panel.height, PANEL_BOUNDS.height),
      distance: clamp(panel.distance, PANEL_BOUNDS.distance), size, open: panel.open,
    };
    if (version < 4) {
      const originalAngle = version < 3 ? LEGACY_PANEL_ANGLES[LEGACY_PANEL_IDS.indexOf(id)]
        : VERSION_3_PANEL_ANGLES[PANEL_IDS.indexOf(id)];
      if (angle === originalAngle && panel.height === 0 && panel.distance === 2.6 && size === 'medium') {
        fallback.panels[id].angle = PANEL_ANGLES[PANEL_IDS.indexOf(id)];
      }
      // The list now lives inside Conversation; repository changes start closed after migration.
      if (version < 3 && id === 'evidence') fallback.panels[id].open = false;
    }
  }
  fallback.focused = PANEL_IDS.find((id) => id === value.focused && fallback.panels[id].open);
  return fallback;
}

export function parseImmersiveLayouts(raw: string | null): ImmersiveLayouts {
  const empty: ImmersiveLayouts = { version: 4, views: {} };
  if (!raw || raw.length > 250_000) return empty;
  try {
    const value: unknown = JSON.parse(raw);
    if (!record(value) || ![1, 2, 3, 4].includes(value.version as number) || !record(value.views)) return empty;
    const version = value.version;
    return { version: 4, views: Object.fromEntries(Object.entries(value.views)
      .filter(([key]) => key.startsWith('[') && key.length <= 512).slice(-MAX_IMMERSIVE_LAYOUTS)
      .map(([key, layout]) => [key, parseImmersiveLayout(layout, version as number)])) };
  } catch { return empty; }
}

export function updateImmersivePanel(layout: ImmersiveLayout, id: WorkspacePanelId, command: PanelCommand): ImmersiveLayout {
  const panel = { ...layout.panels[id] };
  if (!panel.open && command !== 'open' && command !== 'toggle') return layout;
  const next = { ...layout, panels: { ...layout.panels, [id]: panel } };
  if (command === 'close' || (command === 'toggle' && panel.open)) {
    panel.open = false;
    if (next.focused === id) next.focused = undefined;
  } else if (command === 'open' || command === 'toggle' || command === 'focus' || command === 'drag' || command === 'resize') {
    panel.open = true;
    next.focused = id;
  } else if (Object.hasOwn(PANEL_SIZES, command)) panel.size = command as PanelSize;
  return next;
}

export function placeImmersivePanel(layout: ImmersiveLayout, id: WorkspacePanelId, placement: PanelPlacement): ImmersiveLayout {
  if (!layout.panels[id].open || ![placement.angle, placement.height, placement.distance].every(finite)) return layout;
  return { ...layout, focused: id, panels: { ...layout.panels, [id]: { ...layout.panels[id],
    angle: clamp(placement.angle, PANEL_BOUNDS.angle), height: clamp(placement.height, PANEL_BOUNDS.height),
    distance: clamp(placement.distance, PANEL_BOUNDS.distance),
  } } };
}

export function panelTransform(panel: WorkspacePanelLayout) {
  const angle = panel.angle * Math.PI / 180;
  return { position: [Math.sin(angle) * panel.distance, panel.height, -Math.cos(angle) * panel.distance] as [number, number, number], rotationY: -angle };
}

export function parsePanelAction(action: string): { id: WorkspacePanelId; command: PanelCommand } | undefined {
  const [prefix, id, command, extra] = action.split(':');
  if (prefix !== 'panel' || extra !== undefined || !PANEL_IDS.includes(id as WorkspacePanelId)
    || !Object.hasOwn(PANEL_COMMAND_LABELS, command)) return undefined;
  return { id: id as WorkspacePanelId, command: command as PanelCommand };
}
