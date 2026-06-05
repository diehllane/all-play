import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { commitSlotsDay, undoSlotsCommit } from '../../lib/slots';

export default function SlotsScoreEntryPage() {
  const { eventId } = useParams();
  const { user, profile } = useAuth();

  const [event, setEvent] = useState(null);
  const [config, setConfig] = useState(null);
  const [players, setPlayers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [entries, setEntries] = useState([]);
  const [lastCommit, setLastCommit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedPlayer, setSelectedPlayer] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [encounterCount, setEncounterCount] = useState('');
  const [dayNumber, setDayNumber] = useState(1);
  const [addMsg, setAddMsg] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [undoLoading, setUndoLoading] = useState(false);

  const canManage = profile?.role === 'event_runner' || profile?.role === 'owner';
  const canEnter = canManage || profile?.role === 'scorer';

  const loadAll = useCallback(async () => {
    try {
      const [evRes, cfgRes, playersRes, catsRes, commitRes] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).single(),
        supabase.from('slots_config').select('*').eq('event_id', eventId).single(),
        supabase.from('slots_players').select('*').eq('event_id', eventId).order('display_name'),
        supabase.from('slots_categories').select('*').eq('event_id', eventId).eq('is_active', true).order('sort_order'),
        supabase.from('slots_commits').select('*').eq('event_id', eventId).order('committed_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (evRes.error) throw evRes.error;
      setEvent(evRes.data);
      setConfig(cfgRes.data);
      setPlayers(playersRes.data || []);
      setCategories(catsRes.data || []);
      setLastCommit(commitRes.data);

      // Derive next day from latest commit
      const nextDay = commitRes.data ? (commitRes.data.day_number || 0) + 1 : 1;
      setDayNumber(nextDay);

      // Fetch uncommitted entries for this day ONLY — prevents showing prior committed days
      const { data: entryData } = await supabase
        .from('slots_score_entries')
        .select(`*, slots_players(display_name), slots_categories(label, point_value)`)
        .eq('event_id', eventId)
        .eq('day_number', nextDay)
        .is('committed_at', null)
        .order('saved_at', { ascending: false });
      setEntries(entryData || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    const ch = supabase.channel(`slots-scores-${eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'slots_score_entries', filter: `event_id=eq.${eventId}` }, loadAll)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [eventId, loadAll]);

  if (!canEnter) return <div style={styles.center}>Access denied.</div>;
  if (loading) return <div style={styles.center}>Loading...</div>;
  if (error) return <div style={styles.center}>Error: {error}</div>;

  const theme = config?.theme_color || '#c62828';
  const selectedCat = categories.find(c => c.id === selectedCategory);
  const pointsPreview = selectedCat && encounterCount ? selectedCat.point_value * parseInt(encounterCount) : null;

  const byPlayer = {};
  for (const e of entries) {
    const pid = e.player_id;
    if (!byPlayer[pid]) byPlayer[pid] = { player: e.slots_players, entries: [] };
    byPlayer[pid].entries.push(e);
  }

  const handleAdd = async () => {
    if (!selectedPlayer || !selectedCategory || !encounterCount) return;
    setAddLoading(true);
    const cat = categories.find(c => c.id === selectedCategory);
    const count = parseInt(encounterCount);
    const pts = cat.point_value * count;
    const { error: e } = await supabase.from('slots_score_entries').insert({
      event_id: eventId,
      player_id: selectedPlayer,
      category_id: selectedCategory,
      encounter_count: count,
      points_calculated: pts,
      day_number: dayNumber,
      saved_by: user.id,
    });
    if (e) { setAddMsg('Error: ' + e.message); }
    else { setSelectedCategory(''); setEncounterCount(''); setAddMsg(''); }
    setAddLoading(false);
    loadAll();
  };

  const handleRemove = async (id) => {
    await supabase.from('slots_score_entries').delete().eq('id', id);
    loadAll();
  };

  const handleCommit = async () => {
    if (!confirm(`Commit Day ${dayNumber}? This will award tokens to all players.`)) return;
    setCommitLoading(true);
    setCommitMsg('');
    try {
      const result = await commitSlotsDay(eventId, dayNumber, user.id);
      setCommitMsg(`Day ${dayNumber} committed! ${result?.player_results?.length ?? 0} players updated.`);
      // Reset form — loadAll will advance dayNumber and fetch empty entries for next day
      setSelectedPlayer('');
      setSelectedCategory('');
      setEncounterCount('');
      await loadAll();
    } catch (e) {
      setCommitMsg('Error: ' + e.message);
    } finally {
      setCommitLoading(false);
    }
  };

  const handleUndo = async () => {
    if (!lastCommit) return;
    if (!confirm(`Undo Day ${lastCommit.day_number} commit? Player token balances will roll back.`)) return;
    setUndoLoading(true);
    try {
      await undoSlotsCommit(eventId);
      setCommitMsg('Commit undone. Scores are back to saved state.');
      await loadAll();
    } catch (e) {
      setCommitMsg('Undo error: ' + e.message);
    } finally {
      setUndoLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={{ ...styles.header, borderBottomColor: theme }}>
        <div>
          <div style={{ ...styles.title, color: theme }}>{event?.name}</div>
          <div style={{ fontSize: 12, opacity: 0.5 }}>Score Entry · Day {dayNumber}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to={`/admin/slots/${eventId}`} style={styles.linkBtn}>← Event Admin</Link>
          <Link to={`/slots/${eventId}`} target="_blank" style={styles.linkBtn}>🎰 Public Page ↗</Link>
        </div>
      </div>

      <div style={styles.content}>
        <div style={styles.formCard}>
          <div style={{ fontWeight: 700, marginBottom: 12, color: theme }}>Add Score Entry — Day {dayNumber}</div>
          <div style={styles.formRow}>
            <select value={selectedPlayer} onChange={e => setSelectedPlayer(e.target.value)} style={styles.input}>
              <option value="">Select player...</option>
              {players.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
            </select>
            <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)} style={styles.input}>
              <option value="">Select category...</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.label} ({c.point_value} pts)</option>)}
            </select>
            <input
              type="number" min="1" placeholder="Count"
              value={encounterCount} onChange={e => setEncounterCount(e.target.value)}
              style={{ ...styles.input, width: 90, flex: 'none' }}
            />
            <div style={{ fontSize: 13, minWidth: 80, textAlign: 'right', color: pointsPreview > 0 ? '#90CAF9' : '#555' }}>
              {pointsPreview != null ? `= ${pointsPreview} pts` : ''}
            </div>
            <button onClick={handleAdd} disabled={addLoading || !selectedPlayer || !selectedCategory || !encounterCount}
              style={{ ...styles.btn, background: theme, opacity: (!selectedPlayer || !selectedCategory || !encounterCount) ? 0.5 : 1 }}>
              {addLoading ? '...' : 'Save'}
            </button>
          </div>
          {addMsg && <div style={styles.errorMsg}>{addMsg}</div>}
          <div style={{ fontSize: 11, opacity: 0.4, marginTop: 8 }}>
            Token preview: {selectedCat && pointsPreview != null
              ? `${pointsPreview} pts / ${config?.score_divisor ?? 1} = ~${Math.floor(pointsPreview / (config?.score_divisor ?? 1))} tokens`
              : '--'}
          </div>
        </div>

        <div style={styles.tallyGrid}>
          {Object.values(byPlayer).map(({ player, entries: pEntries }) => {
            const totalPts = pEntries.reduce((s, e) => s + (e.points_calculated || 0), 0);
            const tokenPreview = Math.floor(totalPts / (config?.score_divisor ?? 1));
            return (
              <div key={player?.display_name} style={{ ...styles.tallyCard, borderColor: theme + '44' }}>
                <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>{player?.display_name}</div>
                {pEntries.map(e => (
                  <div key={e.id} style={styles.entryRow}>
                    <span style={{ flex: 1, fontSize: 12 }}>{e.slots_categories?.label} x {e.encounter_count}</span>
                    <span style={{ color: '#90CAF9', fontSize: 12 }}>{e.points_calculated} pts</span>
                    <button onClick={() => handleRemove(e.id)} style={styles.removeBtn}>x</button>
                  </div>
                ))}
                <div style={styles.tallyFooter}>
                  <span style={{ opacity: 0.6, fontSize: 12 }}>Total</span>
                  <span style={{ fontWeight: 700 }}>{totalPts} pts</span>
                </div>
                <div style={{ ...styles.tallyFooter, color: '#4CAF50' }}>
                  <span style={{ opacity: 0.6, fontSize: 12 }}>Token award</span>
                  <span style={{ fontWeight: 700 }}>T {tokenPreview}</span>
                </div>
              </div>
            );
          })}
          {Object.keys(byPlayer).length === 0 && (
            <div style={{ color: '#444', padding: '32px 0', textAlign: 'center', gridColumn: '1/-1' }}>
              No scores saved for Day {dayNumber} yet.
            </div>
          )}
        </div>

        {canManage && (
          <div style={styles.commitBar}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={handleCommit}
                disabled={commitLoading || entries.length === 0}
                style={{ ...styles.bigBtn, background: theme, opacity: entries.length === 0 ? 0.4 : 1 }}>
                {commitLoading ? 'Committing...' : `Commit Day ${dayNumber}`}
              </button>
              {lastCommit && (
                <button onClick={handleUndo} disabled={undoLoading}
                  style={{ ...styles.bigBtn, background: '#555' }}>
                  {undoLoading ? 'Undoing...' : `Undo Day ${lastCommit.day_number}`}
                </button>
              )}
            </div>
            {commitMsg && <div style={{ fontSize: 13, color: commitMsg.startsWith('Error') ? '#f44' : '#4CAF50', marginTop: 8 }}>{commitMsg}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: '#0a0a0f', color: '#e0e0e0', fontFamily: "'Segoe UI', sans-serif" },
  center: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh', color: '#888' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 24px', borderBottom: '2px solid', background: '#111' },
  title: { fontSize: 18, fontWeight: 800 },
  linkBtn: { padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, color: '#e0e0e0', background: '#222', border: '1px solid #333', cursor: 'pointer', textDecoration: 'none' },
  content: { maxWidth: 1100, margin: '0 auto', padding: 24 },
  formCard: { background: '#111', border: '1px solid #222', borderRadius: 10, padding: '18px 20px', marginBottom: 24 },
  formRow: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  input: { background: '#0d0d14', border: '1px solid #2a2a3a', borderRadius: 6, color: '#e0e0e0', padding: '8px 12px', fontSize: 13, flex: 1, minWidth: 140 },
  btn: { padding: '8px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, color: '#fff', border: 'none', cursor: 'pointer' },
  bigBtn: { padding: '10px 24px', borderRadius: 8, fontSize: 14, fontWeight: 700, color: '#fff', border: 'none', cursor: 'pointer' },
  errorMsg: { color: '#f44', fontSize: 12, marginTop: 6 },
  tallyGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16, marginBottom: 24 },
  tallyCard: { background: '#111', border: '1px solid', borderRadius: 10, padding: 16 },
  entryRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid #1a1a1a' },
  removeBtn: { background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 12, padding: '0 4px', lineHeight: 1 },
  tallyFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, marginTop: 4 },
  commitBar: { background: '#111', border: '1px solid #222', borderRadius: 10, padding: '18px 20px' },
};
