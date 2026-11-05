export async function register() { if (process.env.NEXT_RUNTIME === 'nodejs') {
    const Sentry = await import('@sentry/nextjs');
    Sentry.init({ dsn: process.env.SENTRY_DSN, enabled: !!process.env.SENTRY_DSN, tracesSampleRate: 0.1, sendDefaultPii: false });
} }
export { captureRequestError as onRequestError } from '@sentry/nextjs';
