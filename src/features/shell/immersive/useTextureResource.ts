import { useEffect, useState } from 'react';
import { RetiredLedgers, SpatialResourceLedger } from '@/features/diagram/spatial/resourceLedger';

/**
 * Disposes retired ledgers after the commit that binds another product, and all of them on unmount.
 * Call it after the effect that retires ledgers, so the unmount flush also sees the last one.
 */
export function useRetiredLedgerFlush(retired: RetiredLedgers, bound: unknown): void {
  useEffect(() => retired.flush(bound), [retired, bound]);
  useEffect(() => () => retired.flush(), [retired]);
}

export function useTextureResource<T>(create: (ledger: SpatialResourceLedger) => T, dependencies: readonly unknown[]): T | undefined {
  const [resource, setResource] = useState<T>();
  const [retired] = useState(() => new RetiredLedgers());
  useEffect(() => {
    const ledger = new SpatialResourceLedger('immersive');
    let created: T | undefined;
    try { created = create(ledger); }
    catch { ledger.dispose(); }
    setResource(created);
    // The meshes of this commit still render the replaced resource; see RetiredLedgers.
    return () => retired.add(ledger, created);
    // Resource owners pass the exact raster-generation dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
  useRetiredLedgerFlush(retired, resource);
  return resource;
}
