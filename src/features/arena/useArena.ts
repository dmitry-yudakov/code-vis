'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArenaMachineSnapshot, ArenaSnapshot, RunDiscovery } from '@/shared/types';
import { useDeviceAccess } from '@/features/devices/DeviceAccess';
import { subscribeArena } from './arenaSubscription';
import {
  acknowledgeAttention, DEVICE_ARENA_STORAGE_KEY, EMPTY_DEVICE_ARENA_STATE,
  parseDeviceArenaState, type DeviceArenaState,
} from './arenaModel';

export function useArena() {
  const [connected, setConnected] = useState(false);
  const [machines, setMachines] = useState<ArenaMachineSnapshot[]>([]);
  const [refreshError, setRefreshError] = useState<string>();
  const [deviceState, setDeviceState] = useState<DeviceArenaState>(EMPTY_DEVICE_ARENA_STATE);
  const [deviceReady, setDeviceReady] = useState(false);
  const subscription = useRef<ReturnType<typeof subscribeArena> | undefined>(undefined);
  const { refresh: refreshAccess } = useDeviceAccess();

  useEffect(() => {
    try { setDeviceState(parseDeviceArenaState(localStorage.getItem(DEVICE_ARENA_STORAGE_KEY))); } catch {
      setDeviceState(EMPTY_DEVICE_ARENA_STATE);
    } finally {
      setDeviceReady(true);
    }
  }, []);

  useEffect(() => {
    if (!deviceReady) return;
    try { localStorage.setItem(DEVICE_ARENA_STORAGE_KEY, JSON.stringify(deviceState)); } catch {
      // Inbox read state is optional device state; the live permission authority stays on-server.
    }
  }, [deviceReady, deviceState]);

  const refresh = useCallback(() => subscription.current?.refresh() ?? Promise.resolve(), []);

  useEffect(() => {
    const owner = subscribeArena({
      snapshot: (snapshot: ArenaSnapshot) => setMachines(snapshot.machines),
      connected: setConnected, error: setRefreshError, unauthorized: () => void refreshAccess(),
    });
    subscription.current = owner;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const activate = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'hidden') return;
      timer = setTimeout(() => void owner.refresh(), 150);
    };
    window.addEventListener('focus', activate);
    window.addEventListener('pageshow', activate);
    document.addEventListener('visibilitychange', activate);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', activate);
      window.removeEventListener('pageshow', activate);
      document.removeEventListener('visibilitychange', activate);
      owner.stop();
      if (subscription.current === owner) subscription.current = undefined;
    };
  }, [refreshAccess]);

  const acknowledge = useCallback((itemIds: string[]) => {
    setDeviceState((current) => acknowledgeAttention(current, itemIds));
  }, []);

  const sessions = machines.flatMap((entry) => entry.sessions.map((session) => ({
    ...session, machineId: entry.machine.id,
  })));
  const archivedSessions = machines.flatMap((entry) => entry.archivedSessions.map((session) => ({
    ...session, machineId: entry.machine.id,
  })));
  const discovery: RunDiscovery = {
    active: machines.flatMap((entry) => entry.runs.active.map((run) => ({ ...run, machineId: entry.machine.id }))),
    recent: machines.flatMap((entry) => entry.runs.recent.map((run) => ({ ...run, machineId: entry.machine.id }))),
  };

  return {
    machines: machines.map((entry) => ({ ...entry, snapshotFresh: connected && !refreshError })),
    sessions,
    archivedSessions,
    discovery,
    refreshError,
    deviceState,
    refresh,
    acknowledge,
  };
}
