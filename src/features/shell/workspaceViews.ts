import type { AgentMode } from '@/shared/types';

export const DEVICE_WORKSPACE_STORAGE_KEY = 'code-ai:device:v1:workspace';
export const LOOSE_WORKSPACE_SCOPE = 'project:none';

const MAX_SCOPES = 100;
const MAX_SESSIONS_PER_SCOPE = 200;
export const MAX_CANVAS_VIEWS = 200;
export const SPATIAL_ROOM_BOUNDS = {
  x: [-32, 32],
  y: [-12, 16],
  z: [-24, 24],
} as const;
const SPATIAL_CAMERA_BOUNDS = 64;
const SESSION_ID = /^[0-9a-f-]{36}$/i;
const AGENT_MODES = new Set<AgentMode>(['ask', 'plan', 'agent']);

export interface CanvasViewState {
  zoom: number;
  pan: { x: number; y: number };
  fitted: boolean;
}

export type CanvasSurface = 'flat' | 'spatial';

export interface SpatialPose {
  position: [number, number, number];
  rotationY: number;
}

export interface SpatialCameraState {
  position: [number, number, number];
  target: [number, number, number];
}

export interface SpatialViewState {
  camera?: SpatialCameraState;
  placements: Record<string, SpatialPose>;
}

export interface DeviceViewState {
  composer: string;
  pendingAttachmentIds?: string[];
  unread: number;
  selectedCheckoutId?: string;
  activeDiagramId?: string;
  addressedAgentId?: string;
  defaultMode?: AgentMode;
  canvasViews: Record<string, CanvasViewState>;
  surface?: CanvasSurface;
  spatial?: SpatialViewState;
}

export interface DeviceWorkspaceScope {
  openSessionIds: string[];
  focusedSessionId?: string;
  views: Record<string, DeviceViewState>;
}

export interface DeviceWorkspace {
  version: 1;
  scopes: Record<string, DeviceWorkspaceScope>;
}

export const EMPTY_DEVICE_WORKSPACE: DeviceWorkspace = { version: 1, scopes: {} };

export function workspaceScopeKey(projectId?: string, machineId?: string): string {
  const project = projectId || 'none';
  return machineId ? `machine:${machineId}:project:${project}` : `project:${project}`;
}

export function emptyDeviceView(): DeviceViewState {
  return { composer: '', unread: 0, canvasViews: {} };
}

export function emptyWorkspaceScope(): DeviceWorkspaceScope {
  return { openSessionIds: [], views: {} };
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function optionalId(value: unknown): string | undefined {
  return typeof value === 'string' && SESSION_ID.test(value) ? value : undefined;
}

function optionalKey(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f]/.test(value)
    ? value
    : undefined;
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => {
    const id = optionalId(item);
    return id ? [id] : [];
  }))].slice(0, MAX_SESSIONS_PER_SCOPE);
}

function parseCanvasViews(value: unknown): Record<string, CanvasViewState> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, CanvasViewState> = {};
  for (const [canvasId, candidate] of Object.entries(value).slice(0, MAX_CANVAS_VIEWS)) {
    if (!SESSION_ID.test(canvasId) || !candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const view = candidate as Partial<CanvasViewState> & { pan?: Partial<CanvasViewState['pan']> };
    if (!finite(view.zoom) || !finite(view.pan?.x) || !finite(view.pan?.y)) continue;
    result[canvasId] = {
      zoom: Math.max(0.08, Math.min(8, view.zoom)),
      pan: {
        x: Math.max(-100_000, Math.min(100_000, view.pan.x)),
        y: Math.max(-100_000, Math.min(100_000, view.pan.y)),
      },
      fitted: view.fitted === true,
    };
  }
  return result;
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.max(lower, Math.min(upper, value));
}

function parseTuple(value: unknown, bounds: readonly [number, number] | number): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(finite)) return undefined;
  const coordinateBounds = typeof bounds === 'number'
    ? [[-bounds, bounds], [-bounds, bounds], [-bounds, bounds]] as const
    : [bounds, bounds, bounds] as const;
  return value.map((coordinate, index) => (
    clamp(coordinate as number, coordinateBounds[index][0], coordinateBounds[index][1])
  )) as [number, number, number];
}

function parseRoomPosition(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(finite)) return undefined;
  return [
    clamp(value[0], ...SPATIAL_ROOM_BOUNDS.x),
    clamp(value[1], ...SPATIAL_ROOM_BOUNDS.y),
    clamp(value[2], ...SPATIAL_ROOM_BOUNDS.z),
  ];
}

