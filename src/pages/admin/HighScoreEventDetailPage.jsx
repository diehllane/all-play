// src/pages/admin/HighScoreEventDetailPage.jsx

import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  getHSConfig, getHSTeams, getHSPlayers, getHSDailyTotals,
  buildHSStandings, getHSLastCommittedDay,
} from '../../lib/highscore';
import { exportHighScoreXLSX } from '../../lib/highscoreExport';

const ACC = '#c62828';

export default function HighScoreEventDetailPage() {
  const { id: eventId } = useParams();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const canManage = profile?.role === 'event_runner' || profile?.role === 'owner';

  const [event, setEvent] = useState(null);
  const [config, setConfig] = useState(null);
  const [teams, setTeams] = useState([]);
  const [players, setPlayers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [dailyTotals, setDailyTotals] = useState([]);
  const [commits, setCommits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [msg, setMsg] = useState('');

  useEffect(() => { loadAll(); }, [eventId]);

  async function loadAll() {
    setLoading(true);
    try {
      const [evRes, catRes, commitRes] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).single(),
        supabase.from('categories').select('*').eq('event_id', eventId).order('name'),
        supabase.from('hs_commits').select('*').eq('event_id', eventId).order('day_number', { ascending: false }),
      ]);
      setEvent(evRes.data);
      setCategories(catRes.data || []);
      setCommits(commitRes.data || []);

      const [cfg, tm, pl, dt] = await Promise.all([
        getHSConfig(eventId).catch(() => null),
        getHSTeams(eventId),
        getHSPlayers(eventId),
        getHSDailyTotals(eventId),
      ]);
      setConfig(cfg);
      setTeams(tm);
      setPlayers(pl);
      setDailyTotals(dt);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteEvent() {
    if (!confirm(`Delete "${event?.name}" and all data? This cannot be undone.`)) return;
    if (!confirm('Are you absolutely sure?')) return;
    const { error } = await supabase.from('events').delete().eq('id', eventId);
    if (error) { setMsg(error.message); return; }
    navigate('/admin');
  }

  function handleExport() {
    exportHighScoreXLSX(event?.name || 'Event', config, teams, players, dailyTotals, commits, categories);
  }

  if (loading) return <div style={s.loading}>Loading...</div>;

  const { individualStandings, teamStandings } = buildHSStandings(
    dailyTotals, players, teams, config?.mode || 'solo'
  );

  const tabs = ['overview', 'commits'];

  return (
    <div style={s.page}>
      <div style={s.topBar}>
        <div>
          <Link to="/admin" style={s.back}>← Dashboard</Link>
          <h1 style={s.title}>{event?.name}</h1>
          <span style={s.typeBadge}>High Score · {config?.mode === 'team' ? 'Team' : 'Solo'}</span>
        </div>
        <div style={s.topActions}>
          <Link to={`/admin/highscore/${eventId}/scores`} style={s.actionBtn}>Enter Scores</Link>
          <Link to={`/highscore/${eventId}`} style={s.actionBtn}>Public Page</Link>
          <Link to={`/admin/highscore/${eventId}/edit`} style={s.secondaryBtn}>Edit Event</Link>
          <button onClick={handleExport} style={s.secondaryBtn}>Export Results XLSX</button>
          {canManage && (
            <button onClick={handleDeleteEvent} style={s.dangerBtn}>Delete Event</button>
          )}
        </div>
      </div>

      {msg && <div style={s.msg}>{msg}</div>}

      <div style={s.tabs}>
        {tabs.map(t => (
          <button key={t} onClick={() => setActiveTab(t)} style={activeTab === t ? s.tabActive : s.tab}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div style={s.section}>
          <div style={s.statsRow}>
            <Stat label="Players" value={players.length} />
            <Stat label="Teams" value={teams.length} />
            <Stat label="Days Committed" value={commits.length} />
            <Stat label="Categories" value={categories.length} />
          </div>

          {config?.mode === 'team' && teamStandings.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <h3 style={s.sectionHead}>Team Standings</h3>
              <table style={s.table}>
                <thead><tr>
                  <th style={s.th}>Rank</th>
                  <th style={s.th}>Team</th>
                  <th style={s.th}>Total Score</th>
                </tr></thead>
                <tbody>
                  {teamStandings.map(t => (
                    <tr key={t.teamId}>
                      <td style={s.td}>#{t.rank}</td>
                      <td style={s.td}>{t.name}</td>
                      <td style={s.td}>{t.totalScore.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 style={s.sectionHead}>Individual Standings</h3>
          <table style={s.table}>
            <thead><tr>
              <th style={s.th}>Rank</th>
              <th style={s.th}>Player</th>
              {config?.mode === 'team' && <th style={s.th}>Team</th>}
              <th style={s.th}>Total Score</th>
            </tr></thead>
            <tbody>
              {individualStandings.map(p => (
                <tr key={p.playerId}>
                  <td style={s.td}>#{p.rank}</td>
                  <td style={s.td}>{p.name}</td>
                  {config?.mode === 'team' && <td style={s.td}>{p.teamName || '—'}</td>}
                  <td style={s.td}>{p.totalScore.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'commits' && (
        <div style={s.section}>
          <h3 style={s.sectionHead}>Commit History</h3>
          {commits.length === 0 ? <p style={{ color: '#888' }}>No commits yet.</p> : (
            <table style={s.table}>
              <thead><tr>
                <th style={s.th}>Day</th>
                <th style={s.th}>Committed At</th>
              </tr></thead>
              <tbody>
                {commits.map(c => (
                  <tr key={c.id}>
                    <td style={s.td}>Day {c.day_number}</td>
                    <td style={s.td}>{new Date(c.committed_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, padding: '12px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: ACC }}>{value}</div>
      <div style={{ color: '#888', fontSize: 13, marginTop: 2 }}>{label}</div>
    </div>
  );
}

const s = {
  page: { maxWidth: 960, margin: '0 auto', padding: '24px 16px', fontFamily: 'sans-serif' },
  loading: { padding: 40, textAlign: 'center', color: '#aaa' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 },
  back: { color: '#888', textDecoration: 'none', fontSize: 13 },
  title: { margin: '4px 0', fontSize: 22, color: '#fff' },
  typeBadge: { background: '#2a2a2a', color: '#aaa', borderRadius: 4, padding: '2px 8px', fontSize: 12 },
  topActions: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  actionBtn: { background: ACC, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', textDecoration: 'none', fontSize: 13 },
  secondaryBtn: { background: '#222', color: '#ccc', border: '1px solid #444', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontSize: 13, textDecoration: 'none' },
  dangerBtn: { background: '#5c1a1a', color: '#ff8a8a', border: '1px solid #7a2020', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontSize: 13 },
  msg: { background: '#1e1e1e', border: '1px solid #444', borderRadius: 6, padding: '10px 14px', color: '#ffb', marginBottom: 16 },
  tabs: { display: 'flex', gap: 0, borderBottom: '1px solid #333', marginBottom: 20 },
  tab: { background: 'none', border: 'none', color: '#888', padding: '10px 18px', cursor: 'pointer', fontSize: 13 },
  tabActive: { background: 'none', border: 'none', borderBottom: '2px solid #c62828', color: '#fff', padding: '10px 18px', cursor: 'pointer', fontWeight: 700, fontSize: 13 },
  section: { paddingTop: 4 },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 12, marginBottom: 24 },
  sectionHead: { color: '#fff', fontSize: 15, marginBottom: 12, marginTop: 20 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: { textAlign: 'left', color: '#888', padding: '8px 12px', borderBottom: '1px solid #333', fontSize: 12, textTransform: 'uppercase' },
  td: { padding: '10px 12px', borderBottom: '1px solid #222', color: '#ddd' },
};
