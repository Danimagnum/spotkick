import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
if (process.env.SPOTKICK_CORE_E2E !== '1' || !process.env.CORE_URL?.startsWith('http://127.0.0.1:'))
    throw new Error('Core mutations require the isolated local release runner');
const mutations = [
    ['player-session grant activation', 'apps/api/src/wallet/core-client.ts', 'await this.activatePlayer(token!, claims.sub);', 'void token;'],
    ['stable keys after lost reserve reply', 'apps/api/src/wallet/core-client.ts', "idempotencyKey: 'match:' + matchId + ':' + action", "idempotencyKey: 'match:' + matchId + ':' + action + ':' + Math.random()"],
];
for (const [name, file, before, after] of mutations) {
    const original = readFileSync(file, 'utf8');
    if (!original.includes(before)) throw new Error('Mutation target missing: ' + name);
    try {
        writeFileSync(file, original.replace(before, after));
        const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/integration/core-wallet.test.ts'], {
            env: { ...process.env, SPOTKICK_CORE_EVIDENCE_PATH: '' }, encoding: 'utf8', timeout: 90000,
        });
        if (result.error || result.status === null) throw result.error ?? new Error('Mutation process failed');
        if (result.status === 0 || !/AssertionError|expected|promise rejected/.test(result.stdout + result.stderr)) {
            process.stderr.write(result.stdout + result.stderr);
            throw new Error('Core mutation was not detected by an assertion: ' + name);
        }
        console.log('Real Core detected: ' + name);
    } finally { writeFileSync(file, original); }
}
