import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

export default function BingoEventDetailPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const canManage = profile?.role === 'event_runner' || profile?.role === 'owner';

  const [event, setEvent] = useState(null);
  const [config, setConfig] = useState(null);
  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [commits, setCommits] = useState([]);
  const [scores, setScores] = useState([]);
  const [squares, setSquares] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState(null);

  const flash = (text, isError = false) => { setMsg({ text, isError }); setTimeout(() => setMsg(null), 5000); };

  const load = useCallback(async () => {
    const [
      { data: ev },
      { data: cfg },
      { data: pls },
      { data: tms },
      { data: cms },
      { data: scs },
      { data: sqs },
    ] = await Promise.all([
      supabase.from('events').select('*').eq('id', eventId).single(),
      supabase.from('bingo_config').select('*').eq('event_id', eventId).single(),
      supabase.from('bingo_players').select('*').eq('event_id', eventId).order('sort_order'),
      supabase.from('bingo_teams').select('*').eq('event_id', eventId).order('sort_order'),
      supabase.from('bingo_commits').select('*').eq('event_id', eventId).order('day_number', { ascending: false }),
      supabase.from('bingo_scores').select('*').eq('event_id', eventId),
      supabase.from('bingo_squares').select('*').eq('event_id', eventId).order('position'),
    ]);
    setEvent(ev);
    setConfig(cfg);
    setPlayers(pls ?? []);
    setTeams(tms ?? []);
    setCommits(cms ?? []);
    setScores(scs ?? []);
    setSquares(sqs ?? []);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async () => {
    if (!window.confirm('Delete this Bingo event and ALL associated data? This cannot be undone.')) return;
    setDeleting(true);
    await supabase.from('bingo_score_entries').delete().eq('event_id', eventId);
    await supabase.from('bingo_lines_completed').delete().eq('event_id', eventId);
    await supabase.from('bingo_square_completions').delete().eq('event_id', eventId);
    await supabase.from('bingo_team_square_completions').delete().eq('event_id', eventId);
    await supabase.from('bingo_daily_scores').delete().eq('event_id', eventId);
    await supabase.from('bingo_scores').delete().eq('event_id', eventId);
    await supabase.from('bingo_commits').delete().eq('event_id', eventId);
    await supabase.from('bingo_players').delete().eq('event_id', eventId);
    await supabase.from('bingo_teams').delete().eq('event_id', eventId);
    await supabase.from('bingo_squares').delete().eq('event_id', eventId);
    await supabase.from('bingo_config').delete().eq('event_id', eventId);
    await supabase.from('events').delete().eq('id', eventId);
    navigate('/admin');
  };

  if (loading) return <div style={{ padding: 40, color: 'var(--text-dim)' }}>Loading...</div>;
  if (!config || !event) return <div style={{ padding: 40, color: '#ef4444' }}>Event not found.</div>;

  const themeColor = config.theme_color || '#c62828';
  const isTeam = config.event_type === 'team';
  const playerScores = scores.filter(s => s.player_id);
  const teamScores = scores.filter(s => s.team_id);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '32px 24px' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
          <button onClick={() => navigate('/admin')} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-dim)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>← Dashboard</button>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: 'var(--text)' }}>{config.game_title || event.name}</h1>
          <span style={{ background: `${themeColor}22`, color: themeColor, fontWeight: 700, borderRadius: 6, padding: '3px 10px', fontSize: 12 }}>
            BINGO · {isTeam ? 'TEAM' : 'SOLO'}
          </span>
        </div>

        {msg && (
          <div style={{ background: msg.isError ? '#ef444422' : `${themeColor}22`, border: `1px solid ${msg.isError ? '#ef4444' : themeColor}`, color: msg.isError ? '#ef4444' : themeColor, borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontWeight: 600 }}>
            {msg.text}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 28 }}>
          <Link to={`/bingo/${eventId}`} style={{ background: themeColor, color: '#fff', borderRadius: 7, padding: '9px 18px', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
            View Public Board
          </Link>
          <Link to={`/admin/bingo/${eventId}/scores`} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 7, padding: '9px 18px', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
            Score Entry
          </Link>
          <Link to={`/admin/bingo/${eventId}/edit`} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 7, padding: '9px 18px', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
            Edit Board & Config
          </Link>
          {canManage && (
            <button onClick={handleDelete} disabled={deleting}
              style={{ marginLeft: 'auto', background: 'none', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 7, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {deleting ? 'Deleting...' : 'Delete Event'}
            </button>
          )}
        </div>

        {/* Config summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 28 }}>
          {[
            { label: 'Event Type', value: isTeam ? 'Team Bingo' : 'Solo Bingo' },
            { label: 'Free Space', value: config.free_space_enabled ? 'Enabled' : 'Disabled' },
            { label: 'Score Divisor', value: `÷${config.score_divisor}` },
            { label: 'Squares', value: squares.length },
            { label: 'Players', value: players.length },
            { label: 'Teams', value: isTeam ? teams.length : '—' },
            { label: 'Days Committed', value: commits.length },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Current standings */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 24 }}>
          <div style={{ background: `${themeColor}22`, borderBottom: `2px solid ${themeColor}`, padding: '12px 18px' }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: 1 }}>
              {isTeam ? 'Team Standings' : 'Player Standings'}
            </h2>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 600 }}>#</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 600 }}>{isTeam ? 'Team' : 'Player'}</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-dim)', fontWeight: 600 }}>Squares</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-dim)', fontWeight: 600 }}>Bingo Bonus</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-dim)', fontWeight: 600 }}>Total</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-dim)', fontWeight: 600 }}>Bingos</th>
              </tr>
            </thead>
            <tbody>
              {(isTeam ? teams : players)
                .map(subject => {
                  const s = isTeam
                    ? teamScores.find(x => x.team_id === subject.id)
                    : playerScores.find(x => x.player_id === subject.id);
                  return { ...subject, squareScore: s?.square_score ?? 0, bingoScore: s?.bingo_score ?? 0, total: s?.total_score ?? 0, bingos: s?.bingo_count ?? 0 };
                })
                .sort((a, b) => b.total - a.total)
                .map((s, i) => (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 16px', color: 'var(--text-dim)' }}>{i + 1}</td>
                    <td style={{ padding: '10px 16px', color: 'var(--text)', fontWeight: 600 }}>{s.name}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text)' }}>{s.squareScore}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', color: themeColor, fontWeight: 600 }}>{s.bingoScore}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text)', fontWeight: 700, fontSize: 15 }}>{s.total}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                      <span style={{ background: `${themeColor}22`, color: themeColor, fontWeight: 700, borderRadius: 4, padding: '2px 8px' }}>{s.bingos}</span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* Commit history */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ background: `${themeColor}22`, borderBottom: `2px solid ${themeColor}`, padding: '12px 18px' }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: 1 }}>Commit History</h2>
          </div>
          {commits.length === 0 && <div style={{ padding: 20, color: 'var(--text-dim)', fontSize: 13 }}>No days committed yet.</div>}
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              {commits.length > 0 && (
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '10px 16px', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 600 }}>Day</th>
                  <th style={{ padding: '10px 16px', textAlign: 'left', color: 'var(--text-dim)', fontWeight: 600 }}>Committed At</th>
                  <th style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-dim)', fontWeight: 600 }}>Team Bingos</th>
                  <th style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-dim)', fontWeight: 600 }}>Indiv. Bingos</th>
                  <th style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-dim)', fontWeight: 600 }}>Entries</th>
                </tr>
              )}
            </thead>
            <tbody>
              {commits.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 16px', color: 'var(--text)', fontWeight: 600 }}>Day {c.day_number}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--text-dim)' }}>{new Date(c.committed_at).toLocaleString()}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text)' }}>{c.results_summary?.teamBingos ?? 0}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text)' }}>{c.results_summary?.individualBingos ?? 0}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text)' }}>{c.results_summary?.entriesCommitted ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
