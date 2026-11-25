// src/components/ScratchOffStore.jsx
// Player-facing scratch-off tickets, rendered at the top of the Slots Store tab.
// Buying draws the outcome server-side; the player then scratches a 3×3 grid
// on a canvas. Match 3 of the same icon to win — the winning three are
// highlighted loudly so the result is obvious without reading anything.

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import {
  SCRATCH_SYMBOL_IMAGES, computeOdds, formatOneIn, findWinCells,
  fetchScratchGames, fetchMyScratchTickets, buyScratchTicket, revealScratchTicket,
} from '../lib/scratchoff';

const TIER_NAMES = ['GRAND PRIZE', '2nd Prize', '3rd Prize', '4th Prize', '5th Prize', '6th Prize', '7th Prize', '8th Prize', '9th Prize'];

// ─── Icon helpers ─────────────────────────────────────────────────────────────

function makeIconResolver(games, symbolSrc) {
  // cell key → { src, tier|null }
  return (key, gameId) => {
    if (key?.startsWith('s:')) {
      const sym = key.slice(2);
      return { src: symbolSrc?.(sym) || SCRATCH_SYMBOL_IMAGES[sym], tier: null };
    }
    const game = games.find(g => g.id === gameId);
    const tier = game?.tiers.find(t => t.id === key) ?? null;
    if (!tier) return { src: null, tier: null };
    return { src: tier.icon_url || symbolSrc?.(tier.icon) || SCRATCH_SYMBOL_IMAGES[tier.icon], tier };
  };
}

function tierSrc(tier, symbolSrc) {
  return tier.icon_url || symbolSrc?.(tier.icon) || SCRATCH_SYMBOL_IMAGES[tier.icon];
}

// ─── Scratch canvas ───────────────────────────────────────────────────────────

const GRID_PX = 300;          // CSS size of the play area
const CELL_PX = GRID_PX / 3;
const BRUSH = 22;             // scratch radius in CSS px
const CELL_CLEAR_AT = 0.45;   // fraction of a cell scratched before it auto-clears

