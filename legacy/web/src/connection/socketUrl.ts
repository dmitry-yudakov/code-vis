type BrowserLocation = Pick<Location, 'hostname' | 'origin' | 'protocol'>;

const DEFAULT_SOCKET_PORT = '3789';
const LOCAL_SOCKET_URL = `http://localhost:${DEFAULT_SOCKET_PORT}`;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const isLocalHostname = (hostname: string): boolean =>
  LOCAL_HOSTNAMES.has(hostname.toLowerCase());

const getUrlHostname = (url: string): string | null => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

export const getDefaultSocketUrl = (
  locationOverride?: BrowserLocation
): string => {
  const browserLocation =
    locationOverride ??
    (typeof window !== 'undefined' ? window.location : undefined);
  const configuredUrl = import.meta.env.VITE_SOCKET_URL?.trim();

  if (configuredUrl) {
    const configuredHostname = getUrlHostname(configuredUrl);

    if (
      !browserLocation ||
      !configuredHostname ||
      !isLocalHostname(configuredHostname) ||
      isLocalHostname(browserLocation.hostname)
    ) {
      return configuredUrl;
    }
  }

  if (!browserLocation) {
    return LOCAL_SOCKET_URL;
  }

  if (import.meta.env.DEV) {
    return browserLocation.origin;
  }

  const protocol = browserLocation.protocol === 'https:' ? 'https:' : 'http:';

  return `${protocol}//${browserLocation.hostname}:${DEFAULT_SOCKET_PORT}`;
};
