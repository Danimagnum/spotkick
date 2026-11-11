import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({ resolve: { alias: { '@spotkick/shared': path.resolve(__dirname, 'packages/shared/src/index.ts') } }, test: { include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'tests/integration/**/*.test.ts', 'tests/contract/**/*.test.ts'], testTimeout: 60000, hookTimeout: 60000, pool: 'forks', maxWorkers: 1 } });
