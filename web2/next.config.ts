import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  distDir: process.env.CODEAI_WEB2_DIST_DIR || '.next',
};

export default nextConfig;
