// src/pages/admin/BoardGameEditPage.jsx
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import BoardBuilder from '../../components/BoardBuilder';
import { logAudit } from '../../lib/audit';

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

// ── CSV helpers ───────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = lines.slice(1).map(line => {
    const cols = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    cols.push(cur.trim());
    return Object.fromEntries(headers.map((h, i) => [h, cols[i] ?? '']));
  });
  return { headers, rows };
}

// UTF-8 BOM ensures Excel opens the file correctly and renders emoji in the icon column.
function downloadCSV(filename, headers, rows) {
  const BOM = '\uFEFF';
  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = BOM + [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function CsvImporter({ onImport, sampleHeaders, sampleRow, label, themeColor }) {
  const [preview, setPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { setPreview(parseCSV(ev.target.result)); setResult(null); };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleConfirm = async () => {
    setImporting(true);
    const res = await onImport(preview.rows);
    setResult(res);
    setPreview(null);
    setImporting(false);
  };

  const tc = themeColor || '#c62828';

  return (
    <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <label style={{ background: 'none', border: '1px solid #444', color: '#aaa', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
        ↑ Import CSV
        <input type="file" accept=".csv" onChange={handleFile} style={{ display: 'none' }} />
      </label>
      <button onClick={() => downloadCSV(`sample_${label}.csv`, sampleHeaders, [sampleRow])}
        style={{ background: 'none', border: '1px solid #333', color: '#666', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
        ↓ Sample
      </button>
      {result && <span style={{ fontSize: 12, color: result.error ? '#ef4444' : '#4ade80' }}>{result.text}</span>}

      {preview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 10, padding: 24, maxWidth: 720, width: '90%', maxHeight: '80vh', overflow: 'auto' }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#fff', marginBottom: 12 }}>Preview — {preview.rows.length} rows</div>
            <div style={{ overflowX: 'auto', marginBottom: 16 }}>
              <table style={{ fontSize: 12, borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>{preview.headers.map(h => <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#aaa', borderBottom: '1px solid #333' }}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 10).map((row, i) => (
                    <tr key={i}>{preview.headers.map(h => <td key={h} style={{ padding: '5px 10px', color: '#ddd', borderBottom: '1px solid #222' }}>{row[h]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
              {preview.rows.length > 10 && <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>...and {preview.rows.length - 10} more rows</div>}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={handleConfirm} disabled={importing}
                style={{ background: tc, border: 'none', color: '#fff', borderRadius: 6, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {importing ? 'Importing...' : 'Confirm Import'}
              </button>
              <button onClick={() => setPreview(null)}
                style={{ background: 'none', border: '1px solid #444', color: '#aaa', borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BoardGameEditPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [event, setEvent]           = useState(null);
  const [config, setConfig]         = useState(null);
  const [squares, setSquares]       = useState([]);
  const [players, setPlayers]       = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [message, setMessage]       = useState(null);
  const [activeTab, setActiveTab]   = useState('board');

  const [newCatName, setNewCatName] = useState('');
  const [newCatPts, setNewCatPts]   = useState(1);

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
      const { data: newCfg, error } = await supabase
        .from('board_game_config')
        .insert({ ...DEFAULT_CONFIG, event_id: eventId })
        .select().single();
      if (!error) setConfig(newCfg);
      else setConfig({ ...DEFAULT_CONFIG, event_id: eventId });
    }
    setLoading(false);
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  // ── Board squares ─────────────────────────────────────────
  const handleSaveSquares = async () => {
    setSaving(true); setMessage(null);
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
      await logAudit({
        actor: profile, eventType: 'config_change',
        action: `Saved board tiles for "${event?.name}" (${squares.length} squares)`,
        eventId, eventName: event?.name,
        metadata: { square_count: squares.length },
      });
    } catch (e) {
      setMessage({ type: 'error', text: e.message });
    } finally {
      setSaving(false);
    }
  };

  // ── Board squares CSV import ──────────────────────────────
  const importSquares = async (rows) => {
    let imported = 0, errors = [];
    const parsed = rows.map(row => {
      const num = parseInt(row['square_number']);
      if (isNaN(num)) { errors.push(`Invalid square_number: "${row['square_number']}"`); return null; }
      // Strip surrogate-pair emoji that survive as garbled chars when Excel re-saves without UTF-8
      const sanitizeIcon = v => v ? v.trim().replace(/[\uD800-\uDFFF]/g, '') || null : null;
      return {
        square_number: num,
        type: row['type']?.trim() || 'flavor',
        label: row['label']?.trim() || null,
        icon: sanitizeIcon(row['icon']),
        jump_to: row['jump_to'] ? parseInt(row['jump_to']) : null,
        move_amount: row['move_amount'] ? parseInt(row['move_amount']) : null,
        description: row['description']?.trim() || null,
        badge: row['badge']?.trim() || null,
        flavor_text: row['flavor_text']?.trim() || null,
      };
    }).filter(Boolean);

    // Merge into existing squares by square_number
    setSquares(prev => {
      const map = Object.fromEntries(prev.map(s => [s.square_number, s]));
      for (const sq of parsed) { map[sq.square_number] = { ...map[sq.square_number], ...sq }; imported++; }
      return Object.values(map).sort((a, b) => a.square_number - b.square_number);
    });

    if (errors.length) return { error: true, text: `${imported} merged, ${errors.length} skipped: ${errors[0]}` };
    return { text: `${imported} squares merged. Click Save Tiles to commit.` };
  };

  const exportSquares = () => {
    const headers = ['square_number', 'type', 'label', 'icon', 'jump_to', 'move_amount', 'description', 'badge', 'flavor_text'];
    const rows = squares.map(s => ({
      square_number: s.square_number,
      type: s.type,
      label: s.label ?? '',
      icon: s.icon ?? '',
      jump_to: s.jump_to ?? '',
      move_amount: s.move_amount ?? '',
      description: s.description ?? '',
      badge: s.badge ?? '',
      flavor_text: s.flavor_text ?? '',
    }));
    downloadCSV(`board_squares_${event?.id ?? eventId}.csv`, headers, rows);
  };

  // ── Config ────────────────────────────────────────────────
  const handleSaveConfig = async () => {
    setSaving(true); setMessage(null);
    try {
      const { error } = await supabase.from('board_game_config').update({
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
      }).eq('event_id', eventId);
      if (error) throw error;

      const { error: evErr } = await supabase.from('events').update({
        name: event.name,
        start_date: event.start_date || null,
        end_date: event.end_date || null,
        discord_overall_webhook: event.discord_overall_webhook || null,
      }).eq('id', eventId);
      if (evErr) throw evErr;

      setMessage({ type: 'success', text: 'Configuration saved.' });
      await logAudit({
        actor: profile, eventType: 'config_change',
        action: `Saved configuration for "${event?.name}"`,
        eventId, eventName: event?.name,
        metadata: { score_divisor: config.score_divisor, track_length: config.track_length, theme_color: config.theme_color },
      });
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
      event_id: eventId, name: newCatName.trim(), multiplier: Number(newCatPts) || 1,
    });
    if (error) { setMessage({ type: 'error', text: error.message }); return; }
    setNewCatName(''); setNewCatPts(1);
    await load();
  };

  const handleDeleteCategory = async (id) => {
    await supabase.from('categories').delete().eq('id', id);
    await load();
  };

  const importCategories = async (rows) => {
    let imported = 0, errors = [];
    for (const row of rows) {
      const name = row['name']?.trim();
      if (!name) { errors.push('Row missing name'); continue; }
      const pts = parseFloat(row['point_value']) || 1;
      const existing = categories.find(c => c.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        await supabase.from('categories').update({ multiplier: pts }).eq('id', existing.id);
      } else {
        await supabase.from('categories').insert({ event_id: eventId, name, multiplier: pts });
      }
      imported++;
    }
    await load();
    if (errors.length) return { error: true, text: `${imported} imported, ${errors.length} errors: ${errors[0]}` };
    return { text: `${imported} categories imported.` };
  };

  const exportCategories = () => {
    downloadCSV(
      `categories_${event?.id ?? eventId}.csv`,
      ['name', 'point_value'],
      categories.map(c => ({ name: c.name, point_value: c.multiplier }))
    );
  };

  // ── Players ───────────────────────────────────────────────
  const handleSavePlayer = async (player) => {
    const { error } = await supabase.from('board_players')
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

  const importPlayers = async (rows) => {
    let imported = 0, errors = [];
    for (const row of rows) {
      const name = row['player_name']?.trim();
      if (!name) { errors.push('Row missing player_name'); continue; }
      const existing = players.find(p => p.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        await supabase.from('board_players').update({
          avatar_url: row['avatar_url']?.trim() || null,
          color: row['color']?.trim() || existing.color,
        }).eq('id', existing.id);
      } else {
        await supabase.from('board_players').insert({
          event_id: eventId,
          name,
          avatar_url: row['avatar_url']?.trim() || null,
          color: row['color']?.trim() || null,
          sort_order: players.length + imported,
        });
      }
      imported++;
    }
    await load();
    if (errors.length) return { error: true, text: `${imported} imported, ${errors.length} errors: ${errors[0]}` };
    return { text: `${imported} players imported.` };
  };

  const exportPlayers = () => {
    downloadCSV(
      `players_${event?.id ?? eventId}.csv`,
      ['player_name', 'avatar_url', 'color'],
      players.map(p => ({ player_name: p.name, avatar_url: p.avatar_url ?? '', color: p.color ?? '' }))
    );
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              <p style={{ fontSize: 13, opacity: 0.6, margin: 0 }}>
                Click any tile to edit. Click an empty square to add.
              </p>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                <CsvImporter
                  label="board_tiles"
                  themeColor={themeColor}
                  sampleHeaders={['square_number','type','label','icon','jump_to','move_amount','description','badge','flavor_text']}
                  sampleRow={{ square_number: 14, type: 'gym', label: 'Pewter City Gym', icon: '🏅', jump_to: '', move_amount: '', description: 'Earn the Boulder Badge', badge: 'Boulder Badge', flavor_text: '' }}
                  onImport={importSquares}
                />
                <button onClick={exportSquares}
                  style={{ background: 'none', border: '1px solid #333', color: '#666', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
                  ↓ Export CSV
                </button>
              </div>
            </div>
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
              <p style={{ fontSize: 13, opacity: 0.6, margin: 0 }}>
                Categories define encounter types and point values for scorers.
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <CsvImporter
                  label="categories"
                  themeColor={themeColor}
                  sampleHeaders={['name', 'point_value']}
                  sampleRow={{ name: 'Shiny Legend', point_value: 100 }}
                  onImport={importCategories}
                />
                <button onClick={exportCategories}
                  style={{ background: 'none', border: '1px solid #333', color: '#666', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
                  ↓ Export CSV
                </button>
              </div>
            </div>
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
              <input value={newCatName} onChange={e => setNewCatName(e.target.value)}
                placeholder="Category name (e.g. Shiny Legend)"
                onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
                style={{ flex: 1, minWidth: 180, padding: '8px 10px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13 }} />
              <input type="number" value={newCatPts} onChange={e => setNewCatPts(e.target.value)}
                style={{ width: 80, padding: '8px 10px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13 }}
                placeholder="Pts" min="1" />
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
              <span style={{ fontSize: 13, opacity: 0.6 }}>{players.length} players</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <CsvImporter
                  label="players"
                  themeColor={themeColor}
                  sampleHeaders={['player_name', 'avatar_url', 'color']}
                  sampleRow={{ player_name: 'Ash', avatar_url: 'https://example.com/ash.png', color: '#ef4444' }}
                  onImport={importPlayers}
                />
                <button onClick={exportPlayers}
                  style={{ background: 'none', border: '1px solid #333', color: '#666', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
                  ↓ Export CSV
                </button>
                <button onClick={handleAddPlayer}
                  style={{ padding: '7px 16px', background: themeColor, border: 'none', color: '#fff', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                  + Add Player
                </button>
              </div>
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

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #2a2a3e', flexWrap: 'wrap' }}>
      {avatar
        ? <img src={avatar} alt="" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
        : <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#2a2a3e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>{name.charAt(0)}</div>
      }
      <input value={name} onChange={e => { setName(e.target.value); setDirty(true); }}
        style={{ flex: '1 1 140px', padding: '7px 10px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13 }} />
      <input value={avatar} onChange={e => { setAvatar(e.target.value); setDirty(true); }}
        placeholder="Avatar URL (optional)"
        style={{ flex: '2 1 220px', padding: '7px 10px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13 }} />
      <button onClick={() => { onSave({ ...player, name, avatar_url: avatar }); setDirty(false); }} disabled={!dirty}
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
