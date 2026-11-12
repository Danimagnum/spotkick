'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { botZone, commitment, fairZone, hmac256, pvpPayout, sha256, soloPayout, zones, MatchView, LobbyView, SoloView, Zone } from '@spotkick/shared';
import { Ball, Pitch } from './pitch';
type Mode = 'arena' | 'solo' | 'verify';
type Me = {
    id: string;
    name: string;
    balance: number | string;
    active_game: string | null;
    queue_stake: number | null;
};
const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
function money(amount: number | string) {
    if (typeof amount === 'number') return numberFormat.format(amount / 100);
    const units = BigInt(amount);
    const fraction = (units % 100n).toString().padStart(2, '0').replace(/0$/, '');
    return numberFormat.format(units / 100n) + (fraction === '0' ? '' : '.' + fraction);
}
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const emptyLobby: LobbyView = { online: [], matches: 0, recent: [], config: { rakeBps: 300, botAfterMs: 5000, choiceMs: 10000 } };
function Icon({ name, size = 20 }: {
    name: string;
    size?: number;
}) { const paths: Record<string, React.ReactNode> = { shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>, wallet: <><rect x="3" y="6" width="18" height="14" rx="3"/><path d="M17 6V3L4 6m12 6h5v4h-5Z"/></>, arrow: <><path d="M5 12h14m-5-5 5 5-5 5"/></>, users: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 4c3 0 3 3 3 6"/></>, bolt: <path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z"/>, cup: <><path d="M7 3h10v6a5 5 0 0 1-10 0V3Zm0 2H3v3a5 5 0 0 0 5 5m9-8h4v3a5 5 0 0 1-5 5m-4 1v6m-5 1h10"/></>, clock: <><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>, check: <path d="m5 12 4 4L19 6"/>, close: <path d="m6 6 12 12M6 18 18 6"/>, chevron: <path d="m9 5 7 7-7 7"/> }; return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.bolt}</svg>; }
const coreTokenKey = 'spotkick:core-token';
function sessionToken() { return sessionStorage.getItem(coreTokenKey) ?? localStorage.getItem('spotkick:token'); }
function handleSessionExpiry(status?: number) {
    if (status !== 401 || !sessionStorage.getItem(coreTokenKey)) return;
    sessionStorage.removeItem(coreTokenKey);
    window.location.reload();
}
async function request(path: string, body?: unknown) { const token = sessionToken(); const res = await fetch(`${API}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) }); const data = await res.json();
    if (path !== '/session') handleSessionExpiry(res.status);
    if (!res.ok)
    throw new Error(data.error || 'The server could not complete this request'); return data; }
function secretKey(m: MatchView, user: string) { return `spotkick:choice:${m.id}:${m.exchange}:${user}`; }
function ZoneButtons({ disabled, onPick, selected, keeper = false }: {
    disabled: boolean;
    onPick: (z: Zone) => void;
    selected?: Zone;
    keeper?: boolean;
}) { return <div className="zone-buttons">{zones.map((z, i) => <button key={z} disabled={disabled} className={selected === z ? 'selected' : ''} onClick={() => onPick(z)} aria-label={`${keeper ? 'Dive' : 'Shoot'} ${z}`}><span>{['↖', '↑', '↗'][i]}</span><strong>{z[0].toUpperCase() + z.slice(1)}</strong><small>{keeper ? 'Dive' : 'Shoot'} {z}</small></button>)}</div>; }
export function SpotKick({ initialMode }: {
    initialMode: Mode;
}) {
    const [coreMode, setCoreMode] = useState(false), [needsLogin, setNeedsLogin] = useState(false);
    const [mode, setMode] = useState<Mode>(initialMode), [me, setMe] = useState<Me | null>(null), [lobby, setLobby] = useState<LobbyView>(emptyLobby), [connected, setConnected] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false), [stake, setStake] = useState(1000), [queued, setQueued] = useState(false), [match, setMatch] = useState<MatchView | null>(null), [solo, setSolo] = useState<SoloView | null>(null), [seed, setSeed] = useState<{
        id: string;
        hash: string;
    } | null>(null), [clientSeed, setClientSeed] = useState('my-first-kick'), [now, setNow] = useState(Date.now()), [selected, setSelected] = useState<Zone>(), [modal, setModal] = useState<'rules' | 'wallet' | null>(null), [journal, setJournal] = useState<any[]>([]), [queueStarted, setQueueStarted] = useState(0);
    const socket = useRef<Socket | null>(null), meRef = useRef<Me | null>(null), matchRef = useRef<MatchView | null>(null), revealing = useRef(''), mounted = useRef(true), refreshSeq = useRef(0);
    const modalTrigger = useRef<HTMLElement | null>(null);
    const openModal = (next: 'rules' | 'wallet') => {
        modalTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setModal(next);
    };
    useEffect(() => {
        if (!modal) return;
        const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
        if (!dialog) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setModal(null);
                return;
            }
            if (event.key !== 'Tab') return;
            const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
                'button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
            )).filter(control => control.getClientRects().length > 0);
            const first = controls[0], last = controls.at(-1);
            const outside = !dialog.contains(document.activeElement);
            if (event.shiftKey && (document.activeElement === first || outside)) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && (document.activeElement === last || outside)) {
                event.preventDefault();
                first?.focus();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            if (modalTrigger.current?.isConnected) modalTrigger.current.focus();
        };
    }, [modal]);
    const acceptMatch = useCallback((next: MatchView) => { setMatch(old => { if (old?.id === next.id && old.version > next.version)
        return old; matchRef.current = next; return next; }); setQueued(false); }, []);
    const call = useCallback(<T,>(event: string, data: unknown) => new Promise<T>((resolve, reject) => { if (!socket.current?.connected)
        return reject(new Error('Reconnecting to the arena. Please wait.')); socket.current.timeout(8000).emit(event, data, (err: Error | null, response: {
        ok: boolean;
        data: T;
        error?: string;
        status?: number;
    }) => { if (err)
        return reject(new Error('Connection timed out. Your game is safe; reconnecting.'));
        if (!response.ok) {
            handleSessionExpiry(response.status);
            return reject(new Error(response.error));
        }
        resolve(response.data); }); }), []);
    const loadMatch = useCallback(async (id: string) => { const snapshot = await call<MatchView>('match:join', { id }); acceptMatch(snapshot); }, [call, acceptMatch]);
    const refresh = useCallback(async () => { const seq = ++refreshSeq.current; const u = await request('/me'); if (!mounted.current || seq !== refreshSeq.current)
        return; setMe(u); meRef.current = u; setQueued(!!u.queue_stake); if (u.active_game?.startsWith('match:'))
        await loadMatch(u.active_game.slice(6)); if (u.active_game?.startsWith('solo:')) {
        const next = await request(`/solo/${u.active_game.slice(5)}`);
        if (seq === refreshSeq.current)
            setSolo(old => old && old.id === next.id && (old.nonce > next.nonce || old.status !== 'ACTIVE' && next.status === 'ACTIVE') ? old : next);
    } }, [loadMatch]);
    useEffect(() => {
        mounted.current = true;
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        let cancelled = false;
        async function init() {
            try {
                const config = await request('/mode');
                if (cancelled) return;
                const core = config.mode === 'core';
                setCoreMode(core);
                if (core && initialMode === 'solo') setMode('arena');
                if (core && !sessionStorage.getItem(coreTokenKey)) {
                    setNeedsLogin(true);
                    return;
                }
                if (core) await request('/me');
                if (!core) sessionStorage.removeItem(coreTokenKey);
                if (!core && !localStorage.getItem('spotkick:token')) {
                    const s = await request('/session', {});
                    localStorage.setItem('spotkick:token', s.token);
                }
                if (cancelled)
                    return;
                const s = io(API, { transports: ['websocket'], auth: { token: sessionToken() }, reconnectionDelay: 750 });
                socket.current = s;
                s.on('ready', () => { setConnected(true); setError(''); void refresh().catch(e => setError(e.message)); });
                s.on('disconnect', () => setConnected(false));
                s.on('session:expired', () => handleSessionExpiry(401));
                s.on('connect_error', () => { setConnected(false); setError('The arena is offline. Check the API connection and retry.'); });
                s.on('lobby', setLobby);
                s.on('match', acceptMatch);
                s.on('account', (v: {
                    matchId?: string;
                }) => { void refresh().catch(e => setError(e.message)); if (v.matchId) {
                    setMode('arena');
                    void loadMatch(v.matchId).catch(e => setError(e.message));
                } });
                heartbeat = setInterval(() => { if (s.connected) {
                    void call('heartbeat', {}).catch(() => { });
                    void refresh().catch(() => { });
                } }, 5000);
                const l = await request('/lobby');
                if (!cancelled)
                    setLobby(l);
            }
            catch (e) {
                if (!cancelled)
                    setError(e instanceof Error ? e.message : 'Could not connect');
            }
        }
        void init();
        try {
            const last = localStorage.getItem('spotkick:lastSolo');
            if (last)
                setSolo(JSON.parse(last));
        }
        catch { }
        return () => { cancelled = true; mounted.current = false; if (heartbeat)
            clearInterval(heartbeat); socket.current?.disconnect(); };
    }, [refresh, acceptMatch, call, loadMatch, initialMode]);
    useEffect(() => { const t = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(t); }, []);
    useEffect(() => { if (!coreMode && mode === 'solo' && me && solo?.status !== 'ACTIVE')
        void request('/solo/seed', {}).then(setSeed).catch(e => setError(e.message)); }, [coreMode, mode, me?.id, solo?.status]);
    useEffect(() => { if (!match || !me || !connected || !match.phase.endsWith('_REVEAL') || match.revealed.includes(me.id))
        return; const key = secretKey(match, me.id), saved = sessionStorage.getItem(key); if (!saved || revealing.current === key)
        return; revealing.current = key; const { choice, salt } = JSON.parse(saved); void call<MatchView>('choice:reveal', { matchId: match.id, exchange: match.exchange, choice, salt }).then(acceptMatch).catch(e => setError(e.message)).finally(() => { revealing.current = ''; }); }, [match, me, connected, call, acceptMatch]);
    useEffect(() => { setSelected(undefined); }, [match?.exchange, solo?.nonce]);
    const act = async (fn: () => Promise<void>) => { setBusy(true); setError(''); try {
        await fn();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Try again');
    }
    finally {
        setBusy(false);
    } };
    const canStartMatch = !busy && connected && !!me && BigInt(stake) <= BigInt(me.balance);
    const find = () => act(async () => { await call('queue:join', { stake }); setQueued(true); setQueueStarted(Date.now()); });
    const practice = () => act(async () => {
        const { id } = await call<{ id: string }>('match:practice', { stake });
        await loadMatch(id);
    });
    const pick = (choice: Zone) => act(async () => {
        if (!match || !me) return;
        const key = secretKey(match,me.id);
        const saved = sessionStorage.getItem(key);
        // An acknowledgement can be lost after the server accepted a commitment.
        // Retrying must preserve that exact secret, including across reloads.
        const secret: {choice:Zone;salt:string} = saved ? JSON.parse(saved) : {
            choice,
            salt:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')
        };
        setSelected(secret.choice);
        sessionStorage.setItem(key,JSON.stringify(secret));
        const hash=await commitment(match.id,match.exchange,me.id,secret.choice,secret.salt);
        acceptMatch(await call<MatchView>('choice:commit',{matchId:match.id,exchange:match.exchange,hash}));
    });
    const startSolo = () => act(async () => { if (!seed)
        return; const next = await request('/solo/start', { stake, seedId: seed.id, clientSeed, key: crypto.randomUUID() }); setSolo(next); await refresh(); });
    const soloAction = (choice?: Zone) => act(async () => { if (!solo)
        return; const next = await request(choice ? '/solo/shoot' : '/solo/cashout', { id: solo.id, key: crypto.randomUUID(), nonce: solo.nonce, ...(choice ? { choice } : {}) }); setSolo(next); if (next.status !== 'ACTIVE')
        localStorage.setItem('spotkick:lastSolo', JSON.stringify(next)); await refresh(); });
    const finished = match?.phase === 'SETTLED' || match?.phase === 'ABANDONED', inMatch = !!match && mode === 'arena', isKeeper = !!match && !!me && match.players[match.shooter].id !== me.id;
    const result = inMatch && (match.phase === 'RESOLVED' || finished) ? match.results.at(-1) : undefined;
    const walletIssue = match?.walletIssue && {
        responsible_gaming: 'The stake was declined by responsible gaming checks.',
        insufficient_funds: 'A player has insufficient funds for this stake.',
        wallet_unavailable: finished
            ? (match.settlementId ? 'Wallet processing failed. The stakes were returned.' : 'The wallet could not confirm the stake.')
            : 'Wallet processing needs review. The match is on hold.',
    }[match.walletIssue];
    const soloResult = mode === 'solo' ? solo?.history.at(-1) : undefined;
    const countdown = match ? Math.max(0, Math.ceil((match.deadline - now) / 1000)) : 10;
    const openWallet = () => { openModal('wallet'); void request('/wallet').then(setJournal).catch(e => setError(e.message)); };
    const isLobby = mode === 'arena' && !inMatch;
    const currency = coreMode ? '€' : 'S';
    const balance = me ? money(me.balance) : '—';
    const lobbyPayout = pvpPayout(stake, lobby.config.rakeBps);
    const wallet = (className: string) => (
        <button className={className} onClick={openWallet} aria-label="View wallet ledger">
            {isLobby ? <span>Balance</span> : <span className="coin">{coreMode ? '€' : 'S'}</span>}
            <b data-testid="balance">{balance}</b><Icon name="wallet" size={16}/>
        </button>
    );
    if (needsLogin) return <main className="app-shell">
        <section className="verify-page">
            <h1>Sign in with Platform Core</h1>
            <form onSubmit={e => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                void act(async () => {
                    const session = await request('/session', { email: form.get('email'), password: form.get('password') });
                    sessionStorage.setItem(coreTokenKey, session.token);
                    window.location.reload();
                });
            }}>
                <p><label>Email <input name="email" type="email" autoComplete="username" required /></label></p>
                <p><label>Password <input name="password" type="password" autoComplete="current-password" required /></label></p>
                <button disabled={busy}>Sign in</button>
            </form>
            {error && <p role="alert">{error}</p>}
        </section>
    </main>;
    return <div className={mode === 'arena' ? 'app-shell compact-arena' : 'app-shell'}>
    <header className="site-header">
      <a className="brand" href="/" aria-label="SpotKick home">
        <span className="brand-mark"><Ball size={24}/></span>spotkick<span className="brand-period">.</span>
      </a>
      {mode !== 'arena' && <nav aria-label="Main navigation">
        <a href="/">Arena</a>{!coreMode && <a href="/solo" className={mode === 'solo' ? 'active' : ''}>Solo run</a>}
        <button onClick={() => openModal('rules')}>How to play</button>
        <a href="/verify" className={mode === 'verify' ? 'active' : ''}>Fairness <Icon name="shield" size={14}/></a>
      </nav>}
      <div className="header-account">
        {mode === 'arena' ? <>
          <span className={connected ? 'console-status is-live' : 'console-status'}>
            <i className="status-dot"/>{connected ? 'Live arena' : 'Connecting'}
          </span>
          {!isLobby && wallet('wallet-button')}
          <details className="console-menu">
            <summary aria-label="Game menu"><span className="menu-lines" aria-hidden="true"/></summary>
            <div className="console-menu-links">
              {!coreMode && <a href="/solo">Solo run</a>}
              <button onClick={() => openModal('rules')}>How to play</button>
              <a href="/verify">Fairness verifier</a>
            </div>
          </details>
        </> : <>
          <span className="demo-tag">{coreMode ? 'Core wallet' : 'Play money'}</span>
          {wallet('wallet-button')}
          <span className="avatar header-avatar">{me?.name.slice(-2) || 'SK'}</span>
        </>}
      </div>
    </header>
    <main>
      {mode !== 'arena' && <div className="status-strip"><span><i className={`status-dot ${connected ? 'on' : ''}`}/>{connected ? 'Arena connected' : 'Connecting to arena'}<span className="status-divider"/> <span>{lobby.online.length} online</span></span><span className="status-fair"><Icon name="shield" size={14}/> {coreMode ? 'EUR wallet. Take breaks.' : 'Play money only. Take breaks.'}</span></div>}
      {walletIssue && !finished && <div className="error-banner" role="status">{walletIssue}</div>}
      {error && <div className="error-banner" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><Icon name="close" size={16}/></button></div>}
      {mode === 'verify' ? <VerifyPanel solo={solo}/> : <>
      {mode === 'arena' ? <h1 className="sr-only">SpotKick penalty shootout</h1> : <section className="intro"><div><div className="intro-kicker"><span className="mini-line"/>{mode === 'solo' ? 'You against the odds' : 'The beautiful game. Down to one kick.'}</div><h1>{inMatch ? (finished ? 'The final whistle.' : `Make your moment.`) : mode === 'solo' ? 'How far can you go?' : <>Small margins.<br />Big moments.</>}</h1><p>{inMatch ? (finished ? 'Every kick counted. Your result is on the board.' : 'Pick a zone. Trust your instinct. Both choices stay hidden until the reveal.') : mode === 'solo' ? 'Beat the keeper. Build your multiplier. Decide when to walk away.' : 'Outthink your opponent in a live penalty shootout.\nThree rounds. Three zones. Everything to play for.'}</p></div><div className="intro-aside"><span className="outline-ball"><Ball size={22}/></span><p>{mode === 'solo' ? 'A little nerve.\nA lot of instinct.' : '90 minutes of drama.\nSix kicks of football.'}</p></div></section>}
      <div className={isLobby ? 'arena-layout lobby-console' : 'arena-layout'}><section className="arena-card" aria-label="Penalty arena"><div className="arena-card-header"><div><span className="live-label"><i />{inMatch && !finished ? 'In play' : 'The arena'}</span><span className="arena-kind">{mode === 'solo' ? 'Solo run' : inMatch ? `Round ${match.round > 3 ? `SD ${match.round - 3}` : match.round} / 3` : 'Head to head'}</span></div><span className="arena-format"><Icon name="users" size={15}/>{mode === 'solo' ? '1 player' : inMatch ? `${match.players.some(p => p.bot) ? 'Bot opponent' : 'Live PvP'}` : '1 vs 1'}<span />3 zones</span></div>
        {inMatch && <div className="scoreboard" data-testid="scoreboard"><div><span className="avatar">{match.players[0].name.slice(-2)}</span><strong>{match.players[0].id === me?.id ? 'You' : match.players[0].name}</strong></div><span className="score" data-testid="score">{match.score[0]} <i>:</i> {match.score[1]}</span><div><strong>{match.players[1].id === me?.id ? 'You' : match.players[1].name}</strong><span className="avatar opponent">{match.players[1].bot ? 'AI' : match.players[1].name.slice(-2)}</span></div></div>}
        <Pitch preview={isLobby} active={inMatch && !finished || mode === 'solo' && solo?.status === 'ACTIVE'} role={isKeeper ? 'keeper' : 'shooter'} result={result ? { ...result, key: result.index } : soloResult ? { ...soloResult, key: soloResult.nonce } : undefined}/>
        <div className="arena-caption"><div><Icon name={inMatch && finished ? 'cup' : 'shield'} size={18}/><span>{inMatch && finished ? (match.phase === 'ABANDONED' ? (walletIssue && !match.settlementId ? 'Stake declined' : 'Match refunded') : match.winner === me?.id ? 'You take the win. Well played.' : `${match.players.find(p => p.id === match.winner)?.name} takes the win.`) : inMatch ? match.phase === 'RESOLVED' ? (result?.goal ? 'Goal! Into the back of the net.' : 'Saved! The keeper read that one.') : `${isKeeper ? 'You’re keeping goal' : 'You’re taking the shot'} · ${match.phase.endsWith('_REVEAL') ? 'Revealing choices' : match.committed.includes(me?.id || '') ? 'Choice locked in' : 'Choose your zone'}` : mode === 'solo' ? 'The keeper’s seed is committed before you play.' : 'Your opponent’s choice is hidden. So is yours.'}</span></div><span className="caption-pill">{inMatch && !finished ? <><Icon name="clock" size={14}/><b data-testid="countdown">{countdown}s</b></> : <><span className="tiny-dot"/> {mode === 'solo' ? 'Provably fair' : 'Commit & reveal'}</>}</span></div>
        {inMatch && !finished && <div className="match-controls"><ZoneButtons disabled={busy || !connected || !match.phase.endsWith('_COMMIT') || match.committed.includes(me?.id || '')} onPick={pick} selected={selected} keeper={isKeeper}/><p className="control-hint">{match.phase === 'RESOLVED' ? 'Next kick in a moment.' : match.phase.endsWith('_REVEAL') ? 'Both choices are locked. Verifying the reveal…' : match.committed.includes(me?.id || '') ? 'Locked in. Waiting for your opponent…' : '10 seconds to choose. A timeout picks a random zone.'}</p></div>}
        {mode === 'solo' && solo?.status === 'ACTIVE' && <div className="match-controls"><ZoneButtons disabled={busy || !connected} onPick={z => soloAction(z)} selected={selected}/><p className="control-hint">A goal grows your return. A save ends the run.</p></div>}
      </section>
      {isLobby && <ArenaActivity lobby={lobby} connected={connected} guestId={me?.id} coreMode={coreMode}/>}
      {!isLobby && <aside className="match-panel">{inMatch ? <><div className="panel-title"><span className="panel-icon"><Icon name="cup"/></span><div><h2>{finished ? 'Match result' : 'The shootout'}</h2><p>{finished ? 'The stakes are settled.' : match.players.some(p => p.bot) ? 'The bot picks each zone with equal probability.' : 'Both players. Equal chances.'}</p></div></div><div className="pot-display"><span>Match pot</span><strong><span className="coin">{coreMode ? '€' : 'S'}</span>{money(match.pot)}</strong><small>{money(match.stake)} from each player</small></div><div className="round-table"><div><span>Round</span><span>You</span><span>Rival</span></div>{Array.from({ length: Math.max(3, match.round) }, (_, i) => i + 1).map(r => <div key={r} className={r === match.round ? 'current' : ''}><span>{r > 3 ? `Sudden death ${r - 3}` : `Round ${r}`}<small>{r <= 3 ? `${r} pt` : '1 pt'}</small></span>{[me?.id, match.players.find(p => p.id !== me?.id)?.id].map((id, j) => { const shot = match.results.find(x => x.round === r && match.players[x.shooter].id === id); return <span key={j} className={shot ? (shot.goal ? 'goal-dot' : 'save-dot') : ''}>{shot ? (shot.goal ? `+${shot.points}` : '—') : '·'}</span>; })}</div>)}</div><div className="panel-summary"><span>Winner’s payout</span><b>{money(match.pot - Math.floor(match.pot * match.rakeBps / 10000))} {currency}</b><span>Arena fee</span><span>{match.rakeBps / 100}%</span></div>{finished ? <><div className={`match-result ${match.winner === me?.id ? 'won' : ''}`} data-testid="match-result"><Icon name="cup" size={28}/><h3>{match.phase === 'ABANDONED' ? (match.settlementId || !walletIssue ? 'Stakes returned' : 'Stake declined') : match.winner === me?.id ? 'That’s your moment.' : 'A worthy opponent.'}</h3><p>{walletIssue || (match.winner === me?.id ? `${money(match.payout || 0)} ${currency} added to your wallet.` : 'Play again when you’re ready.')}</p></div><button className="primary-button" onClick={() => { setMatch(null); matchRef.current = null; void refresh(); }}>Back to lobby <Icon name="arrow"/></button><PvpAudit match={match}/></> : <div className="locked-note"><Icon name="shield"/><span>Both stakes are held in escrow until the final whistle.</span></div>}</> : mode === 'solo' ? <><div className="panel-title"><span className="panel-icon"><Icon name="bolt"/></span><div><h2>Your solo run</h2><p>One more kick, or call it?</p></div></div>{solo?.status === 'ACTIVE' ? <><div className="pot-display"><span>Cash-out value</span><strong><span className="coin">{coreMode ? '€' : 'S'}</span>{money(solo.payout)}</strong><small>{solo.goals} {solo.goals === 1 ? 'goal' : 'goals'} · {(0.99 * 1.5 ** solo.goals).toFixed(3)}× multiplier</small></div><button className="primary-button" onClick={() => soloAction()} disabled={busy || solo.goals < 1}>Cash out {solo.goals ? `${money(solo.payout)} S` : ''}<Icon name="wallet"/></button><p className="control-hint">{solo.goals ? 'Your call. Bank it or take another shot.' : 'Score your first goal to unlock cash-out.'}</p></> : <><StakeSelector stake={stake} setStake={setStake} balance={me?.balance}/><label className="input-label" htmlFor="client-seed">Your client seed</label><input id="client-seed" className="text-input" maxLength={128} value={clientSeed} onChange={e => setClientSeed(e.target.value)}/><div className="seed-box"><span><Icon name="shield" size={14}/> Server seed commitment</span><code title={seed?.hash}>{seed?.hash || 'Connecting to the fairness service…'}</code></div>{solo && <p className="solo-outcome" role="status">{solo.status === 'LOST' ? 'Saved. Your run ends here.' : `You banked ${money(solo.payout)} S.`} <button onClick={() => setMode('verify')}>Verify this run</button></p>}<button className="primary-button" onClick={startSolo} disabled={!connected || !seed || busy || !clientSeed.trim()}>Start solo run <Icon name="arrow"/></button></>}<div className="ladder"><h3>The cash-out ladder</h3>{Array.from({ length: 5 }, (_, i) => i + 1).map(k => <div key={k} className={solo?.status === 'ACTIVE' && solo.goals === k ? 'current' : ''}><span>{k} {k === 1 ? 'goal' : 'goals'}</span><strong>{(0.99 * 1.5 ** k).toFixed(3)}×</strong><span>{money(soloPayout(solo?.status === 'ACTIVE' ? solo.stake : stake, k))} S</span></div>)}</div><p className="control-hint">2 in 3 chance to score. A save loses your stake. Theoretical return up to 99% before rounding.</p></> : null}</aside>}
      {isLobby && <section className="console-controls" aria-label="Match setup">
        <div className="console-stats">
          {wallet('console-stat console-balance')}
          <div className="console-stat console-stake">
            <span>Your stake</span><b>{money(stake)} <small>{coreMode ? '€' : 'S'}</small></b>
          </div>
        </div>
        <StakeSelector stake={stake} setStake={setStake} balance={me?.balance} disabled={queued} currency={currency}/>
        {queued ? <div className="console-queue">
          <button className="primary-button searching" disabled><span className="spinner"/>Finding your opponent…</button>
          <p className="queue-note" role="status">
            {Math.floor((now - (queueStarted || now)) / 1000)}s searching
            {!coreMode && ` · A bot joins after ${lobby.config.botAfterMs / 1000}s.`}
          </p>
          <button className="text-button cancel-queue" onClick={() => act(async () => {
            await call('queue:cancel', {});
            setQueued(false);
          })}>Cancel search</button>
        </div> : <div className={coreMode ? 'console-actions' : 'console-actions has-practice'}>
          <button className="primary-button" onClick={find} disabled={!canStartMatch}>Find match <Icon name="arrow" size={17}/></button>
          {!coreMode && <button className="secondary-button" onClick={practice} disabled={!canStartMatch}>
            <Icon name="bolt" size={16}/> Practice vs bot
          </button>}
        </div>}
        <p className="console-fee">Winner receives <b>{money(lobbyPayout.payout)} {coreMode ? '€' : 'S'}</b>
          <span>{lobby.config.rakeBps / 100}% arena fee · {money(lobbyPayout.rake)} {coreMode ? '€' : 'S'}</span>
        </p>
      </section>}
      </div>
      {isLobby && <section className="console-recent" aria-label="Recent results">
        <h2>Recent results</h2>
        {lobby.recent.length ? <ul>{lobby.recent.slice(0, 5).map(match => <li key={match.id}>
          <span>{match.winner}</span><b>{match.score.join(' : ')}</b>
        </li>)}</ul> : <p>Results will appear after the first match.</p>}
      </section>}
      {mode === 'solo' && <section className="how-row" aria-label="How the shootout works"><div><span className="step-number">1</span><div><h3>Pick your stake</h3><p>Equal stakes. One shared pot.</p></div></div><div><span className="step-number">2</span><div><h3>Read your rival</h3><p>Shoot and keep in every round.</p></div></div><div><span className="step-number">3</span><div><h3>Make it count</h3><p>Goals earn 1, 2, then 3 points.</p></div></div></section>}
      {mode === 'solo' && <section className="lobby-section"><div className="section-heading"><h2>On the touchline <span className="count-badge">{lobby.online.length}</span></h2><span><span className="tiny-dot"/>{lobby.matches} {lobby.matches === 1 ? 'match' : 'matches'} in play</span></div><div className="lobby-columns"><div className="players-list">{lobby.online.length ? lobby.online.slice(0, 6).map((p, i) => <div className="player-row" key={p.id}><span className={`avatar color-${i % 3}`}>{p.name.slice(-2)}</span><div><b>{p.id === me?.id ? 'You' : p.name}</b><small>{p.id === me?.id ? 'Ready for your moment' : 'On the touchline'}</small></div><span className="online-dot"/></div>) : <p className="empty-state">The lights are on. Connect to join the touchline.</p>}</div><div className="recent-list"><h3><Icon name="cup" size={16}/> Recent final whistles</h3>{lobby.recent.length ? lobby.recent.slice(0, 4).map(r => <div key={r.id}><span>{r.winner}</span><span>{r.score.join(' : ')}</span><strong>+{money(r.payout)} S</strong></div>) : <p className="empty-state">The first result could be yours.<br />Completed matches appear here live.</p>}</div></div></section>}
      </>}
      <div className="responsible-notice"><Icon name="shield" size={21}/><p><strong>Keep it a game.</strong> {coreMode ? 'EUR wallet. Core enforces eligibility and limits.' : 'Play money only. No purchases, withdrawals or cash value.'} Take breaks and play responsibly.</p><span>Just for the love of the game.</span></div>
    </main><footer><a className="brand footer-brand" href="/">spotkick.</a><span>Every choice counts.</span><button onClick={() => openModal('rules')}>Game rules</button><a href="/verify">Fairness verifier</a><small>An original real-time multiplayer demo</small></footer>
    {modal && <div className="modal-backdrop" onClick={() => setModal(null)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={e => e.stopPropagation()}><button className="modal-close" onClick={() => setModal(null)} aria-label="Close dialog" autoFocus><Icon name="close"/></button><h2 id="modal-title">{modal === 'rules' ? 'Six kicks. All the drama.' : (coreMode ? 'Your Core wallet ledger' : 'Your play-money ledger')}</h2>{modal === 'rules' ? <><p>Both players stake the same amount. In each of three rounds, you shoot once and keep goal once.</p><ol><li>Choose left, centre or right. A matching keeper choice saves the shot.</li><li>Goals earn 1 point in round 1, 2 in round 2 and 3 in round 3.</li><li>A tie enters sudden death. Both players finish their shot before a winner is decided.</li><li>You have 10 seconds to choose. A timeout uses an auditable random zone.</li><li>The winner receives the pot minus the configured arena fee, 3% by default.</li></ol>{!coreMode && <><p>Solo mode: score to grow your payout, then cash out or keep shooting. A save loses your stake. The multiplier after k goals is 0.99 × 1.5ᵏ.</p><p className="control-hint">Guest sessions start with 1,000 S. These credits have no cash value. Preserve your browser’s session to keep your wallet.</p></>}</> : <><p>Every movement is recorded. Balance: <b>{me ? money(me.balance) : '—'} {coreMode ? 'EUR' : 'S'}</b></p><div className="journal">{journal.map((e, i) => <div key={i}><span>{e.operation.replaceAll('_', ' ').toLowerCase()}<small>{new Date(e.created_at).toLocaleString()}</small></span><b className={BigInt(e.amount) > 0 ? 'positive' : ''}>{BigInt(e.amount) > 0 ? '+' : ''}{money(e.amount)} {currency}</b></div>)}</div></>}</section></div>}
  </div>;
}
function ArenaActivity({ lobby, connected, guestId, coreMode }: {
    lobby: LobbyView;
    connected: boolean;
    guestId?: string;
    coreMode: boolean;
}) {
    return <aside className="console-activity" aria-label="Live arena activity">
        <div className="activity-heading">
            <h2>Live lobby</h2>
            <span><i className="status-dot on"/>{lobby.online.length} online</span>
        </div>
        <ul className="console-player-list" aria-label="Players online">
            {lobby.online.slice(0, 8).map((player, index) => <li key={player.id}>
                <span className={`avatar color-${index % 3}`}>{player.name.slice(-2)}</span>
                <span className="console-player-name">
                    <b>{player.id === guestId ? 'You' : player.name}</b>
                    <small>{player.id === guestId ? 'Ready to kick' : 'Online'}</small>
                </span>
                <span className="online-dot"/>
            </li>)}
            {!lobby.online.length && <li className="console-empty">
                {connected ? (coreMode ? 'Waiting for players to join.' : 'The pitch is yours. Start a practice match.') : 'Connecting to the arena…'}
            </li>}
        </ul>
        {lobby.online.length <= 2 && <div className="activity-rounds">
            <span>Points per goal</span>
            <ol aria-label="Points per goal in rounds one through three">
                {[1, 2, 3].map(points => <li key={points}><small>R{points}</small><b>{points}</b></li>)}
            </ol>
        </div>}
        <div className="activity-footer"><Icon name="bolt" size={14}/>{lobby.matches} {lobby.matches === 1 ? 'match' : 'matches'} in play</div>
    </aside>;
}
function StakeSelector({ stake, setStake, balance, disabled = false, currency = 'S' }: {
    stake: number;
    setStake: (s: number) => void;
    balance?: number | string;
    disabled?: boolean;
    currency?: '€' | 'S';
}) { return <div className="stake-selector"><div className="stake-label"><label>Choose your stake</label><span>Available: {balance === undefined ? '—' : money(balance)} {currency}</span></div><div className="stake-options">{[500, 1000, 2500, 5000].map(n => <button key={n} className={stake === n ? 'selected' : ''} onClick={() => setStake(n)} disabled={disabled || balance !== undefined && BigInt(balance) < BigInt(n)} aria-pressed={stake === n}><span className="coin small">{currency}</span>{money(n)}</button>)}</div></div>; }
function PvpAudit({ match }: {
    match: MatchView;
}) { const [report, setReport] = useState(''); async function verify() { const m = match as MatchView & {
    audit?: {
        exchange: number;
        commitments: Record<string, string>;
        reveals: Record<string, {
            choice: Zone;
            salt: string;
        }>;
        timeouts: string[];
    }[];
}; if (!m.timeoutSeed || !m.audit)
    return setReport('Transcript unavailable'); let ok = await sha256(m.timeoutSeed) === m.timeoutSeedHash; for (const a of m.audit)
    for (const p of m.players) {
        const r = a.reveals[p.id];
        if (a.timeouts.includes(p.id)) {
            ok = ok && r.choice === await fairZone(m.timeoutSeed, `timeout:${m.id}:${p.id}`, a.exchange);
        }
        else
            ok = ok && await commitment(m.id, a.exchange, p.id, r.choice, r.salt) === a.commitments[p.id];
        if (p.bot && !a.timeouts.includes(p.id))
            ok = ok && r.choice === await botZone(m.timeoutSeed, p.id, a.exchange);
    } setReport(ok ? (m.players.some(p => p.bot) ? 'Verified: seed, commitments, timeout and bot choices match.' : 'Verified: seed, commitments and timeout choices match.') : 'Verification failed. Inspect the transcript.'); } return <details className="audit"><summary>Inspect match fairness</summary><p>Timeout seed hash</p><code>{match.timeoutSeedHash}</code><p>Revealed timeout seed</p><code>{match.timeoutSeed}</code><button className="secondary-button" onClick={verify}>Verify match transcript</button><p role="status">{report}</p></details>; }
function VerifyPanel({ solo }: {
    solo: SoloView | null;
}) { const [serverSeed, setServerSeed] = useState(''), [hash, setHash] = useState(''), [client, setClient] = useState(''), [nonce, setNonce] = useState('0'), [report, setReport] = useState<{
    ok: boolean;
    zone: Zone;
    digest: string;
    hash: string;
} | null>(null), [err, setErr] = useState(''); useEffect(() => { if (solo?.serverSeed) {
    setServerSeed(solo.serverSeed);
    setHash(solo.serverSeedHash);
    setClient(solo.clientSeed);
    setNonce(String(Math.max(0, solo.nonce - 1)));
} }, [solo]); async function verify() { setErr(''); try {
    if (!serverSeed || !hash || !client || !/^\d+$/.test(nonce) || !Number.isSafeInteger(Number(nonce)))
        throw new Error('Enter the revealed seed, original hash, client seed and a valid nonce.');
    const actual = await sha256(serverSeed), zone = await fairZone(serverSeed, client, Number(nonce)), digest = await hmac256(serverSeed, `${client}:${nonce}`);
    setReport({ ok: actual === hash.toLowerCase(), zone, digest, hash: actual });
}
catch (e) {
    setErr(e instanceof Error ? e.message : 'Could not verify');
} } return <section className="verify-page"><div className="verify-intro"><span className="large-shield"><Icon name="shield" size={38}/></span><h1>Trust the maths.<br />Check the kick.</h1><p>The house commits to its server seed before your run. When it ends, the seed is revealed. Reproduce every keeper choice here, entirely in your browser.</p><div className="fairness-steps"><div><b>Before you play</b><p>Keep the server seed’s SHA-256 hash. Choose your own client seed.</p></div><div><b>For every shot</b><p>HMAC-SHA256(serverSeed, clientSeed:nonce) determines the keeper’s zone. Nonces start at zero.</p></div><div><b>After the whistle</b><p>Check the revealed seed against its hash, then reproduce the outcome.</p></div></div><p className="control-hint">The digest is interpreted as an unsigned integer and mapped modulo 3: left, centre, right. An all-ff digest is rejected and retried to remove modulo bias.</p></div><div className="verify-form"><h2>The fairness verifier</h2><p>{solo?.serverSeed ? 'Your last completed run is loaded below.' : 'Finish a solo run to reveal its seed, or paste a transcript.'}</p><label htmlFor="seed-hash">Original server seed hash</label><textarea id="seed-hash" value={hash} onChange={e => setHash(e.target.value)} placeholder="The hash shown before playing"/><label htmlFor="server-seed">Revealed server seed</label><textarea id="server-seed" value={serverSeed} onChange={e => setServerSeed(e.target.value)} placeholder="Available after your run ends"/><label htmlFor="verify-client">Client seed</label><input id="verify-client" value={client} onChange={e => setClient(e.target.value)}/><label htmlFor="verify-nonce">Shot nonce (starts at 0)</label><input id="verify-nonce" type="number" min="0" value={nonce} onChange={e => setNonce(e.target.value)}/><button className="primary-button" onClick={verify}>Verify this shot <Icon name="shield"/></button>{err && <p role="alert" className="verify-failed">{err}</p>}{report && <div className={report.ok ? 'verification-result' : 'verification-result failed'} role="status"><strong>{report.ok ? 'Seed commitment matches' : 'Seed commitment does not match'}</strong><p>Keeper’s zone: <b>{report.zone}</b></p><small>HMAC-SHA256 digest</small><code>{report.digest}</code></div>}</div>{solo?.serverSeed && <div className="verification-history"><h2>Your run transcript</h2><div><b>Nonce</b><b>Your shot</b><b>Keeper</b><b>Outcome</b></div>{solo.history.map(s => <div key={s.nonce}><span>{s.nonce}</span><span>{s.shot}</span><span>{s.keeper}</span><span>{s.goal ? 'Goal' : 'Save'}</span></div>)}</div>}</section>; }
