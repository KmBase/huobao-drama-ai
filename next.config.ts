import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  serverExternalPackages: ['@vercel/blob'],
  // Standalone output: self-contained server bundle spawned by the Electron
  // desktop shell (electron/main.js). Vercel deployments ignore this option.
  output: 'standalone',
  // Keep the standalone bundle (Next copies the traced project root) free of
  // build artifacts and local logs.
  outputFileTracingExcludes: {
    '*': [
      'release/**',
      'desktop-payload/**',
      'electron-test.log',
      'dev.log',
      'server.log',
      'docs/**',
      'examples/**',
      'mini-services/**',
      'data/skills/**',
    ],
  },
};

export default withNextIntl(nextConfig);
