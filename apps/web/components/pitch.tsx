'use client';
import { useReducedMotion } from 'framer-motion';
import { zones, type Zone } from '@spotkick/shared';
export function Ball({ size = 24 }: {
    size?: number;
}) { return <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="#eef2e7" stroke="#abb9b6"/><path d="m20 11 8 6-3 9H15l-3-9 8-6Z" fill="#20312f"/><path d="m20 2 1 9M4 14l8 3m3 9-6 8m16-8 6 8m-3-17 8-4" stroke="#20312f" strokeWidth="2"/></svg>; }
export function Pitch({ result, role = 'shooter', active = false, preview = false }: {
    result?: { shot: Zone; keeper: Zone; goal: boolean; key: number };
    role?: 'shooter' | 'keeper';
    active?: boolean;
    preview?: boolean;
}) {
    const reducedMotion = useReducedMotion();
    const replay = result && `/retro/${result.shot}-${result.keeper}`;
    const scene = result ? `${replay}.webp` : '/retro/ready.webp';

    return <div className="pitch-wrap">
        <div className="pixel-hud">
            <span className="pixel-venue">The Nightground</span>
            <div className="pixel-caption">
                {result ? <>
                    <strong className={result.goal ? 'pixel-goal' : 'pixel-save'}>{result.goal ? 'Goal!' : 'Saved!'}</strong>
                    <span>Shot {result.shot} · Keeper {result.keeper}</span>
                </> : <>
                    <strong>{preview ? 'Ready to kick' : active ? (role === 'shooter' ? 'Pick your corner' : 'Read the shot') : 'Penalty arena'}</strong>
                    {preview && <span>Three rounds · Three zones</span>}
                </>}
            </div>
        </div>
        <div className="pixel-field" style={{ backgroundImage: `url(${scene})` }}>
            {result && !reducedMotion && <video
                key={`${replay}-${result.key}`}
                src={`${replay}.mp4`}
                poster="/retro/ready.webp"
                autoPlay muted playsInline aria-hidden="true"
                onError={event => { event.currentTarget.hidden = true; }}
            />}
            {active && !result && <div className="pixel-zones" aria-hidden="true">
                {zones.map(zone => <span key={zone}>{zone[0].toUpperCase()}</span>)}
            </div>}
        </div>
    </div>;
}
