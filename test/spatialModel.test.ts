import { describe, expect, it, vi } from 'vitest';
import type { CanvasTarget, DiagramArtifact, SketchCanvas } from '@/shared/types';
import {
  MAX_SPATIAL_PANELS, MAX_SPATIAL_TEXTURE_TEXELS, MAX_TEXTURE_LONG_EDGE,
  MAX_TEXTURE_TEXELS, allocateTexturePixels, defaultSpatialArrangement, defaultSpatialCamera,
  selectSpatialTargets,
} from '@/features/diagram/spatial/spatialModel';
import { SpatialResourceLedger, getSpatialInstrumentation } from '@/features/diagram/spatial/resourceLedger';

function diagram(index: number, createdAt = `2026-09-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`): CanvasTarget {
  const artifact: DiagramArtifact = {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    sessionId: 'session', messageId: 'message', ordinal: index + 1, createdAt,
    source: `flowchart LR\n  A${index}-->B${index}`, status: 'ready', derivedFromDiagramIds: [], evidence: [],
  };
  return { kind: 'diagram', artifact };
}

function sketch(index: number, createdAt: string): CanvasTarget {
  const value: SketchCanvas = {
    id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    sessionId: 'session', ordinal: index + 1, createdAt, viewBox: [0, 0, 1_600, 1_000],
  };
  return { kind: 'sketch', sketch: value };
}

describe('spatial room model', () => {
  it('always retains the active target and orders the bounded newest working set chronologically', () => {
    const targets = Array.from({ length: 15 }, (_, index) => diagram(index));
    const activeId = (targets[0] as Extract<CanvasTarget, { kind: 'diagram' }>).artifact.id;
    const selected = selectSpatialTargets([...targets].reverse(), activeId);
    expect(selected.targets).toHaveLength(MAX_SPATIAL_PANELS);
    expect(selected.omitted).toBe(3);
    expect(selected.targets[0]).toBe(targets[0]);
    expect(selected.targets.slice(1)).toEqual(targets.slice(4));
  });

  it('uses target id as the stable tie-breaker for diagrams and sketches', () => {
    const createdAt = '2026-09-04T12:00:00.000Z';
    const targets = [sketch(2, createdAt), diagram(2, createdAt), diagram(1, createdAt)];
    expect(selectSpatialTargets(targets).targets.map((target) => (
      target.kind === 'diagram' ? target.artifact.id : target.sketch.id
    ))).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000002',
    ]);
  });

  it('builds a deterministic shallow arc and targets the active panel with the default camera', () => {
    const targets = [diagram(0), diagram(1), diagram(2)];
    const first = defaultSpatialArrangement(targets);
    expect(defaultSpatialArrangement(targets)).toEqual(first);
    expect(Object.values(first).map((pose) => pose.position[0])).toEqual([-3.2, 0, 3.2]);
    expect(Object.values(first)[1].position[2]).toBeLessThan(Object.values(first)[0].position[2]);
    const activeId = (targets[2] as Extract<CanvasTarget, { kind: 'diagram' }>).artifact.id;
    expect(defaultSpatialCamera(targets, activeId).target).toEqual(first[activeId].position);
  });

  it('caps individual and aggregate texture pixels while preserving the active allocation', () => {
    const candidates = Array.from({ length: 12 }, (_, index) => ({
      id: `panel-${index}`,
      viewBox: [0, 0, 8_000, 4_000] as const,
    }));
    const allocations = allocateTexturePixels(candidates, 'panel-0');
    const active = allocations[0];
    expect(Math.max(active.width, active.height)).toBeLessThanOrEqual(MAX_TEXTURE_LONG_EDGE);
    expect(active.pixels).toBeLessThanOrEqual(MAX_TEXTURE_TEXELS);
    expect(allocations.reduce((sum, allocation) => sum + allocation.pixels, 0)).toBeLessThanOrEqual(MAX_SPATIAL_TEXTURE_TEXELS);
    expect(active.width).toBeGreaterThan(allocations[1].width);
    const immersive = allocateTexturePixels(candidates.slice(0, 1), 'panel-0', 1_600_000)[0];
    expect(immersive.pixels).toBeLessThanOrEqual(1_600_000);
    expect(immersive.pixels).toBeLessThan(active.pixels);
  });
});

describe('spatial resource ledger', () => {
  it('tracks and releases every disposable exactly once', () => {
    const baseline = { ...getSpatialInstrumentation() };
    const ledger = new SpatialResourceLedger();
    const texture = { dispose: vi.fn() };
    const material = { dispose: vi.fn() };
    const geometry = { dispose: vi.fn() };
    ledger.trackTexture(texture, 2_000);
    ledger.trackTexture(texture, 2_000);
    ledger.trackMaterial(material);
    ledger.trackGeometry(geometry);
    ledger.trackObjectUrl('blob:spatial-test');
    expect(getSpatialInstrumentation()).toMatchObject({
      textures: baseline.textures + 1,
      materials: baseline.materials + 1,
      geometries: baseline.geometries + 1,
      objectUrls: baseline.objectUrls + 1,
      logicalTexturePixels: baseline.logicalTexturePixels + 2_000,
    });
    ledger.dispose();
    ledger.dispose();
    expect(texture.dispose).toHaveBeenCalledTimes(1);
    expect(material.dispose).toHaveBeenCalledTimes(1);
    expect(geometry.dispose).toHaveBeenCalledTimes(1);
    expect(getSpatialInstrumentation()).toMatchObject(baseline);
  });
});
