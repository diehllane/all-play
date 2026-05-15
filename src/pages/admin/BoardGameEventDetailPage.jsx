// src/pages/admin/BoardGameEventDetailPage.jsx
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { exportBoardGameXLSX } from '../../lib/boardgameExport';

export default function BoardGameEventDetailPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isRunner = profile?.role === 'event_runner';

  const [event, setEvent]         = useState(null);
  const [config, setConfig]       = useState(null);
  const [players, setPlayers]     = useState([]);
  const [categories, setCategories] = useState([]);
  const [positions, setPositions] = useState([]);
  const [squares, setSquares]     = useState([]);
  const [commits, setCommits]     = useState([]);
  const [scoreEntries, setScoreEntries] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [message, setMessage]     = useState(null);
  const [deleting, setDeleting]   = useState(false);

  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerAvatar, setNewPlayerAvatar] = useState('');
  const [addingPlayer, setAddingPlayer] = useState(false);

  const load = useCallback(async () => {
    const [evRes, cfgRes, plRes, catRes, posRes, sqRes, cmtRes, entRes] = await Promise.all([
      supabase.from('events').select('*').eq('id', eventId).single(),
      supabase.from('board_game_config').select('*').eq('event_id', eventId).single(),
      supabase.from('board_players').select('*').eq('event_id', eventId).order('sort_order'),
      supabase.from('categories').select('*').eq('event_id', eventId).order('name'),
      supabase.from('board_player_positions').select('*').eq('event_id', eventId),
      supabase.from('board_squares').select('*').eq('event_id', eventId).order('square_number'),
      supabase.from('board_commits').select('*').eq('event_id', eventId).order('day_number'),
      supabase.from('board_score_entries').select('*').eq('event_id', eventId),
    ]);
    setEvent(evRes.data);
    setConfig(cfgRes.data);
    setPlayers(plRes.data || []);
    setCategories(catRes.data || []);
    setPositions(posRes.data || []);
    setSquares(sqRes.data || []);
    setCommits(cmtRes.data || []);
    setScoreEntries(entRes.data || []);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const handleAddPlayer = async () => {
    if (!newPlayerName.trim()) return;
    setAddingPlayer(true);
    const { error } = await supabase.from('board_players').insert({
      event_id: eventId,
      name: newPlayerName.trim(),
      avatar_url: newPlayerAvatar.trim() || null,
      sort_order: players.length,
    });
    if (error) {
      setMessage({ type: 'error', text: error.message });
    } else {
      setNewPlayerName('');
      setNewPlayerAvatar('');
      await load();
    }
    setAddingPlayer(false);
  };

  const handleRemovePlayer = async (playerId) => {
    if (!confirm('Remove this player? All their score entries will also be deleted.')) return;
    await supabase.from('board_players').delete().eq('id', playerId);
    await load();
  };

  const handleDeleteEvent = async () => {
    if (!confirm(`Delete "${event?.name}" and ALL its data? This cannot be undone.`)) return;
    setDeleting(true);
    const { error } = await supabase.from('events').delete().eq('id', eventId);
    if (error) {
      setMessage({ type: 'error', text: error.message });
      setDeleting(false);
    } else {
      navigate('/admin');
    }
  };

  const handleExport = () => {
    exportBoardGameXLSX(event, config, players, positions, scoreEntries, commits, squares, categories);
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#aaa' }}>Loading...</div>;

  const themeColor = config?.theme_color || '#c62828';

  return (
    <div style={{ padding: 24, maxWidth: 860, margin: '0 auto', color: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <Link to="/admin" style={{ color: '#888', textDecoration: 'none', fontSize: 13 }}>← Dashboard</Link>
          <h2 style={{ margin: '4px 0' }}>{event?.name}</h2>
          <span style={{ fontSize: 12, opacity: 0.6, background: '#c62828', padding: '2px 8px', borderRadius: 10 }}>Board Game</span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link to={`/board/${eventId}`}
            style={{ padding: '8px 16px', background: '#1e1e2e', border: '1px solid #444', color: '#fff', borderRadius: 6, textDecoration: 'none', fontSize: 13 }}>
            🎮 View Board
          </Link>
          <Link to={`/admin/board/${eventId}/scores`}
            style={{ padding: '8px 16px', background: themeColor, border: 'none', color: '#fff', borderRadius: 6, textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>
            📝 Score Entry
          </Link>
          <button onClick={handleExport}
            style={{ padding: '8px 16px', background: '#1a3a1a', border: '1px solid #2e7d32', color: '#fff', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
            📥 Export XLSX
          </button>
        </div>
      </div>

      {message && (
        <div style={{ padding: '10px 16px', marginBottom: 16, borderRadius: 6, background: message.type === 'error' ? '#4a1010' : '#0f3d1f', border: `1px solid ${message.type === 'error' ? '#c62828' : '#2e7d32'}` }}>
          {message.text}
          <button onClick={() => setMessage(null)} style={{ float: 'right', background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {config && (
        <div style={{ background: '#1e1e2e', borderRadius: 8, padding: 16, marginBottom: 20, border: '1px solid #2a2a3e' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>Board Configuration</h3>
            {isRunner && (
              <Link to={`/admin/board/${eventId}/edit`} style={{ fontSize: 12, color: themeColor, textDecoration: 'none' }}>Edit →</Link>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, fontSize: 13 }}>
            {[
              ['Track Length', config.track_length],
              ['Grid Columns', config.grid_columns],
              ['Score Operation', `÷${config.score_divisor} (${config.score_operation})`],
              ['Rounding', config.score_rounding],
              ['Min Moves/Day', config.min_moves_per_day],
              ['Max Moves/Day', config.max_moves_per_day === 0 ? 'No cap' : config.max_moves_per_day],
              ['Badge Bonus', config.badge_bonus_enabled ? 'Enabled' : 'Disabled'],
              ['Total Squares', squares.length + ' defined'],
            ].map(([k, v]) => (
              <div key={k} style={{ background: '#13131f', padding: '8px 12px', borderRadius: 6 }}>
                <div style={{ fontSize: 10, opacity: 0.6 }}>{k}</div>
                <div style={{ fontWeight: 600 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ background: '#1e1e2e', borderRadius: 8, padding: 16, marginBottom: 20, border: '1px solid #2a2a3e' }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: 14 }}>Commit History</h3>
        {commits.length === 0
          ? <div style={{ opacity: 0.4, fontSize: 13 }}>No days committed yet.</div>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Day','Committed At','Status'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '4px 10px', borderBottom: '1px solid #2a2a3e', opacity: 0.6, fontWeight: 400 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {commits.map(c => (
                  <tr key={c.id}>
                    <td style={{ padding: '6px 10px' }}>Day {c.day_number}</td>
                    <td style={{ padding: '6px 10px', opacity: 0.7 }}>{new Date(c.committed_at).toLocaleString()}</td>
                    <td style={{ padding: '6px 10px' }}>
                      {c.reverted_at
                        ? <span style={{ color: '#ef5350' }}>Reverted</span>
                        : <span style={{ color: '#4caf50' }}>✓ Committed</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </div>

      <div style={{ background: '#1e1e2e', borderRadius: 8, padding: 16, marginBottom: 20, border: '1px solid #2a2a3e' }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: 14 }}>Players ({players.length})</h3>
        {players.map(p => {
          const pos = positions.find(x => x.player_id === p.id);
          return (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #2a2a3e', fontSize: 13 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {p.avatar_url && <img src={p.avatar_url} alt="" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} />}
                <span>{p.name}</span>
              </div>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', opacity: 0.7 }}>
                <span>Sq {pos?.position ?? 0}</span>
                {isRunner && (
                  <button onClick={() => handleRemovePlayer(p.id)}
                    style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 16 }}>✕</button>
                )}
              </div>
            </div>
          );
        })}
        {isRunner && (
          <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input value={newPlayerName} onChange={e => setNewPlayerName(e.target.value)}
              placeholder="Player name"
              style={{ flex: '1 1 160px', padding: '7px 12px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13 }} />
            <input value={newPlayerAvatar} onChange={e => setNewPlayerAvatar(e.target.value)}
              placeholder="Avatar URL (optional)"
              style={{ flex: '2 1 200px', padding: '7px 12px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13 }} />
            <button onClick={handleAddPlayer} disabled={!newPlayerName.trim() || addingPlayer}
              style={{ padding: '7px 16px', background: themeColor, border: 'none', color: '#fff', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
              + Add Player
            </button>
          </div>
        )}
      </div>

      <div style={{ background: '#1e1e2e', borderRadius: 8, padding: 16, marginBottom: 20, border: '1px solid #2a2a3e' }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: 14 }}>Encounter Categories ({categories.length})</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {categories.map(c => (
            <span key={c.id} style={{ background: '#13131f', border: '1px solid #333', padding: '4px 10px', borderRadius: 12, fontSize: 12 }}>
              {c.name} <span style={{ color: '#ffd700' }}>{c.multiplier}pts</span>
            </span>
          ))}
        </div>
      </div>

      {isRunner && (
        <div style={{ background: '#1e0a0a', borderRadius: 8, padding: 16, border: '1px solid #4a1010' }}>
          <h3 style={{ margin: '0 0 8px 0', fontSize: 14, color: '#ef5350' }}>Danger Zone</h3>
          <p style={{ fontSize: 13, opacity: 0.7, margin: '0 0 12px 0' }}>
            Deleting this event removes all players, scores, positions, and commit history permanently.
          </p>
          <button onClick={handleDeleteEvent} disabled={deleting}
            style={{ padding: '8px 20px', background: '#c62828', border: 'none', color: '#fff', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
            {deleting ? 'Deleting...' : 'Delete Event'}
          </button>
        </div>
      )}
    </div>
  );
}
