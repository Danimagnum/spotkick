import { execFileSync } from 'node:child_process';
export function assertLocalDocker() {
    const context = execFileSync('docker', ['context', 'show'], { encoding: 'utf8' }).trim();
    const info = JSON.parse(execFileSync('docker', ['context', 'inspect', context], { encoding: 'utf8' }))[0];
    const endpoint = process.env.DOCKER_HOST ?? info.Endpoints.docker.Host;
    if (!/^(npipe|unix):\/\//.test(endpoint) && !/^tcp:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/.test(endpoint))
        throw new Error('These test runners require local Docker, never a remote NAS/staging context');
}
