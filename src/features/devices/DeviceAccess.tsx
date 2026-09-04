'use client';

import {
  createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode,
} from 'react';
import type { DeviceAuthStatus } from '@/shared/types';

interface DeviceAccessValue {
  status: DeviceAuthStatus;
  refresh: () => Promise<void>;
}

const DeviceAccessContext = createContext<DeviceAccessValue | undefined>(undefined);

export function useDeviceAccess(): DeviceAccessValue {
  const value = useContext(DeviceAccessContext);
  if (!value) throw new Error('Device access is available only inside DeviceAccessGate.');
  return value;
}

export function DeviceAccessGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<DeviceAuthStatus>();
  const [statusError, setStatusError] = useState<string>();
  const [label, setLabel] = useState('My device');
  const [code, setCode] = useState('');
  const [pairing, setPairing] = useState(false);
  const [pairingError, setPairingError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/status', { cache: 'no-store' });
      const data = await response.json().catch(() => ({})) as DeviceAuthStatus & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not check device access.');
      setStatus(data);
      setStatusError(undefined);
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : 'Could not check device access.');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (status?.mode !== 'paired' || !status.authenticated) return;
    const timer = window.setInterval(() => { void refresh(); }, 15_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, status?.authenticated, status?.mode]);

  const pair = async (event: FormEvent) => {
    event.preventDefault();
    setPairing(true);
    setPairingError(undefined);
    try {
      const response = await fetch('/api/auth/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, code }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not pair this device.');
      setCode('');
      await refresh();
    } catch (error) {
      setPairingError(error instanceof Error ? error.message : 'Could not pair this device.');
    } finally {
      setPairing(false);
    }
  };

  if (!status) {
    return (
      <main className="device-access-screen">
        <div className="device-access-card" role="status">
          <div className="brand-mark">C</div>
          <span className="eyebrow">Personal workspace</span>
          <h1>{statusError ? 'CodeAI is unavailable' : 'Opening CodeAI…'}</h1>
          {statusError && <p className="device-access-error">{statusError}</p>}
          {statusError && <button type="button" onClick={() => void refresh()}>Try again</button>}
        </div>
      </main>
    );
  }

  if (status.mode === 'paired' && !status.authenticated) {
    return (
      <main className="device-access-screen">
        <section className="device-access-card" aria-labelledby="pair-device-title">
          <div className="brand-mark">C</div>
          <span className="eyebrow">{status.hostLabel} · Personal device</span>
          <h1 id="pair-device-title">Pair this device</h1>
          {!status.transportSecure ? (
            <div className="device-access-warning" role="alert">
              <strong>Secure transport is not active.</strong>
              <p>Open the exact HTTPS address configured on the home machine and start it with <code>npm run start:remote</code>.</p>
            </div>
          ) : (
            <>
              <p>On {status.hostLabel}, run <code>npm run device:pair</code>. Enter the one-time code it prints; it expires after ten minutes.</p>
              <form onSubmit={(event) => void pair(event)}>
                <label>
                  Device name
                  <input
                    value={label}
                    maxLength={64}
                    autoComplete="nickname"
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder="Living-room tablet"
                    required
                  />
                </label>
                <label>
                  Pairing code
                  <input
                    value={code}
                    maxLength={32}
                    autoComplete="one-time-code"
                    autoCapitalize="characters"
                    spellCheck={false}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder="ABCD-EFGH-JKLM-NPQR"
                    required
                    autoFocus
                  />
                </label>
                {pairingError && <p className="device-access-error" role="alert">{pairingError}</p>}
                <button type="submit" disabled={pairing || !label.trim() || !code.trim()}>
                  {pairing ? 'Pairing…' : 'Pair device'}
                </button>
              </form>
            </>
          )}
        </section>
      </main>
    );
  }

  return (
    <DeviceAccessContext.Provider value={{ status, refresh }}>
      {children}
    </DeviceAccessContext.Provider>
  );
}
