const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WorkspaceLocation =
  | { kind: 'default' }
  | { kind: 'session'; sessionId: string; machineId?: string }
  | { kind: 'project'; projectId?: string; machineId?: string }
  | { kind: 'invalid' };

export interface WorkspaceTarget {
  sessionId?: string;
  projectId?: string;
  machineId?: string;
}

/** Only navigation identity belongs here; session content and presentation have other owners. */
export function parseWorkspaceLocation(query: Pick<URLSearchParams, 'get' | 'getAll' | 'has'>): WorkspaceLocation {
  if (['session', 'project', 'machine'].some((key) => query.getAll(key).length > 1)) return { kind: 'invalid' };
  const session = query.get('session');
  const project = query.get('project');
  const machine = query.get('machine');
  if ((query.has('machine') && (!machine || !UUID.test(machine)))
    || (query.has('session') && (!session || !UUID.test(session)))
    || (query.has('project') && project !== 'none' && (!project || !UUID.test(project)))
    || (query.has('session') && query.has('project'))) return { kind: 'invalid' };
  const owner = machine ? { machineId: machine } : {};
  if (session) return { kind: 'session', sessionId: session, ...owner };
  if (project) return { kind: 'project', ...(project !== 'none' ? { projectId: project } : {}), ...owner };
  return { kind: machine ? 'invalid' : 'default' };
}

export function workspaceHref(
  target: WorkspaceTarget,
  localMachineId?: string,
): string {
  const query = new URLSearchParams(target.sessionId ? { session: target.sessionId } : { project: target.projectId || 'none' });
  if (target.machineId && target.machineId !== localMachineId) query.set('machine', target.machineId);
  return `/?${query}`;
}
