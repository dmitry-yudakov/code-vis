'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArenaMachineSnapshot, ArenaSnapshot, RunDiscovery } from '@/shared/types';
import {
  acknowledgeAttention, DEVICE_ARENA_STORAGE_KEY, EMPTY_DEVICE_ARENA_STATE,
  parseDeviceArenaState, type DeviceArenaState,
} from './arenaModel';

const EMPTY_DISCOVERY: RunDiscovery = { active: [], recent: [] };
const POLL_INTERVAL_MS = 2_000;

export function useArena() {
  const [machines, setMachines] = useState<ArenaMachineSnapshot[]>([]);
  const [refreshError, setRefreshError] = useState<string>();
  const [deviceState, setDeviceState] = useState<DeviceArenaState>(EMPTY_DEVICE_ARENA_STATE);
  const [deviceReady, setDeviceReady] = useState(false);
  const mounted = useRef(true);
  const refreshing = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

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

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const response = await fetch('/api/arena', { cache: 'no-store' });
      const data = await response.json().catch(() => ({})) as ArenaSnapshot & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not refresh the Arena.');
      if (!mounted.current) return;
      setMachines(data.machines || []);
      setRefreshError(undefined);
    } catch (error) {
      if (mounted.current) setRefreshError(error instanceof Error ? error.message : 'Could not refresh the Arena.');
    } finally {
      refreshing.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

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
    machines,
    sessions,
    archivedSessions,
    discovery,
    refreshError,
    deviceState,
    refresh,
    acknowledge,
  };
}
