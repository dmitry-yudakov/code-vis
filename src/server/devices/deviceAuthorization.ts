import { timingSafeEqual } from 'node:crypto';
import { getConfig, type AppConfig } from '@/server/config';
import { getDeviceAuthStore } from './deviceAuthStore';
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

export async function authorizeDeviceRequest(request: Request): Promise<Response | undefined> {
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

export function deviceCredentialCookie(credential: string, expiresAt: string): string {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1_000));
  return `${DEVICE_COOKIE_NAME}=${credential}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearDeviceCredentialCookie(): string {
  return `${DEVICE_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
