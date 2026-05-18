// src/pages/admin/HighScoreScoreEntryPage.jsx

import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  getHSConfig, getHSTeams, getHSPlayers, getHSEntries,
  addHSEntry, removeHSEntry, commitHSDay, undoHSDay,
  getHSLastCommittedDay, getHSDailyTotals, buildHSStandings,
} from '../../lib/highscore';
import { fireHighScoreWebhooks } from '../../lib/discord';

const ACC = '#c62828';

export default function HighScoreScoreEntryPage() {
  const { id: eventId } = useParams();
  const { profile } = useAuth();
  const canManage = profile?.role === 'event_runner' || profile?.role === 'owner';

  const [event, setEvent] = useState(null);
  const [config, setConfig] = useState(null);
  const [teams, setTeams] = useState([]);
  const [players, setPlayers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [entries, setEntries] = useState([]);
  const [dayNumber, setDayNumber] = useState(1);
  const [loading, setLoading] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [msg, setMsg] = useState('');

  // Dropdowns
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
      const [evRes, catRes] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).single(),
        supabase.from('categories').select('*').eq('event_id', eventId).order('name'),
      ]);
      setEvent(evRes.data);
      setCategories(catRes.data || []);

      const [cfg, tm, pl] = await Promise.all([
        getHSConfig(eventId).catch(() => ({})),
        getHSTeams(eventId),
        getHSPlayers(eventId),
      ]);
      setConfig(cfg);
      setTeams(tm);
      setPlayers(pl);

      const lastDay = await getHSLastCommittedDay(eventId);
      const day = lastDay + 1;
      setDayNumber(day);
      await loadEntries(day);

      // Realtime
      realtimeRef.current = supabase
        .channel(`hs-entry-${eventId}`)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'hs_score_entries',
          filter: `event_id=eq.${eventId}`,
        }, () => loadEntries(day))
        .subscribe();
    } finally {
      setLoading(false);
    }
  }

  async function loadEntries(day) {
    const data = await getHSEntries(eventId, day);
    setEntries(data);
  }

  async function handleAdd() {
    if (!selectedPlayer || !selectedCategory) {
      setMsg('Select a player and category.');
      return;
    }
    const cat = categories.find(c => c.id === selectedCategory);
    const player = players.find(p => p.id === selectedPlayer);
    try {
      await addHSEntry(eventId, {
        playerId: selectedPlayer,
        teamId: player?.team_id || null,
        categoryId: selectedCategory,
        pointsEach: cat?.multiplier || 0,
        dayNumber,
      });
      setMsg('');
    } catch (e) { setMsg(e.message); }
  }

  async function handleRemove(entryId) {
    await removeHSEntry(entryId);
    await loadEntries(dayNumber);
  }

  // Build per-player tally
  function buildTally() {
    const tally = {};
    for (const e of entries) {
      const pid = e.player_id;
      if (!tally[pid]) {
        tally[pid] = { player: e.hs_players, totalPoints: 0, items: [] };
      }
      tally[pid].totalPoints += e.points_each;
      tally[pid].items.push({ id: e.id, catName: e.categories?.name, pts: e.points_each });
    }
    return Object.values(tally);
  }

  async function handleCommit() {
    if (!canManage) return;
    if (!confirm(`Commit Day ${dayNumber} for all players?`)) return;
    setCommitting(true);
    setMsg('');
    try {
      // Re-fetch config fresh to avoid stale state closure
      const freshConfig = await getHSConfig(eventId).catch(() => config || {});
      const { upserts } = await commitHSDay(eventId, dayNumber, freshConfig, players, teams);

      // Build standings for Discord
      const allTotals = await getHSDailyTotals(eventId);
      const { individualStandings, teamStandings } = buildHSStandings(
        allTotals, players, teams, freshConfig?.mode || 'solo'
      );

      const overallWebhook = event?.discord_overall_webhook;
      const teamWebhookList = teams
        .filter(t => t.discord_webhook_url)
        .map(t => {
          const tStanding = teamStandings.find(ts => ts.teamId === t.id);
          const todayTeamScore = upserts
            .filter(u => u.team_id === t.id)
            .reduce((s, u) => s + u.final_score, 0);
          return {
            teamName: t.name,
            webhookUrl: t.discord_webhook_url,
            todayTeamScore,
            totalTeamScore: tStanding?.totalScore || 0,
            rank: tStanding?.rank || 0,
            members: (tStanding?.members || []).map(m => {
              const upsert = upserts.find(u => u.player_id === m.playerId);
              return { name: m.name, todayScore: upsert?.final_score || 0, totalScore: m.totalScore };
            }),
          };
        });

      if (overallWebhook || teamWebhookList.length > 0) {
        await fireHighScoreWebhooks({
          eventName: event?.name || 'Event',
          dayNumber,
          publicUrl: `${window.location.origin}/all-play/highscore/${eventId}`,
          themeColor: freshConfig?.theme_color || '#c62828',
          mode: freshConfig?.mode || 'solo',
          overallWebhook,
          teamWebhooks: teamWebhookList,
          allTeams: teamStandings.map(t => ({ name: t.name, totalScore: t.totalScore, rank: t.rank })),
          allPlayers: individualStandings.map(p => ({
            name: p.name, teamName: p.teamName, totalScore: p.totalScore, rank: p.rank,
          })),
        });
      }

      setMsg(`Day ${dayNumber} committed successfully!`);
      setDayNumber(d => d + 1);
      setEntries([]);
    } catch (e) {
      setMsg('Commit error: ' + e.message);
    } finally {
      setCommitting(false);
    }
  }

  async function handleUndo() {
    if (!canManage) return;
    const prevDay = dayNumber - 1;
    if (prevDay < 1) { setMsg('Nothing to undo.'); return; }
    if (!confirm(`Undo Day ${prevDay}? Scores will be restored as uncommitted.`)) return;
    try {
      await undoHSDay(eventId, prevDay);
      setDayNumber(prevDay);
      await loadEntries(prevDay);
      setMsg(`Day ${prevDay} reverted. Fix entries and recommit.`);
    } catch (e) { setMsg(e.message); }
  }

  if (loading) return <div style={s.loading}>Loading...</div>;

  const tally = buildTally();
  const isTeamMode = config?.mode === 'team';

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <Link to={`/admin/highscore/${eventId}`} style={s.back}>← Back to Event</Link>
          <h1 style={s.title}>{event?.name}</h1>
          <span style={s.dayBadge}>Day {dayNumber}</span>
        </div>
        {canManage && (
          <div style={s.headerActions}>
            <button
              onClick={handleCommit}
              disabled={committing || entries.length === 0}
              style={s.commitBtn}
            >
              {committing ? 'Committing...' : `Commit Day ${dayNumber}`}
            </button>
            <button
              onClick={handleUndo}
              disabled={committing || dayNumber <= 1}
              style={s.undoBtn}
            >
              Undo Last Day
            </button>
          </div>
        )}
      </div>

      {msg && <div style={s.msg}>{msg}</div>}

      {/* Entry dropdowns */}
      <div style={s.entryRow}>
        <select value={selectedPlayer} onChange={e => setSelectedPlayer(e.target.value)} style={s.select}>
          <option value="">— Select Player —</option>
          {isTeamMode
            ? [
                ...teams.map(t => (
                  <optgroup key={t.id} label={t.name}>
                    {players.filter(p => p.team_id === t.id).map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </optgroup>
                )),
                players.filter(p => !p.team_id).length > 0 && (
                  <optgroup key="unassigned" label="— No Team —">
                    {players.filter(p => !p.team_id).map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </optgroup>
                ),
              ]
            : players.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))
          }
        </select>
        <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)} style={s.select}>
          <option value="">— Select Category —</option>
          {categories.map(c => (
            <option key={c.id} value={c.id}>{c.name} ({c.multiplier} pts)</option>
          ))}
        </select>
        <button onClick={handleAdd} style={s.addBtn}>+ Add</button>
      </div>

      {/* Tally cards */}
      {tally.length === 0 ? (
        <div style={s.empty}>No entries yet for Day {dayNumber}. Start adding above.</div>
      ) : (
        <div style={s.tallyGrid}>
          {tally.map(({ player, totalPoints, items }) => {
            const team = teams.find(t => t.id === player?.team_id);
            return (
              <div key={player?.id} style={s.card}>
                <div style={s.cardHeader}>
                  <div style={s.cardMeta}>
                    {player?.avatar_url && (
                      <img src={player.avatar_url} style={s.cardAvatar} alt="" />
                    )}
                    <div>
                      <div style={s.cardName}>{player?.name}</div>
                      {team && <div style={s.cardTeam}>{team.name}</div>}
                    </div>
                  </div>
                  <span style={s.cardTotal}>{totalPoints} pts</span>
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
            );
          })}
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
  cardAvatar: { width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' },
  cardName: { fontWeight: 700, color: '#fff', fontSize: 14 },
  cardTeam: { color: '#888', fontSize: 12 },
  cardTotal: { color: ACC, fontWeight: 700, fontSize: 18 },
  cardItems: { padding: '8px 14px' },
  itemRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid #222' },
  itemName: { flex: 1, color: '#ccc', fontSize: 13 },
  itemPts: { color: '#4caf50', fontSize: 13, fontWeight: 700, minWidth: 40, textAlign: 'right' },
  removeBtn: { background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: '0 4px', fontSize: 14 },
};
