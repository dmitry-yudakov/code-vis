'use client';

import { useEffect, useState } from 'react';
import type { SecurityLevel } from '@/shared/types';

export function SecurityLevelDetails({ level }: { level: SecurityLevel }) {
  return <>
    <p>{level === 'native' ? 'Native — Local Claude and Codex write with your own setup' : 'Guarded — CodeAI sets the rules for Local turns'}</p>
    <p>Set <code>CODEAI_SECURITY_LEVEL</code> on this computer and restart CodeAI to change it.</p>
  </>;
}

/** Optional device state, scoped to the home machine and its current policy. */
export function SecurityLevelNotice({ machineId, level }: { machineId: string; level: SecurityLevel }) {
  const storageKey = `code-ai:device:v1:security-notice:${machineId}`;
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try { setDismissed(localStorage.getItem(storageKey) === level); } catch { /* optional device storage */ }
  }, [level, storageKey]);
  if (dismissed) return null;
  return <section className="arena-docker-settings" aria-label="Security level">
    <div className="arena-docker-setting">
      <strong>Security level</strong>
      <button type="button" aria-label="Dismiss security notice" onClick={() => {
        setDismissed(true);
        try { localStorage.setItem(storageKey, level); } catch { /* dismissal still holds in memory */ }
      }}>Dismiss</button>
    </div>
    <SecurityLevelDetails level={level} />
  </section>;
}
