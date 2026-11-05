'use client';
import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
export default function GlobalError({ error, reset }: {
    error: Error;
    reset: () => void;
}) { useEffect(() => { Sentry.captureException(error); }, [error]); return <html lang="en"><body style={{ background: '#0c1420', color: 'white', padding: 40, fontFamily: 'sans-serif' }}><h1>Let’s get you back on the pitch.</h1><p>The screen could not load. Your wallet and match are stored on the server.</p><button onClick={reset}>Reload screen</button></body></html>; }
