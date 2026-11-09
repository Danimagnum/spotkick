'use client';
import { motion, useReducedMotion } from 'framer-motion';
import type { Zone } from '@spotkick/shared';
export function Ball({ size = 24 }: {
    size?: number;
}) { return <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="#eef2e7" stroke="#abb9b6"/><path d="m20 11 8 6-3 9H15l-3-9 8-6Z" fill="#20312f"/><path d="m20 2 1 9M4 14l8 3m3 9-6 8m16-8 6 8m-3-17 8-4" stroke="#20312f" strokeWidth="2"/></svg>; }
export function Pitch({ result, role = 'shooter', active = false, preview = false }: {
    result?: {
        shot: Zone;
        keeper: Zone;
        goal: boolean;
        key: number;
    };
    role?: 'shooter' | 'keeper';
    active?: boolean;
    preview?: boolean;
}) {
    const reduced = useReducedMotion(), target = (z: Zone) => z === 'left' ? -150 : z === 'right' ? 150 : 0;
    const shotX = result ? 450 + target(result.shot) : 450;
    const finalX = result && !result.goal ? shotX + (shotX < 450 ? -75 : 75) : shotX;
    const finalY = result ? result.goal ? 210 : 313 : 495;
    const resultColor = result?.goal ? '#ffd481' : '#83ecff';
    return <div className={`pitch-wrap${preview ? ' pitch-preview' : ''}`}>
    <svg className="pitch" viewBox="0 0 900 530" preserveAspectRatio="xMidYMid slice" role="img" aria-label="An original floodlit football pitch with three goal zones">
    <defs>
      <linearGradient id="sky" x2="0" y2="1"><stop stopColor="#23335c"/><stop offset=".53" stopColor="#425c88"/><stop offset="1" stopColor="#ed9c77"/></linearGradient>
      <linearGradient id="grass" x2="0" y2="1"><stop stopColor="#31735e"/><stop offset="1" stopColor="#123b35"/></linearGradient>
      <radialGradient id="light"><stop stopColor="#c0eaff" stopOpacity=".36"/><stop offset="1" stopColor="#c0eaff" stopOpacity="0"/></radialGradient>
      <radialGradient id="stadium-haze"><stop stopColor="#ffd4a1" stopOpacity=".62"/><stop offset="1" stopColor="#ffd4a1" stopOpacity="0"/></radialGradient>
      <pattern id="crowd" width="25" height="18" patternUnits="userSpaceOnUse"><circle cx="6" cy="7" r="1.5" fill="#9cb2b9" opacity=".32"/><circle cx="19" cy="14" r="1" fill="#c4b384" opacity=".22"/></pattern>
      <pattern id="net" width="22" height="18" patternUnits="userSpaceOnUse"><path d="M22 0H0V18" fill="none" stroke="#c6dbd2" strokeOpacity=".28" strokeWidth="1"/></pattern>
      <filter id="glow"><feGaussianBlur stdDeviation="5"/></filter>
    </defs>
    <path d="M0 0H900V530H0Z" fill="url(#sky)"/>
    <ellipse cx="450" cy="170" rx="485" ry="110" fill="url(#stadium-haze)"/>
    <path d="M0 104Q450 30 900 104V232H0Z" fill="#162b43" opacity=".78"/><path d="M0 108Q450 43 900 108V218H0Z" fill="url(#crowd)"/>
    <path d="M0 123Q450 50 900 123M0 157Q450 92 900 157M0 191Q450 133 900 191" stroke="#527078" opacity=".18" fill="none"/>
    {[185, 715].map(x => <g key={x} className="pitch-light-rig">
      <path d={`M${x} 46V198m-12 0 12-135 12 135`} stroke="#7b94aa" strokeWidth="3" fill="none"/>
      <g className="pitch-lamp">
        <rect x={x - 45} y="38" width="90" height="15" rx="4" fill="#b4dfff" opacity=".55" filter="url(#glow)"/>
        <path d={`M${x - 30} 50 320 330H580L${x + 30} 50Z`} fill="url(#light)"/>
      </g>
      <rect x={x - 38} y="42" width="76" height="6" rx="2" fill="#e6f5ff"/>
    </g>)}
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
    {result && <motion.ellipse key={`impact-${result.key}`} cx={shotX} cy="185" rx="55" ry="38" fill={resultColor}
      initial={{ opacity: 0, scale: .45 }}
      animate={{ opacity: reduced ? 0 : [0, .48, 0], scale: reduced ? 1 : [.45, 1, 1.4] }}
      transition={{ duration: reduced ? 0 : .58, delay: reduced ? 0 : .33 }}
      style={{ transformBox: 'fill-box', transformOrigin: 'center' }}/>}
    <path d="M381 100V244M519 100V244" stroke="#e6ece1" opacity=".13" strokeDasharray="5 7"/>
    {active && ['L', 'C', 'R'].map((l, i) => <g key={l}><rect x={284 + i * 139} y="125" width="48" height="36" rx="8" fill="#bad6bc" opacity=".06"/><text x={308 + i * 139} y="149" textAnchor="middle" fill="#d3e4d7" opacity=".4" fontSize="15">{l}</text></g>)}
    <ellipse cx="450" cy="266" rx="50" ry="8" fill="#091e1b" opacity=".4"/>
    <motion.g key={`keeper-${result?.key ?? 'idle'}`} className={!result ? 'pitch-keeper-idle' : undefined}
      initial={{ x: 0, y: 0, rotate: 0 }}
      animate={{
        x: result ? target(result.keeper) : 0,
        y: result ? (result.keeper === 'centre' ? -17 : -23) : 0,
        rotate: result ? target(result.keeper) / 4 : 0,
      }}
      transition={{ duration: reduced ? 0 : .44, delay: reduced ? 0 : .08, ease: 'easeOut' }}
      style={{ transformOrigin: '450px 220px' }}>
      <path d="m435 234-14 33m44-33 14 33" stroke="#1b2c3b" strokeWidth="12" strokeLinecap="round"/><path d="m424 269-14 2m68-2 13 3" stroke="#d9e8dc" strokeWidth="8" strokeLinecap="round"/>
      <path d="m432 197-25 18-20-12m81-6 25 18 20-12" stroke="#e9ba64" strokeWidth="11" fill="none" strokeLinecap="round"/>
      <path d="m431 193 38 0 7 43h-52Z" fill="#e9ba64"/><path d="M442 196v37h16v-37" fill="#cba155" opacity=".5"/>
      <circle cx="450" cy="178" r="13" fill="#d7b99c"/><path d="M437 176c-2-20 28-20 26 0l-8-8-18 8Z" fill="#1e2a31"/>
      <path d="m386 202-5-6m133 7 5-7" stroke="#e7eae1" strokeWidth="12" strokeLinecap="round"/>
    </motion.g>
    {!result && <g opacity=".95"><ellipse cx="449" cy="504" rx="25" ry="6" fill="#081e1a" opacity=".5"/><path d="m439 462-7 36m27-36 10 35" stroke="#c5d7d9" strokeWidth="10" strokeLinecap="round"/><path d="m430 498-9 2m48-2 10 2" stroke="#e7b660" strokeWidth="8" strokeLinecap="round"/><path d="m437 428-15 20m42-20 16 19" stroke="#7497b9" strokeWidth="10" strokeLinecap="round"/><path d="m437 422 26 0 5 43h-35Z" fill="#7397b8"/><text x="451" y="451" textAnchor="middle" fill="#e7efeb" fontSize="16" fontWeight="700">9</text><circle cx="450" cy="409" r="11" fill="#c3a183"/><path d="M439 406c0-16 24-16 22 1" fill="#16252d"/></g>}
    {result && !reduced && <motion.path key={`trail-${result.key}`}
      d={`M450 495 Q${(450 + shotX) / 2} 247 ${shotX} 185`} fill="none" stroke="#e8f5ff" strokeWidth="4" strokeLinecap="round"
      initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: [.1, .7, 0] }} transition={{ duration: .48 }}/>}
    <motion.g key={`ball-${result?.key ?? 'idle'}`}
      initial={{ x: 450, y: 495, scale: 1 }}
      animate={result && !reduced ? {
        x: [450, (450 + shotX) / 2, shotX, finalX],
        y: [495, 278, 185, finalY],
        scale: [1, .88, .68, .64],
      } : { x: finalX, y: finalY, scale: result ? .68 : 1 }}
      transition={{ duration: result && !reduced ? .64 : 0, times: [0, .25, .66, 1], ease: 'easeOut' }}>
      <ellipse cy="12" rx="14" ry="4" fill="#082019" opacity=".4"/>
      <circle r="11" fill="#eaf0df"/>
      <path d="m0-6 6 4-2 7h-8l-2-7Z" fill="#253f38"/>
      <path d="m0-11 0 5m6 4 5-2m-7 9 3 5m-11-5-3 5m1-12-5-2" stroke="#253f38" strokeWidth="1.5"/>
    </motion.g>
    <path d="M0 520H900V530H0Z" fill="#0b171d" opacity=".3"/>
  </svg>
  <div className="pitch-top"><span className="venue"><span className="tiny-dot"/> The Nightground</span></div>
  {preview && <div className="pitch-idle-title"><strong>Ready to kick</strong><span>Three rounds · Three zones</span></div>}
  {result && <motion.div key={`call-${result.key}`} className={`pitch-result-call ${result.goal ? 'is-goal' : 'is-save'}`}
    aria-hidden="true" initial={reduced ? false : { opacity: 0, scale: .8 }}
    animate={{ opacity: 1, scale: 1 }} transition={{ delay: reduced ? 0 : .37, duration: reduced ? 0 : .2 }}>
    {result.goal ? 'Goal!' : 'Saved!'}
  </motion.div>}
  {!preview && !result && <div className="pitch-bottom"><span>{active ? (role === 'shooter' ? 'Your shot. Pick your corner.' : 'Read the shot. Make the save.') : 'Three zones. One split-second decision.'}</span></div>}
  </div>;
}
