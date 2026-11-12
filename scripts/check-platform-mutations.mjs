import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const mutations = [
  ['due-only deadline work', 'apps/api/src/matches/engine.ts', "AND (state->>'deadline')::bigint <= $1", 'AND ($1::bigint IS NOT NULL)', 'tests/integration/system.test.ts', 'ticks only due'],
  ['current-mode work isolation', 'apps/api/src/matches/engine.ts', "AND (state ? 'core')=$2", 'AND ($2::boolean IS NOT NULL)', 'tests/integration/system.test.ts', 'ticks only due'],
  ['full health queue recovery', 'apps/api/src/platform/operations.ts', "console.warn(JSON.stringify({ event: 'platform.health.queue_full' }));", "console.warn(JSON.stringify({ event: 'platform.health.queue_full' })); return;", 'apps/api/src/platform/operations.test.ts', 'drains a full'],
  ['observation-time health metrics', 'apps/api/src/platform/operations.ts', '...sample.window', '...this.window(sample.at.getTime())', 'apps/api/src/platform/operations.test.ts', 'drains a full'],
  ['readiness dependency checks', 'apps/api/src/platform/operations.ts', "if (!database || !redis) return 'unhealthy';", "if (false) return 'unhealthy';", 'tests/integration/operations.test.ts', 'serves real probes'],
  ['health state changes', 'apps/api/src/platform/operations.ts', 'status !== this.lastObserved', 'false', 'tests/integration/operations.test.ts', 'writes contract health'],
  ['resolution metrics', 'apps/api/src/platform/game-metrics.ts', 'this.resolutionCount++;', 'void 0;', 'tests/integration/platform.test.ts'],
  ['explicit platform opt-in', 'apps/api/src/platform-config.ts', "export const coreEnabled = platformMode;", "export const coreEnabled = () => Boolean(process.env.CORE_URL);", 'tests/contract/platform.test.ts'],
  ['event validation', 'apps/api/src/platform/events.ts', '    parseEvent(topic, value);', '    void value;', 'apps/api/src/platform/events.test.ts'],
  ['stable money command key', 'apps/api/src/wallet/core-client.ts', "idempotencyKey: 'match:' + matchId + ':' + action", "idempotencyKey: 'match:' + matchId + ':' + action + ':' + Math.random()", 'tests/integration/platform.test.ts'],
];
for (const [name, file, before, after, test, pattern] of mutations) {
  const original = readFileSync(file, 'utf8');
  if (!original.includes(before)) throw new Error('Mutation target missing: ' + name);
  try {
    writeFileSync(file, original.replace(before, after));
    const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', test, ...(pattern ? ['--testNamePattern', pattern] : [])], { encoding: 'utf8', timeout: 90000 });
    if (result.error || result.status === null) throw result.error ?? new Error('Test process failed');
    if (result.status === 0 || !/AssertionError|AssertionError:|expected|promise rejected/.test(result.stdout + result.stderr)) {
      process.stderr.write(result.stdout + result.stderr);
      throw new Error('Mutation not detected by assertion: ' + name);
    }
    console.log('Detected: ' + name);
  } finally { writeFileSync(file, original); }
}
