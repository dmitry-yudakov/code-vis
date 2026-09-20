import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { followSourceTexture } from '@/features/diagram/spatial/immersiveResources';
import {
  getImmersiveInstrumentation, RetiredLedgers, SpatialResourceLedger,
} from '@/features/diagram/spatial/resourceLedger';

function generation() {
  const ledger = new SpatialResourceLedger('immersive');
  const texture = ledger.trackTexture({ dispose: vi.fn() }, 3_000, true);
  const material = ledger.trackMaterial({ dispose: vi.fn() });
  const geometry = ledger.trackGeometry({ dispose: vi.fn() });
  const disposals = () => [texture, material, geometry].map((resource) => resource.dispose.mock.calls.length);
  return { ledger, product: { material, geometry }, disposals };
}

describe('replaced immersive resources', () => {
  it('retires a ledger without touching the GPU objects a mesh still renders', () => {
    const baseline = { ...getImmersiveInstrumentation() };
    const { ledger, disposals } = generation();
    const image = { onload: vi.fn(), onerror: vi.fn(), src: 'blob:retired' };
    ledger.trackObjectUrl('blob:retired', image);
    expect(getImmersiveInstrumentation().liveResources).toBe(baseline.liveResources + 4);

    const dispose = ledger.retire();
    // The budget is free for the replacement at once; only the GPU disposal waits for the rebind.
    expect(getImmersiveInstrumentation()).toMatchObject({
      liveResources: baseline.liveResources, logicalTexturePixels: baseline.logicalTexturePixels,
    });
    expect(image.src).toBe('');
    expect(ledger.isDisposed()).toBe(true);
    expect(disposals()).toEqual([0, 0, 0]);

    const late = ledger.trackMaterial({ dispose: vi.fn() });
    expect(late.dispose).toHaveBeenCalledTimes(1);

    dispose(); dispose(); ledger.dispose(); ledger.retire()();
    expect(disposals()).toEqual([1, 1, 1]);
    expect(getImmersiveInstrumentation()).toMatchObject({
      liveResources: baseline.liveResources, logicalTexturePixels: baseline.logicalTexturePixels,
    });
  });

  it('disposes a replaced generation once, and only after another product is bound', () => {
    const retired = new RetiredLedgers();
    const first = generation();
    const second = generation();
    const third = generation();

    // Dependencies changed: the first product stays on its mesh until React commits the second.
    retired.add(first.ledger, first.product);
    retired.flush(first.product);
    expect(first.disposals()).toEqual([0, 0, 0]);

    // The second product commits and is replaced in that same commit, so it is still bound.
    retired.add(second.ledger, second.product);
    retired.flush(second.product);
    expect(first.disposals()).toEqual([1, 1, 1]);
    expect(second.disposals()).toEqual([0, 0, 0]);

    retired.flush(third.product);
    retired.flush(third.product);
    expect(first.disposals()).toEqual([1, 1, 1]);
    expect(second.disposals()).toEqual([1, 1, 1]);
    expect(third.disposals()).toEqual([0, 0, 0]);
  });

  it('disposes a generation that was never bound at once, and everything on unmount', () => {
    const retired = new RetiredLedgers();
    const superseded = generation();
    retired.add(superseded.ledger, undefined);
    expect(superseded.disposals()).toEqual([1, 1, 1]);

    const bound = generation();
    retired.add(bound.ledger, bound.product);
    expect(bound.disposals()).toEqual([0, 0, 0]);
    retired.flush();
    retired.flush();
    expect(bound.disposals()).toEqual([1, 1, 1]);
  });

  it('moves a tinted clone onto the replacement texture before the replaced one is disposed', () => {
    const retired = new RetiredLedgers();
    const panel = (ledger: SpatialResourceLedger) => ({
      material: ledger.trackMaterial(new THREE.MeshBasicMaterial({ map: ledger.trackTexture(new THREE.Texture(), 64) })),
    });
    const firstLedger = new SpatialResourceLedger('immersive');
    const first = panel(firstLedger);
    const clone = first.material.clone();
    const replacedTexture = first.material.map!;
    const disposed = vi.fn(() => expect(clone.map).not.toBe(replacedTexture));
    replacedTexture.addEventListener('dispose', disposed);

    const secondLedger = new SpatialResourceLedger('immersive');
    const second = panel(secondLedger);
    retired.add(firstLedger, first);
    // One commit: the layout effect rebinds the clone, then the passive effect flushes the source.
    followSourceTexture(clone, second);
    retired.flush(second);
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(clone.map).toBe(second.material.map);

    followSourceTexture(undefined, second);
    followSourceTexture(clone, undefined);
    expect(clone.map).toBe(second.material.map);
    clone.dispose();
    secondLedger.dispose();
  });
});
