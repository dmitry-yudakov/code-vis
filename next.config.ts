import type { NextConfig } from 'next';

interface DevOriginEnvironment {
  [name: string]: string | undefined;
  CODEAI_ALLOWED_DEV_ORIGINS?: string;
  CODEAI_WEB2_ALLOWED_DEV_ORIGINS?: string;
  CODEAI_PUBLIC_ORIGIN?: string;
  CODEAI_WEB2_PUBLIC_ORIGIN?: string;
}

/**
 * Next's development guard matches source hostnames rather than full URL origins. Keep LAN access
 * opt-in, but reuse the already-explicit paired-device origin when one is configured.
 */
export function resolveAllowedDevOrigins(environment: DevOriginEnvironment): string[] | undefined {
  const configured = environment.CODEAI_ALLOWED_DEV_ORIGINS
    || environment.CODEAI_WEB2_ALLOWED_DEV_ORIGINS
    || '';
  const origins = configured
    .split(',')
    .map((origin) => origin.trim().toLowerCase())
    .filter(Boolean);
  const publicOrigin = environment.CODEAI_PUBLIC_ORIGIN
    || environment.CODEAI_WEB2_PUBLIC_ORIGIN;

  if (publicOrigin) {
    try {
      origins.push(new URL(publicOrigin).hostname.toLowerCase());
    } catch {
      // Paired-mode configuration owns validation. An invalid optional value must not make an
      // otherwise-local Next.js development or build command fail while loading this file.
    }
  }

  const uniqueOrigins = [...new Set(origins)];
  return uniqueOrigins.length > 0 ? uniqueOrigins : undefined;
}

const allowedDevOrigins = resolveAllowedDevOrigins(process.env);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // TypeScript 5.9 still exposes the compiler API. Using it avoids the CLI capture path, whose
  // cross-spawn child can close before its --showConfig stdout is delivered on newer Node hosts.
  experimental: { useTypeScriptCli: false },
  // Neutral name first; the former web2 name stays accepted for one migration.
  distDir: process.env.CODEAI_DIST_DIR || process.env.CODEAI_WEB2_DIST_DIR || '.next',
  ...(allowedDevOrigins ? { allowedDevOrigins } : {}),
};

export default nextConfig;