export function parseSpatialView(value: unknown): SpatialViewState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as { camera?: unknown; placements?: unknown };
  let camera: SpatialCameraState | undefined;
  if (candidate.camera && typeof candidate.camera === 'object' && !Array.isArray(candidate.camera)) {
    const raw = candidate.camera as { position?: unknown; target?: unknown };
    const position = parseTuple(raw.position, SPATIAL_CAMERA_BOUNDS);
    const target = parseRoomPosition(raw.target);
    if (position && target) camera = { position, target };
  }
  const placements: Record<string, SpatialPose> = {};
  if (candidate.placements && typeof candidate.placements === 'object' && !Array.isArray(candidate.placements)) {
    for (const [canvasId, value] of Object.entries(candidate.placements).slice(0, MAX_CANVAS_VIEWS)) {
      if (!SESSION_ID.test(canvasId) || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      const raw = value as { position?: unknown; rotationY?: unknown };
      const position = parseRoomPosition(raw.position);
      if (!position || !finite(raw.rotationY)) continue;
      placements[canvasId] = { position, rotationY: clamp(raw.rotationY, -Math.PI, Math.PI) };
    }
  }
  return { ...(camera ? { camera } : {}), placements };
}

export function reconcileSpatialView(spatial: SpatialViewState | undefined, canvasIds: readonly string[]): SpatialViewState | undefined {
  if (!spatial) return undefined;
  const available = new Set(canvasIds);
  const placements = Object.fromEntries(
    Object.entries(spatial.placements).filter(([id]) => available.has(id)).slice(0, MAX_CANVAS_VIEWS),
  );
  if (Object.keys(placements).length === Object.keys(spatial.placements).length) return spatial;
  return { ...(spatial.camera ? { camera: spatial.camera } : {}), placements };
}

export function resetSpatialView(): SpatialViewState {
  return { placements: {} };
}

function parseView(value: unknown): DeviceViewState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyDeviceView();
  const candidate = value as Partial<DeviceViewState>;
  const pending = candidate.pendingAttachmentIds === undefined ? undefined : ids(candidate.pendingAttachmentIds).slice(0, 4);
  const mode = typeof candidate.defaultMode === 'string' && AGENT_MODES.has(candidate.defaultMode as AgentMode)
    ? candidate.defaultMode as AgentMode
    : undefined;
  const surface = candidate.surface === 'flat' || candidate.surface === 'spatial' ? candidate.surface : undefined;
  const spatial = parseSpatialView(candidate.spatial);
  return {
    composer: typeof candidate.composer === 'string' ? candidate.composer.slice(0, 8_000) : '',
    ...(pending === undefined ? {} : { pendingAttachmentIds: pending }),
    unread: finite(candidate.unread) ? Math.max(0, Math.min(999, Math.floor(candidate.unread))) : 0,
    ...(optionalKey(candidate.selectedCheckoutId) ? { selectedCheckoutId: candidate.selectedCheckoutId } : {}),
    ...(optionalId(candidate.activeDiagramId) ? { activeDiagramId: candidate.activeDiagramId } : {}),
    ...(optionalId(candidate.addressedAgentId) ? { addressedAgentId: candidate.addressedAgentId } : {}),
    ...(mode ? { defaultMode: mode } : {}),
    canvasViews: parseCanvasViews(candidate.canvasViews),
    ...(surface ? { surface } : {}),
    ...(spatial ? { spatial } : {}),
  };
}

export function parseDeviceWorkspace(value: string | null): DeviceWorkspace {
  if (!value) return EMPTY_DEVICE_WORKSPACE;
  try {
    const parsed = JSON.parse(value) as { version?: unknown; scopes?: unknown };
    if (parsed.version !== 1 || !parsed.scopes || typeof parsed.scopes !== 'object' || Array.isArray(parsed.scopes)) {
      return EMPTY_DEVICE_WORKSPACE;
    }
    const scopes: Record<string, DeviceWorkspaceScope> = {};
    for (const [scopeId, rawScope] of Object.entries(parsed.scopes).slice(0, MAX_SCOPES)) {
      if (!/^(?:machine:[0-9a-f-]{36}:)?project:(none|[0-9a-f-]{36})$/i.test(scopeId) || !rawScope || typeof rawScope !== 'object' || Array.isArray(rawScope)) continue;
      const candidate = rawScope as Partial<DeviceWorkspaceScope>;
      const openSessionIds = ids(candidate.openSessionIds);
      const views: Record<string, DeviceViewState> = {};
      if (candidate.views && typeof candidate.views === 'object' && !Array.isArray(candidate.views)) {
        for (const [sessionId, view] of Object.entries(candidate.views).slice(0, MAX_SESSIONS_PER_SCOPE)) {
          if (SESSION_ID.test(sessionId)) views[sessionId] = parseView(view);
        }
      }
      const focused = optionalId(candidate.focusedSessionId);
      scopes[scopeId] = {
        openSessionIds,
        ...(focused && openSessionIds.includes(focused) ? { focusedSessionId: focused } : {}),
        views,
      };
    }
    return { version: 1, scopes };
  } catch {
    return EMPTY_DEVICE_WORKSPACE;
  }
}

