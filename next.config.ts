import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Neutral name first; the former web2 name stays accepted for one migration.
  distDir: process.env.CODEAI_DIST_DIR || process.env.CODEAI_WEB2_DIST_DIR || '.next',
};

export default nextConfig;
