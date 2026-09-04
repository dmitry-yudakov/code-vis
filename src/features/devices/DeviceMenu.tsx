'use client';

import { useEffect, useState } from 'react';
import type { PairedDeviceSummary } from '@/shared/types';
import { useDeviceAccess } from './DeviceAccess';

function pairedDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

export function DeviceMenu() {
  const { status, refresh: refreshAccess } = useDeviceAccess();
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<PairedDeviceSummary[]>([]);
  const [error, setError] = useState<string>();
  const [revoking, setRevoking] = useState<string>();

  useEffect(() => {
    if (!open || status.mode !== 'paired') return;
    let active = true;
    void fetch('/api/auth/devices', { cache: 'no-store' }).then(async (response) => {
      const data = await response.json().catch(() => ({})) as { devices?: PairedDeviceSummary[]; error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not load paired devices.');
      if (active) {
        setDevices(data.devices || []);
        setError(undefined);
      }
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not load paired devices.');
    });
    return () => { active = false; };
  }, [open, status.mode]);

  if (status.mode !== 'paired' || !status.device) return null;

  const revoke = async (device: PairedDeviceSummary) => {
    if (!device.current && !window.confirm(`Revoke ${device.label}? It will need a new pairing code to reconnect.`)) return;
    setRevoking(device.id);
    setError(undefined);
    try {
      const response = await fetch('/api/auth/devices', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: device.id }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; signedOut?: boolean };
      if (!response.ok) throw new Error(data.error || 'Could not revoke that device.');
      if (data.signedOut) await refreshAccess();
      else setDevices((current) => current.filter((item) => item.id !== device.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not revoke that device.');
    } finally {
      setRevoking(undefined);
    }
  };

  return (
    <details className="device-menu" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary title={`Paired as ${status.device.label}`}>Devices</summary>
      <div>
        <header>
          <strong>Personal devices</strong>
          <small>{status.hostLabel}</small>
        </header>
        {error && <p className="device-menu-error" role="alert">{error}</p>}
        <div className="device-menu-list">
          {devices.map((device) => (
            <div className="device-menu-item" key={device.id}>
              <span>
                <strong>{device.label}{device.current ? ' · This device' : ''}</strong>
                <small>Paired {pairedDate(device.pairedAt)}</small>
              </span>
              <button type="button" disabled={Boolean(revoking)} onClick={() => void revoke(device)}>
                {revoking === device.id ? 'Working…' : device.current ? 'Sign out' : 'Revoke'}
              </button>
            </div>
          ))}
        </div>
        <p>To add another device, run <code>npm run device:pair</code> on this machine.</p>
      </div>
    </details>
  );
}
