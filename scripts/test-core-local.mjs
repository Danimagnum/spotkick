import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const release = JSON.parse(readFileSync('tests/fixtures/core030/release.json', 'utf8'));
const compose = ['compose', '-f', 'compose.core-test.yaml'];
const image = JSON.parse(execFileSync('docker', ['image', 'inspect', release.image, '--format', '{{json .}}'], { encoding: 'utf8' }));
if (image.Os !== 'linux' || image.Architecture !== 'amd64' || image.Config.Labels['org.opencontainers.image.revision'] !== release.commit ||
    image.Config.Labels['org.opencontainers.image.version'] !== release.tag.slice(1) || !image.RepoDigests.includes(release.image))
    throw new Error('Loaded Core image does not match the pinned release');
const base = 'http://127.0.0.1:34101';
const env = { ...process.env, DATABASE_URL: 'postgres://platform:spotkick-test@127.0.0.1:35432/spotkick_030_test',
    REDIS_URL: 'redis://127.0.0.1:36379/1', CORE_URL: base, CORE_ISSUER: base, CORE_AUDIENCE: 'platform-core',
    CORE_JWKS_URL: base + '/.well-known/jwks.json', SPOTKICK_CORE_E2E: '1',
    SPOTKICK_CORE_TEST_DATABASE_URL: 'postgres://platform:spotkick-test@127.0.0.1:35432/core_030_test',
    SPOTKICK_CORE_EVIDENCE_PATH: 'docs/core-v020-results.json' };
delete env.PLATFORM_MODE;
try {
    execFileSync('docker', [...compose, 'up', '-d'], { stdio: 'inherit' });
    let ready = false;
    for (let i = 0; i < 90; i++) {
        try { if ((await fetch(base + '/health/ready', { signal: AbortSignal.timeout(3000) })).ok) { ready = true; break; } } catch {}
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!ready) throw new Error('Pinned local Core did not become ready');
    const live = await (await fetch(base + '/health/live')).json();
    if (live.commit !== release.commit || live.version !== release.tag.slice(1)) throw new Error('Running Core revision mismatch');
    console.log('Verified local Core ' + release.tag + ' at commit ' + release.commit + ' (EUR only).');
    const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/integration/core-wallet.test.ts'], { env, stdio: 'inherit' });
    if (run.error || run.status !== 0) throw run.error ?? new Error('Real Core integration failed');
    if (process.argv.includes('--mutations')) {
        delete env.SPOTKICK_CORE_EVIDENCE_PATH;
        const mutation = spawnSync(process.execPath, ['scripts/check-core-mutations.mjs'], { env, stdio: 'inherit' });
        if (mutation.error || mutation.status !== 0) throw mutation.error ?? new Error('Core mutation checks failed');
    }
} finally {
    if (!process.argv.includes('--keep-running')) execFileSync('docker', [...compose, 'stop'], { stdio: 'inherit' });
}
