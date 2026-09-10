import { useEffect, useState } from 'react';
import { SpatialResourceLedger } from '@/features/diagram/spatial/resourceLedger';

export function useTextureResource<T>(create: (ledger: SpatialResourceLedger) => T, dependencies: readonly unknown[]): T | undefined {
  const [resource, setResource] = useState<T>();
  useEffect(() => {
    const ledger = new SpatialResourceLedger('immersive');
    try { setResource(create(ledger)); }
    catch { ledger.dispose(); setResource(undefined); }
    return () => { setResource(undefined); ledger.dispose(); };
    // Resource owners pass the exact raster-generation dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
  return resource;
}
