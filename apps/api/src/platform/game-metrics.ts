import { Injectable } from '@nestjs/common';
const buckets = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
@Injectable()
export class GameMetrics {
    connections = () => 0;
    activeMatches = NaN;
    private resolutionCount = 0;
    private resolutionSum = 0;
    private readonly resolutionBuckets = buckets.map(() => 0);
    private readonly settlementErrors = { standalone: 0, platform: 0 };
    resolution(elapsedMs: number) {
        const seconds = Math.max(0, elapsedMs) / 1000;
        this.resolutionCount++;
        this.resolutionSum += seconds;
        buckets.forEach((upper, i) => { if (seconds <= upper) this.resolutionBuckets[i]++; });
    }
    settlementError(mode: 'standalone' | 'platform') { this.settlementErrors[mode]++; }
    render() {
        return [
            '# HELP spotkick_active_matches Active matches in this service database; use max across replicas, not sum.',
            '# TYPE spotkick_active_matches gauge',
            'spotkick_active_matches ' + this.activeMatches,
            '# HELP spotkick_socket_connections Local Engine.IO connections, including handshakes.',
            '# TYPE spotkick_socket_connections gauge',
            'spotkick_socket_connections ' + this.connections(),
            '# HELP spotkick_resolution_duration_seconds Reveal resolution processing attempts, including rolled-back attempts; excludes player wait.',
            '# TYPE spotkick_resolution_duration_seconds histogram',
            ...buckets.map((upper, i) => 'spotkick_resolution_duration_seconds_bucket{le="' + upper + '"} ' + this.resolutionBuckets[i]),
            'spotkick_resolution_duration_seconds_bucket{le="+Inf"} ' + this.resolutionCount,
            'spotkick_resolution_duration_seconds_count ' + this.resolutionCount,
            'spotkick_resolution_duration_seconds_sum ' + this.resolutionSum,
            '# HELP spotkick_settlement_errors_total Failed settlement attempts; retries count separately.',
            '# TYPE spotkick_settlement_errors_total counter',
            ...Object.entries(this.settlementErrors).map(([mode, total]) => 'spotkick_settlement_errors_total{mode="' + mode + '"} ' + total),
            '',
        ].join('\n');
    }
}
