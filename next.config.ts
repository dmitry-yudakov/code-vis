import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // TypeScript 5.9 still exposes the compiler API. Using it avoids the CLI capture path, whose
  // cross-spawn child can close before its --showConfig stdout is delivered on newer Node hosts.
  experimental: { useTypeScriptCli: false },
  // Neutral name first; the former web2 name stays accepted for one migration.
  distDir: process.env.CODEAI_DIST_DIR || process.env.CODEAI_WEB2_DIST_DIR || '.next',
};

export default nextConfig;
