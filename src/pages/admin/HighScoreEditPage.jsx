// src/pages/admin/HighScoreEditPage.jsx

import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  getHSConfig, upsertHSConfig,
  getHSTeams, getHSPlayers,
  createHSTeam, updateHSTeam, deleteHSTeam,
  createHSPlayer, updateHSPlayer, deleteHSPlayer,
} from '../../lib/highscore';

const ACC = '#c62828';

// ── CSV helpers ───────────────────────────────────────────────

function downloadCSV(filename, rows, headers) {
  const escape = v => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const lines = [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = lines.slice(1).map(line => {
    // basic CSV parse — handles quoted fields
    const vals = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    vals.push(cur.trim());
    const row = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });
    return row;
  });
  return { headers, rows };
}

// ── CSV Import UI ─────────────────────────────────────────────

function CsvImporter({ label, sampleHeaders, sampleRow, onImport }) {
  const [preview, setPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState('');
  const fileRef = useRef();

  function handleDownloadSample() {
    downloadCSV(`${label.toLowerCase().replace(/\s+/g, '_')}_sample.csv`, [sampleRow], sampleHeaders);
  }

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const { rows } = parseCSV(ev.target.result);
      setPreview(rows);
      setResult('');
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function handleConfirm() {
    if (!preview) return;
    setImporting(true);
    setResult('');
    try {
      const { imported, errors } = await onImport(preview);
      setResult(`✓ Imported ${imported} row${imported !== 1 ? 's' : ''}${errors.length ? ` · ${errors.length} error(s): ${errors.join('; ')}` : ''}`);
      setPreview(null);
    } catch (e) {
      setResult('Error: ' + e.message);
    } finally {
      setImporting(false);
    }
  }

  const shown = preview?.slice(0, 10) ?? [];
  const headers = shown.length > 0 ? Object.keys(shown[0]) : [];

  return (
    <div style={ci.wrap}>
      <div style={ci.header}>
        <span style={ci.label}>{label}</span>
        <div style={ci.btnRow}>
          <button onClick={handleDownloadSample} style={ci.sampleBtn}>⬇ Sample CSV</button>
          <button onClick={() => fileRef.current?.click()} style={ci.importBtn}>⬆ Import CSV</button>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{ display: 'none' }} />
        </div>
      </div>

      {preview && (
        <div style={ci.previewWrap}>
          <div style={ci.previewNote}>
            Preview — {preview.length} row{preview.length !== 1 ? 's' : ''}{preview.length > 10 ? ` (showing first 10)` : ''}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={ci.table}>
              <thead>
                <tr>{headers.map(h => <th key={h} style={ci.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {shown.map((row, i) => (
                  <tr key={i}>{headers.map(h => <td key={h} style={ci.td}>{row[h]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={ci.confirmRow}>
            <button onClick={() => setPreview(null)} style={ci.cancelBtn}>Cancel</button>
            <button onClick={handleConfirm} disabled={importing} style={ci.confirmBtn}>
              {importing ? 'Importing...' : `Confirm Import (${preview.length} rows)`}
            </button>
          </div>
        </div>
      )}

      {result && <div style={ci.result}>{result}</div>}
    </div>
  );
}

const ci = {
  wrap: { background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, padding: '14px 16px', marginBottom: 16 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  label: { color: '#aaa', fontSize: 13, fontWeight: 600 },
  btnRow: { display: 'flex', gap: 8 },
  sampleBtn: { background: 'none', color: '#888', border: '1px solid #333', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 12 },
  importBtn: { background: 'none', color: ACC, border: `1px solid ${ACC}`, borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700 },
  previewWrap: { marginTop: 12 },
  previewNote: { color: '#666', fontSize: 12, marginBottom: 6 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { textAlign: 'left', color: '#888', padding: '5px 8px', borderBottom: '1px solid #333', whiteSpace: 'nowrap' },
  td: { padding: '5px 8px', borderBottom: '1px solid #1a1a1a', color: '#ccc', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  confirmRow: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 },
  cancelBtn: { background: 'none', color: '#888', border: '1px solid #333', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 13 },
  confirmBtn: { background: ACC, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontWeight: 700, fontSize: 13 },
  result: { marginTop: 8, color: '#8bc34a', fontSize: 13 },
};

// ── Main Page ─────────────────────────────────────────────────

export default function HighScoreEditPage() {
  const { id: eventId } = useParams();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const canManage = profile?.role === 'event_runner' || profile?.role === 'owner';

  const [event, setEvent] = useState(null);
  const [config, setConfig] = useState(null);
  const [teams, setTeams] = useState([]);
  const [players, setPlayers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('config');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  // Config form state
  const [cfgForm, setCfgForm] = useState({
    mode: 'solo', score_divisor: 1, score_operation: 'divide', score_rounding: 'round',
    allow_handicap: false, theme_color: '#c62828', title_image_url: '', start_date: '', end_date: '',
  });

  // Team / Player inline forms
  const [newTeam, setNewTeam] = useState({ name: '', avatar_url: '', handicap_multiplier: 1, discord_webhook_url: '' });
  const [editTeam, setEditTeam] = useState(null);
  const [newPlayer, setNewPlayer] = useState({ name: '', avatar_url: '', team_id: '' });
  const [editPlayer, setEditPlayer] = useState(null);

  // Category inline form
  const [newCat, setNewCat] = useState({ name: '', multiplier: 1 });

  useEffect(() => { loadAll(); }, [eventId]);

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
        getHSConfig(eventId).catch(() => null),
        getHSTeams(eventId),
        getHSPlayers(eventId),
      ]);
      setConfig(cfg);
      setTeams(tm);
      setPlayers(pl);

      if (cfg) {
        setCfgForm({
          mode: cfg.mode || 'solo',
          score_divisor: cfg.score_divisor ?? 1,
          score_operation: cfg.score_operation || 'divide',
          score_rounding: cfg.score_rounding || 'round',
          allow_handicap: cfg.allow_handicap || false,
          theme_color: cfg.theme_color || '#c62828',
          title_image_url: cfg.title_image_url || '',
          start_date: cfg.start_date || '',
          end_date: cfg.end_date || '',
        });
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Config save ──────────────────────────────────────────────

  async function handleSaveConfig() {
    setSaving(true);
    setMsg('');
    try {
      await upsertHSConfig(eventId, {
        mode: cfgForm.mode,
        score_divisor: Number(cfgForm.score_divisor),
        score_operation: cfgForm.score_operation,
        score_rounding: cfgForm.score_rounding,
        allow_handicap: cfgForm.allow_handicap,
        theme_color: cfgForm.theme_color,
        title_image_url: cfgForm.title_image_url || null,
        start_date: cfgForm.start_date || null,
        end_date: cfgForm.end_date || null,
      });
      setMsg('Configuration saved.');
      await loadAll();
    } catch (e) {
      setMsg('Error: ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Team CRUD ────────────────────────────────────────────────

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

  // ── Player CRUD ──────────────────────────────────────────────

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

  // ── Category CRUD ────────────────────────────────────────────

  async function handleAddCategory() {
    if (!newCat.name.trim()) return;
    const { error } = await supabase.from('categories').insert({
      event_id: eventId, name: newCat.name.trim(), multiplier: Number(newCat.multiplier),
    });
    if (error) { setMsg(error.message); return; }
    setNewCat({ name: '', multiplier: 1 });
    await loadAll();
  }

  async function handleDeleteCategory(id) {
    if (!confirm('Remove this category?')) return;
    await supabase.from('categories').delete().eq('id', id);
    await loadAll();
  }

  // ── CSV Export ───────────────────────────────────────────────

  function handleExportPlayers() {
    const rows = players.map(p => ({
      player_name: p.name,
      team_name: teams.find(t => t.id === p.team_id)?.name || '',
      avatar_url: p.avatar_url || '',
    }));
    downloadCSV(`${event?.name || 'highscore'}_players.csv`, rows, ['player_name', 'team_name', 'avatar_url']);
  }

  function handleExportTeams() {
    const rows = teams.map(t => ({
      team_name: t.name,
      avatar_url: t.avatar_url || '',
      discord_webhook: t.discord_webhook_url || '',
    }));
    downloadCSV(`${event?.name || 'highscore'}_teams.csv`, rows, ['team_name', 'avatar_url', 'discord_webhook']);
  }

  function handleExportCategories() {
    const rows = categories.map((c, i) => ({
      label: c.name,
      point_value: c.multiplier,
      sort_order: i,
    }));
    downloadCSV(`${event?.name || 'highscore'}_categories.csv`, rows, ['label', 'point_value', 'sort_order']);
  }

  // ── CSV Import handlers ──────────────────────────────────────

  async function importPlayers(rows) {
    let imported = 0;
    const errors = [];
    for (const row of rows) {
      const name = row['player_name']?.trim();
      if (!name) { errors.push('Missing player_name'); continue; }
      const teamName = row['team_name']?.trim();
      const team = teamName ? teams.find(t => t.name.toLowerCase() === teamName.toLowerCase()) : null;
      try {
        // Upsert by name within this event
        const existing = players.find(p => p.name.toLowerCase() === name.toLowerCase());
        if (existing) {
          await updateHSPlayer(existing.id, {
            name,
            avatar_url: row['avatar_url']?.trim() || existing.avatar_url,
            team_id: team?.id ?? existing.team_id,
          });
        } else {
          await createHSPlayer(eventId, {
            name,
            avatar_url: row['avatar_url']?.trim() || null,
            team_id: team?.id || null,
          });
        }
        imported++;
      } catch (e) { errors.push(`${name}: ${e.message}`); }
    }
    await loadAll();
    return { imported, errors };
  }

  async function importTeams(rows) {
    let imported = 0;
    const errors = [];
    for (const row of rows) {
      const name = row['team_name']?.trim();
      if (!name) { errors.push('Missing team_name'); continue; }
      try {
        const existing = teams.find(t => t.name.toLowerCase() === name.toLowerCase());
        if (existing) {
          await updateHSTeam(existing.id, {
            name,
            avatar_url: row['avatar_url']?.trim() || existing.avatar_url,
            discord_webhook_url: row['discord_webhook']?.trim() || existing.discord_webhook_url,
            handicap_multiplier: existing.handicap_multiplier,
          });
        } else {
          await createHSTeam(eventId, {
            name,
            avatar_url: row['avatar_url']?.trim() || null,
            discord_webhook_url: row['discord_webhook']?.trim() || null,
            handicap_multiplier: 1,
          });
        }
        imported++;
      } catch (e) { errors.push(`${name}: ${e.message}`); }
    }
    await loadAll();
    return { imported, errors };
  }

  async function importCategories(rows) {
    let imported = 0;
    const errors = [];
    for (const row of rows) {
      const name = row['label']?.trim();
      if (!name) { errors.push('Missing label'); continue; }
      const pts = Number(row['point_value']) || 1;
      try {
        const existing = categories.find(c => c.name.toLowerCase() === name.toLowerCase());
        if (existing) {
          await supabase.from('categories').update({ multiplier: pts }).eq('id', existing.id);
        } else {
          await supabase.from('categories').insert({ event_id: eventId, name, multiplier: pts });
        }
        imported++;
      } catch (e) { errors.push(`${name}: ${e.message}`); }
    }
    await loadAll();
    return { imported, errors };
  }

  // ── Render ───────────────────────────────────────────────────

  if (loading) return <div style={s.loading}>Loading...</div>;

  const isTeam = cfgForm.mode === 'team';
  const tabs = ['config', 'teams_players', 'categories'];
  const tabLabels = { config: 'Configuration', teams_players: 'Teams & Players', categories: 'Categories' };

  return (
    <div style={s.page}>
      <div style={s.topBar}>
        <div>
          <Link to={`/admin/highscore/${eventId}`} style={s.back}>← Back to Event</Link>
          <h1 style={s.title}>{event?.name} — Edit</h1>
        </div>
        <div style={s.topActions}>
          <Link to={`/highscore/${eventId}`} style={s.secondaryBtn}>Public Page</Link>
          <Link to={`/admin/highscore/${eventId}/scores`} style={s.actionBtn}>Enter Scores</Link>
        </div>
      </div>

      {msg && <div style={s.msg}>{msg}</div>}

      <div style={s.tabs}>
        {tabs.map(t => (
          <button key={t} onClick={() => { setActiveTab(t); setMsg(''); }}
            style={activeTab === t ? s.tabActive : s.tab}>
            {tabLabels[t]}
          </button>
        ))}
      </div>

      {/* ── Configuration Tab ── */}
      {activeTab === 'config' && (
        <div style={s.section}>
          <h3 style={s.sectionHead}>Event Configuration</h3>

          <div style={s.formGrid}>
            <div>
              <label style={s.label}>Mode</label>
              <div style={s.radioRow}>
                {[['solo', '👤 Solo'], ['team', '👥 Team']].map(([val, lbl]) => (
                  <label key={val} style={s.radioLabel}>
                    <input type="radio" value={val} checked={cfgForm.mode === val}
                      onChange={() => setCfgForm(f => ({ ...f, mode: val }))} />
                    {lbl}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div style={s.twoCol}>
            <div>
              <label style={s.label}>Score Divisor</label>
              <input type="number" value={cfgForm.score_divisor} min="0.1" step="0.1"
                onChange={e => setCfgForm(f => ({ ...f, score_divisor: e.target.value }))}
                style={s.input} />
            </div>
            <div>
              <label style={s.label}>Operation</label>
              <select value={cfgForm.score_operation}
                onChange={e => setCfgForm(f => ({ ...f, score_operation: e.target.value }))}
                style={s.select}>
                <option value="divide">Divide</option>
                <option value="multiply">Multiply</option>
              </select>
            </div>
          </div>

          <label style={s.label}>Score Rounding</label>
          <select value={cfgForm.score_rounding}
            onChange={e => setCfgForm(f => ({ ...f, score_rounding: e.target.value }))}
            style={s.select}>
            <option value="round">Round (nearest)</option>
            <option value="ceil">Ceiling (always up)</option>
            <option value="floor">Floor (always down)</option>
          </select>

          {isTeam && (
            <label style={s.checkLabel}>
              <input type="checkbox" checked={cfgForm.allow_handicap}
                onChange={e => setCfgForm(f => ({ ...f, allow_handicap: e.target.checked }))} />
              Enable handicap multipliers per team
            </label>
          )}

          <div style={s.twoCol}>
            <div>
              <label style={s.label}>Start Date</label>
              <input type="date" value={cfgForm.start_date}
                onChange={e => setCfgForm(f => ({ ...f, start_date: e.target.value }))}
                style={s.input} />
            </div>
            <div>
              <label style={s.label}>End Date</label>
              <input type="date" value={cfgForm.end_date}
                onChange={e => setCfgForm(f => ({ ...f, end_date: e.target.value }))}
                style={s.input} />
            </div>
          </div>

          <label style={s.label}>Theme Color</label>
          <input type="color" value={cfgForm.theme_color}
            onChange={e => setCfgForm(f => ({ ...f, theme_color: e.target.value }))}
            style={{ ...s.input, height: 40, padding: 4, width: 80 }} />

          <label style={s.label}>Title Image URL (optional)</label>
          <input value={cfgForm.title_image_url}
            onChange={e => setCfgForm(f => ({ ...f, title_image_url: e.target.value }))}
            style={s.input} placeholder="https://..." />

          <div style={{ marginTop: 20 }}>
            <button onClick={handleSaveConfig} disabled={saving} style={s.saveConfigBtn}>
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </div>
      )}

      {/* ── Teams & Players Tab ── */}
      {activeTab === 'teams_players' && (
        <div style={s.section}>

          {/* Teams (only in team mode) */}
          {isTeam ? (
            <>
              <div style={s.sectionHeaderRow}>
                <h3 style={s.sectionHead}>Teams</h3>
                <button onClick={handleExportTeams} style={s.exportBtn}>⬇ Export Config CSV</button>
              </div>

              <CsvImporter
                label="Import Teams CSV"
                sampleHeaders={['team_name', 'avatar_url', 'discord_webhook']}
                sampleRow={{ team_name: 'Team Rocket', avatar_url: 'https://example.com/avatar.png', discord_webhook: '' }}
                onImport={importTeams}
              />

              {teams.map(t => (
                editTeam?.id === t.id ? (
                  <div key={t.id} style={s.editRow}>
                    <input value={editTeam.name} onChange={e => setEditTeam(p => ({ ...p, name: e.target.value }))} style={s.input} placeholder="Team name" />
                    <input value={editTeam.avatar_url} onChange={e => setEditTeam(p => ({ ...p, avatar_url: e.target.value }))} style={s.input} placeholder="Avatar URL" />
                    <input value={editTeam.handicap_multiplier} type="number" step="0.1"
                      onChange={e => setEditTeam(p => ({ ...p, handicap_multiplier: e.target.value }))}
                      style={{ ...s.input, width: 80 }} placeholder="Handicap ×" />
                    <input value={editTeam.discord_webhook_url} onChange={e => setEditTeam(p => ({ ...p, discord_webhook_url: e.target.value }))} style={s.input} placeholder="Discord webhook" />
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
                  <input value={newTeam.handicap_multiplier} type="number" step="0.1"
                    onChange={e => setNewTeam(p => ({ ...p, handicap_multiplier: e.target.value }))}
                    style={{ ...s.input, width: 80 }} placeholder="Handicap ×" />
                  <input value={newTeam.discord_webhook_url} onChange={e => setNewTeam(p => ({ ...p, discord_webhook_url: e.target.value }))} style={s.input} placeholder="Discord webhook (optional)" />
                  <button onClick={handleAddTeam} style={s.addBtn}>+ Add Team</button>
                </div>
              )}

              <div style={s.divider} />
            </>
          ) : (
            <div style={s.soloNote}>This event is in solo mode — teams are not used.</div>
          )}

          {/* Players */}
          <div style={s.sectionHeaderRow}>
            <h3 style={s.sectionHead}>Players</h3>
            <button onClick={handleExportPlayers} style={s.exportBtn}>⬇ Export Config CSV</button>
          </div>

          <CsvImporter
            label="Import Players CSV"
            sampleHeaders={['player_name', 'team_name', 'avatar_url']}
            sampleRow={{ player_name: 'AshKetchum', team_name: isTeam ? 'Team Rocket' : '', avatar_url: 'https://example.com/avatar.png' }}
            onImport={importPlayers}
          />

          {players.map(p => (
            editPlayer?.id === p.id ? (
              <div key={p.id} style={s.editRow}>
                <input value={editPlayer.name} onChange={e => setEditPlayer(prev => ({ ...prev, name: e.target.value }))} style={s.input} placeholder="Player name" />
                <input value={editPlayer.avatar_url} onChange={e => setEditPlayer(prev => ({ ...prev, avatar_url: e.target.value }))} style={s.input} placeholder="Avatar URL" />
                {isTeam && (
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
              {isTeam && (
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

      {/* ── Categories Tab ── */}
      {activeTab === 'categories' && (
        <div style={s.section}>
          <div style={s.sectionHeaderRow}>
            <h3 style={s.sectionHead}>Score Categories</h3>
            <button onClick={handleExportCategories} style={s.exportBtn}>⬇ Export Config CSV</button>
          </div>

          <CsvImporter
            label="Import Categories CSV"
            sampleHeaders={['label', 'point_value', 'sort_order']}
            sampleRow={{ label: 'Shiny Legend', point_value: 100, sort_order: 0 }}
            onImport={importCategories}
          />

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
    </div>
  );
}

const s = {
  page: { maxWidth: 960, margin: '0 auto', padding: '24px 16px', fontFamily: 'sans-serif' },
  loading: { padding: 40, textAlign: 'center', color: '#aaa' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 },
  back: { color: '#888', textDecoration: 'none', fontSize: 13, display: 'block', marginBottom: 4 },
  title: { margin: '4px 0', fontSize: 22, color: '#fff' },
  topActions: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  actionBtn: { background: ACC, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', textDecoration: 'none', fontSize: 13 },
  secondaryBtn: { background: '#222', color: '#ccc', border: '1px solid #444', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontSize: 13, textDecoration: 'none' },
  msg: { background: '#1e1e1e', border: '1px solid #444', borderRadius: 6, padding: '10px 14px', color: '#ffb', marginBottom: 16 },
  tabs: { display: 'flex', gap: 0, borderBottom: '1px solid #333', marginBottom: 20 },
  tab: { background: 'none', border: 'none', color: '#888', padding: '10px 18px', cursor: 'pointer', fontSize: 13 },
  tabActive: { background: 'none', border: 'none', borderBottom: `2px solid ${ACC}`, color: '#fff', padding: '10px 18px', cursor: 'pointer', fontWeight: 700, fontSize: 13 },
  section: { paddingTop: 4 },
  sectionHeaderRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, marginTop: 20 },
  sectionHead: { color: '#fff', fontSize: 15, margin: 0 },
  exportBtn: { background: 'none', color: '#888', border: '1px solid #333', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 12 },
  divider: { borderTop: '1px solid #222', margin: '24px 0' },
  soloNote: { color: '#555', fontSize: 13, padding: '10px 0', marginBottom: 8 },
  formGrid: { marginBottom: 8 },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 4 },
  label: { display: 'block', color: '#aaa', fontSize: 13, marginBottom: 6, marginTop: 14 },
  input: { width: '100%', boxSizing: 'border-box', background: '#1a1a1a', color: '#fff', border: '1px solid #444', borderRadius: 6, padding: '7px 10px', fontSize: 13 },
  select: { width: '100%', boxSizing: 'border-box', background: '#1a1a1a', color: '#fff', border: '1px solid #444', borderRadius: 6, padding: '7px 10px', fontSize: 13 },
  radioRow: { display: 'flex', gap: 20, marginTop: 4 },
  radioLabel: { display: 'flex', alignItems: 'center', gap: 6, color: '#ccc', fontSize: 14, cursor: 'pointer' },
  checkLabel: { display: 'flex', alignItems: 'center', gap: 8, color: '#ccc', fontSize: 14, marginTop: 14, cursor: 'pointer' },
  saveConfigBtn: { background: ACC, color: '#fff', border: 'none', borderRadius: 6, padding: '9px 22px', cursor: 'pointer', fontWeight: 700, fontSize: 14 },
  listRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #222', flexWrap: 'wrap' },
  editRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', flexWrap: 'wrap' },
  addRow: { display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' },
  listName: { color: '#fff', fontWeight: 600, flex: 1 },
  avatar: { width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' },
  badge: { background: '#2a2a2a', color: '#aaa', borderRadius: 4, padding: '2px 8px', fontSize: 12 },
  addBtn: { background: ACC, color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap' },
  saveBtn: { background: '#1a4a1a', color: '#8bc34a', border: '1px solid #2d6a2d', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13 },
  cancelBtn: { background: 'none', color: '#888', border: '1px solid #444', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13 },
  editBtn: { background: 'none', color: '#888', border: '1px solid #333', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 },
  deleteBtn: { background: 'none', color: '#c55', border: '1px solid #522', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 },
};
