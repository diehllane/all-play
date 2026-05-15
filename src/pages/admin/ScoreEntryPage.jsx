// src/pages/admin/ScoreEntryPage.jsx
// All-Play score entry — migrated to dropdown style (player + category + Add)
// matching the board game score entry UX.

import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { fireAllPlayWebhooks } from '../../lib/discord';

export default function ScoreEntryPage() {
  const { id: eventId } = useParams();
  const { profile } = useAuth();
  const isRunner = profile?.role === 'event_runner';

  const [event, setEvent] = useState(null);
  const [divisions, setDivisions] = useState([]);
  const [allTeams, setAllTeams] = useState([]);
  const [categories, setCategories] = useState([]);
  const [entries, setEntries] = useState([]); // uncommitted entries for current day
  const [dayNumber, setDayNumber] = useState(1);
  const [loading, setLoading] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [msg, setMsg] = useState('');

  // Dropdown state
  const [selectedTeam, setSelectedTeam] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');

  // Playoff tab
  const [activeTab, setActiveTab] = useState('regular'); // 'regular' | 'playoffs'
  const [bracketMatches, setBracketMatches] = useState([]);
  const [playoffEntry, setPlayoffEntry] = useState(null);

  const realtimeRef = useRef(null);
  const dayRef = useRef(1);

  useEffect(() => {
    loadAll();
    return () => { realtimeRef.current?.unsubscribe(); };
  }, [eventId]);

  async function loadAll() {
    setLoading(true);
    try {
      const [evRes, divRes, teamRes, catRes] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).single(),
        supabase.from('divisions').select('*, teams(*)').eq('event_id', eventId).order('name'),
        supabase.from('teams').select('*').eq('event_id', eventId).order('name'),
        supabase.from('categories').select('*').eq('event_id', eventId).order('name'),
      ]);
      const ev = evRes.data;
      setEvent(ev);
      setDivisions(divRes.data || []);
      setAllTeams(teamRes.data || []);
      setCategories(catRes.data || []);

      // Determine current day
      const { data: maxDay } = await supabase
        .from('score_entries')
        .select('day_number')
        .eq('event_id', eventId)
        .order('day_number', { ascending: false })
        .limit(1);
      const day = maxDay?.[0]?.day_number ?? 1;
      setDayNumber(day);
      dayRef.current = day;
      await loadEntries(day);

      // Bracket matches if in playoff mode
      if (ev?.status === 'playoffs') {
        const { data: matches } = await supabase
          .from('bracket_matches')
          .select('*')
          .eq('event_id', eventId)
          .is('winner_team_id', null)
          .order('round')
          .order('position');
        setBracketMatches(matches || []);
      }

      // Realtime
      realtimeRef.current = supabase
        .channel(`scoreentry-${eventId}`)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'score_entries',
          filter: `event_id=eq.${eventId}`,
        }, () => loadEntries(dayRef.current))
        .subscribe();
    } finally {
      setLoading(false);
    }
  }

  async function loadEntries(day) {
    const { data, error } = await supabase
      .from('score_entries')
      .select('*, teams(id, name), categories(id, name, multiplier)')
      .eq('event_id', eventId)
      .eq('day_number', day)
      .is('finalized_at', null)
      .order('created_at');
    if (!error) setEntries(data || []);
  }

  async function addEntry() {
    if (!selectedTeam || !selectedCategory) {
      setMsg('Select a team and category first.');
      return;
    }
    const cat = categories.find(c => c.id === selectedCategory);
    const { error } = await supabase.from('score_entries').insert({
      event_id: eventId,
      team_id: selectedTeam,
      category_id: selectedCategory,
      encounter_count: 1,
      day_number: dayNumber,
    });
    if (error) { setMsg('Error adding entry: ' + error.message); return; }
    setMsg('');
    // Don't reset dropdowns — fast multi-entry UX
  }

  async function removeEntry(entryId) {
    await supabase.from('score_entries').delete().eq('id', entryId);
  }

  // Build per-team tally from entries
  function buildTally() {
    const tally = {};
    for (const e of entries) {
      const tid = e.team_id;
      if (!tally[tid]) {
        tally[tid] = { team: e.teams, totalPoints: 0, items: [] };
      }
      const pts = (e.categories?.multiplier || 0) * e.encounter_count;
      tally[tid].totalPoints += pts;
      tally[tid].items.push({ id: e.id, catName: e.categories?.name, pts });
    }
    return Object.values(tally);
  }

  async function commitDay() {
    if (!isRunner) return;
    setCommitting(true);
    setMsg('');
    try {
      // Pull fresh entries
      const { data: fresh } = await supabase
        .from('score_entries')
        .select('*, categories(multiplier)')
        .eq('event_id', eventId)
        .eq('day_number', dayNumber)
        .is('finalized_at', null);

      if (!fresh || fresh.length === 0) {
        setMsg('No entries to commit.');
        setCommitting(false);
        return;
      }

      // Compute team scores
      const teamScores = {};
      for (const e of fresh) {
        teamScores[e.team_id] = (teamScores[e.team_id] || 0) + (e.categories?.multiplier || 0) * e.encounter_count;
      }

      // Fetch existing standings for League Average calc
      const { data: allEntries } = await supabase
        .from('score_entries')
        .select('team_id, encounter_count, categories(multiplier)')
        .eq('event_id', eventId)
        .not('finalized_at', 'is', null);

      // Calculate league average for the day (all teams that submitted)
      const teamsWithScores = Object.keys(teamScores);
      const leagueAvg = teamsWithScores.length > 0
        ? Object.values(teamScores).reduce((s, v) => s + v, 0) / teamsWithScores.length
        : 0;

      // For each team: head-to-head + vs league avg, award pts
      const standings = {};
      for (const team of allTeams) {
        const score = teamScores[team.id] || 0;
        // head-to-head: compare vs their division opponent for the day
        // simplified: we store raw scores and let standings page calculate
        standings[team.id] = { score, leagueAvg };
      }

      // Finalize entries
      const ids = fresh.map(e => e.id);
      await supabase
        .from('score_entries')
        .update({ finalized_at: new Date().toISOString() })
        .in('id', ids);

      // Fire Discord webhooks
      const webhookTeams = allTeams.map((t, i) => ({
        teamName: t.name,
        webhookUrl: t.discord_webhook_url,
        todayScore: teamScores[t.id] || 0,
        wins: 0, losses: 0, ties: 0, points: 0, rank: i + 1, // standings calc is async
      }));

      const overallWebhook = event?.discord_overall_webhook;
      if (overallWebhook || webhookTeams.some(t => t.webhookUrl)) {
        await fireAllPlayWebhooks({
          eventName: event?.name || 'Event',
          dayNumber,
          publicUrl: `${window.location.origin}/all-play/events/${event?.slug}`,
          themeColor: '#c62828',
          overallWebhook,
          teamWebhooks: webhookTeams,
          allTeams: allTeams.map((t, i) => ({
            name: t.name, points: 0, wins: 0, losses: 0, ties: 0, rank: i + 1,
          })),
        });
      }

      setMsg(`Day ${dayNumber} committed.`);
      setDayNumber(d => { dayRef.current = d + 1; return d + 1; });
      setEntries([]);
    } catch (err) {
      setMsg('Commit error: ' + err.message);
    } finally {
      setCommitting(false);
    }
  }

  async function undoDay() {
    if (!isRunner) return;
    const prevDay = dayNumber - 1;
    if (prevDay < 1) { setMsg('Nothing to undo.'); return; }
    if (!confirm(`Undo Day ${prevDay}? This will restore those entries as uncommitted.`)) return;

    const { error } = await supabase
      .from('score_entries')
      .update({ finalized_at: null })
      .eq('event_id', eventId)
      .eq('day_number', prevDay)
      .not('finalized_at', 'is', null);

    if (error) { setMsg('Undo failed: ' + error.message); return; }
    setDayNumber(prevDay);
    dayRef.current = prevDay;
    await loadEntries(prevDay);
    setMsg(`Day ${prevDay} reverted. Fix scores and recommit.`);
  }

  if (loading) return <div style={styles.loading}>Loading...</div>;
  const tally = buildTally();

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <Link to={`/admin/events/${eventId}`} style={styles.backLink}>← Back to Event</Link>
          <h1 style={styles.title}>{event?.name}</h1>
          <div style={styles.dayBadge}>Day {dayNumber}</div>
        </div>
        {isRunner && (
          <div style={styles.headerActions}>
            <button onClick={commitDay} disabled={committing || entries.length === 0} style={styles.commitBtn}>
              {committing ? 'Committing...' : `Commit Day ${dayNumber}`}
            </button>
            <button onClick={undoDay} disabled={committing || dayNumber <= 1} style={styles.undoBtn}>
              Undo Last Day
            </button>
          </div>
        )}
      </div>

      {msg && <div style={styles.msg}>{msg}</div>}

      {event?.status === 'playoffs' && (
        <div style={styles.tabs}>
          <button
            onClick={() => setActiveTab('regular')}
            style={activeTab === 'regular' ? styles.tabActive : styles.tab}
          >Regular Season</button>
          <button
            onClick={() => setActiveTab('playoffs')}
            style={activeTab === 'playoffs' ? styles.tabActive : styles.tab}
          >Playoffs</button>
        </div>
      )}

      {activeTab === 'regular' && (
        <>
          {/* Score Entry Row */}
          <div style={styles.entryRow}>
            <select
              value={selectedTeam}
              onChange={e => setSelectedTeam(e.target.value)}
              style={styles.select}
            >
              <option value="">— Select Team —</option>
              {allTeams.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <select
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
              style={styles.select}
            >
              <option value="">— Select Category —</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.multiplier} pts)</option>
              ))}
            </select>
            <button onClick={addEntry} style={styles.addBtn}>+ Add</button>
          </div>

          {/* Per-team tally cards */}
          {tally.length === 0 ? (
            <div style={styles.empty}>No entries yet for Day {dayNumber}.</div>
          ) : (
            <div style={styles.tallyGrid}>
              {tally.map(({ team, totalPoints, items }) => (
                <div key={team?.id} style={styles.card}>
                  <div style={styles.cardHeader}>
                    <span style={styles.cardTeam}>{team?.name}</span>
                    <span style={styles.cardTotal}>{totalPoints} pts</span>
                  </div>
                  <div style={styles.cardItems}>
                    {items.map(item => (
                      <div key={item.id} style={styles.itemRow}>
                        <span style={styles.itemName}>{item.catName}</span>
                        <span style={styles.itemPts}>+{item.pts}</span>
                        <button onClick={() => removeEntry(item.id)} style={styles.removeBtn}>✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'playoffs' && (
        <PlayoffEntry
          eventId={eventId}
          matches={bracketMatches}
          teams={allTeams}
          categories={categories}
          onMatchSaved={() => setBracketMatches(m => [...m])}
        />
      )}
    </div>
  );
}

// ── Playoff Entry Sub-component ───────────────────────────────

function PlayoffEntry({ eventId, matches, teams, categories, onMatchSaved }) {
  const [activeMatch, setActiveMatch] = useState(null);
  const [entries, setEntries] = useState({ team1: [], team2: [] }); // {catId, pts}[]
  const [selectedCat, setSelectedCat] = useState({ team1: '', team2: '' });
  const [saving, setSaving] = useState(false);

  function getTeam(id) { return teams.find(t => t.id === id); }

  function addPlayoffEntry(side) {
    const catId = selectedCat[side];
    if (!catId) return;
    const cat = categories.find(c => c.id === catId);
    setEntries(prev => ({
      ...prev,
      [side]: [...prev[side], { catId, catName: cat.name, pts: cat.multiplier }],
    }));
  }

  function removePlayoffEntry(side, idx) {
    setEntries(prev => ({
      ...prev,
      [side]: prev[side].filter((_, i) => i !== idx),
    }));
  }

  function totalScore(side) {
    return entries[side].reduce((s, e) => s + e.pts, 0);
  }

  async function saveMatch() {
    if (!activeMatch) return;
    setSaving(true);
    try {
      const score1 = totalScore('team1');
      const score2 = totalScore('team2');
      const winnerId = score1 > score2
        ? activeMatch.team1_id
        : score2 > score1
          ? activeMatch.team2_id
          : null; // tie goes to... team1 for simplicity

      await supabase.from('bracket_matches').update({
        team1_score: score1,
        team2_score: score2,
        winner_team_id: winnerId || activeMatch.team1_id,
      }).eq('id', activeMatch.id);

      // Advance winner to next slot
      const { data: nextMatches } = await supabase
        .from('bracket_matches')
        .select('*')
        .eq('event_id', eventId)
        .eq('bracket_type', activeMatch.bracket_type)
        .eq('round', activeMatch.round + 1)
        .order('position');

      if (nextMatches?.length > 0) {
        const target = nextMatches.find(m => !m.team1_id || !m.team2_id);
        if (target) {
          const slotKey = !target.team1_id ? 'team1_id' : 'team2_id';
          await supabase.from('bracket_matches')
            .update({ [slotKey]: winnerId || activeMatch.team1_id })
            .eq('id', target.id);
        }
      }

      setActiveMatch(null);
      setEntries({ team1: [], team2: [] });
      onMatchSaved();
    } finally {
      setSaving(false);
    }
  }

  if (matches.length === 0) {
    return <div style={styles.empty}>No pending playoff matches.</div>;
  }

  if (!activeMatch) {
    return (
      <div style={styles.matchList}>
        <h3 style={styles.sectionTitle}>Pending Matches</h3>
        {matches.map(m => {
          const t1 = getTeam(m.team1_id);
          const t2 = getTeam(m.team2_id);
          return (
            <div key={m.id} style={styles.matchCard}>
              <span>{t1?.name || 'TBD'} vs {t2?.name || 'TBD'}</span>
              <span style={styles.roundBadge}>R{m.round}</span>
              <button onClick={() => setActiveMatch(m)} style={styles.enterBtn}>Enter Scores</button>
            </div>
          );
        })}
      </div>
    );
  }

  const t1 = getTeam(activeMatch.team1_id);
  const t2 = getTeam(activeMatch.team2_id);

  return (
    <div style={styles.playoffEntry}>
      <h3 style={styles.sectionTitle}>{t1?.name} vs {t2?.name}</h3>
      <div style={styles.vsGrid}>
        {(['team1', 'team2']).map((side, si) => {
          const team = si === 0 ? t1 : t2;
          return (
            <div key={side} style={styles.vsCard}>
              <div style={styles.vsTeamName}>{team?.name}</div>
              <div style={styles.vsScore}>{totalScore(side)} pts</div>
              <div style={styles.entryRow}>
                <select
                  value={selectedCat[side]}
                  onChange={e => setSelectedCat(p => ({ ...p, [side]: e.target.value }))}
                  style={styles.select}
                >
                  <option value="">— Category —</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.multiplier})</option>
                  ))}
                </select>
                <button onClick={() => addPlayoffEntry(side)} style={styles.addBtn}>+ Add</button>
              </div>
              {entries[side].map((e, i) => (
                <div key={i} style={styles.itemRow}>
                  <span style={styles.itemName}>{e.catName}</span>
                  <span style={styles.itemPts}>+{e.pts}</span>
                  <button onClick={() => removePlayoffEntry(side, i)} style={styles.removeBtn}>✕</button>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div style={styles.playoffActions}>
        <button onClick={() => setActiveMatch(null)} style={styles.undoBtn}>Cancel</button>
        <button onClick={saveMatch} disabled={saving} style={styles.commitBtn}>
          {saving ? 'Saving...' : 'Save Match Result'}
        </button>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────

const styles = {
  page: { maxWidth: 900, margin: '0 auto', padding: '24px 16px', fontFamily: 'sans-serif' },
  loading: { padding: 40, textAlign: 'center', color: '#aaa' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 16 },
  backLink: { color: '#888', textDecoration: 'none', fontSize: 14 },
  title: { margin: '4px 0', fontSize: 22, color: '#fff' },
  dayBadge: { display: 'inline-block', background: '#c62828', color: '#fff', borderRadius: 4, padding: '2px 10px', fontSize: 13, marginTop: 4 },
  headerActions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  commitBtn: { background: '#c62828', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 20px', cursor: 'pointer', fontWeight: 700 },
  undoBtn: { background: '#333', color: '#ccc', border: '1px solid #444', borderRadius: 6, padding: '10px 16px', cursor: 'pointer' },
  msg: { background: '#1e1e1e', border: '1px solid #444', borderRadius: 6, padding: '10px 14px', color: '#ffb', marginBottom: 16 },
  tabs: { display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid #333' },
  tab: { background: 'none', border: 'none', color: '#888', padding: '10px 20px', cursor: 'pointer', fontSize: 14 },
  tabActive: { background: 'none', border: 'none', borderBottom: '2px solid #c62828', color: '#fff', padding: '10px 20px', cursor: 'pointer', fontWeight: 700, fontSize: 14 },
  entryRow: { display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' },
  select: { background: '#1a1a1a', color: '#fff', border: '1px solid #444', borderRadius: 6, padding: '8px 12px', flex: 1, minWidth: 160, fontSize: 14 },
  addBtn: { background: '#c62828', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap' },
  empty: { color: '#666', textAlign: 'center', padding: 40 },
  tallyGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 },
  card: { background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, overflow: 'hidden' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#222', padding: '10px 14px', borderBottom: '1px solid #333' },
  cardTeam: { fontWeight: 700, color: '#fff', fontSize: 15 },
  cardTotal: { color: '#c62828', fontWeight: 700, fontSize: 16 },
  cardItems: { padding: '8px 14px' },
  itemRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid #222' },
  itemName: { flex: 1, color: '#ccc', fontSize: 13 },
  itemPts: { color: '#4caf50', fontSize: 13, fontWeight: 700, minWidth: 40, textAlign: 'right' },
  removeBtn: { background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: '0 4px', fontSize: 14 },
  sectionTitle: { color: '#fff', fontSize: 16, marginBottom: 12 },
  matchList: { display: 'flex', flexDirection: 'column', gap: 8 },
  matchCard: { display: 'flex', alignItems: 'center', gap: 12, background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, padding: '12px 16px' },
  roundBadge: { background: '#333', color: '#aaa', borderRadius: 4, padding: '2px 8px', fontSize: 12 },
  enterBtn: { marginLeft: 'auto', background: '#c62828', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer' },
  playoffEntry: { background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, padding: 20 },
  vsGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 },
  vsCard: { background: '#222', border: '1px solid #333', borderRadius: 8, padding: 16 },
  vsTeamName: { fontWeight: 700, color: '#fff', marginBottom: 4 },
  vsScore: { color: '#c62828', fontSize: 20, fontWeight: 700, marginBottom: 12 },
  playoffActions: { display: 'flex', gap: 8, justifyContent: 'flex-end' },
  matchCard_color: '#fff',
};
