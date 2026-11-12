import { assertLocalDocker } from './local-docker.mjs';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import os from 'node:os';
assertLocalDocker();
const { Client } = createRequire(resolve('apps/api/package.json'))('pg');
const baseline = process.argv.includes('--baseline');
const matches = Number(process.env.MATCHES ?? 200);
if (!Number.isInteger(matches) || matches < 1 || matches > 200) throw new Error('MATCHES must be 1..200');
const phase = baseline ? 'before' : 'after';
const artifacts = resolve('../../work/load200'); mkdirSync(artifacts, { recursive: true });
const k6 = process.env.K6_BIN ?? resolve('../../work/k6/k6-v2.3.0-windows-amd64/k6.exe');
if (!existsSync(k6)) throw new Error('Set K6_BIN to an installed k6 executable');
const database = 'spotkick_load_' + Date.now() + '_test';
const admin = new Client({ connectionString: 'postgres://platform:spotkick-test@127.0.0.1:35432/postgres' });
await admin.connect();
try { await admin.query('CREATE DATABASE ' + database); } finally { await admin.end(); }
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'packages/shared/tsconfig.json'], { stdio: 'inherit' });
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'apps/api/tsconfig.json'], { stdio: 'inherit' });
execFileSync('docker', ['compose', '-p', 'spotkick-core030', '-f', 'compose.core-test.yaml', 'stop', 'core', 'worker'], { stdio: 'inherit' });
const db = new Client({ connectionString: 'postgres://platform:spotkick-test@127.0.0.1:35432/' + database });
const endpoints = ['http://127.0.0.1:34311', 'http://127.0.0.1:34312'];
const children = [], descriptors = [];
const samples = []; let timer, sampling = false, peakMatches = 0, peakSockets = 0;
const start = Date.now();
try {
    for (let i = 0; i < 2; i++) {
        const log = openSync(resolve(artifacts, phase + '-api-' + i + '.log'), 'w'); descriptors.push(log);
        children.push(spawn(process.execPath, ['apps/api/dist/main.js'], { windowsHide: true, stdio: ['ignore', log, log], env: {
            ...process.env, PLATFORM_MODE: 'false', SERVICE_NAME: 'spotkick-load-' + database.replaceAll('_', '-'), PORT: String(34311 + i),
            DATABASE_URL: 'postgres://platform:spotkick-test@127.0.0.1:35432/' + database,
            REDIS_URL: 'redis://127.0.0.1:36379/2', GUEST_RATE_LIMIT: '2000', CHOICE_MS: '60000', REVEAL_MS: '3000', RESULT_MS: '1600', BOT_AFTER_MS: '60000', RAKE_BPS: '300',
        } }));
    }
    for (const endpoint of endpoints) {
        let ready = false;
        for (let i = 0; i < 90; i++) {
            if (children.some(child => child.exitCode !== null)) throw new Error('Load API exited during startup; inspect its log');
            try { if ((await fetch(endpoint + '/health/ready', { signal: AbortSignal.timeout(3000) })).ok) { ready = true; break; } } catch {}
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (!ready) throw new Error('Load API did not become ready: ' + endpoint);
    }
    await db.connect();
    async function sample() {
        if (sampling) return;
        sampling = true;
        try {
            const [active, ...metrics] = await Promise.all([
                db.query("SELECT COUNT(*)::int AS count FROM matches WHERE status NOT IN ('SETTLED','ABANDONED')"),
                ...endpoints.map(async endpoint => (await (await fetch(endpoint + '/metrics', { signal: AbortSignal.timeout(5000) })).text())),
            ]);
            const connections = metrics.map(text => Number(/^spotkick_socket_connections ([0-9]+)/m.exec(text)?.[1] ?? 0));
            peakMatches = Math.max(peakMatches, active.rows[0].count); peakSockets = Math.max(peakSockets, connections.reduce((a,b) => a+b, 0));
            samples.push({ ms: Date.now() - start, activeMatches: active.rows[0].count, connections });
        } finally { sampling = false; }
    }
    timer = setInterval(() => { sample().catch(() => {}); }, 250);
    const summaryPath = resolve(artifacts, phase + '-k6.json');
    const log = openSync(resolve(artifacts, phase + '-k6.log'), 'w'); descriptors.push(log);
    console.log('Running ' + matches + ' requested matches / ' + matches*2 + ' players across two instances (' + phase + ').');
    const run = spawn(k6, ['run', '--summary-export', summaryPath, '-e', 'MATCHES=' + matches, '-e', 'API_URLS=' + endpoints.join(','), 'tests/load/matches.js'], { windowsHide: true, stdio: ['ignore', log, log] });
    const exitCode = await new Promise((resolve, reject) => { run.on('error', reject); run.on('exit', resolve); });
    clearInterval(timer); while (sampling) await new Promise(resolve => setTimeout(resolve, 20));
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
    const states = (await db.query('SELECT status,COUNT(*)::int AS count FROM matches GROUP BY status ORDER BY status')).rows;
    const audit = (await db.query("SELECT (SELECT COALESCE(SUM(amount),0)::text FROM ledger_entries) AS ledger_net, (SELECT COUNT(*)::int FROM (SELECT account_id FROM ledger_entries GROUP BY account_id HAVING SUM(amount)<0) n JOIN accounts a ON a.id=n.account_id WHERE a.kind<>'ISSUANCE') AS negative_spendable")).rows[0];
    const result = { verifiedAt: new Date().toISOString(), phase, requestedMatches: matches, expectedPlayers: matches*2, peakActiveMatches: peakMatches, peakSocketConnections: peakSockets, k6ExitCode: exitCode, states, audit,
        environment: { mode: 'standalone', core: 'not part of this capacity test', node: process.version, k6: execFileSync(k6, ['version'], { encoding: 'utf8' }).trim(),
            os: os.type() + ' ' + os.release(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, hostMemoryBytes: os.totalmem(),
            docker: execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' }).trim(), database,
            postgres: (await db.query('SELECT version()')).rows[0].version, redis: 'redis:7.4-alpine', apis: endpoints, choiceMs: 60000, revealMs: 3000, resultMs: 1600, botAfterMs: 60000,
            schedule: 'all guests provisioned first; queue barrier +5s, first choice barrier +25s; 400 VUs, one iteration each, max 3m',
            commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), workingTree: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() },
        metrics: summary.metrics, samples };
    writeFileSync('docs/load-200-' + phase + '.json', JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ phase, peakMatches, peakSockets, exitCode, states, audit, duration: summary.metrics.match_duration, success: summary.metrics.match_success }));
    if (!baseline && (exitCode !== 0 || peakMatches !== matches || states.length !== 1 || states[0].status !== 'SETTLED' || states[0].count !== matches || audit.ledger_net !== '0' || audit.negative_spendable !== 0))
        throw new Error('Load acceptance failed; see saved evidence');
} finally {
    clearInterval(timer);
    for (const child of children) if (child.exitCode === null) child.kill();
    await db.end().catch(() => {});
    for (const fd of descriptors) closeSync(fd);
}
