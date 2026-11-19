'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ArenaMachineSnapshot, ArenaSnapshot, RunDiscovery } from '@/shared/types';
import { useDeviceAccess } from '@/features/devices/DeviceAccess';
import { subscribeArena } from './arenaSubscription';
import {
  acknowledgeAttention, buildMultiMachineInbox, DEVICE_ARENA_STORAGE_KEY, EMPTY_DEVICE_ARENA_STATE,
  groupArenaSessions, moveArenaProject, parseArenaProjectOrder, parseDeviceArenaState, rememberArenaActiveOrder,
  type ArenaActiveOrder, type DeviceArenaState,
} from './arenaModel';

const projectOrderKey = (machineId: string) => `code-ai:device:v1:arena-project-order:${machineId}`;

function loadProjectOrder(machineId: string): ArenaActiveOrder {
  try { return parseArenaProjectOrder(localStorage.getItem(projectOrderKey(machineId))); } catch { return new Map(); }
}

export function useArena() {
  const [connected, setConnected] = useState(false);
  const [machines, setMachines] = useState<ArenaMachineSnapshot[]>([]);
  const [refreshError, setRefreshError] = useState<string>();
  const [deviceState, setDeviceState] = useState<DeviceArenaState>(EMPTY_DEVICE_ARENA_STATE);
  const [deviceReady, setDeviceReady] = useState(false);
  const attentionMachines = useMemo(() => machines.map(machine => ({
    ...machine, sessions: [...machine.sessions, ...machine.archivedSessions],
  })), [machines]);
  const subscription = useRef<ReturnType<typeof subscribeArena> | undefined>(undefined);
  const activeOrder = useRef(new Map<string, ArenaActiveOrder>());
  const [, showProjectOrder] = useReducer((revision: number) => revision + 1, 0);
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

  // Preserve previously saved read aliases while an older executor still supplies the run id.
  useEffect(() => {
    if (!deviceReady) return;
    setDeviceState(current => {
      const acknowledged = new Set(current.acknowledgedIds);
      const aliases = buildMultiMachineInbox(attentionMachines, current).filter(item => item.read && !acknowledged.has(item.id));
      return aliases.length ? acknowledgeAttention(current, aliases.map(item => item.id)) : current;
    });
  }, [deviceReady, attentionMachines]);

  const refresh = useCallback(() => subscription.current?.refresh() ?? Promise.resolve(), []);

  useEffect(() => {
    const owner = subscribeArena({
      snapshot: (snapshot: ArenaSnapshot) => {
        for (const machine of snapshot.machines) {
          const order = activeOrder.current.get(machine.machine.id) ?? loadProjectOrder(machine.machine.id);
          rememberArenaActiveOrder(order, groupArenaSessions(
            machine.projects, machine.sessions, machine.runs, machine.machine.state === 'online', true, true,
          ));
          activeOrder.current.set(machine.machine.id, order);
        }
        setMachines(snapshot.machines);
      },
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

  const moveProject = (machineId: string, projectId: string, targetId: string) => {
    const order = activeOrder.current.get(machineId);
    const ids = order && moveArenaProject(order, projectId, targetId);
    if (!ids) return;
    try { localStorage.setItem(projectOrderKey(machineId), JSON.stringify(ids)); } catch { /* the current view still keeps the order */ }
    showProjectOrder();
  };

  const acknowledge = useCallback((itemIds: string[]) => {
    setDeviceState((current) => {
      const inbox = buildMultiMachineInbox(attentionMachines, current);
      return acknowledgeAttention(current, [...inbox.filter(item => item.read).map(item => item.id), ...itemIds], new Set(inbox.map(item => item.id)));
    });
  }, [attentionMachines]);

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
    activeOrder: activeOrder.current,
    moveProject,
    sessions,
    archivedSessions,
    discovery,
    refreshError,
    deviceState,
    refresh,
    acknowledge,
  };
}
