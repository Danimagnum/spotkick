import type { Metadata } from 'next';
import localFont from 'next/font/local';
const clubDisplay = localFont({ src: [{ path: '../public/fonts/BarlowCondensed-Black.ttf', weight: '400', style: 'normal' }, { path: '../public/fonts/BarlowCondensed-BlackItalic.ttf', weight: '400', style: 'italic' }], variable: '--font-display', display: 'swap' });
import './globals.css';
import './showcase.css';
export const metadata: Metadata = { title: 'SpotKick | Every choice counts', description: 'A real-time penalty shootout. Three rounds, three zones, one winner. Play money only.', robots: { index: false, follow: false } };
export default function Layout({ children }: {
    children: React.ReactNode;
}) { return <html className={clubDisplay.variable} lang="en" translate="no"><head><meta name="google" content="notranslate" /></head><body>{children}</body></html>; }
