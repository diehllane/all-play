// src/components/ScratchOffAdminPanel.jsx
// Slots admin → Scratch-Offs tab: sales, prizes left, and every ticket sold.
// "Reveal unscratched" posts any winning ticket a player bought but never
// scratched to the Prize Board, so no prize gets lost at the end of an event.

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  SCRATCH_SYMBOL_IMAGES, computeOdds, formatOneIn,
  fetchScratchGames, fetchEventScratchTickets, revealScratchTicket,
} from '../lib/scratchoff';

export default function ScratchOffAdminPanel({ eventId, theme, actorId, onChanged }) {
  const [games, setGames] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [filterGame, setFilterGame] = useState('');

  const load = useCallback(async () => {
    try {
      const [g, t] = await Promise.all([fetchScratchGames(eventId), fetchEventScratchTickets(eventId)]);
      setGames(g); setTickets(t);
    } catch (e) {
      setMsg({ text: 'Error: ' + e.message, isError: true });
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ color: '#666' }}>Loading...</div>;

  const unscratchedWinners = tickets.filter(t => !t.scratched_at && t.tier_id);
  const unscratched = tickets.filter(t => !t.scratched_at);

  const revealAllUnscratched = async () => {
    if (!unscratched.length) return;
    if (!window.confirm(`Reveal all ${unscratched.length} unscratched ticket(s)? ${unscratchedWinners.length} winner(s) will be posted to the Prize Board. Players will see them as already scratched.`)) return;
    setBusy(true);
    let ok = 0; const errs = [];
    for (const t of unscratched) {
      try { await revealScratchTicket(t.id, actorId); ok++; }
      catch (e) { errs.push(e.message); }
    }
    setBusy(false);
    setMsg(errs.length ? { text: `${ok} revealed, ${errs.length} failed: ${errs[0]}`, isError: true } : { text: `${ok} ticket(s) revealed.` });
    await load();
    onChanged?.();
  };

  const tierById = {};
  for (const g of games) for (const t of g.tiers) tierById[t.id] = { ...t, gameLabel: g.label };
  const shown = filterGame ? tickets.filter(t => t.game_id === filterGame) : tickets;

  return (
    <div>
      {msg && (
        <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 6, background: msg.isError ? '#ef444422' : '#4caf5022', border: `1px solid ${msg.isError ? '#ef4444' : '#4caf50'}`, color: msg.isError ? '#ef4444' : '#4caf50', fontSize: 13 }}>{msg.text}</div>
      )}
      <p style={{ opacity: 0.6, fontSize: 13, marginBottom: 16 }}>
        Set up tickets on <Link to={`/admin/slots/${eventId}/edit`} style={{ color: theme }}>Edit Config → Scratch-Offs</Link>. Wins appear on the Prizes tab once the player finishes scratching.
      </p>

      {games.length === 0 && <div style={{ color: '#555', fontSize: 13, padding: '16px 0' }}>No scratch-offs set up.</div>}

      {games.map(g => {
        const sold = g.total_tickets - g.tickets_remaining;
        const odds = computeOdds(g.total_tickets, g.tiers);
        const gameTickets = tickets.filter(t => t.game_id === g.id);
        return (
          <div key={g.id} style={{ background: '#111', border: '1px solid #222', borderRadius: 10, padding: '14px 16px', marginBottom: 14, opacity: g.is_active ? 1 : 0.6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontWeight: 700, color: '#fff' }}>🎫 {g.label} {!g.is_active && <span style={{ fontSize: 11, color: '#888' }}>(sales stopped)</span>}</div>
              <div style={{ fontSize: 12, color: '#aaa', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <span>{sold.toLocaleString()} / {g.total_tickets.toLocaleString()} sold</span>
                <span style={{ color: '#d4af37' }}>{(sold * g.cost_cpc).toLocaleString()} CPC taken in</span>
                <span style={{ color: '#4CAF50' }}>Overall {formatOneIn(odds.overall)}</span>
                <span>{gameTickets.filter(t => !t.scratched_at).length} unscratched</span>
              </div>
            </div>
            <table style={s.table}>
              <thead><tr>{['Icon', 'Prize', 'Won', 'Left', 'Odds'].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>
                {g.tiers.map((t, i) => (
                  <tr key={t.id}>
                    <td style={s.td}><img src={t.icon_url || SCRATCH_SYMBOL_IMAGES[t.icon]} alt="" style={{ width: 20, height: 20, objectFit: 'contain' }} /></td>
                    <td style={{ ...s.td, color: i === 0 ? '#FFD700' : '#ccc' }}>{t.prize_label}</td>
                    <td style={s.tdNum}>{t.prize_count - t.prizes_remaining}</td>
                    <td style={s.tdNum}>{t.prizes_remaining}</td>
                    <td style={{ ...s.tdNum, color: '#90CAF9' }}>{formatOneIn(odds.tiers[i]?.oneIn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {tickets.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, margin: '24px 0 10px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#888' }}>Tickets sold</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={filterGame} onChange={e => setFilterGame(e.target.value)}
                style={{ background: '#1a1a1a', color: '#fff', border: '1px solid #444', borderRadius: 6, padding: '6px 8px', fontSize: 12 }}>
                <option value="" style={{ background: '#1a1a1a', color: '#fff' }}>All games</option>
                {games.map(g => <option key={g.id} value={g.id} style={{ background: '#1a1a1a', color: '#fff' }}>{g.label}</option>)}
              </select>
              <button onClick={revealAllUnscratched} disabled={busy || !unscratched.length}
                title="Use at the end of an event so prizes from tickets nobody scratched still get fulfilled"
                style={{ padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, color: '#fff', border: 'none', background: unscratched.length ? '#b8860b' : '#333', cursor: unscratched.length ? 'pointer' : 'not-allowed' }}>
                {busy ? 'Revealing...' : `Reveal ${unscratched.length} unscratched${unscratchedWinners.length ? ` (${unscratchedWinners.length} winner${unscratchedWinners.length === 1 ? '' : 's'})` : ''}`}
              </button>
            </div>
          </div>
          <table style={s.table}>
            <thead><tr>{['Bought', 'Player', 'Game', 'Result', 'Scratched'].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>
              {shown.map(t => {
                const tier = t.tier_id ? tierById[t.tier_id] : null;
                return (
                  <tr key={t.id}>
                    <td style={{ ...s.td, fontSize: 11, opacity: 0.6, whiteSpace: 'nowrap' }}>{new Date(t.purchased_at).toLocaleString()}</td>
                    <td style={s.td}>{t.slots_players?.display_name || '--'}</td>
                    <td style={s.td}>{games.find(g => g.id === t.game_id)?.label || '--'}</td>
                    <td style={{ ...s.td, color: t.tier_id ? '#4CAF50' : '#666' }}>{t.tier_id ? `🏆 ${tier?.prize_label ?? 'Winner'}` : 'No win'}</td>
                    <td style={{ ...s.td, fontSize: 12, color: t.scratched_at ? '#888' : '#f0a020' }}>{t.scratched_at ? new Date(t.scratched_at).toLocaleString() : 'Not yet'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

const s = {
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 10 },
  th: { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #222', color: '#888', fontWeight: 600, fontSize: 12 },
  td: { padding: '7px 10px', borderBottom: '1px solid #1a1a1a', color: '#ccc' },
  tdNum: { padding: '7px 10px', borderBottom: '1px solid #1a1a1a', textAlign: 'right', color: '#ccc' },
};
