const UUID = /^[0-9a-f-]{36}$/i;

/** The complete domain-operation scope granted to an attached home machine. */
export function machineOperationAllowed(method: string, segments: readonly string[]): boolean {
  const normalizedMethod = method.toUpperCase();
  const exact = segments.join('/');
  if (normalizedMethod === 'GET' && [
    'health', 'checkouts', 'projects', 'sessions', 'repository/status', 'repository/diff',
    'agent/runs', 'agent/stream',
  ].includes(exact)) return true;
  if (normalizedMethod === 'POST' && [
    'projects', 'sessions', 'agent/message', 'agent/cancel', 'agent/permission',
  ].includes(exact)) return true;
  if (segments.length === 2 && segments[0] === 'projects' && UUID.test(segments[1])) {
    return ['GET', 'PATCH', 'DELETE'].includes(normalizedMethod);
  }
  if (segments.length === 2 && segments[0] === 'sessions' && UUID.test(segments[1])) {
    return normalizedMethod === 'GET';
  }
  if (segments.length !== 3 || segments[0] !== 'sessions' || !UUID.test(segments[1])) return false;
  const operation = segments[2];
  if (operation === 'participants') return ['GET', 'POST', 'PATCH'].includes(normalizedMethod);
  if (['annotations', 'pins', 'repositories'].includes(operation)) return normalizedMethod === 'PUT';
  if (operation === 'sketches') return normalizedMethod === 'POST';
  return ['archive', 'restore'].includes(operation) && normalizedMethod === 'POST';
}

export function machineRequestAllowed(request: Request): boolean {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith('/api/')) return false;
  return machineOperationAllowed(request.method, pathname.slice('/api/'.length).split('/'));
}
