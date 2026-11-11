import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
// Gitleaks v8.30.1, official multi-platform image, pinned by digest.
const image = 'ghcr.io/gitleaks/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f';
const scratch = mkdtempSync(join(tmpdir(), 'spotkick-secret-scan-'));
const root = process.cwd();
function run(command, args) {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 180000 });
    if (result.error || result.status === null) throw result.error ?? new Error(command + ' failed to run');
    return result;
}
function scan(path, mode, extra = []) {
    return run('docker', ['run', '--rm', '--env', 'GIT_CONFIG_COUNT=1', '--env', 'GIT_CONFIG_KEY_0=safe.directory', '--env', 'GIT_CONFIG_VALUE_0=/source', '--mount', 'type=bind,source=' + path + ',target=/source,readonly', image,
        mode, '/source', '--redact=100', '--verbose', '--no-banner', '--exit-code=1', ...extra]);
}
try {
    const fixture = join(scratch, 'fixture'); mkdirSync(fixture);
    const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
    writeFileSync(join(fixture, 'synthetic-key.pem'), key);
    const control = scan(fixture, 'dir');
    if (control.status !== 1 || !/private.key/i.test(control.stdout + control.stderr)) { process.stderr.write(control.stdout + control.stderr); throw new Error('Scanner failed to detect the synthetic private key'); }
    console.log('Scanner self-test: synthetic private key detected (redacted).');
    const history = scan(root, 'git', ['--log-opts=--all']);
    if (history.status !== 0) { process.stderr.write(history.stdout + history.stderr); throw new Error('Git history secret scan failed'); }
    // Snapshot current tracked files too, so staged and working-tree changes are scanned before commit.
    const snapshot = join(scratch, 'tracked'); mkdirSync(snapshot);
    const files = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
    if (files.status !== 0) throw new Error('Unable to enumerate repository files');
    for (const name of files.stdout.split('\0').filter(Boolean)) {
        const source = resolve(root, name), target = resolve(snapshot, name);
        if (!source.startsWith(root + sep) || !target.startsWith(snapshot + sep)) throw new Error('Unsafe tracked path');
        try { mkdirSync(dirname(target), { recursive: true }); copyFileSync(source, target); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const working = scan(snapshot, 'dir');
    if (working.status !== 0) { process.stderr.write(working.stdout + working.stderr); throw new Error('Working-tree secret scan failed'); }
    console.log('Secret scan: full Git history and current tracked/unignored files passed.');
} finally {
    const expectedRoot = resolve(tmpdir()) + sep;
    if (!resolve(scratch).startsWith(expectedRoot) || !scratch.includes('spotkick-secret-scan-')) throw new Error('Unsafe scanner cleanup path');
    rmSync(scratch, { recursive: true, force: true });
}