export function getWorkspaceScope(workspace: DeviceWorkspace, scopeId: string): DeviceWorkspaceScope {
  return workspace.scopes[scopeId] || emptyWorkspaceScope();
}

export function getWorkspaceViewIds(workspace: DeviceWorkspace): string[] {
  return [...new Set(Object.values(workspace.scopes).flatMap((scope) => Object.keys(scope.views)))];
}

export function replacePendingCanvasRevision(
  pendingAttachmentIds: string[] | undefined,
  priorCanvasId: string,
  revisionCanvasId: string,
): string[] | undefined {
  if (!pendingAttachmentIds?.includes(priorCanvasId)) return pendingAttachmentIds;
  return [...new Set(pendingAttachmentIds.map((id) => id === priorCanvasId ? revisionCanvasId : id))].slice(0, 4);
}

export function reconcileWorkspaceScope(
  workspace: DeviceWorkspace,
  scopeId: string,
  availableSessionIds: readonly string[],
): DeviceWorkspace {
  const current = getWorkspaceScope(workspace, scopeId);
  const available = new Set(availableSessionIds);
  const openSessionIds = current.openSessionIds.filter((id) => available.has(id));
  if (!openSessionIds.length && availableSessionIds[0]) openSessionIds.push(availableSessionIds[0]);
  const focusedSessionId = current.focusedSessionId && openSessionIds.includes(current.focusedSessionId)
    ? current.focusedSessionId
    : openSessionIds[0];
  const views = Object.fromEntries(Object.entries(current.views).filter(([id]) => available.has(id)));
  for (const id of openSessionIds) views[id] ||= emptyDeviceView();
  return {
    ...workspace,
    scopes: { ...workspace.scopes, [scopeId]: { openSessionIds, focusedSessionId, views } },
  };
}

export function openWorkspaceView(workspace: DeviceWorkspace, scopeId: string, sessionId: string): DeviceWorkspace {
  const current = getWorkspaceScope(workspace, scopeId);
  return {
    ...workspace,
    scopes: {
      ...workspace.scopes,
      [scopeId]: {
        openSessionIds: current.openSessionIds.includes(sessionId)
          ? current.openSessionIds
          : [...current.openSessionIds, sessionId],
        focusedSessionId: sessionId,
        views: { ...current.views, [sessionId]: current.views[sessionId] || emptyDeviceView() },
      },
    },
  };
}

export function ensureWorkspaceView(workspace: DeviceWorkspace, scopeId: string, sessionId: string): DeviceWorkspace {
  const current = getWorkspaceScope(workspace, scopeId);
  if (current.openSessionIds.includes(sessionId)) return workspace;
  return {
    ...workspace,
    scopes: {
      ...workspace.scopes,
      [scopeId]: {
        openSessionIds: [...current.openSessionIds, sessionId],
        focusedSessionId: current.focusedSessionId || sessionId,
        views: { ...current.views, [sessionId]: current.views[sessionId] || emptyDeviceView() },
      },
    },
  };
}

export function closeWorkspaceView(workspace: DeviceWorkspace, scopeId: string, sessionId: string): DeviceWorkspace {
  const current = getWorkspaceScope(workspace, scopeId);
  const closingIndex = current.openSessionIds.indexOf(sessionId);
  if (closingIndex < 0) return workspace;
  const openSessionIds = current.openSessionIds.filter((id) => id !== sessionId);
  const focusedSessionId = current.focusedSessionId === sessionId
    ? openSessionIds[Math.min(closingIndex, openSessionIds.length - 1)]
    : current.focusedSessionId;
  return {
    ...workspace,
    scopes: {
      ...workspace.scopes,
      [scopeId]: { ...current, openSessionIds, focusedSessionId },
    },
  };
}

export function updateWorkspaceView(
  workspace: DeviceWorkspace,
  scopeId: string,
  sessionId: string,
  update: (current: DeviceViewState) => DeviceViewState,
): DeviceWorkspace {
  const scope = getWorkspaceScope(workspace, scopeId);
  const current = scope.views[sessionId] || emptyDeviceView();
  const next = update(current);
  if (next === current) return workspace;
  return {
    ...workspace,
    scopes: {
      ...workspace.scopes,
      [scopeId]: { ...scope, views: { ...scope.views, [sessionId]: next } },
    },
  };
}
