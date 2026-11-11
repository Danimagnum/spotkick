export const platformMode = () => process.env.PLATFORM_MODE === 'true';
export const coreEnabled = platformMode;
export const serviceName = () => process.env.SERVICE_NAME || 'spotkick';
export const redisKey = (key: string) => `${serviceName()}:${key}`;
export const kafkaBrokers = () => (process.env.KAFKA_BROKERS || '').split(',').map(value => value.trim()).filter(Boolean);

export function validatePlatformConfig() {
    if (process.env.PLATFORM_MODE !== undefined && !['true', 'false'].includes(process.env.PLATFORM_MODE))
        throw new Error('PLATFORM_MODE must be true or false');
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(serviceName())) throw new Error('Invalid SERVICE_NAME');
    if (!platformMode()) return;
    for (const key of ['SERVICE_NAME', 'DATABASE_URL', 'REDIS_URL', 'CORE_URL', 'CORE_ISSUER', 'CORE_AUDIENCE',
        'CORE_JWKS_URL', 'CORE_CLIENT_ID', 'CORE_CLIENT_SECRET'] as const) {
        if (!process.env[key]?.trim()) throw new Error(`${key} is required in platform mode`);
    }
    if (!kafkaBrokers().length) throw new Error('KAFKA_BROKERS is required in platform mode');
}
