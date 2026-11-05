import type { NextConfig } from 'next';
import path from 'node:path';
const config: NextConfig = { output: process.platform === 'win32' ? undefined : 'standalone', outputFileTracingRoot: path.join(__dirname, '../..'), transpilePackages: ['@spotkick/shared'], serverExternalPackages: ['@sentry/nextjs', '@sentry/node'], poweredByHeader: false, experimental: { cpus: 2 } };
export default config;
