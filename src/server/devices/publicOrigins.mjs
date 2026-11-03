/** Shared by the plain-Node HTTPS launcher and the application's TypeScript configuration. */
function exactHttpsOrigin(value, setting) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${setting} must be an exact HTTPS origin`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/'
    || url.search || url.hash || url.hostname.includes('*')) {
    throw new Error(`${setting} must be an exact HTTPS origin`);
  }
  return url;
}

export function parsePublicOrigins(primary, additional) {
  const origin = exactHttpsOrigin(primary, 'CODEAI_PUBLIC_ORIGIN');
  const origins = [origin.origin];
  for (const value of additional ? additional.split(',') : []) {
    const extra = exactHttpsOrigin(value, 'CODEAI_ADDITIONAL_ORIGINS');
    if (extra.port !== origin.port) {
      throw new Error('CODEAI_ADDITIONAL_ORIGINS must use the same port as CODEAI_PUBLIC_ORIGIN');
    }
    origins.push(extra.origin);
  }
  return [...new Set(origins)];
}
