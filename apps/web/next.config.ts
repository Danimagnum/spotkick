import type { NextConfig } from 'next';
import path from 'node:path';
const config: NextConfig = { output: process.platform === 'win32' ? undefined : 'standalone', outputFileTracingRoot: path.join(__dirname, '../..'), transpilePackages: ['@spotkick/shared'], serverExternalPackages: ['@sentry/nextjs', '@sentry/node'], poweredByHeader: false, experimental: { cpus: 2 }, async headers() { return [{ source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'self' https://danielgil.eu https://www.danielgil.eu http://127.0.0.1:8081" }] }]; } };
export default config;
