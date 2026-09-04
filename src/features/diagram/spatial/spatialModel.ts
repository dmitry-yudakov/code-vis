import type { CanvasTarget } from '@/shared/types';
import type { SpatialCameraState, SpatialPose } from '@/features/shell/workspaceViews';
import { canvasTargetId } from '@/features/conversation/sessionStore';

export const MAX_SPATIAL_PANELS = 12;
export const MAX_TEXTURE_LONG_EDGE = 2_048;
export const MAX_TEXTURE_TEXELS = 2_000_000;
export const MAX_SPATIAL_TEXTURE_TEXELS = 16_000_000;
export const MIN_TEXTURE_SHORT_EDGE = 128;

export interface SpatialTargetSelection {
  targets: CanvasTarget[];
  omitted: number;
}

function targetCreatedAt(target: CanvasTarget): string {
  return target.kind === 'diagram' ? target.artifact.createdAt : target.sketch.createdAt;
}

export function compareSpatialTargets(left: CanvasTarget, right: CanvasTarget): number {
  return targetCreatedAt(left).localeCompare(targetCreatedAt(right))
    || canvasTargetId(left).localeCompare(canvasTargetId(right));
}

export function selectSpatialTargets(targets: readonly CanvasTarget[], activeId?: string): SpatialTargetSelection {
  const chronological = [...targets].sort(compareSpatialTargets);
  if (chronological.length <= MAX_SPATIAL_PANELS) return { targets: chronological, omitted: 0 };
  const active = chronological.find((target) => canvasTargetId(target) === activeId);
  const newest = chronological
    .filter((target) => target !== active)
    .slice(-(MAX_SPATIAL_PANELS - (active ? 1 : 0)));
  const selected = active ? [...newest, active].sort(compareSpatialTargets) : chronological.slice(-MAX_SPATIAL_PANELS);
  return { targets: selected, omitted: chronological.length - selected.length };
}

export function defaultSpatialArrangement(targets: readonly CanvasTarget[]): Record<string, SpatialPose> {
  const middle = (targets.length - 1) / 2;
  return Object.fromEntries(targets.map((target, index) => {
    const offset = index - middle;
    return [canvasTargetId(target), {
      position: [offset * 3.2, 0, Math.abs(offset) * 0.28] as [number, number, number],
      rotationY: -offset * 0.035,
    }];
  }));
}

export function resolvedSpatialArrangement(
  targets: readonly CanvasTarget[],
  placements: Readonly<Record<string, SpatialPose>>,
): Record<string, SpatialPose> {
  const defaults = defaultSpatialArrangement(targets);
  return Object.fromEntries(targets.map((target) => {
    const id = canvasTargetId(target);
    return [id, placements[id] || defaults[id]];
  }));
}

export function defaultSpatialCamera(
  targets: readonly CanvasTarget[],
  activeId?: string,
  placements: Readonly<Record<string, SpatialPose>> = {},
): SpatialCameraState {
  const arrangement = resolvedSpatialArrangement(targets, placements);
  const active = activeId && arrangement[activeId]
    ? arrangement[activeId]
    : targets[0] ? arrangement[canvasTargetId(targets[0])] : { position: [0, 0, 0] as [number, number, number] };
  const [x, y, z] = active.position;
  return { position: [x, y + 0.35, z + 9], target: [x, y, z] };
}

export function spatialTargetLabel(target: CanvasTarget): string {
  return target.kind === 'diagram' ? `Diagram ${target.artifact.ordinal}` : `Sketch ${target.sketch.ordinal}`;
}

export function spatialPanelSize(viewBox: readonly [number, number, number, number]): [number, number] {
  const aspect = Math.max(0.45, Math.min(2.4, viewBox[2] / Math.max(1, viewBox[3])));
  return aspect >= 1 ? [4.4, 4.4 / aspect] : [3.25 * aspect, 3.25];
}

export interface TextureCandidate {
  id: string;
  viewBox: readonly [number, number, number, number];
}

export interface TextureAllocation {
  id: string;
  width: number;
  height: number;
  pixels: number;
  omitted: boolean;
}

function cappedTextureSize(viewBox: readonly [number, number, number, number]): [number, number] {
  const width = Math.max(1, viewBox[2]);
  const height = Math.max(1, viewBox[3]);
  const scale = Math.min(
    1,
    MAX_TEXTURE_LONG_EDGE / Math.max(width, height),
    Math.sqrt(MAX_TEXTURE_TEXELS / (width * height)),
  );
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

export function allocateTexturePixels(candidates: readonly TextureCandidate[], activeId?: string): TextureAllocation[] {
  const capped = candidates.map((candidate) => {
    const [width, height] = cappedTextureSize(candidate.viewBox);
    return { id: candidate.id, width, height, pixels: width * height };
  });
  const activePixels = capped.find((candidate) => candidate.id === activeId)?.pixels || 0;
  const peerPixels = capped.filter((candidate) => candidate.id !== activeId).reduce((sum, candidate) => sum + candidate.pixels, 0);
  const peerScale = peerPixels > 0
    ? Math.min(1, Math.sqrt(Math.max(0, MAX_SPATIAL_TEXTURE_TEXELS - activePixels) / peerPixels))
    : 1;
  return capped.map((candidate) => {
    const scale = candidate.id === activeId ? 1 : peerScale;
    const width = Math.max(1, Math.floor(candidate.width * scale));
    const height = Math.max(1, Math.floor(candidate.height * scale));
    const omitted = Math.min(width, height) < MIN_TEXTURE_SHORT_EDGE;
    return { id: candidate.id, width, height, pixels: omitted ? 0 : width * height, omitted };
  });
}

export function stableSpatialDigest(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
