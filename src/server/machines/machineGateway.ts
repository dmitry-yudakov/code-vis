import { getConfig } from '@/server/config';
import { getMachineRegistry } from './machineRegistry';
import { machineAuthorization } from './machineClient';
import { publicError, safeJsonResponse } from '@/shared/protocol';
import { boundedRequestBody } from './boundedBody';
import { machineOperationAllowed } from './machineRoutePolicy';

const MAX_PROXY_BODY_BYTES = 7_000_000;
const CONNECT_TIMEOUT_MS = 5_000;
const UUID = /^[0-9a-f-]{36}$/i;

async function boundedBody(request: Request): Promise<ArrayBuffer | undefined> {
  if (/^(GET|HEAD)$/i.test(request.method) || !request.body) return undefined;
  return (await boundedRequestBody(request, MAX_PROXY_BODY_BYTES)).buffer;
}

function responseHeaders(remote: Response): Headers {
  const headers = new Headers();
  for (const name of [
    'content-type', 'cache-control', 'x-content-type-options',
    'x-codeai-run-finished', 'x-codeai-replay-events',
  ]) {
    const value = remote.headers.get(name);
    if (value) headers.set(name, value.slice(0, 500));
  }
  headers.set('Cache-Control', 'no-store');
  return headers;
}

/** Proxies one explicitly allowed API operation without exposing the executor credential. */
export async function proxyMachineRequest(
  machineId: string,
  pathSegments: string[],
  request: Request,
): Promise<Response> {
  if (!UUID.test(machineId) || !machineOperationAllowed(request.method, pathSegments)) {
    return safeJsonResponse({ error: 'That machine operation is not available.' }, { status: 404 });
  }
  try {
    const connection = await getMachineRegistry(getConfig().dataDir).get(machineId);
    if (Date.parse(connection.expiresAt) <= Date.now()) {
      return safeJsonResponse({ error: 'That machine attachment has expired.' }, { status: 401 });
    }
    const body = await boundedBody(request);
    const incomingUrl = new URL(request.url);
    const target = new URL(`/api/${pathSegments.map(encodeURIComponent).join('/')}`, connection.origin);
    target.search = incomingUrl.search;
    const headers = new Headers({
      Authorization: machineAuthorization(connection.credential),
      Accept: request.headers.get('accept')?.slice(0, 500) || 'application/json',
    });
    const contentType = request.headers.get('content-type');
    if (contentType) headers.set('Content-Type', contentType.slice(0, 200));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
    const abort = () => controller.abort();
    request.signal.addEventListener('abort', abort, { once: true });
    let remote: Response;
    try {
      remote = await fetch(target, {
        method: request.method,
        headers,
        ...(body ? { body } : {}),
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener('abort', abort);
    }
    return new Response(remote.body, { status: remote.status, headers: responseHeaders(remote) });
  } catch (error) {
    const message = publicError(error);
    if (message === 'Request body is too large.') {
      return safeJsonResponse({ error: message }, { status: 413 });
    }
    const registryCode = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (registryCode === 'unknown') {
      return safeJsonResponse({ error: 'That machine is not attached.' }, { status: 404 });
    }
    if (registryCode === 'corrupt') {
      return safeJsonResponse({ error: 'The machine registry is unavailable.' }, { status: 503 });
    }
    return safeJsonResponse({ error: 'The execution machine is unreachable.' }, { status: 502 });
  }
}
