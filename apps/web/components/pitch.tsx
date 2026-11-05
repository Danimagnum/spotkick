'use client';
import { motion, useReducedMotion } from 'framer-motion';
import type { Zone } from '@spotkick/shared';
export function Ball({ size = 24 }: {
    size?: number;
}) { return <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="#eef2e7" stroke="#abb9b6"/><path d="m20 11 8 6-3 9H15l-3-9 8-6Z" fill="#20312f"/><path d="m20 2 1 9M4 14l8 3m3 9-6 8m16-8 6 8m-3-17 8-4" stroke="#20312f" strokeWidth="2"/></svg>; }
export function Pitch({ result, role = 'shooter', active = false }: {
    result?: {
        shot: Zone;
        keeper: Zone;
        goal: boolean;
        key: number;
    };
    role?: 'shooter' | 'keeper';
    active?: boolean;
}) {
    const reduced = useReducedMotion(), target = (z: Zone) => z === 'left' ? -150 : z === 'right' ? 150 : 0;
    return <div className="pitch-wrap"><svg className="pitch" viewBox="0 0 900 530" role="img" aria-label="An original floodlit football pitch with three goal zones">
    <defs>
      <linearGradient id="sky" x2="0" y2="1"><stop stopColor="#101d2c"/><stop offset="1" stopColor="#1b3440"/></linearGradient>
      <linearGradient id="grass" x2="0" y2="1"><stop stopColor="#204e46"/><stop offset="1" stopColor="#143a34"/></linearGradient>
      <radialGradient id="light"><stop stopColor="#d9eee4" stopOpacity=".12"/><stop offset="1" stopColor="#d9eee4" stopOpacity="0"/></radialGradient>
      <pattern id="crowd" width="25" height="18" patternUnits="userSpaceOnUse"><circle cx="6" cy="7" r="1.5" fill="#9cb2b9" opacity=".32"/><circle cx="19" cy="14" r="1" fill="#c4b384" opacity=".22"/></pattern>
      <pattern id="net" width="22" height="18" patternUnits="userSpaceOnUse"><path d="M22 0H0V18" fill="none" stroke="#c6dbd2" strokeOpacity=".28" strokeWidth="1"/></pattern>
      <filter id="glow"><feGaussianBlur stdDeviation="5"/></filter>
    </defs>
    <path d="M0 0H900V530H0Z" fill="url(#sky)"/>
    <path d="M0 80Q450 0 900 80V232H0Z" fill="#122531"/><path d="M0 89Q450 13 900 89V218H0Z" fill="url(#crowd)"/>
    <path d="M0 123Q450 50 900 123M0 157Q450 92 900 157M0 191Q450 133 900 191" stroke="#527078" opacity=".18" fill="none"/>
    {[80, 820].map(x => <g key={x}><path d={`M${x} 46V198`} stroke="#71868b" strokeWidth="4"/><rect x={x - 43} y="40" width="86" height="12" rx="3" fill="#b8d9d2" opacity=".3" filter="url(#glow)"/><rect x={x - 38} y="42" width="76" height="6" rx="2" fill="#d6ede4"/><path d={`M${x - 30} 50 320 330H580L${x + 30} 50Z`} fill="url(#light)"/></g>)}
    <rect y="216" width="900" height="30" fill="#172a32"/><path d="M0 246H900" stroke="#7b9b8f" opacity=".3"/>
    {[65, 310, 560, 790].map((x, i) => <text key={x} x={x} y="235" fill={i % 2 ? '#a2b6b1' : '#d8bd7d'} opacity=".5" fontSize="12" fontWeight="700" letterSpacing="3">{i % 2 ? 'EVERY CHOICE COUNTS' : 'SPOTKICK'}</text>)}
    <path d="M0 247H900V530H0Z" fill="url(#grass)"/>
    <path d="M0 290H900V336H0Zm0 95H900V440H0Zm0 110H900V530H0Z" fill="#78a78c" opacity=".035"/>
    <path d="M240 245 145 530M660 245 755 530M145 420H755M305 245 260 350H640L595 245" fill="none" stroke="#c5dacf" strokeWidth="2" opacity=".3"/>
    <path d="M350 420Q450 482 550 420" fill="none" stroke="#c5dacf" strokeWidth="2" opacity=".3"/>
    <ellipse cx="450" cy="495" rx="4" ry="2" fill="#d8e9db" opacity=".7"/>
    <path d="M245 250 262 100H638L655 250Z" fill="#09171b" opacity=".28"/>
    <path d="M245 250 262 100H638L655 250Z" fill="url(#net)"/>
    <path d="M245 250V91H655V250M245 91 262 100H638L655 91M262 100V245M638 100V245" stroke="#d8e7df" strokeWidth="5" fill="none" strokeLinejoin="round"/>
    <path d="M381 100V244M519 100V244" stroke="#e6ece1" opacity=".13" strokeDasharray="5 7"/>
    {active && ['L', 'C', 'R'].map((l, i) => <g key={l}><rect x={284 + i * 139} y="125" width="48" height="36" rx="8" fill="#bad6bc" opacity=".06"/><text x={308 + i * 139} y="149" textAnchor="middle" fill="#d3e4d7" opacity=".4" fontSize="15">{l}</text></g>)}
    <ellipse cx="450" cy="266" rx="50" ry="8" fill="#091e1b" opacity=".4"/>
    <motion.g key={`keeper-${result?.key ?? 'idle'}`} initial={{ x: 0, rotate: 0 }} animate={{ x: result ? target(result.keeper) : 0, rotate: result ? target(result.keeper) / 5 : 0 }} transition={{ duration: reduced ? 0 : .55, delay: reduced ? 0 : .1 }} style={{ transformOrigin: '450px 220px' }}>
      <path d="m435 234-14 33m44-33 14 33" stroke="#1b2c3b" strokeWidth="12" strokeLinecap="round"/><path d="m424 269-14 2m68-2 13 3" stroke="#d9e8dc" strokeWidth="8" strokeLinecap="round"/>
      <path d="m432 197-25 18-20-12m81-6 25 18 20-12" stroke="#e9ba64" strokeWidth="11" fill="none" strokeLinecap="round"/>
      <path d="m431 193 38 0 7 43h-52Z" fill="#e9ba64"/><path d="M442 196v37h16v-37" fill="#cba155" opacity=".5"/>
      <circle cx="450" cy="178" r="13" fill="#d7b99c"/><path d="M437 176c-2-20 28-20 26 0l-8-8-18 8Z" fill="#1e2a31"/>
      <path d="m386 202-5-6m133 7 5-7" stroke="#e7eae1" strokeWidth="12" strokeLinecap="round"/>
    </motion.g>
    {!result && <g opacity=".95"><ellipse cx="449" cy="504" rx="25" ry="6" fill="#081e1a" opacity=".5"/><path d="m439 462-7 36m27-36 10 35" stroke="#c5d7d9" strokeWidth="10" strokeLinecap="round"/><path d="m430 498-9 2m48-2 10 2" stroke="#e7b660" strokeWidth="8" strokeLinecap="round"/><path d="m437 428-15 20m42-20 16 19" stroke="#7497b9" strokeWidth="10" strokeLinecap="round"/><path d="m437 422 26 0 5 43h-35Z" fill="#7397b8"/><text x="451" y="451" textAnchor="middle" fill="#e7efeb" fontSize="16" fontWeight="700">9</text><circle cx="450" cy="409" r="11" fill="#c3a183"/><path d="M439 406c0-16 24-16 22 1" fill="#16252d"/></g>}
    <motion.g key={`ball-${result?.key ?? 'idle'}`} initial={{ x: 450, y: 495, scale: 1 }} animate={result ? { x: 450 + target(result.shot), y: 185, scale: .7 } : { x: 450, y: 495, scale: 1 }} transition={{ duration: reduced ? 0 : .55, ease: 'easeOut' }}><ellipse cy="12" rx="14" ry="4" fill="#082019" opacity=".4"/><circle r="11" fill="#eaf0df"/><path d="m0-6 6 4-2 7h-8l-2-7Z" fill="#253f38"/><path d="m0-11 0 5m6 4 5-2m-7 9 3 5m-11-5-3 5m1-12-5-2" stroke="#253f38" strokeWidth="1.5"/></motion.g>
    <path d="M0 520H900V530H0Z" fill="#0b171d" opacity=".3"/>
  </svg><div className="pitch-top"><span className="venue"><span className="tiny-dot"/> The Nightground</span><span className="weather">16° &nbsp; Clear skies</span></div><div className="pitch-bottom"><span>{active ? (role === 'shooter' ? 'Your shot. Pick your corner.' : 'Read the shot. Make the save.') : 'Three zones. One split-second decision.'}</span><span>Original arena No. 01</span></div></div>;
}