function ScratchGrid({ ticket, resolveIcon, onAllRevealed, alreadyScratched, winCells, theme }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastRef = useRef(null);
  const movesRef = useRef(0);
  const [revealed, setRevealed] = useState(() => Array(9).fill(!!alreadyScratched));
  const revealedRef = useRef(revealed);
  const doneRef = useRef(!!alreadyScratched);

  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;

  // Paint the silver coating
  useEffect(() => {
    if (alreadyScratched) return;
    const c = canvasRef.current;
    if (!c) return;
    c.width = GRID_PX * dpr;
    c.height = GRID_PX * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    for (let i = 0; i < 9; i++) {
      const x = (i % 3) * CELL_PX, y = Math.floor(i / 3) * CELL_PX;
      const g = ctx.createLinearGradient(x, y, x + CELL_PX, y + CELL_PX);
      g.addColorStop(0, '#d9d9d9'); g.addColorStop(0.45, '#9e9e9e'); g.addColorStop(0.55, '#c8c8c8'); g.addColorStop(1, '#8a8a8a');
      ctx.fillStyle = g;
      ctx.fillRect(x + 3, y + 3, CELL_PX - 6, CELL_PX - 6);
      ctx.fillStyle = 'rgba(80,80,80,0.55)';
      ctx.font = 'bold 26px Segoe UI, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', x + CELL_PX / 2, y + CELL_PX / 2);
    }
  }, [alreadyScratched, dpr]);

  const markRevealed = useCallback((idxs) => {
    const next = [...revealedRef.current];
    let changed = false;
    for (const i of idxs) if (!next[i]) { next[i] = true; changed = true; }
    if (!changed) return;
    revealedRef.current = next;
    setRevealed(next);
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000'; // must be fully opaque or destination-out only partly erases
      for (const i of idxs) ctx.fillRect((i % 3) * CELL_PX, Math.floor(i / 3) * CELL_PX, CELL_PX, CELL_PX);
      ctx.restore();
    }
    if (next.every(Boolean) && !doneRef.current) {
      doneRef.current = true;
      onAllRevealed();
    }
  }, [onAllRevealed]);

  const measureCells = useCallback((cells) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const done = [];
    for (const i of cells) {
      if (revealedRef.current[i]) continue;
      const x = Math.round(((i % 3) * CELL_PX + 3) * dpr), y = Math.round((Math.floor(i / 3) * CELL_PX + 3) * dpr);
      const w = Math.round((CELL_PX - 6) * dpr);
      const data = ctx.getImageData(x, y, w, w).data;
      let clear = 0, total = 0;
      for (let p = 3; p < data.length; p += 16) { total++; if (data[p] < 64) clear++; }
      if (total && clear / total >= CELL_CLEAR_AT) done.push(i);
    }
    if (done.length) markRevealed(done);
  }, [dpr, markRevealed]);

  const pointAt = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * GRID_PX, y: ((e.clientY - r.top) / r.height) * GRID_PX };
  };

  const cellsNear = (p) => {
    const out = new Set();
    for (const dx of [-BRUSH, 0, BRUSH]) for (const dy of [-BRUSH, 0, BRUSH]) {
      const cx = Math.floor((p.x + dx) / CELL_PX), cy = Math.floor((p.y + dy) / CELL_PX);
      if (cx >= 0 && cx < 3 && cy >= 0 && cy < 3) out.add(cy * 3 + cx);
    }
    return [...out];
  };

  const scratchTo = (p) => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = BRUSH * 2;
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    const from = lastRef.current ?? p;
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.restore();
    lastRef.current = p;
    if (++movesRef.current % 6 === 0) measureCells(cellsNear(p));
  };

  const onDown = (e) => {
    if (doneRef.current) return;
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    drawingRef.current = true;
    lastRef.current = null;
    scratchTo(pointAt(e));
  };
  const onMove = (e) => { if (drawingRef.current) { e.preventDefault(); scratchTo(pointAt(e)); } };
  const onUp = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastRef.current = null;
    measureCells([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  };

  const revealAll = () => markRevealed([0, 1, 2, 3, 4, 5, 6, 7, 8]);

  const allShown = revealed.every(Boolean);
  const winSet = new Set(allShown ? (winCells ?? []) : []);
  const isWin = allShown && winSet.size === 3;

  return (
    <div>
      <div style={{ position: 'relative', width: GRID_PX, height: GRID_PX, margin: '0 auto', borderRadius: 10, background: '#fdf6e3', boxShadow: 'inset 0 0 0 3px #b8860b' }}>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(3, 1fr)' }}>
          {ticket.grid.map((cell, i) => {
            const { src } = resolveIcon(cell.k, ticket.game_id);
            const hot = winSet.has(i);
            return (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: 4, borderRadius: 8,
                background: hot ? 'radial-gradient(circle, #fff59d 0%, #ffd54f 60%, #ffb300 100%)' : 'transparent',
                border: hot ? '4px solid #ff6f00' : '4px solid transparent',
                boxShadow: hot ? '0 0 18px 4px #ffd700' : 'none',
                opacity: isWin && !hot ? 0.3 : 1,
                animation: hot ? 'scratchPulse 0.9s ease-in-out infinite' : 'none',
                transition: 'opacity 0.4s',
                position: 'relative',
              }}>
                {src && <img src={src} alt="" draggable={false} style={{ width: 62, height: 62, objectFit: 'contain', userSelect: 'none' }} />}
                {hot && <span style={{ position: 'absolute', top: -10, right: -8, fontSize: 22 }}>✅</span>}
              </div>
            );
          })}
        </div>
        {!alreadyScratched && (
          <canvas ref={canvasRef}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={onUp}
            style={{ position: 'absolute', inset: 0, width: GRID_PX, height: GRID_PX, borderRadius: 10, touchAction: 'none', cursor: allShown ? 'default' : 'crosshair', pointerEvents: allShown ? 'none' : 'auto' }} />
        )}
      </div>
      {!allShown && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <div style={{ fontSize: 13, color: '#bbb', marginBottom: 8 }}>👆 Rub the silver boxes to scratch</div>
          <button onClick={revealAll} style={{ background: 'none', border: `1px solid ${theme}`, color: '#ddd', borderRadius: 20, padding: '6px 16px', fontSize: 12, cursor: 'pointer' }}>
            Reveal all
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Ticket modal ─────────────────────────────────────────────────────────────

function TicketModal({ ticket, game, resolveIcon, symbolSrc, theme, actorId, onClose, onRevealed }) {
  const [phase, setPhase] = useState(ticket.scratched_at ? 'done' : 'scratching');
  const [revealError, setRevealError] = useState(null);
  const winCells = ticket.win_cells ?? findWinCells(ticket.grid);
  const tier = ticket.tier_id ? game?.tiers.find(t => t.id === ticket.tier_id) : null;
  const isWin = !!winCells && winCells.length === 3;

  const handleAllRevealed = useCallback(async () => {
    setPhase('done');
    try {
      await revealScratchTicket(ticket.id, actorId);
      onRevealed?.();
    } catch (e) {
      setRevealError(e.message);
    }
  }, [ticket.id, actorId, onRevealed]);

  return (
    <div style={m.backdrop} onClick={phase === 'done' ? onClose : undefined}>
      <style>{`
        @keyframes scratchPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
        @keyframes scratchBanner { 0% { transform: scale(0.6); opacity: 0; } 70% { transform: scale(1.1); opacity: 1; } 100% { transform: scale(1); } }
      `}</style>
      <div style={m.ticket} onClick={e => e.stopPropagation()}>
        <div style={{ ...m.ticketHead, background: `linear-gradient(135deg, ${theme}, #8b0000)` }}>
          <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: 1 }}>🎫 {game?.label || 'Scratch-Off'}</div>
          <div style={{ fontSize: 15, fontWeight: 800, marginTop: 4, color: '#FFD700' }}>MATCH 3 = WIN!</div>
        </div>

        <div style={{ padding: '16px 16px 8px' }}>
          <ScratchGrid ticket={ticket} resolveIcon={resolveIcon} onAllRevealed={handleAllRevealed}
            alreadyScratched={!!ticket.scratched_at} winCells={winCells} theme={theme} />
        </div>

        {phase === 'done' && (
          <div style={{ textAlign: 'center', padding: '6px 16px 4px', animation: 'scratchBanner 0.5s ease-out' }}>
            {isWin ? (
              <div style={m.winBanner}>
                <div style={{ fontSize: 34, fontWeight: 900, color: '#1b5e20', letterSpacing: 2 }}>🎉 WINNER! 🎉</div>
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, margin: '8px 0' }}>
                  {[0, 1, 2].map(i => {
                    const { src } = resolveIcon(ticket.grid[winCells[0]].k, ticket.game_id);
                    return <img key={i} src={src} alt="" style={{ width: 40, height: 40, objectFit: 'contain' }} />;
                  })}
                  <span style={{ fontSize: 28, fontWeight: 900, color: '#1b5e20', margin: '0 6px' }}>=</span>
                  <span style={{ fontSize: 34 }}>🏆</span>
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#111' }}>{tier?.prize_label || 'Prize'}</div>
                {!revealError && <div style={{ fontSize: 12, color: '#333', marginTop: 4 }}>Added to the Prize Board ✔</div>}
              </div>
            ) : (
              <div style={m.loseBanner}>
                <div style={{ fontSize: 26, fontWeight: 900, color: '#ccc' }}>❌ No match</div>
                <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>Not a winner this time. Good luck next ticket!</div>
              </div>
            )}
            {revealError && <div style={{ color: '#f44', fontSize: 12, marginTop: 8 }}>Error saving result: {revealError}. Close and open the ticket again to retry.</div>}
          </div>
        )}

        {/* Prize key, like the side of a real scratcher */}
        {game && (
          <div style={m.key}>
            {game.tiers.map((t, i) => (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: 12, color: tier?.id === t.id && phase === 'done' ? '#FFD700' : '#bbb', fontWeight: tier?.id === t.id && phase === 'done' ? 800 : 400 }}>
                {[0, 1, 2].map(j => <img key={j} src={tierSrc(t, symbolSrc)} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} />)}
                <span style={{ margin: '0 4px' }}>=</span>
                <span style={{ flex: 1 }}>{t.prize_label}</span>
                <span style={{ fontSize: 10, color: i === 0 ? '#FFD700' : '#666' }}>{TIER_NAMES[i]}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ textAlign: 'center', padding: '4px 16px 16px' }}>
          <button onClick={onClose} style={{ ...m.closeBtn, background: phase === 'done' ? theme : '#333' }}>
            {phase === 'done' ? 'Done' : 'Scratch later'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Store section ────────────────────────────────────────────────────────────

export default function ScratchOffStore({ eventId, user, myPlayer, myCpc, theme, symbolSrc, onBalanceChange }) {
  const [games, setGames] = useState([]);
  const [myTickets, setMyTickets] = useState([]);
  const [openTicket, setOpenTicket] = useState(null);
  const [buying, setBuying] = useState(null);
  const [msg, setMsg] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [categories, setCategories] = useState({});

  const resolveIcon = makeIconResolver(games, symbolSrc);

  const loadGames = useCallback(async () => {
    // Load every game (not just active ones) so tickets from a game whose sales
    // were stopped still render their icons and prize key.
    try { setGames(await fetchScratchGames(eventId)); }
    catch (e) { console.warn('Scratch-offs failed to load:', e.message); }
  }, [eventId]);

  const playerId = myPlayer?.id;
  const loadTickets = useCallback(async () => {
    try { setMyTickets(playerId ? await fetchMyScratchTickets(playerId) : []); }
    catch (e) { console.warn('Tickets failed to load:', e.message); }
  }, [playerId]);

  useEffect(() => { loadGames(); }, [loadGames]);
  useEffect(() => { loadTickets(); }, [loadTickets]);

  // Category names for "earned by scoring X" tickets
  useEffect(() => {
    supabase.from('slots_categories').select('id, label').eq('event_id', eventId)
      .then(({ data }) => setCategories(Object.fromEntries((data ?? []).map(c => [c.id, c.label]))));
  }, [eventId]);

  useEffect(() => {
    const ch = supabase.channel(`scratch-games-${eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slots_scratch_games' }, (payload) => {
        // Client-side filter (server-side filters need REPLICA IDENTITY FULL)
        const row = payload.new?.event_id ? payload.new : payload.old;
        if (!row?.event_id || row.event_id === eventId) loadGames();
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [eventId, loadGames]);

  const activeGames = games.filter(g => g.is_active);
  if (activeGames.length === 0 && myTickets.length === 0) return null;

  const flash = (text, isError = false) => { setMsg({ text, isError }); setTimeout(() => setMsg(null), 4000); };

  const handleBuy = async (game) => {
    if (!user || !myPlayer) return;
    setBuying(game.id);
    setMsg(null);
    try {
      const { ticket } = await buyScratchTicket(eventId, myPlayer.id, game.id, user.id);
      setOpenTicket(ticket);
      await Promise.all([loadTickets(), loadGames(), onBalanceChange?.()]);
    } catch (e) {
      flash('Error: ' + e.message, true);
    } finally {
      setBuying(null);
    }
  };

  const unscratched = myTickets.filter(t => !t.scratched_at);
  const scratched = myTickets.filter(t => t.scratched_at);
  const countByGame = {};
  for (const t of myTickets) countByGame[t.game_id] = (countByGame[t.game_id] ?? 0) + 1;

  const gameFor = (id) => games.find(g => g.id === id);

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: theme, marginBottom: 12 }}>🎫 Scratch-Off Tickets</div>
      {msg && <div style={{ padding: '10px 16px', borderRadius: 8, border: `1px solid ${msg.isError ? '#f44' : '#4caf50'}`, background: msg.isError ? '#f443361a' : '#4caf501a', marginBottom: 12, fontSize: 13 }}>{msg.text}</div>}

      {unscratched.length > 0 && (
        <div style={{ background: '#1a1405', border: '2px solid #d4af37', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
          <div style={{ fontWeight: 800, color: '#FFD700', marginBottom: 8 }}>👆 You have {unscratched.length} ticket{unscratched.length === 1 ? '' : 's'} to scratch!</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {unscratched.map(t => (
              <button key={t.id} onClick={() => setOpenTicket(t)} style={{ background: theme, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 16px', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
                {t.source === 'award' ? '🎁' : '🎫'} Scratch {gameFor(t.game_id)?.label ?? 'ticket'}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
        {activeGames.map(g => {
          const odds = computeOdds(g.total_tickets, g.tiers);
          const soldOut = g.tickets_remaining <= 0;
          const mine = countByGame[g.id] ?? 0;
          const limitReached = g.max_per_player != null && mine >= g.max_per_player;
          const canAfford = myPlayer && myCpc >= g.cost_cpc;
          const forSale = g.sell_in_store !== false;
          const earnFrom = g.award_category_id ? (categories[g.award_category_id] ?? 'a quest') : null;
          const disabled = !forSale || !user || !myPlayer || soldOut || limitReached || !canAfford || buying === g.id;
          let label = `Buy ticket · ${g.cost_cpc.toLocaleString()} CPC`;
          if (!user) label = 'Log In';
          else if (!myPlayer) label = 'Not Enrolled';
          else if (soldOut) label = 'Sold Out';
          else if (limitReached) label = 'Limit Reached';
          else if (!canAfford) label = 'Not enough CPC';
          if (buying === g.id) label = '...';
          if (!forSale) label = soldOut ? 'All tickets given out' : limitReached ? `✔ You've earned ${mine}` : `🎁 Earn it: score ${earnFrom}`;
          const grand = g.tiers[0];

          return (
            <div key={g.id} style={{ background: 'linear-gradient(160deg, #241a05 0%, #111 55%)', border: `2px solid ${soldOut ? '#333' : '#d4af37'}`, borderRadius: 12, overflow: 'hidden', opacity: soldOut ? 0.55 : 1 }}>
              <div style={{ background: `linear-gradient(135deg, ${theme}, #8b0000)`, padding: '10px 14px' }}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>{g.label}</div>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#FFD700' }}>MATCH 3 = WIN!</div>
              </div>
              <div style={{ padding: 14 }}>
                {g.description && <div style={{ fontSize: 12, color: '#aaa', marginBottom: 8 }}>{g.description}</div>}
                {earnFrom && (
                  <div style={{ background: '#2a1033', border: '1px solid #6a2c80', color: '#e1bee7', borderRadius: 6, padding: '6px 10px', fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
                    🎁 FREE ticket for scoring <span style={{ color: '#fff' }}>{earnFrom}</span>{g.max_per_player != null ? ` (max ${g.max_per_player} each)` : ''}
                  </div>
                )}
                {grand && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <img src={tierSrc(grand, symbolSrc)} alt="" style={{ width: 36, height: 36, objectFit: 'contain' }} />
                    <div>
                      <div style={{ fontSize: 10, color: '#FFD700', fontWeight: 800, letterSpacing: 1 }}>GRAND PRIZE</div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{grand.prize_label}</div>
                    </div>
                  </div>
                )}

                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginBottom: 10 }}>
                  <thead>
                    <tr>{['Match 3', 'Prize', 'Left', 'Odds'].map(h => <th key={h} style={{ textAlign: 'left', color: '#666', fontWeight: 600, padding: '3px 4px', borderBottom: '1px solid #2a2a2a' }}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {g.tiers.map((t, i) => (
                      <tr key={t.id} style={{ opacity: t.prizes_remaining > 0 ? 1 : 0.4 }}>
                        <td style={{ padding: '3px 4px' }}><img src={tierSrc(t, symbolSrc)} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} /></td>
                        <td style={{ padding: '3px 4px', color: i === 0 ? '#FFD700' : '#ddd' }}>{t.prize_label}</td>
                        <td style={{ padding: '3px 4px', color: '#ccc' }}>{t.prizes_remaining}/{t.prize_count}</td>
                        <td style={{ padding: '3px 4px', color: '#90CAF9', whiteSpace: 'nowrap' }}>{formatOneIn(odds.tiers[i]?.oneIn)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                  Overall odds: <span style={{ color: '#4CAF50', fontWeight: 700 }}>{formatOneIn(odds.overall)}</span>
                </div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 10 }}>
                  {soldOut ? 'All tickets given out' : `${g.tickets_remaining.toLocaleString()} of ${g.total_tickets.toLocaleString()} tickets left`}
                  {g.max_per_player != null && <span style={{ color: limitReached ? (forSale ? '#ef5350' : '#81c784') : '#90CAF9' }}> · {myPlayer ? `${mine}/${g.max_per_player} yours` : `max ${g.max_per_player} each`}</span>}
                </div>

                <button onClick={() => handleBuy(g)} disabled={disabled}
                  style={{ width: '100%', padding: '11px', fontSize: 14, fontWeight: 800, color: '#fff', border: 'none', borderRadius: 8, background: !forSale ? '#4a1f5c' : disabled ? '#333' : theme, cursor: disabled ? 'default' : 'pointer', opacity: forSale && disabled && buying !== g.id ? 0.6 : 1 }}>
                  {label}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {scratched.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <button onClick={() => setShowHistory(h => !h)} style={{ background: 'none', border: 'none', color: '#888', fontSize: 12, cursor: 'pointer', padding: 0 }}>
            {showHistory ? '▴ Hide' : '▾ Show'} my scratched tickets ({scratched.length})
          </button>
          {showHistory && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {scratched.map(t => {
                const g = gameFor(t.game_id);
                const tier = t.tier_id ? g?.tiers.find(x => x.id === t.tier_id) : null;
                return (
                  <button key={t.id} onClick={() => setOpenTicket(t)}
                    style={{ background: t.tier_id ? '#1b3a1f' : '#1a1a1a', border: `1px solid ${t.tier_id ? '#4CAF50' : '#333'}`, color: t.tier_id ? '#9be7a0' : '#777', borderRadius: 6, padding: '5px 10px', fontSize: 11, cursor: 'pointer' }}>
                    {t.tier_id ? `🏆 ${tier?.prize_label ?? 'Winner'}` : '❌ No win'} · {new Date(t.purchased_at).toLocaleDateString()}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {openTicket && (
        <TicketModal
          key={openTicket.id}
          ticket={openTicket}
          game={gameFor(openTicket.game_id)}
          resolveIcon={resolveIcon}
          symbolSrc={symbolSrc}
          theme={theme}
          actorId={user?.id}
          onRevealed={() => { loadTickets(); onBalanceChange?.(); }}
          onClose={() => { setOpenTicket(null); loadTickets(); }}
        />
      )}
    </div>
  );
}

const m = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, overflowY: 'auto' },
  ticket: { width: 340, maxWidth: '100%', background: '#141414', border: '3px solid #d4af37', borderRadius: 14, boxShadow: '0 0 40px rgba(212,175,55,0.35)', overflow: 'hidden', color: '#eee' },
  ticketHead: { padding: '12px 16px', textAlign: 'center', color: '#fff' },
  winBanner: { background: 'linear-gradient(135deg, #a5d6a7, #FFD700)', borderRadius: 10, padding: '12px 10px', border: '3px solid #2e7d32' },
  loseBanner: { background: '#1e1e1e', borderRadius: 10, padding: '12px 10px', border: '1px solid #333' },
  key: { margin: '10px 16px 8px', padding: '8px 10px', background: '#0d0d0d', border: '1px dashed #444', borderRadius: 8 },
  closeBtn: { color: '#fff', border: 'none', borderRadius: 20, padding: '10px 32px', fontSize: 14, fontWeight: 800, cursor: 'pointer', marginTop: 6 },
};
