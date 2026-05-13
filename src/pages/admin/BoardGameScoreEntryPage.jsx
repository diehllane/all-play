// src/pages/admin/BoardGameScoreEntryPage.jsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { calcMoves, resolveMovement } from '../../lib/boardgame';

export default function BoardGameScoreEntryPage() {
  const { eventId } = useParams();
  const { user, profile } = useAuth();

  const [event, setEvent]         = useState(null);
  const [config, setConfig]       = useState(null);
  const [players, setPlayers]     = useState([]);
  const [categories, setCategories] = useState([]);
  const [positions, setPositions] = useState({});
  const [squares, setSquares]     = useState([]);

  const [currentDay, setCurrentDay] = useState(1);
  const [lastCommit, setLastCommit] = useState(null);

  // Entry form state
  const [selectedPlayer, setSelectedPlayer] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [adding, setAdding]       = useState(false);

  // Per-player per-day tallies (realtime)
  const [dayEntries, setDayEntries] = useState([]); // raw rows for current day

  const [committing, setCommitting] = useState(false);
  const [undoing, setUndoing]       = useState(false);
  const [message, setMessage]       = useState(null);
  const [loading, setLoading]       = useState(true);

  const isRunner = profile?.role === 'event_runner';
  const themeColor = config?.theme_color || '#c62828';

  // ── Initial load ─────────────────────────────────────────
  const load = useCallback(async () => {
    const [evRes, cfgRes, plRes, catRes, posRes, sqRes] = await Promise.all([
      supabase.from('events').select('*').eq('id', eventId).single(),
      supabase.from('board_game_config').select('*').eq('event_id', eventId).single(),
      supabase.from('board_players').select('*').eq('event_id', eventId).order('name'),
      supabase.from('categories').select('*').eq('event_id', eventId).order('name'),
      supabase.from('board_player_positions').select('*').eq('event_id', eventId),
      supabase.from('board_squares').select('*').eq('event_id', eventId),
    ]);
    setEvent(evRes.data);
    setConfig(cfgRes.data);
    setPlayers(plRes.data || []);
    setCategories(catRes.data || []);
    const posMap = {};
    (posRes.data || []).forEach(p => { posMap[p.player_id] = p.position; });
    setPositions(posMap);
    setSquares(sqRes.data || []);

    // Determine current day
    const { data: commits } = await supabase
      .from('board_commits')
      .select('*')
      .eq('event_id', eventId)
      .is('reverted_at', null)
      .order('day_number', { ascending: false })
      .limit(1);
    const last = commits?.[0] || null;
    setLastCommit(last);
    setCurrentDay((last?.day_number ?? 0) + 1);
    setLoading(false);
  }, [eventId]);

  // ── Load current day entries ──────────────────────────────
  const loadDayEntries = useCallback(async (day) => {
    const { data } = await supabase
      .from('board_score_entries')
      .select('*, categories(name, point_value)')
      .eq('event_id', eventId)
      .eq('day_number', day ?? currentDay)
      .order('created_at');
    setDayEntries(data || []);
  }, [eventId, currentDay]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!loading) loadDayEntries(currentDay);
  }, [currentDay, loading, loadDayEntries]);

  // ── Realtime subscription for concurrent entry ────────────
  useEffect(() => {
    if (loading) return;
    const channel = supabase
      .channel('score_entry_' + eventId + '_' + currentDay)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'board_score_entries',
        filter: `event_id=eq.${eventId}`
      }, () => loadDayEntries(currentDay))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [eventId, currentDay, loading, loadDayEntries]);

  // ── Add single encounter entry ────────────────────────────
  const handleAddEntry = async () => {
    if (!selectedPlayer || !selectedCategory) return;
    const cat = categories.find(c => c.id === selectedCategory);
    if (!cat) return;
    setAdding(true);
    const { error } = await supabase.from('board_score_entries').insert({
      event_id: eventId,
      player_id: selectedPlayer,
      category_id: selectedCategory,
      day_number: currentDay,
      points: cat.point_value || 0,
      entered_by: user?.id,
    });
    if (error) {
      setMessage({ type: 'error', text: error.message });
    }
    // Don't reset selectedPlayer — scorer likely entering multiple for same player
    setAdding(false);
  };

  // ── Remove a single entry ─────────────────────────────────
  const handleRemoveEntry = async (entryId) => {
    await supabase.from('board_score_entries').delete().eq('id', entryId);
  };

  // ── Commit day ───────────────────────────────────────────
  const handleCommit = async () => {
    if (!isRunner) return;
    setCommitting(true);
    setMessage(null);
    try {
      // Build snapshot of current positions
      const snapshot = {};
      players.forEach(p => { snapshot[p.id] = positions[p.id] || 0; });

      // Tally scores per player for today
      const playerTotals = {};
      dayEntries.forEach(e => {
        playerTotals[e.player_id] = (playerTotals[e.player_id] || 0) + (e.points || 0);
      });

      // Calculate new positions
      const newPositions = {};
      players.forEach(p => {
        const rawScore = playerTotals[p.id] || 0;
        const moves = calcMoves(rawScore, config);
        const { finalPosition } = resolveMovement(positions[p.id] || 0, moves, squares, config.track_length || 252);
        newPositions[p.id] = finalPosition;
      });

      // Upsert positions
      const upserts = players.map(p => ({
        event_id: eventId,
        player_id: p.id,
        position: newPositions[p.id],
        last_updated: new Date().toISOString(),
      }));
      const { error: posErr } = await supabase
        .from('board_player_positions')
        .upsert(upserts, { onConflict: 'event_id,player_id' });
      if (posErr) throw posErr;

      // Insert commit record
      const { error: commitErr } = await supabase.from('board_commits').insert({
        event_id: eventId,
        day_number: currentDay,
        committed_by: user?.id,
        pre_commit_snapshot: snapshot,
      });
      if (commitErr) throw commitErr;

      setMessage({ type: 'success', text: `Day ${currentDay} committed! All positions updated.` });
      await load();
    } catch (e) {
      setMessage({ type: 'error', text: e.message });
    } finally {
      setCommitting(false);
    }
  };

  // ── Undo last commit ─────────────────────────────────────
  const handleUndo = async () => {
    if (!isRunner || !lastCommit) return;
    setUndoing(true);
    setMessage(null);
    try {
      const snapshot = lastCommit.pre_commit_snapshot;
      if (!snapshot) throw new Error('No snapshot available for this commit.');

      // Restore positions from snapshot
      const upserts = players.map(p => ({
        event_id: eventId,
        player_id: p.id,
        position: snapshot[p.id] ?? 0,
        last_updated: new Date().toISOString(),
      }));
      const { error: posErr } = await supabase
        .from('board_player_positions')
        .upsert(upserts, { onConflict: 'event_id,player_id' });
      if (posErr) throw posErr;

      // Mark commit as reverted
      const { error: revertErr } = await supabase
        .from('board_commits')
        .update({ reverted_at: new Date().toISOString(), reverted_by: user?.id })
        .eq('id', lastCommit.id);
      if (revertErr) throw revertErr;

      setMessage({ type: 'success', text: `Day ${lastCommit.day_number} reverted. Positions restored. Fix scores and re-commit.` });
      await load();
    } catch (e) {
      setMessage({ type: 'error', text: e.message });
    } finally {
      setUndoing(false);
    }
  };

  // ── Per-player tally from dayEntries ─────────────────────
  const playerTallies = {};
  players.forEach(p => { playerTallies[p.id] = { total: 0, entries: [] }; });
  dayEntries.forEach(e => {
    if (!playerTallies[e.player_id]) return;
    playerTallies[e.player_id].total += e.points || 0;
    playerTallies[e.player_id].entries.push(e);
  });

  // Preview moves for selected player
  const previewMoves = selectedPlayer && config
    ? calcMoves(playerTallies[selectedPlayer]?.total || 0, config)
    : null;
  const currentPos = selectedPlayer ? (positions[selectedPlayer] || 0) : 0;
  const previewPos = previewMoves != null
    ? resolveMovement(currentPos, previewMoves, squares, config?.track_length || 252).finalPosition
    : null;

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto', color: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Score Entry — Day {currentDay}</h2>
        <span style={{ fontSize: 13, opacity: 0.6 }}>{event?.name}</span>
      </div>

      {message && (
        <div style={{ padding: '10px 16px', marginBottom: 16, borderRadius: 6, background: message.type === 'error' ? '#4a1010' : '#0f3d1f', border: `1px solid ${message.type === 'error' ? '#c62828' : '#2e7d32'}` }}>
          {message.text}
          <button onClick={() => setMessage(null)} style={{ float: 'right', background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* Entry form */}
      <div style={{ background: '#1e1e2e', borderRadius: 8, padding: 20, marginBottom: 24, border: `1px solid ${themeColor}` }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: 15 }}>Add Encounter</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {/* Player dropdown */}
          <div style={{ flex: '1 1 180px' }}>
            <label style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Player</label>
            <select value={selectedPlayer} onChange={e => setSelectedPlayer(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 14 }}>
              <option value="">Select player...</option>
              {players.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Category dropdown */}
          <div style={{ flex: '1 1 220px' }}>
            <label style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Encounter Category</label>
            <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 14 }}>
              <option value="">Select category...</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.point_value} pts)</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleAddEntry}
            disabled={!selectedPlayer || !selectedCategory || adding}
            style={{ padding: '9px 20px', background: themeColor, border: 'none', color: '#fff', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 14, opacity: (!selectedPlayer || !selectedCategory) ? 0.5 : 1 }}>
            {adding ? 'Adding...' : '+ Add'}
          </button>
        </div>

        {/* Preview for selected player */}
        {selectedPlayer && previewMoves !== null && (
          <div style={{ marginTop: 14, padding: '10px 14px', background: '#13131f', borderRadius: 6, fontSize: 13 }}>
            <span style={{ opacity: 0.7 }}>Preview for </span>
            <strong>{players.find(p => p.id === selectedPlayer)?.name}</strong>
            <span style={{ marginLeft: 12, opacity: 0.7 }}>Today's score: </span>
            <strong style={{ color: '#ffd700' }}>{playerTallies[selectedPlayer]?.total || 0} pts</strong>
            <span style={{ margin: '0 8px', opacity: 0.4 }}>→</span>
            <strong style={{ color: '#4caf50' }}>{previewMoves} moves</strong>
            <span style={{ margin: '0 8px', opacity: 0.4 }}>→</span>
            <span>Sq {currentPos}</span>
            <span style={{ margin: '0 6px', opacity: 0.4 }}>→</span>
            <strong style={{ color: config?.theme_color || '#c62828' }}>Sq {previewPos}</strong>
          </div>
        )}
      </div>

      {/* Per-player tallies */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 15, marginBottom: 12 }}>Day {currentDay} — Running Tallies</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {players.map(p => {
            const tally = playerTallies[p.id];
            const moves = config ? calcMoves(tally.total, config) : 0;
            const pos = positions[p.id] || 0;
            const { finalPosition } = config
              ? resolveMovement(pos, moves, squares, config.track_length || 252)
              : { finalPosition: pos };
            return (
              <div key={p.id} style={{ background: '#1e1e2e', borderRadius: 8, padding: 14, border: '1px solid #2a2a3e' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <strong style={{ fontSize: 14 }}>{p.name}</strong>
                  <span style={{ fontSize: 13, color: '#ffd700', fontWeight: 700 }}>{tally.total} pts</span>
                </div>
                <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 8 }}>
                  {tally.entries.length} encounter{tally.entries.length !== 1 ? 's' : ''} · {moves} moves · Sq {pos} → {finalPosition}
                </div>
                {/* Entry list */}
                {tally.entries.length > 0 && (
                  <div style={{ maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {tally.entries.map((e, i) => (
                      <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '3px 6px', background: '#13131f', borderRadius: 4 }}>
                        <span>{e.categories?.name || 'Unknown'}</span>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ color: '#4caf50' }}>+{e.points}</span>
                          <button onClick={() => handleRemoveEntry(e.id)}
                            style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {tally.entries.length === 0 && (
                  <div style={{ fontSize: 12, opacity: 0.35, fontStyle: 'italic' }}>No entries yet</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Commit / Undo — event_runner only */}
      {isRunner && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', borderTop: '1px solid #2a2a3e', paddingTop: 20 }}>
          <button
            onClick={handleCommit}
            disabled={committing || dayEntries.length === 0}
            style={{ padding: '10px 24px', background: '#2e7d32', border: 'none', color: '#fff', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 14, opacity: dayEntries.length === 0 ? 0.4 : 1 }}>
            {committing ? 'Committing...' : `✅ Commit Day ${currentDay}`}
          </button>
          {lastCommit && !lastCommit.reverted_at && (
            <button
              onClick={handleUndo}
              disabled={undoing}
              style={{ padding: '10px 24px', background: '#4a1010', border: '1px solid #c62828', color: '#fff', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
              {undoing ? 'Reverting...' : `↩ Undo Day ${lastCommit.day_number}`}
            </button>
          )}
          <span style={{ fontSize: 12, opacity: 0.5 }}>
            {dayEntries.length} entries across {Object.values(playerTallies).filter(t => t.entries.length > 0).length} players
          </span>
        </div>
      )}
    </div>
  );
}
