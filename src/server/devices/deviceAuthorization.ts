import { timingSafeEqual } from 'node:crypto';
import { getConfig, type AppConfig } from '@/server/config';
import { getDeviceAuthStore } from './deviceAuthStore';
import { getMachineAuthStore, type AuthenticatedMachine } from '@/server/machines/machineAuthStore';
import { machineRequestAllowed } from '@/server/machines/machineRoutePolicy';
import { safeJsonResponse } from '@/shared/protocol';
import type { DeviceAuthStatus, PairedDeviceSummary } from '@/shared/types';

export const DEVICE_COOKIE_NAME = '__Host-codeai-device';
const TRANSPORT_HEADER = 'x-codeai-internal-transport';

function internalTransportMarker(): string | undefined {
  return (globalThis as typeof globalThis & { __codeaiInternalTlsMarker?: string })
    .__codeaiInternalTlsMarker;
}

function cookieValue(request: Request, name: string): string | undefined {
  const cookie = request.headers.get('cookie');
  if (!cookie) return undefined;
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return undefined;
}

function sameSecret(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function expectedHost(config: AppConfig): string | undefined {
  return config.publicOrigin ? new URL(config.publicOrigin).host : undefined;
}

export function requestHasSecureTransport(request: Request, config: AppConfig): boolean {
  if (config.remoteAccess !== 'paired') return true;
  return new URL(request.url).host === expectedHost(config)
    && sameSecret(request.headers.get(TRANSPORT_HEADER) || undefined, internalTransportMarker());
}

export function requestHasExpectedMutationOrigin(request: Request, config: AppConfig): boolean {
  if (config.remoteAccess !== 'paired' || /^(GET|HEAD)$/i.test(request.method)) return true;
  return request.headers.get('origin') === config.publicOrigin;
}

/**
 * Docker mutations change what runs on this machine, so they demand the exact browser origin in
 * every access mode: the configured public origin, or else the one the browser addressed.
 */
export function requestHasExactOrigin(request: Request, config: AppConfig): boolean {
  const url = new URL(request.url);
  // Next.js may normalize request.url to its internal hostname. Host retains the browser origin.
  const origin = config.publicOrigin || `${url.protocol}//${request.headers.get('host') || url.host}`;
  return request.headers.get('origin') === origin;
}

export async function deviceAuthStatus(request: Request): Promise<DeviceAuthStatus> {
  const config = getConfig();
  if (config.remoteAccess !== 'paired') {
    return { mode: 'local', authenticated: true, transportSecure: true, hostLabel: config.hostLabel };
  }
  const transportSecure = requestHasSecureTransport(request, config);
  if (!transportSecure || !requestHasExpectedMutationOrigin(request, config)) {
    return { mode: 'paired', authenticated: false, transportSecure, hostLabel: config.hostLabel };
  }
  const device = await getDeviceAuthStore(config.dataDir)
    .authenticate(cookieValue(request, DEVICE_COOKIE_NAME));
  return {
    mode: 'paired',
    authenticated: Boolean(device),
    transportSecure,
    hostLabel: config.hostLabel,
    ...(device ? { device: { id: device.id, label: device.label } } : {}),
  };
}

export async function authenticatedDevice(request: Request): Promise<PairedDeviceSummary | undefined> {
  const config = getConfig();
  if (config.remoteAccess !== 'paired') return undefined;
  if (!requestHasSecureTransport(request, config) || !requestHasExpectedMutationOrigin(request, config)) {
    return undefined;
  }
  return getDeviceAuthStore(config.dataDir).authenticate(cookieValue(request, DEVICE_COOKIE_NAME));
}

function bearerCredential(request: Request): string | undefined {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return undefined;
  const credential = authorization.slice('Bearer '.length);
  return credential && !credential.includes(' ') ? credential : undefined;
}

/** Machine credentials are valid only on the explicit TLS listener and do not use browser Origin. */
export async function authenticatedMachineRequest(request: Request): Promise<AuthenticatedMachine | undefined> {
  const config = getConfig();
  if (config.remoteAccess !== 'paired' || !requestHasSecureTransport(request, config)) return undefined;
  return getMachineAuthStore(config.dataDir).authenticate(bearerCredential(request));
}

export async function authorizeMachineRequest(request: Request): Promise<Response | undefined> {
  const config = getConfig();
  if (config.remoteAccess !== 'paired' || !requestHasSecureTransport(request, config)) {
    return safeJsonResponse({ error: 'Machine access requires the configured CodeAI HTTPS server.' }, { status: 426 });
  }
  if (!await authenticatedMachineRequest(request)) {
    return safeJsonResponse({ error: 'This machine is not attached.' }, { status: 401 });
  }
  return undefined;
}

/** Authorizes only the human-facing browser, never a server-to-server machine bearer. */
export async function authorizePersonalDeviceRequest(request: Request): Promise<Response | undefined> {
  const config = getConfig();
  if (config.remoteAccess !== 'paired') return undefined;
  if (!requestHasSecureTransport(request, config)) {
    return safeJsonResponse({ error: 'Paired access requires the configured CodeAI HTTPS server.' }, { status: 426 });
  }
  if (!requestHasExpectedMutationOrigin(request, config)) {
    return safeJsonResponse({ error: 'Request origin is not authorized.' }, { status: 403 });
  }
  const device = await getDeviceAuthStore(config.dataDir)
    .authenticate(cookieValue(request, DEVICE_COOKIE_NAME));
  if (!device) return safeJsonResponse({ error: 'Pair this device to continue.' }, { status: 401 });
  return undefined;
}

/** Domain routes accept either the personal browser or a directly attached home machine. */
export async function authorizeDeviceRequest(request: Request): Promise<Response | undefined> {
  const config = getConfig();
  if (config.remoteAccess !== 'paired') return undefined;
  if (!requestHasSecureTransport(request, config)) {
    return safeJsonResponse({ error: 'Paired access requires the configured CodeAI HTTPS server.' }, { status: 426 });
  }
  // A peer executor has already authenticated through a bearer credential and is not a browser,
  // so it deliberately has no browser Origin. The domain route still resolves capability locally.
  if (machineRequestAllowed(request) && await authenticatedMachineRequest(request)) return undefined;
  return authorizePersonalDeviceRequest(request);
}

export function deviceCredentialCookie(credential: string, expiresAt: string): string {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1_000));
  return `${DEVICE_COOKIE_NAME}=${credential}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearDeviceCredentialCookie(): string {
  return `${DEVICE_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
