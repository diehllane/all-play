// src/pages/admin/BoardGameEditPage.jsx
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import BoardBuilder from '../../components/BoardBuilder';

const DEFAULT_CONFIG = {
  track_length: 252,
  grid_columns: 18,
  score_divisor: 2,
  score_operation: 'divide',
  score_rounding: 'ceil',
  min_moves_per_day: 1,
  max_moves_per_day: 0,
  theme_color: '#c62828',
  title_image_url: null,
  badge_bonus_enabled: true,
  show_badge_sidebar: true,
  show_flavor_text: true,
};

export default function BoardGameEditPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [event, setEvent]       = useState(null);
  const [config, setConfig]     = useState(null);
  const [squares, setSquares]   = useState([]);
  const [players, setPlayers]   = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [message, setMessage]   = useState(null);
  const [activeTab, setActiveTab] = useState('board');

  // New category form
  const [newCatName, setNewCatName] = useState('');
  const [newCatPts, setNewCatPts] = useState(1);

  const load = useCallback(async () => {
    const [evRes, cfgRes, sqRes, plRes, catRes] = await Promise.all([
      supabase.from('events').select('*').eq('id', eventId).single(),
      supabase.from('board_game_config').select('*').eq('event_id', eventId).single(),
      supabase.from('board_squares').select('*').eq('event_id', eventId).order('square_number'),
      supabase.from('board_players').select('*').eq('event_id', eventId).order('sort_order'),
      supabase.from('categories').select('*').eq('event_id', eventId).order('name'),
    ]);
    setEvent(evRes.data);
    setSquares(sqRes.data || []);
    setPlayers(plRes.data || []);
    setCategories(catRes.data || []);

    if (cfgRes.data) {
      setConfig(cfgRes.data);
    } else {
      // No config row yet — create one with defaults
      const { data: newCfg, error } = await supabase
        .from('board_game_config')
        .insert({ ...DEFAULT_CONFIG, event_id: eventId })
        .select()
        .single();
      if (!error) setConfig(newCfg);
      else setConfig({ ...DEFAULT_CONFIG, event_id: eventId });
    }
    setLoading(false);
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  // ── Save board squares ────────────────────────────────────
  const handleSaveSquares = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const { error: delErr } = await supabase.from('board_squares').delete().eq('event_id', eventId);
      if (delErr) throw delErr;
      if (squares.length > 0) {
        const inserts = squares.map(s => ({
          event_id: eventId,
          square_number: s.square_number,
          type: s.type,
          label: s.label || null,
          icon: s.icon || null,
          jump_to: s.jump_to != null && s.jump_to !== '' ? parseInt(s.jump_to) : null,
          move_amount: s.move_amount != null && s.move_amount !== '' ? parseInt(s.move_amount) : null,
          badge: s.badge || null,
          description: s.description || null,
          flavor_text: s.flavor_text || null,
        }));
        const { error: insErr } = await supabase.from('board_squares').insert(inserts);
        if (insErr) throw insErr;
      }
      setMessage({ type: 'success', text: 'Board tiles saved.' });
    } catch (e) {
      setMessage({ type: 'error', text: e.message });
    } finally {
      setSaving(false);
    }
  };

  // ── Save config ───────────────────────────────────────────
  const handleSaveConfig = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const { error } = await supabase
        .from('board_game_config')
        .update({
          track_length: config.track_length,
          grid_columns: config.grid_columns,
          score_divisor: config.score_divisor,
          score_operation: config.score_operation,
          score_rounding: config.score_rounding,
          min_moves_per_day: config.min_moves_per_day,
          max_moves_per_day: config.max_moves_per_day,
          theme_color: config.theme_color,
          title_image_url: config.title_image_url || null,
          badge_bonus_enabled: config.badge_bonus_enabled,
          show_badge_sidebar: config.show_badge_sidebar,
          show_flavor_text: config.show_flavor_text,
        })
        .eq('event_id', eventId);
      if (error) throw error;

      const { error: evErr } = await supabase
        .from('events')
        .update({ name: event.name, start_date: event.start_date || null, end_date: event.end_date || null, discord_overall_webhook: event.discord_overall_webhook || null })
        .eq('id', eventId);
      if (evErr) throw evErr;

      setMessage({ type: 'success', text: 'Configuration saved.' });
    } catch (e) {
      setMessage({ type: 'error', text: e.message });
    } finally {
      setSaving(false);
    }
  };

  // ── Categories ────────────────────────────────────────────
  const handleAddCategory = async () => {
    if (!newCatName.trim()) return;
    const { error } = await supabase.from('categories').insert({
      event_id: eventId,
      name: newCatName.trim(),
      multiplier: Number(newCatPts) || 1,
    });
    if (error) { setMessage({ type: 'error', text: error.message }); return; }
    setNewCatName('');
    setNewCatPts(1);
    await load();
  };

  const handleDeleteCategory = async (id) => {
    await supabase.from('categories').delete().eq('id', id);
    await load();
  };

  // ── Players ───────────────────────────────────────────────
  const handleSavePlayer = async (player) => {
    const { error } = await supabase
      .from('board_players')
      .update({ name: player.name, avatar_url: player.avatar_url || null })
      .eq('id', player.id);
    if (error) setMessage({ type: 'error', text: error.message });
    else setMessage({ type: 'success', text: `${player.name} updated.` });
  };

  const handleAddPlayer = async () => {
    const name = prompt('Player name:');
    if (!name?.trim()) return;
    const { error } = await supabase.from('board_players').insert({
      event_id: eventId, name: name.trim(), sort_order: players.length,
    });
    if (error) setMessage({ type: 'error', text: error.message });
    else await load();
  };

  const handleRemovePlayer = async (playerId, playerName) => {
    if (!confirm(`Remove ${playerName}?`)) return;
    await supabase.from('board_players').delete().eq('id', playerId);
    await load();
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#aaa' }}>Loading...</div>;

  const themeColor = config?.theme_color || '#c62828';

  const tabStyle = (tab) => ({
    padding: '8px 20px',
    background: activeTab === tab ? themeColor : '#2a2a3e',
    border: 'none',
    color: '#fff',
    borderRadius: '6px 6px 0 0',
    cursor: 'pointer',
    fontWeight: activeTab === tab ? 700 : 400,
    fontSize: 14,
  });

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto', color: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: '0 0 4px 0' }}>Edit: {event?.name}</h2>
          <span style={{ fontSize: 12, opacity: 0.5 }}>Board Game</span>
        </div>
        <button onClick={() => navigate(`/admin/board/${eventId}`)}
          style={{ padding: '8px 16px', background: '#2a2a3e', border: '1px solid #444', color: '#fff', borderRadius: 6, cursor: 'pointer' }}>
          ← Back to Event
        </button>
      </div>

      {message && (
        <div style={{ padding: '10px 16px', marginBottom: 16, borderRadius: 6, background: message.type === 'error' ? '#4a1010' : '#0f3d1f', border: `1px solid ${message.type === 'error' ? '#c62828' : '#2e7d32'}` }}>
          {message.text}
          <button onClick={() => setMessage(null)} style={{ float: 'right', background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, marginBottom: 0, borderBottom: `2px solid ${themeColor}` }}>
        <button style={tabStyle('board')} onClick={() => setActiveTab('board')}>🗺 Board Tiles</button>
        <button style={tabStyle('config')} onClick={() => setActiveTab('config')}>⚙️ Configuration</button>
        <button style={tabStyle('categories')} onClick={() => setActiveTab('categories')}>🎯 Categories</button>
        <button style={tabStyle('players')} onClick={() => setActiveTab('players')}>👥 Players</button>
      </div>

      <div style={{ background: '#1e1e2e', borderRadius: '0 6px 6px 6px', padding: 20, border: '1px solid #2a2a3e', borderTop: 'none' }}>

        {/* ── Board Tiles ── */}
        {activeTab === 'board' && (
          <div>
            <p style={{ fontSize: 13, opacity: 0.6, marginBottom: 16 }}>
              Click any tile to edit properties. Click an empty square to add a new tile.
            </p>
            <BoardBuilder
              squares={squares}
              onChange={setSquares}
              trackLength={config?.track_length || 252}
              gridColumns={config?.grid_columns || 18}
              themeColor={themeColor}
            />
            <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
              <button onClick={handleSaveSquares} disabled={saving}
                style={{ padding: '9px 24px', background: '#2e7d32', border: 'none', color: '#fff', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}>
                {saving ? 'Saving...' : '💾 Save Tiles'}
              </button>
              <span style={{ fontSize: 12, opacity: 0.5, alignSelf: 'center' }}>Replaces all existing tiles for this event.</span>
            </div>
          </div>
        )}

        {/* ── Configuration ── */}
        {activeTab === 'config' && config && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <Field label="Event Name" value={event?.name || ''} onChange={v => setEvent(e => ({ ...e, name: v }))} />
              <Field label="Theme Color" value={config.theme_color} onChange={v => setConfig(c => ({ ...c, theme_color: v }))} type="color" />
              <Field label="Start Date" value={event?.start_date || ''} onChange={v => setEvent(e => ({ ...e, start_date: v }))} type="date" />
              <Field label="End Date" value={event?.end_date || ''} onChange={v => setEvent(e => ({ ...e, end_date: v }))} type="date" />
              <Field label="Overall Discord Webhook" value={event?.discord_overall_webhook || ''} onChange={v => setEvent(e => ({ ...e, discord_overall_webhook: v }))} placeholder="https://discord.com/api/webhooks/..." />
              <Field label="Title Image URL" value={config.title_image_url || ''} onChange={v => setConfig(c => ({ ...c, title_image_url: v }))} placeholder="https://..." />
              <Field label="Track Length" value={config.track_length} onChange={v => setConfig(c => ({ ...c, track_length: parseInt(v) || 252 }))} type="number" />
              <Field label="Grid Columns" value={config.grid_columns} onChange={v => setConfig(c => ({ ...c, grid_columns: parseInt(v) || 18 }))} type="number" />
              <Field label="Score Divisor" value={config.score_divisor} onChange={v => setConfig(c => ({ ...c, score_divisor: parseFloat(v) || 2 }))} type="number" />
              <div>
                <label style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Score Operation</label>
                <select value={config.score_operation} onChange={e => setConfig(c => ({ ...c, score_operation: e.target.value }))}
                  style={{ width: '100%', padding: '8px 10px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13 }}>
                  <option value="divide">Divide</option>
                  <option value="multiply">Multiply</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Score Rounding</label>
                <select value={config.score_rounding} onChange={e => setConfig(c => ({ ...c, score_rounding: e.target.value }))}
                  style={{ width: '100%', padding: '8px 10px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13 }}>
                  <option value="ceil">Ceiling (round up)</option>
                  <option value="floor">Floor (round down)</option>
                  <option value="round">Round (nearest)</option>
                </select>
              </div>
              <Field label="Min Moves/Day" value={config.min_moves_per_day} onChange={v => setConfig(c => ({ ...c, min_moves_per_day: parseInt(v) || 0 }))} type="number" />
              <Field label="Max Moves/Day (0 = no cap)" value={config.max_moves_per_day} onChange={v => setConfig(c => ({ ...c, max_moves_per_day: parseInt(v) || 0 }))} type="number" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              <Toggle label="Badge Bonus Enabled" value={config.badge_bonus_enabled} onChange={v => setConfig(c => ({ ...c, badge_bonus_enabled: v }))} />
              <Toggle label="Show Badge Sidebar" value={config.show_badge_sidebar} onChange={v => setConfig(c => ({ ...c, show_badge_sidebar: v }))} />
              <Toggle label="Show Flavor Text" value={config.show_flavor_text} onChange={v => setConfig(c => ({ ...c, show_flavor_text: v }))} />
            </div>
            <button onClick={handleSaveConfig} disabled={saving}
              style={{ padding: '9px 24px', background: '#2e7d32', border: 'none', color: '#fff', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}>
              {saving ? 'Saving...' : '💾 Save Configuration'}
            </button>
          </div>
        )}

        {/* ── Categories ── */}
        {activeTab === 'categories' && (
          <div>
            <p style={{ fontSize: 13, opacity: 0.6, marginBottom: 16 }}>
              Categories define what encounter types scorers can add and how many points each is worth.
            </p>
            {categories.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid #2a2a3e', fontSize: 13 }}>
                <span style={{ flex: 1 }}>{c.name}</span>
                <span style={{ color: '#ffd700', minWidth: 60 }}>{c.multiplier} pts</span>
                <button onClick={() => handleDeleteCategory(c.id)}
                  style={{ background: 'none', border: '1px solid #4a1010', color: '#ef5350', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 12 }}>
                  Remove
                </button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                value={newCatName}
                onChange={e => setNewCatName(e.target.value)}
                placeholder="Category name (e.g. Shiny Legend)"
                style={{ flex: 1, minWidth: 180, padding: '8px 10px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13 }}
              />
              <input
                type="number"
                value={newCatPts}
                onChange={e => setNewCatPts(e.target.value)}
                style={{ width: 80, padding: '8px 10px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13 }}
                placeholder="Pts"
                min="1"
              />
              <button onClick={handleAddCategory}
                style={{ padding: '8px 18px', background: themeColor, border: 'none', color: '#fff', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}>
                + Add
              </button>
            </div>
          </div>
        )}

        {/* ── Players ── */}
        {activeTab === 'players' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 13, opacity: 0.6 }}>{players.length} players</span>
              <button onClick={handleAddPlayer}
                style={{ padding: '7px 16px', background: themeColor, border: 'none', color: '#fff', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                + Add Player
              </button>
            </div>
            {players.map(p => (
              <PlayerEditRow
                key={p.id}
                player={p}
                onSave={handleSavePlayer}
                onRemove={() => handleRemovePlayer(p.id, p.name)}
                themeColor={themeColor}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PlayerEditRow({ player, onSave, onRemove, themeColor }) {
  const [name, setName]     = useState(player.name);
  const [avatar, setAvatar] = useState(player.avatar_url || '');
  const [dirty, setDirty]   = useState(false);

  const handleChange = (field, value) => {
    if (field === 'name') setName(value);
    if (field === 'avatar') setAvatar(value);
    setDirty(true);
  };

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #2a2a3e', flexWrap: 'wrap' }}>
      {avatar
        ? <img src={avatar} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
        : <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#2a2a3e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>{name.charAt(0)}</div>
      }
      <input value={name} onChange={e => handleChange('name', e.target.value)}
        style={{ flex: '1 1 140px', padding: '7px 10px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13 }} />
      <input value={avatar} onChange={e => handleChange('avatar', e.target.value)}
        placeholder="Avatar URL (optional)"
        style={{ flex: '2 1 220px', padding: '7px 10px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13 }} />
      <button
        onClick={() => { onSave({ ...player, name, avatar_url: avatar }); setDirty(false); }}
        disabled={!dirty}
        style={{ padding: '7px 14px', background: dirty ? '#2e7d32' : '#2a2a3e', border: 'none', color: '#fff', borderRadius: 6, cursor: dirty ? 'pointer' : 'default', fontWeight: 600, fontSize: 13, opacity: dirty ? 1 : 0.4 }}>
        Save
      </button>
      <button onClick={onRemove}
        style={{ padding: '7px 12px', background: 'none', border: '1px solid #4a1010', color: '#ef5350', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
        Remove
      </button>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder = '' }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>{label}</label>
      <input type={type} value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: '100%', padding: '8px 10px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
    </div>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#13131f', borderRadius: 6 }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      <button onClick={() => onChange(!value)}
        style={{ padding: '4px 14px', background: value ? '#2e7d32' : '#4a1010', border: 'none', color: '#fff', borderRadius: 12, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
        {value ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}
