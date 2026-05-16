import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { commitBingoDay, undoBingoCommit, getNextDayNumber } from '../../lib/bingo';

export default function BingoScoreEntryPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isRunner = profile?.role === 'event_runner';

  const [config, setConfig] = useState(null);
  const [squares, setSquares] = useState([]);
  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [entries, setEntries] = useState([]);
  const [dayNumber, setDayNumber] = useState(1);
  const [loading, setLoading] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [msg, setMsg] = useState(null);

  // Form state
  const [selectedPlayer, setSelectedPlayer] = useState('');
  const [selectedSquare, setSelectedSquare] = useState('');
  const [quantity, setQuantity] = useState(1);

  const flash = (text, isError = false) => {
    setMsg({ text, isError });
    setTimeout(() => setMsg(null), 4000);
  };

  const load = useCallback(async () => {
    const [
      { data: cfg },
      { data: sqs },
      { data: pls },
      { data: tms },
    ] = await Promise.all([
      supabase.from('bingo_config').select('*').eq('event_id', eventId).single(),
      supabase.from('bingo_squares').select('*').eq('event_id', eventId).order('position'),
      supabase.from('bingo_players').select('*').eq('event_id', eventId).order('sort_order'),
      supabase.from('bingo_teams').select('*').eq('event_id', eventId).order('sort_order'),
    ]);
    setConfig(cfg);
    setSquares(sqs ?? []);
    setPlayers(pls ?? []);
    setTeams(tms ?? []);

    const next = await getNextDayNumber(eventId);
    setDayNumber(next);
    setLoading(false);
  }, [eventId]);

  const loadEntries = useCallback(async () => {
    const { data } = await supabase
      .from('bingo_score_entries')
      .select('*, bingo_players(name), bingo_squares(label, point_value, position)')
      .eq('event_id', eventId)
      .eq('committed', false)
      .order('created_at');
    setEntries(data ?? []);
  }, [eventId]);

  useEffect(() => {
    load().then(loadEntries);
  }, [load, loadEntries]);

  // Realtime entries
  useEffect(() => {
    const ch = supabase.channel(`bingo-entries-${eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bingo_score_entries', filter: `event_id=eq.${eventId}` }, loadEntries)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [eventId, loadEntries]);

  const addEntry = async () => {
    if (!selectedPlayer || !selectedSquare) return flash('Select a player and a square.', true);
    const sq = squares.find(s => s.id === selectedSquare);
    if (!sq) return;
    const { error } = await supabase.from('bingo_score_entries').insert({
      event_id: eventId,
      player_id: selectedPlayer,
      square_id: selectedSquare,
      day_number: dayNumber,
      quantity,
      committed: false,
    });
    if (error) return flash(error.message, true);
    setQuantity(1);
  };

  const removeEntry = async (id) => {
    await supabase.from('bingo_score_entries').delete().eq('id', id);
  };

  const handleCommit = async () => {
    if (!window.confirm(`Commit Day ${dayNumber}? This will finalize all entries, calculate bingos, and update scores.`)) return;
    setCommitting(true);
    try {
      const result = await commitBingoDay(eventId, dayNumber, profile?.id);
      const { results } = result;
      flash(`Day ${dayNumber} committed! Team bingos: ${results.teamBingosEarned.length}, Individual bingos: ${results.individualBingosEarned.length}`);
      await load();
      await loadEntries();
    } catch (e) {
      flash(e.message, true);
    } finally {
      setCommitting(false);
    }
  };

  const handleUndo = async () => {
    if (!window.confirm('Undo the last commit? Entries will be restored and scores rolled back.')) return;
    setUndoing(true);
    try {
      const result = await undoBingoCommit(eventId);
      flash(`Day ${result.dayNumber} commit undone. Entries are restored.`);
      await load();
      await loadEntries();
    } catch (e) {
      flash(e.message, true);
    } finally {
      setUndoing(false);
    }
  };

  if (loading) return <div style={{ padding: 40, color: 'var(--text-dim)' }}>Loading...</div>;
  if (!config) return <div style={{ padding: 40, color: '#ef4444' }}>Event not found.</div>;

  const themeColor = config.theme_color || '#c62828';
  const isTeam = config.event_type === 'team';

  // Group entries by player for display
  const entriesByPlayer = {};
  for (const e of entries) {
    if (!entriesByPlayer[e.player_id]) entriesByPlayer[e.player_id] = [];
    entriesByPlayer[e.player_id].push(e);
  }

  const playerTotals = {};
  for (const e of entries) {
    const pts = Number(e.bingo_squares?.point_value ?? 0) * e.quantity;
    playerTotals[e.player_id] = (playerTotals[e.player_id] ?? 0) + pts;
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '32px 24px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
          <button onClick={() => navigate(`/admin/bingo/${eventId}`)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-dim)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>← Back</button>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>Score Entry — Day {dayNumber}</h1>
        </div>

        {msg && (
          <div style={{ background: msg.isError ? '#ef444422' : `${themeColor}22`, border: `1px solid ${msg.isError ? '#ef4444' : themeColor}`, color: msg.isError ? '#ef4444' : themeColor, borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontWeight: 600 }}>
            {msg.text}
          </div>
        )}

        {/* Entry form */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, marginBottom: 28 }}>
          <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Add Entry</h2>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>Player</label>
              <select value={selectedPlayer} onChange={e => setSelectedPlayer(e.target.value)}
                style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '8px 12px', fontSize: 14, minWidth: 160 }}>
                <option value="">Select player...</option>
                {isTeam
                  ? teams.map(t => (
                      <optgroup key={t.id} label={t.name}>
                        {players.filter(p => p.team_id === t.id).map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </optgroup>
                    ))
                  : players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)
                }
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>Square</label>
              <select value={selectedSquare} onChange={e => setSelectedSquare(e.target.value)}
                style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '8px 12px', fontSize: 14, minWidth: 220 }}>
                <option value="">Select square...</option>
                {squares.filter(s => !s.is_free_space).map(s => (
                  <option key={s.id} value={s.id}>{s.label} ({s.point_value} pts)</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>Quantity</label>
              <input type="number" min={1} value={quantity} onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '8px 12px', fontSize: 14, width: 80 }} />
            </div>
            <button onClick={addEntry} style={{ background: themeColor, color: '#fff', border: 'none', borderRadius: 6, padding: '9px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              + Add
            </button>
          </div>
        </div>

        {/* Current entries by player */}
        {players.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 28 }}>
            {players.map(p => {
              const pEntries = entriesByPlayer[p.id] ?? [];
              const total = playerTotals[p.id] ?? 0;
              const team = teams.find(t => t.id === p.team_id);
              return (
                <div key={p.id} style={{ background: 'var(--surface)', border: `1px solid ${pEntries.length > 0 ? themeColor + '66' : 'var(--border)'}`, borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ background: `${themeColor}22`, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${themeColor}44` }}>
                    <div>
                      <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: 14 }}>{p.name}</span>
                      {team && <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 6 }}>{team.name}</span>}
                    </div>
                    <span style={{ fontWeight: 700, color: themeColor, fontSize: 16 }}>{total} pts</span>
                  </div>
                  <div style={{ padding: 10 }}>
                    {pEntries.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-dim)', padding: '4px 0' }}>No entries yet</div>}
                    {pEntries.map(e => (
                      <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ flex: 1, fontSize: 13, color: 'var(--text)' }}>
                          {e.bingo_squares?.label ?? 'Unknown'} ×{e.quantity}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                          {Number(e.bingo_squares?.point_value ?? 0) * e.quantity} pts
                        </div>
                        <button onClick={() => removeEntry(e.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16, padding: '0 4px', lineHeight: 1 }}>×</button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Commit / Undo */}
        {isRunner && (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button onClick={handleCommit} disabled={committing || entries.length === 0}
              style={{ background: entries.length > 0 ? themeColor : 'var(--border)', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 28px', fontSize: 15, fontWeight: 700, cursor: entries.length > 0 ? 'pointer' : 'not-allowed' }}>
              {committing ? 'Committing...' : `Commit Day ${dayNumber}`}
            </button>
            <button onClick={handleUndo} disabled={undoing}
              style={{ background: 'none', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 8, padding: '12px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              {undoing ? 'Undoing...' : 'Undo Last Commit'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
