// src/pages/admin/HighScoreEventDetailPage.jsx

import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  getHSConfig, getHSTeams, getHSPlayers, getHSDailyTotals,
  createHSTeam, updateHSTeam, deleteHSTeam,
  createHSPlayer, updateHSPlayer, deleteHSPlayer,
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

  const [newTeam, setNewTeam] = useState({ name: '', avatar_url: '', handicap_multiplier: 1, discord_webhook_url: '' });
  const [editTeam, setEditTeam] = useState(null);
  const [newPlayer, setNewPlayer] = useState({ name: '', avatar_url: '', team_id: '' });
  const [editPlayer, setEditPlayer] = useState(null);
  const [newCat, setNewCat] = useState({ name: '', multiplier: 1 });

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

  async function handleAddTeam() {
    if (!newTeam.name.trim()) return;
    try {
      await createHSTeam(eventId, newTeam);
      setNewTeam({ name: '', avatar_url: '', handicap_multiplier: 1, discord_webhook_url: '' });
      await loadAll();
    } catch (e) { setMsg(e.message); }
  }

  async function handleSaveTeam() {
    if (!editTeam) return;
    try {
      await updateHSTeam(editTeam.id, {
        name: editTeam.name, avatar_url: editTeam.avatar_url,
        handicap_multiplier: editTeam.handicap_multiplier,
        discord_webhook_url: editTeam.discord_webhook_url,
      });
      setEditTeam(null);
      await loadAll();
    } catch (e) { setMsg(e.message); }
  }

  async function handleDeleteTeam(id) {
    if (!confirm('Delete team and all associated data?')) return;
    await deleteHSTeam(id);
    await loadAll();
  }

  async function handleAddPlayer() {
    if (!newPlayer.name.trim()) return;
    try {
      await createHSPlayer(eventId, {
        name: newPlayer.name, avatar_url: newPlayer.avatar_url, team_id: newPlayer.team_id || null,
      });
      setNewPlayer({ name: '', avatar_url: '', team_id: '' });
      await loadAll();
    } catch (e) { setMsg(e.message); }
  }

  async function handleSavePlayer() {
    if (!editPlayer) return;
    try {
      await updateHSPlayer(editPlayer.id, {
        name: editPlayer.name, avatar_url: editPlayer.avatar_url, team_id: editPlayer.team_id || null,
      });
      setEditPlayer(null);
      await loadAll();
    } catch (e) { setMsg(e.message); }
  }

  async function handleDeletePlayer(id) {
    if (!confirm('Remove this player?')) return;
    await deleteHSPlayer(id);
    await loadAll();
  }

  async function handleAddCategory() {
    if (!newCat.name.trim()) return;
    const { error } = await supabase.from('categories').insert({
      event_id: eventId, name: newCat.name, multiplier: Number(newCat.multiplier),
    });
    if (error) { setMsg(error.message); return; }
    setNewCat({ name: '', multiplier: 1 });
    await loadAll();
  }

  async function handleDeleteCategory(id) {
    await supabase.from('categories').delete().eq('id', id);
    await loadAll();
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

  const tabs = ['overview', 'teams', 'players', 'categories', 'commits'];

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
          <button onClick={handleExport} style={s.secondaryBtn}>Export XLSX</button>
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

      {activeTab === 'teams' && config?.mode === 'team' && (
        <div style={s.section}>
          <h3 style={s.sectionHead}>Teams</h3>
          {teams.map(t => (
            editTeam?.id === t.id ? (
              <div key={t.id} style={s.editRow}>
                <input value={editTeam.name} onChange={e => setEditTeam(p => ({ ...p, name: e.target.value }))} style={s.input} placeholder="Team name" />
                <input value={editTeam.avatar_url} onChange={e => setEditTeam(p => ({ ...p, avatar_url: e.target.value }))} style={s.input} placeholder="Avatar URL" />
                <input value={editTeam.handicap_multiplier} type="number" step="0.1" onChange={e => setEditTeam(p => ({ ...p, handicap_multiplier: e.target.value }))} style={{ ...s.input, width: 80 }} />
                <input value={editTeam.discord_webhook_url} onChange={e => setEditTeam(p => ({ ...p, discord_webhook_url: e.target.value }))} style={s.input} placeholder="Discord webhook URL" />
                <button onClick={handleSaveTeam} style={s.saveBtn}>Save</button>
                <button onClick={() => setEditTeam(null)} style={s.cancelBtn}>Cancel</button>
              </div>
            ) : (
              <div key={t.id} style={s.listRow}>
                {t.avatar_url && <img src={t.avatar_url} style={s.avatar} alt="" />}
                <span style={s.listName}>{t.name}</span>
                {config?.allow_handicap && <span style={s.badge}>×{t.handicap_multiplier}</span>}
                {t.discord_webhook_url && <span style={s.badge}>Discord ✓</span>}
                {canManage && <button onClick={() => setEditTeam({ ...t })} style={s.editBtn}>Edit</button>}
                {canManage && <button onClick={() => handleDeleteTeam(t.id)} style={s.deleteBtn}>Remove</button>}
              </div>
            )
          ))}
          {canManage && (
            <div style={s.addRow}>
              <input value={newTeam.name} onChange={e => setNewTeam(p => ({ ...p, name: e.target.value }))} style={s.input} placeholder="New team name" />
              <input value={newTeam.avatar_url} onChange={e => setNewTeam(p => ({ ...p, avatar_url: e.target.value }))} style={s.input} placeholder="Avatar URL (optional)" />
              <input value={newTeam.handicap_multiplier} type="number" step="0.1" onChange={e => setNewTeam(p => ({ ...p, handicap_multiplier: e.target.value }))} style={{ ...s.input, width: 80 }} placeholder="Handicap ×" />
              <input value={newTeam.discord_webhook_url} onChange={e => setNewTeam(p => ({ ...p, discord_webhook_url: e.target.value }))} style={s.input} placeholder="Discord webhook URL (optional)" />
              <button onClick={handleAddTeam} style={s.addBtn}>+ Add Team</button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'teams' && config?.mode !== 'team' && (
        <div style={s.section}>
          <p style={{ color: '#888' }}>This event is in solo mode. Teams are not used.</p>
        </div>
      )}

      {activeTab === 'players' && (
        <div style={s.section}>
          <h3 style={s.sectionHead}>Players</h3>
          {players.map(p => (
            editPlayer?.id === p.id ? (
              <div key={p.id} style={s.editRow}>
                <input value={editPlayer.name} onChange={e => setEditPlayer(prev => ({ ...prev, name: e.target.value }))} style={s.input} placeholder="Player name" />
                <input value={editPlayer.avatar_url} onChange={e => setEditPlayer(prev => ({ ...prev, avatar_url: e.target.value }))} style={s.input} placeholder="Avatar URL" />
                {config?.mode === 'team' && (
                  <select value={editPlayer.team_id || ''} onChange={e => setEditPlayer(prev => ({ ...prev, team_id: e.target.value }))} style={s.select}>
                    <option value="">No team</option>
                    {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                )}
                <button onClick={handleSavePlayer} style={s.saveBtn}>Save</button>
                <button onClick={() => setEditPlayer(null)} style={s.cancelBtn}>Cancel</button>
              </div>
            ) : (
              <div key={p.id} style={s.listRow}>
                {p.avatar_url && <img src={p.avatar_url} style={s.avatar} alt="" />}
                <span style={s.listName}>{p.name}</span>
                {p.hs_teams && <span style={s.badge}>{p.hs_teams.name}</span>}
                {canManage && <button onClick={() => setEditPlayer({ ...p })} style={s.editBtn}>Edit</button>}
                {canManage && <button onClick={() => handleDeletePlayer(p.id)} style={s.deleteBtn}>Remove</button>}
              </div>
            )
          ))}
          {canManage && (
            <div style={s.addRow}>
              <input value={newPlayer.name} onChange={e => setNewPlayer(p => ({ ...p, name: e.target.value }))} style={s.input} placeholder="Player name" />
              <input value={newPlayer.avatar_url} onChange={e => setNewPlayer(p => ({ ...p, avatar_url: e.target.value }))} style={s.input} placeholder="Avatar URL (optional)" />
              {config?.mode === 'team' && (
                <select value={newPlayer.team_id} onChange={e => setNewPlayer(p => ({ ...p, team_id: e.target.value }))} style={s.select}>
                  <option value="">No team</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
              <button onClick={handleAddPlayer} style={s.addBtn}>+ Add Player</button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'categories' && (
        <div style={s.section}>
          <h3 style={s.sectionHead}>Score Categories</h3>
          {categories.map(c => (
            <div key={c.id} style={s.listRow}>
              <span style={s.listName}>{c.name}</span>
              <span style={s.badge}>{c.multiplier} pts</span>
              {canManage && <button onClick={() => handleDeleteCategory(c.id)} style={s.deleteBtn}>Remove</button>}
            </div>
          ))}
          {canManage && (
            <div style={s.addRow}>
              <input value={newCat.name} onChange={e => setNewCat(p => ({ ...p, name: e.target.value }))} style={s.input} placeholder="Category name" />
              <input value={newCat.multiplier} type="number" onChange={e => setNewCat(p => ({ ...p, multiplier: e.target.value }))} style={{ ...s.input, width: 80 }} placeholder="Pts" />
              <button onClick={handleAddCategory} style={s.addBtn}>+ Add</button>
            </div>
          )}
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
  listRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #222', flexWrap: 'wrap' },
  editRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', flexWrap: 'wrap' },
  addRow: { display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' },
  listName: { color: '#fff', fontWeight: 600, flex: 1 },
  avatar: { width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' },
  badge: { background: '#2a2a2a', color: '#aaa', borderRadius: 4, padding: '2px 8px', fontSize: 12 },
  input: { background: '#1a1a1a', color: '#fff', border: '1px solid #444', borderRadius: 6, padding: '7px 10px', fontSize: 13, flex: 1, minWidth: 140 },
  select: { background: '#1a1a1a', color: '#fff', border: '1px solid #444', borderRadius: 6, padding: '7px 10px', fontSize: 13 },
  addBtn: { background: ACC, color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap' },
  saveBtn: { background: '#1a4a1a', color: '#8bc34a', border: '1px solid #2d6a2d', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13 },
  cancelBtn: { background: 'none', color: '#888', border: '1px solid #444', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13 },
  editBtn: { background: 'none', color: '#888', border: '1px solid #333', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 },
  deleteBtn: { background: 'none', color: '#c55', border: '1px solid #522', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 },
};
