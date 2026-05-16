// src/pages/admin/BoardGameScoreEntryPage.jsx
// Dropdown-style score entry for Board Game events.
// Fires Discord webhooks (overall + per-player) on Commit Day.

import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { fireBoardGameWebhooks } from '../../lib/discord';

const ACC = '#c62828';

export default function BoardGameScoreEntryPage() {
  const { eventId } = useParams();
  const { profile } = useAuth();
  const isRunner = profile?.role === 'event_runner';

  const [event, setEvent] = useState(null);
  const [config, setConfig] = useState({});
  const [players, setPlayers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [entries, setEntries] = useState([]);
  const [squares, setSquares] = useState([]);
  const [dayNumber, setDayNumber] = useState(1);
  const [loading, setLoading] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [msg, setMsg] = useState('');

  const [selectedPlayer, setSelectedPlayer] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');

  const realtimeRef = useRef(null);

  useEffect(() => {
    loadAll();
    return () => { realtimeRef.current?.unsubscribe(); };
  }, [eventId]);

  async function loadAll() {
    setLoading(true);
    try {
      const [evRes, catRes, playerRes, configRes, squaresRes] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).single(),
        supabase.from('categories').select('*').eq('event_id', eventId).order('name'),
        supabase.from('board_players').select('*').eq('event_id', eventId).order('name'),
        supabase.from('board_game_config').select('*').eq('event_id', eventId).single(),
        supabase.from('board_squares').select('*').eq('event_id', eventId),
      ]);

      setEvent(evRes.data);
      setCategories(catRes.data || []);
      setPlayers(playerRes.data || []);
      setConfig(configRes.data || {});
      setSquares(squaresRes.data || []);

      // Find current day
      const { data: commits } = await supabase
        .from('board_commits')
        .select('day_number')
        .eq('event_id', eventId)
        .order('day_number', { ascending: false })
        .limit(1);
      const day = (commits?.[0]?.day_number ?? 0) + 1;
      setDayNumber(day);

      await loadEntries(day);

      realtimeRef.current = supabase
        .channel(`bg-entry-${eventId}`)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'board_score_entries',
          filter: `event_id=eq.${eventId}`,
        }, () => loadEntries(day))
        .subscribe();
    } finally {
      setLoading(false);
    }
  }

  async function loadEntries(day) {
    const { data } = await supabase
      .from('board_score_entries')
      .select('*, board_players(id, name, avatar_url), categories(id, name, multiplier)')
      .eq('event_id', eventId)
      .eq('day_number', day)
      .eq('committed', false)
      .order('created_at');
    setEntries(data || []);
  }

  async function handleAdd() {
    if (!selectedPlayer || !selectedCategory) {
      setMsg('Select a player and category.');
      return;
    }
    const cat = categories.find(c => c.id === selectedCategory);
    const { error } = await supabase.from('board_score_entries').insert({
      event_id: eventId,
      player_id: selectedPlayer,
      category_id: selectedCategory,
      encounter_count: 1,
      points_each: cat?.multiplier || 0,
      day_number: dayNumber,
      committed: false,
    });
    if (error) setMsg(error.message);
    else setMsg('');
  }

  async function handleRemove(id) {
    await supabase.from('board_score_entries').delete().eq('id', id);
    await loadEntries(dayNumber);
  }

  function buildTally() {
    const tally = {};
    for (const e of entries) {
      const pid = e.player_id;
      if (!tally[pid]) tally[pid] = { player: e.board_players, total: 0, items: [] };
      tally[pid].total += e.points_each;
      tally[pid].items.push({ id: e.id, catName: e.categories?.name, pts: e.points_each });
    }
    return Object.values(tally);
  }

  function getSquare(num) {
    return squares.find(sq => sq.square_number === num);
  }

  function resolveSquare(position, squareList) {
    let pos = position;
    const visited = new Set();
    while (!visited.has(pos)) {
      visited.add(pos);
      const sq = squareList.find(s => s.square_number === pos);
      if (!sq) break;
      if (sq.type === 'bonus_jump' || sq.type === 'penalty_jump') {
        pos = sq.jump_to;
      } else if (sq.type === 'bonus_small') {
        pos = Math.min(pos + (sq.move_amount || 0), config.track_length || 252);
        break;
      } else if (sq.type === 'penalty_small') {
        pos = Math.max(pos - (sq.move_amount || 0), 0);
        break;
      } else break;
    }
    return pos;
  }

  async function handleCommit() {
    if (!isRunner) return;
    if (!confirm(`Commit Day ${dayNumber}?`)) return;
    setCommitting(true);
    setMsg('');
    try {
      // Re-fetch squares and config fresh to avoid stale state closures
      const { data: freshSquares } = await supabase
        .from('board_squares').select('*').eq('event_id', eventId);
      const { data: freshConfig } = await supabase
        .from('board_game_config').select('*').eq('event_id', eventId).single();
      const liveSquares = freshSquares || squares;
      const liveConfig = freshConfig || config;

      // Fetch all uncommitted entries
      const { data: allEntries } = await supabase
        .from('board_score_entries')
        .select('*, categories(multiplier)')
        .eq('event_id', eventId)
        .eq('day_number', dayNumber)
        .eq('committed', false);

      // Compute raw score per player
      const rawScores = {};
      for (const e of allEntries || []) {
        rawScores[e.player_id] = (rawScores[e.player_id] || 0) + e.points_each;
      }

      // Load current positions
      const { data: positions } = await supabase
        .from('board_player_positions')
        .select('*')
        .eq('event_id', eventId);

      const posMap = {};
      for (const p of positions || []) posMap[p.player_id] = p.position;

      // Snapshot for undo
      await supabase.from('board_commits').insert({
        event_id: eventId,
        day_number: dayNumber,
        pre_commit_snapshot: { positions: posMap },
      });

      const trackLen = liveConfig.track_length || 252;
      const divisor = liveConfig.score_divisor || 1;
      const operation = liveConfig.score_operation || 'divide';
      const rounding = liveConfig.score_rounding || 'ceil';
      const minMoves = liveConfig.min_moves_per_day || 0;
      const maxMoves = liveConfig.max_moves_per_day || 0;

      const newPositions = {};
      const badgeAwards = {};

      for (const player of players) {
        const raw = rawScores[player.id] || 0;
        let moves = operation === 'multiply' ? raw * divisor : raw / divisor;
        if (rounding === 'ceil') moves = Math.ceil(moves);
        else if (rounding === 'floor') moves = Math.floor(moves);
        else moves = Math.round(moves);
        if (minMoves > 0) moves = Math.max(moves, minMoves);
        if (maxMoves > 0) moves = Math.min(moves, maxMoves);

        const oldPos = posMap[player.id] || 0;
        const rawNewPos = Math.min(oldPos + moves, trackLen);

        // Check for gym passes
        const passedGyms = liveSquares.filter(sq =>
          sq.type === 'gym' && sq.square_number > oldPos && sq.square_number <= rawNewPos
        );
        if (passedGyms.length > 0) badgeAwards[player.id] = passedGyms;

        const finalPos = resolveSquare(rawNewPos, liveSquares);
        newPositions[player.id] = finalPos;
      }

      // Upsert positions
      const posUpserts = Object.entries(newPositions).map(([pid, pos]) => ({
        event_id: eventId, player_id: pid, position: pos,
      }));
      if (posUpserts.length > 0) {
        await supabase.from('board_player_positions')
          .upsert(posUpserts, { onConflict: 'event_id,player_id' });
      }

      // Award prizes for exact landings
      for (const [pid, pos] of Object.entries(newPositions)) {
        const sq = liveSquares.find(s => s.square_number === pos && s.type === 'prize');
        if (sq) {
          // Check if already earned (avoid duplicate)
          const { data: existing } = await supabase
            .from('board_prizes_earned')
            .select('id')
            .eq('event_id', eventId)
            .eq('player_id', pid)
            .eq('square_number', pos)
            .maybeSingle();
          if (!existing) {
            const { error: prizeErr } = await supabase.from('board_prizes_earned').insert({
              event_id: eventId,
              player_id: pid,
              square_number: pos,
              day_number: dayNumber,
            });
            if (prizeErr) console.error('Prize insert error:', prizeErr);
          }
        }
      }

      // Mark entries committed
      if (allEntries?.length > 0) {
        await supabase.from('board_score_entries')
          .update({ committed: true })
          .in('id', allEntries.map(e => e.id));
      }

      // Fire Discord webhooks
      const sortedPlayers = players
        .map(p => ({
          name: p.name,
          position: newPositions[p.id] || 0,
          badges: (badgeAwards[p.id]?.length || 0),
        }))
        .sort((a, b) => b.position - a.position);

      const playerWebhooks = players
        .filter(p => p.discord_webhook_url)
        .map(p => ({
          playerName: p.name,
          webhookUrl: p.discord_webhook_url,
          todayScore: rawScores[p.id] || 0,
          totalPosition: newPositions[p.id] || 0,
          badges: badgeAwards[p.id]?.length || 0,
        }));

      if (event?.discord_overall_webhook || playerWebhooks.length > 0) {
        await fireBoardGameWebhooks({
          eventName: event?.name || 'Board Game',
          dayNumber,
          publicUrl: `${window.location.origin}/all-play/board/${eventId}`,
          themeColor: config.theme_color || '#c62828',
          overallWebhook: event?.discord_overall_webhook,
          playerWebhooks,
          allPlayers: sortedPlayers,
        });
      }

      setMsg(`Day ${dayNumber} committed!`);
      setDayNumber(d => d + 1);
      setEntries([]);
    } catch (e) {
      setMsg('Commit error: ' + e.message);
    } finally {
      setCommitting(false);
    }
  }

  async function handleUndo() {
    if (!isRunner) return;
    const prevDay = dayNumber - 1;
    if (prevDay < 1) { setMsg('Nothing to undo.'); return; }
    if (!confirm(`Undo Day ${prevDay}?`)) return;

    const { data: commits } = await supabase
      .from('board_commits')
      .select('*')
      .eq('event_id', eventId)
      .eq('day_number', prevDay)
      .order('committed_at', { ascending: false })
      .limit(1);

    if (!commits?.length) { setMsg('No commit record found.'); return; }
    const snapshot = commits[0].pre_commit_snapshot;

    // Restore positions
    if (snapshot?.positions) {
      const restores = Object.entries(snapshot.positions).map(([pid, pos]) => ({
        event_id: eventId, player_id: pid, position: pos,
      }));
      await supabase.from('board_player_positions')
        .upsert(restores, { onConflict: 'event_id,player_id' });
    }

    // Delete prizes earned on this day (approximation: delete prizes for positions that were moved to)
    // and un-commit entries
    await supabase.from('board_score_entries')
      .update({ committed: false })
      .eq('event_id', eventId).eq('day_number', prevDay).eq('committed', true);

    await supabase.from('board_commits').delete().eq('id', commits[0].id);

    setDayNumber(prevDay);
    await loadEntries(prevDay);
    setMsg(`Day ${prevDay} reverted.`);
  }

  if (loading) return <div style={s.loading}>Loading...</div>;
  const tally = buildTally();

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <Link to={`/admin/board/${eventId}`} style={s.back}>← Back to Event</Link>
          <h1 style={s.title}>{event?.name}</h1>
          <span style={s.dayBadge}>Day {dayNumber}</span>
        </div>
        {isRunner && (
          <div style={s.headerActions}>
            <button onClick={handleCommit} disabled={committing || entries.length === 0} style={s.commitBtn}>
              {committing ? 'Committing...' : `Commit Day ${dayNumber}`}
            </button>
            <button onClick={handleUndo} disabled={committing || dayNumber <= 1} style={s.undoBtn}>
              Undo Last Day
            </button>
          </div>
        )}
      </div>

      {msg && <div style={s.msg}>{msg}</div>}

      <div style={s.entryRow}>
        <select value={selectedPlayer} onChange={e => setSelectedPlayer(e.target.value)} style={s.select}>
          <option value="">— Select Player —</option>
          {players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)} style={s.select}>
          <option value="">— Select Category —</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name} ({c.multiplier} pts)</option>)}
        </select>
        <button onClick={handleAdd} style={s.addBtn}>+ Add</button>
      </div>

      {tally.length === 0 ? (
        <div style={s.empty}>No entries yet for Day {dayNumber}.</div>
      ) : (
        <div style={s.tallyGrid}>
          {tally.map(({ player, total, items }) => (
            <div key={player?.id} style={s.card}>
              <div style={s.cardHeader}>
                <div style={s.cardMeta}>
                  {player?.avatar_url && <img src={player.avatar_url} style={s.cardAvatar} alt="" />}
                  <span style={s.cardName}>{player?.name}</span>
                </div>
                <span style={s.cardTotal}>{total} pts</span>
              </div>
              <div style={s.cardItems}>
                {items.map(item => (
                  <div key={item.id} style={s.itemRow}>
                    <span style={s.itemName}>{item.catName}</span>
                    <span style={s.itemPts}>+{item.pts}</span>
                    <button onClick={() => handleRemove(item.id)} style={s.removeBtn}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const s = {
  page: { maxWidth: 960, margin: '0 auto', padding: '24px 16px', fontFamily: 'sans-serif' },
  loading: { padding: 40, textAlign: 'center', color: '#aaa' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 16 },
  back: { color: '#888', textDecoration: 'none', fontSize: 13 },
  title: { margin: '4px 0', fontSize: 22, color: '#fff' },
  dayBadge: { display: 'inline-block', background: ACC, color: '#fff', borderRadius: 4, padding: '2px 10px', fontSize: 13, marginTop: 4 },
  headerActions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  commitBtn: { background: ACC, color: '#fff', border: 'none', borderRadius: 6, padding: '10px 20px', cursor: 'pointer', fontWeight: 700 },
  undoBtn: { background: '#333', color: '#ccc', border: '1px solid #444', borderRadius: 6, padding: '10px 16px', cursor: 'pointer' },
  msg: { background: '#1e1e1e', border: '1px solid #444', borderRadius: 6, padding: '10px 14px', color: '#ffb', marginBottom: 16 },
  entryRow: { display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' },
  select: { background: '#1a1a1a', color: '#fff', border: '1px solid #444', borderRadius: 6, padding: '9px 12px', flex: 1, minWidth: 180, fontSize: 14 },
  addBtn: { background: ACC, color: '#fff', border: 'none', borderRadius: 6, padding: '9px 20px', cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap' },
  empty: { color: '#555', textAlign: 'center', padding: 60, fontSize: 15 },
  tallyGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 },
  card: { background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, overflow: 'hidden' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#222', padding: '10px 14px', borderBottom: '1px solid #333' },
  cardMeta: { display: 'flex', alignItems: 'center', gap: 10 },
  cardAvatar: { width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' },
  cardName: { fontWeight: 700, color: '#fff', fontSize: 14 },
  cardTotal: { color: ACC, fontWeight: 700, fontSize: 18 },
  cardItems: { padding: '8px 14px' },
  itemRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid #222' },
  itemName: { flex: 1, color: '#ccc', fontSize: 13 },
  itemPts: { color: '#4caf50', fontSize: 13, fontWeight: 700, minWidth: 40, textAlign: 'right' },
  removeBtn: { background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: '0 4px', fontSize: 14 },
};
