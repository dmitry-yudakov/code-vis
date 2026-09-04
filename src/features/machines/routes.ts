/** Keeps browser traffic same-origin while selecting the executor that owns an API operation. */
export function machineApiPath(path: string, machineId?: string, localMachineId?: string): string {
  if (!path.startsWith('/api/')) throw new Error('Machine API paths must begin with /api/.');
  if (!machineId || !localMachineId || machineId === localMachineId) return path;
  return `/api/machines/${encodeURIComponent(machineId)}/${path.slice('/api/'.length)}`;
}

export function machineApiBase(machineId?: string, localMachineId?: string): string {
  return machineApiPath('/api/', machineId, localMachineId).replace(/\/$/, '');
}
