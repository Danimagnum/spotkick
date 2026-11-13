import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'SpotKick | Every choice counts', description: 'A real-time penalty shootout. Three rounds, three zones, one winner. Play money only.', robots: { index: false, follow: false } };
export default function Layout({ children }: {
    children: React.ReactNode;
}) { return <html lang="en" translate="no"><head><meta name="google" content="notranslate" /></head><body>{children}</body></html>; }
