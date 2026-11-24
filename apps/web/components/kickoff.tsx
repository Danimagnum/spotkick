'use client';

import { useState } from 'react';
import { zones, type Zone } from '@spotkick/shared';
import { Pitch } from './pitch';

/** A presentation-only warm-up. It never calls the game or wallet APIs. */
export function Kickoff({ reduceReplays, onRules }: { reduceReplays: boolean; onRules: () => void }) {
    const [aim, setAim] = useState<Zone>('left');
    const [replay, setReplay] = useState<{ shot: Zone; keeper: Zone; goal: boolean; key: number }>();
    const [attempt, setAttempt] = useState(0);

    function shoot(zone: Zone) {
        setAim(zone);
        setAttempt(value => value + 1);
        setReplay({ shot: zone, keeper: 'centre', goal: zone !== 'centre', key: attempt });
    }

    return <section className="kickoff" aria-labelledby="kickoff-title">
        <div className="kickoff-copy">
            <p className="kickoff-location"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v5m0 10v5M2 12h5m10 0h5M5 5l4 4m6 6 4 4M5 19l4-4m6-6 4-4"/></svg> The Nightground. Under the lights.</p>
            <h1 id="kickoff-title"><span>ALL NERVE.</span><span>ONE KICK.</span></h1>
            <p className="kickoff-description">The whole match comes down to this.<br/> Pick a corner. Keep your cool.</p>
            <div className="kickoff-actions">
                <a className="kickoff-enter" href="#match-setup"><span>Enter the arena</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></a>
                <button className="kickoff-rules" onClick={onRules}>Learn the rules <span aria-hidden="true">↗</span></button>
            </div>
            <div className="kickoff-format" aria-label="Three rounds, three zones, ten seconds per choice">
                <span><b>3</b> rounds</span><span><b>3</b> zones</span><span><b>10</b> seconds</span>
            </div>
        </div>

        <div className="kickoff-stage">
            <span className="kickoff-stadium-word" aria-hidden="true">SPOTKICK</span>
            <div className="kickoff-scene">
                <div className="warmup-topline"><span><i/> On the spot</span><span>Warm-up / free replay</span></div>
                <Pitch preview reduceReplays={reduceReplays} result={replay}/>
                {!replay && <svg className="kickoff-trajectory" viewBox="0 0 500 500" aria-hidden="true"><path key={aim} d={aim === 'left' ? 'M250 384 Q210 300 151 184' : aim === 'right' ? 'M250 384 Q300 300 349 184' : 'M250 384 Q260 280 250 184'}/><circle cx={aim === 'left' ? 151 : aim === 'right' ? 349 : 250} cy="184" r="13"/></svg>}
                <div key={attempt} className={`warmup-stamp ${replay ? (replay.goal ? 'is-goal' : 'is-save') : ''}`} aria-hidden="true"><span>{replay ? `${replay.shot} corner` : 'Trust your'}</span><b>{replay ? (replay.goal ? 'GOAL.' : 'DENIED.') : 'INSTINCT.'}</b></div>
            </div>
            <div className="warmup-controls">
                <div className="warmup-invitation"><span className="warmup-cross" aria-hidden="true">+</span><p>Take a warm-up kick.<small>No credits. Just a taste.</small></p></div>
                <div className="warmup-zones" aria-label="Warm-up replay direction">
                    {zones.map((zone, index) => <button key={zone} aria-label={`Preview ${zone} kick`} aria-pressed={replay?.shot === zone} onPointerEnter={() => { if (!replay) setAim(zone); }} onFocus={() => { if (!replay) setAim(zone); }} onClick={() => shoot(zone)}><svg viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${(index - 1) * 45}deg)` }}><path d="M12 20V4m-6 6 6-6 6 6"/></svg><span>{zone}</span></button>)}
                </div>
            </div>
            <p className="warmup-feedback" role="status" aria-live="polite">{replay ? `${replay.goal ? 'In the net.' : 'The keeper read it.'} Replay: shot ${replay.shot}, keeper centre. Try another corner.` : 'Choose a corner to preview a kick. The keeper stays centre in this warm-up.'}</p>
        </div>
        <div className="kickoff-baseline"><span>Football. Stripped to instinct.</span><span>Original arcade penalty club <span aria-hidden="true">↙</span></span></div>
    </section>;
}
