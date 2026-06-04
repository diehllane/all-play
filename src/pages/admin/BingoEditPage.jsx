import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { TEAM_COLORS } from '../../lib/bingo';
import { useAuth } from '../../contexts/AuthContext';
import { logAudit } from '../../lib/audit';

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
  const tc = themeColor || '#c62828';

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
    setResult(res); setPreview(null); setImporting(false);
  };

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
                <thead><tr>{preview.headers.map(h => <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#aaa', borderBottom: '1px solid #333' }}>{h}</th>)}</tr></thead>
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

// ── Line value key definitions ────────────────────────────
const LINE_KEYS = [
  { key: 'row1_value', label: 'Row 1' },
  { key: 'row2_value', label: 'Row 2' },
  { key: 'row3_value', label: 'Row 3' },
  { key: 'row4_value', label: 'Row 4' },
  { key: 'row5_value', label: 'Row 5' },
  { key: 'col1_value', label: 'Column 1' },
  { key: 'col2_value', label: 'Column 2' },
  { key: 'col3_value', label: 'Column 3' },
  { key: 'col4_value', label: 'Column 4' },
  { key: 'col5_value', label: 'Column 5' },
  { key: 'diag1_value', label: 'Diagonal ↘' },
  { key: 'diag2_value', label: 'Diagonal ↙' },
];

// ── Default 25 squares ────────────────────────────────────
function defaultSquares(hasFreeSpace) {
  return Array.from({ length: 25 }, (_, i) => ({
    position: i,
    label: i === 12 && hasFreeSpace ? 'FREE' : `Square ${i + 1}`,
    description: '',
    point_value: 1,
    is_free_space: i === 12 && hasFreeSpace,
  }));
}

// ── Board Builder ─────────────────────────────────────────
function BoardBuilder({ squares, setSquares, config, setConfig, onSaveSquares, saving, onImportSquares, onExportSquares, onImportLineValues, onExportLineValues, themeColor, eventId }) {
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);
  const [editingIdx, setEditingIdx] = useState(null);
  const tc = themeColor || '#c62828';

  const handleDrop = (pos) => {
    if (dragging === null || dragging === pos) { setDragging(null); setOver(null); return; }
    const newSqs = [...squares];
    const fromIdx = newSqs.findIndex(s => s.position === dragging);
    const toIdx = newSqs.findIndex(s => s.position === pos);
    if (fromIdx < 0 || toIdx < 0) { setDragging(null); setOver(null); return; }
    const tmp = newSqs[fromIdx].position;
    newSqs[fromIdx] = { ...newSqs[fromIdx], position: newSqs[toIdx].position };
    newSqs[toIdx] = { ...newSqs[toIdx], position: tmp };
    newSqs.sort((a, b) => a.position - b.position);
    setSquares(newSqs);
    setDragging(null); setOver(null);
  };

  const updateSquare = (position, field, value) =>
    setSquares(prev => prev.map(s => s.position === position ? { ...s, [field]: value } : s));

  const setLineValue = (key, val) => setConfig(p => ({ ...p, [key]: val }));

  return (
    <div>
      {/* ── Tiles section ── */}
      <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>Drag tiles to rearrange. Click a tile to edit.</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <CsvImporter
            label="bingo_tiles"
            themeColor={tc}
            sampleHeaders={['position', 'label', 'point_value', 'description', 'is_free_space']}
            sampleRow={{ position: 0, label: 'Catch a Shiny', point_value: 10, description: '', is_free_space: false }}
            onImport={onImportSquares}
          />
          <button onClick={onExportSquares}
            style={{ background: 'none', border: '1px solid #333', color: '#666', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
            ↓ Export CSV
          </button>
          <button onClick={onSaveSquares} disabled={saving}
            style={{ background: tc, color: 'var(--text)', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            {saving ? 'Saving...' : 'Save Board'}
          </button>
        </div>
      </div>

      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '24px repeat(5, 1fr)', gap: 4, marginBottom: 4 }}>
        <div />
        {[0,1,2,3,4].map(c => (
          <div key={c} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>Col {c+1}</div>
            <div style={{ fontSize: 10, color: tc }}>{(config[`col${c+1}_value`] ?? 0) > 0 ? `${config[`col${c+1}_value`]}pts` : ''}</div>
          </div>
        ))}
      </div>

      {[0,1,2,3,4].map(row => (
        <div key={row} style={{ display: 'grid', gridTemplateColumns: '24px repeat(5, 1fr)', gap: 4, marginBottom: 4 }}>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-end', paddingRight: 4 }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>R{row+1}</div>
            <div style={{ fontSize: 10, color: tc }}>{(config[`row${row+1}_value`] ?? 0) > 0 ? `${config[`row${row+1}_value`]}pts` : ''}</div>
          </div>
          {[0,1,2,3,4].map(col => {
            const pos = row * 5 + col;
            const sq = squares.find(s => s.position === pos);
            if (!sq) return <div key={col} />;
            const isEditing = editingIdx === pos;
            return (
              <div key={col}
                draggable={!isEditing}
                onDragStart={() => setDragging(pos)}
                onDragOver={e => { e.preventDefault(); setOver(pos); }}
                onDrop={() => handleDrop(pos)}
                onClick={() => setEditingIdx(isEditing ? null : pos)}
                style={{
                  border: `2px solid ${over === pos ? tc : isEditing ? tc : 'var(--border)'}`,
                  borderRadius: 6,
                  background: sq.is_free_space ? `${tc}33` : isEditing ? `${tc}18` : 'var(--surface-raised)',
                  padding: 8, cursor: 'grab',
                  opacity: dragging === pos ? 0.4 : 1,
                  minHeight: 80, transition: 'border-color 0.15s', position: 'relative',
                }}>
                {sq.is_free_space && (
                  <div style={{ position: 'absolute', top: 4, right: 4, background: tc, color: 'var(--text)', fontSize: 9, fontWeight: 700, borderRadius: 3, padding: '1px 4px' }}>FREE</div>
                )}
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3, marginBottom: 4 }}>{sq.label || '(empty)'}</div>
                {!sq.is_free_space && <div style={{ fontSize: 11, color: tc, fontWeight: 700 }}>{sq.point_value}pts</div>}

                {isEditing && (
                  <div onClick={e => e.stopPropagation()} style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <input value={sq.label} onChange={e => updateSquare(pos, 'label', e.target.value)}
                      placeholder="Label"
                      style={{ background: '#1a1a1a', border: '1px solid #444', color: '#fff', borderRadius: 4, padding: '4px 8px', fontSize: 12, width: '100%' }} />
                    {!sq.is_free_space && (
                      <input type="number" value={sq.point_value} onChange={e => updateSquare(pos, 'point_value', Number(e.target.value))}
                        placeholder="Points"
                        style={{ background: '#1a1a1a', border: '1px solid #444', color: '#fff', borderRadius: 4, padding: '4px 8px', fontSize: 12, width: '100%' }} />
                    )}
                    <textarea value={sq.description ?? ''} onChange={e => updateSquare(pos, 'description', e.target.value)}
                      placeholder="Description (optional)" rows={2}
                      style={{ background: '#1a1a1a', border: '1px solid #444', color: '#fff', borderRadius: 4, padding: '4px 8px', fontSize: 11, width: '100%', resize: 'vertical' }} />
                    {config.free_space_enabled && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-dim)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={sq.is_free_space} onChange={e => {
                          if (e.target.checked) {
                            setSquares(prev => prev.map(s => ({
                              ...s,
                              is_free_space: s.position === pos,
                              label: s.position === pos ? 'FREE' : s.is_free_space ? `Square ${s.position + 1}` : s.label,
                            })));
                          } else {
                            updateSquare(pos, 'is_free_space', false);
                          }
                        }} />
                        Free Space
                      </label>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      <div style={{ marginTop: 8, display: 'flex', gap: 20, fontSize: 12, color: 'var(--text-dim)' }}>
        {(config.diag1_value ?? 0) > 0 && <span>↘ Diagonal: {config.diag1_value}pts</span>}
        {(config.diag2_value ?? 0) > 0 && <span>↙ Diagonal: {config.diag2_value}pts</span>}
      </div>

      {/* ── Line Values section ── */}
      <div style={{ marginTop: 36, borderTop: '1px solid var(--border)', paddingTop: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: 1 }}>Bingo Line Values</h3>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <CsvImporter
              label="bingo_line_values"
              themeColor={tc}
              sampleHeaders={['line', 'value']}
              sampleRow={{ line: 'row1', value: 50 }}
              onImport={onImportLineValues}
            />
            <button onClick={onExportLineValues}
              style={{ background: 'none', border: '1px solid #333', color: '#666', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
              ↓ Export CSV
            </button>
          </div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 16 }}>
          Bonus points awarded when a player/team completes a line. Set to 0 to disable a line bonus. CSV keys: row1–row5, col1–col5, diag1, diag2.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          {LINE_KEYS.map(({ key, label }) => (
            <div key={key}>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>{label}</label>
              <input type="number" min={0} value={config[key] ?? 0}
                onChange={e => setLineValue(key, Number(e.target.value))}
                style={{ background: '#1a1a1a', border: '1px solid #444', color: '#fff', borderRadius: 6, padding: '7px 10px', fontSize: 14, width: 100 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Config Tab (no line values here anymore) ───────────────
function ConfigTab({ config, setConfig, onSave, saving }) {
  const themeColor = config.theme_color || '#c62828';
  const field = (key, label, type = 'text') => (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>{label}</label>
      <input type={type} value={config[key] ?? ''} onChange={e => setConfig(p => ({ ...p, [key]: type === 'number' ? Number(e.target.value) : e.target.value }))}
        style={{ background: '#1a1a1a', border: '1px solid #444', color: '#fff', borderRadius: 6, padding: '8px 12px', fontSize: 14, width: '100%', maxWidth: 360 }} />
    </div>
  );

  return (
    <div style={{ maxWidth: 700 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 }}>Display</h3>
      {field('game_title', 'Event Title')}
      {field('game_subtitle', 'Subtitle (optional)')}
      {field('title_image_url', 'Title Image URL (optional)')}
      {field('theme_color', 'Theme Color (hex)', 'color')}

      <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginTop: 24, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 }}>Dates</h3>
      {field('start_date', 'Start Date', 'date')}
      {field('end_date', 'End Date', 'date')}

      <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginTop: 24, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 }}>Scoring</h3>
      {field('score_divisor', 'Score Divisor', 'number')}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>Score Operation</label>
        <select value={config.score_operation ?? 'divide'} onChange={e => setConfig(p => ({ ...p, score_operation: e.target.value }))}
          style={{ background: '#1a1a1a', border: '1px solid #444', color: '#fff', borderRadius: 6, padding: '8px 12px', fontSize: 14 }}>
          <option value="divide" style={{ background: '#1a1a1a', color: '#fff' }}>Divide</option>
          <option value="multiply" style={{ background: '#1a1a1a', color: '#fff' }}>Multiply</option>
        </select>
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>Rounding Mode</label>
        <select value={config.score_rounding_mode ?? 'ceil'} onChange={e => setConfig(p => ({ ...p, score_rounding_mode: e.target.value }))}
          style={{ background: '#1a1a1a', border: '1px solid #444', color: '#fff', borderRadius: 6, padding: '8px 12px', fontSize: 14 }}>
          <option value="ceil" style={{ background: '#1a1a1a', color: '#fff' }}>Ceiling</option>
          <option value="floor" style={{ background: '#1a1a1a', color: '#fff' }}>Floor</option>
          <option value="round" style={{ background: '#1a1a1a', color: '#fff' }}>Round</option>
        </select>
      </div>

      <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginTop: 24, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 }}>Settings</h3>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14, color: '#fff' }}>
          <input type="checkbox" checked={!!config.free_space_enabled} onChange={e => setConfig(p => ({ ...p, free_space_enabled: e.target.checked }))} />
          Free Space in Center (position 13)
        </label>
      </div>

      <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginTop: 24, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 }}>Discord</h3>
      {field('discord_webhook_url', 'Overall Discord Webhook URL')}

      <button onClick={onSave} disabled={saving}
        style={{ marginTop: 8, background: themeColor, color: 'var(--text)', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
        {saving ? 'Saving...' : 'Save Configuration'}
      </button>
    </div>
  );
}

// ── Players/Teams Tab ─────────────────────────────────────
function PlayersTab({ config, players, setPlayers, teams, setTeams, eventId, onSave, saving, onImportPlayers, onExportPlayers, onImportTeams, onExportTeams }) {
  const isTeam = config.event_type === 'team';
  const themeColor = config.theme_color || '#c62828';

  const addPlayer = () => setPlayers(prev => [...prev, {
    id: `new-${Date.now()}`, event_id: eventId, name: '', avatar_url: '',
    color: TEAM_COLORS[prev.length % TEAM_COLORS.length],
    team_id: null, sort_order: prev.length, _isNew: true,
  }]);

  const addTeam = () => setTeams(prev => [...prev, {
    id: `new-${Date.now()}`, event_id: eventId, name: '', avatar_url: '',
    discord_webhook_url: '', color: TEAM_COLORS[prev.length % TEAM_COLORS.length],
    sort_order: prev.length, _isNew: true,
  }]);

  const updatePlayer = (id, field, value) => setPlayers(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  const updateTeam = (id, field, value) => setTeams(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
  const removePlayer = (id) => setPlayers(prev => prev.filter(p => p.id !== id));
  const removeTeam = (id) => {
    setTeams(prev => prev.filter(t => t.id !== id));
    setPlayers(prev => prev.map(p => p.team_id === id ? { ...p, team_id: null } : p));
  };

  return (
    <div>
      {isTeam && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: 1 }}>Teams</h3>
            <button onClick={addTeam} style={{ background: 'none', border: `1px solid ${themeColor}`, color: themeColor, borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>+ Add Team</button>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <CsvImporter label="bingo_teams" themeColor={themeColor}
                sampleHeaders={['team_name','avatar_url','color','discord_webhook']}
                sampleRow={{ team_name: 'Team Rocket', avatar_url: '', color: '#ef4444', discord_webhook: '' }}
                onImport={onImportTeams} />
              <button onClick={onExportTeams} style={{ background: 'none', border: '1px solid #333', color: '#666', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>↓ Export CSV</button>
            </div>
          </div>
          {teams.map(t => (
            <div key={t.id} style={{ background: '#1a1a1a', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 10, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 3 }}>Team Name</label>
                <input value={t.name} onChange={e => updateTeam(t.id, 'name', e.target.value)}
                  style={{ background: '#1a1a1a', border: '1px solid #444', color: '#fff', borderRadius: 5, padding: '6px 10px', fontSize: 13 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 3 }}>Avatar URL</label>
                <input value={t.avatar_url ?? ''} onChange={e => updateTeam(t.id, 'avatar_url', e.target.value)}
                  placeholder="https://..." style={{ background: '#1a1a1a', border: '1px solid #444', color: '#fff', borderRadius: 5, padding: '6px 10px', fontSize: 13, width: 200 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 3 }}>Color</label>
                <input type="color" value={t.color ?? '#ef4444'} onChange={e => updateTeam(t.id, 'color', e.target.value)}
                  style={{ width: 40, height: 32, border: 'none', background: 'none', cursor: 'pointer' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 3 }}>Discord Webhook</label>
                <input value={t.discord_webhook_url ?? ''} onChange={e => updateTeam(t.id, 'discord_webhook_url', e.target.value)}
                  placeholder="https://discord.com/api/webhooks/..."
                  style={{ background: '#1a1a1a', border: '1px solid #444', color: '#fff', borderRadius: 5, padding: '6px 10px', fontSize: 12, width: 260 }} />
              </div>
              <button onClick={() => removeTeam(t.id)} style={{ background: 'none', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 5, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>Remove</button>
            </div>
          ))}
        </div>
      )}

      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: 1 }}>Players</h3>
          <button onClick={addPlayer} style={{ background: 'none', border: `1px solid ${themeColor}`, color: themeColor, borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>+ Add Player</button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <CsvImporter label="bingo_players" themeColor={themeColor}
              sampleHeaders={['player_name','team_name','avatar_url','color']}
              sampleRow={{ player_name: 'Ash', team_name: isTeam ? 'Team Rocket' : '', avatar_url: '', color: '#ef4444' }}
              onImport={onImportPlayers} />
            <button onClick={onExportPlayers} style={{ background: 'none', border: '1px solid #333', color: '#666', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>↓ Export CSV</button>
          </div>
        </div>
        {players.map(p => (
          <div key={p.id} style={{ background: '#1a1a1a', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 10, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 3 }}>Name</label>
              <input value={p.name} onChange={e => updatePlayer(p.id, 'name', e.target.value)}
                style={{ background: '#1a1a1a', border: '1px solid #444', color: '#fff', borderRadius: 5, padding: '6px 10px', fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 3 }}>Avatar URL</label>
              <input value={p.avatar_url ?? ''} onChange={e => updatePlayer(p.id, 'avatar_url', e.target.value)}
                placeholder="https://..." style={{ background: '#1a1a1a', border: '1px solid #444', color: '#fff', borderRadius: 5, padding: '6px 10px', fontSize: 13, width: 180 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 3 }}>Color</label>
              <input type="color" value={p.color ?? '#ef4444'} onChange={e => updatePlayer(p.id, 'color', e.target.value)}
                style={{ width: 40, height: 32, border: 'none', background: 'none', cursor: 'pointer' }} />
            </div>
            {isTeam && (
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 3 }}>Team</label>
                <select value={p.team_id ?? ''} onChange={e => updatePlayer(p.id, 'team_id', e.target.value || null)}
                  style={{ background: '#1a1a1a', border: '1px solid #444', color: '#fff', borderRadius: 5, padding: '6px 10px', fontSize: 13 }}>
                  <option value="" style={{ background: '#1a1a1a', color: '#fff' }}>No Team</option>
                  {teams.map(t => <option key={t.id} value={t.id} style={{ background: '#1a1a1a', color: '#fff' }}>{t.name}</option>)}
                </select>
              </div>
            )}
            <button onClick={() => removePlayer(p.id)} style={{ background: 'none', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 5, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>Remove</button>
          </div>
        ))}
      </div>

      <button onClick={onSave} disabled={saving}
        style={{ marginTop: 16, background: themeColor, color: 'var(--text)', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
        {saving ? 'Saving...' : 'Save Players & Teams'}
      </button>
    </div>
  );
}

// ── Main Edit Page ─────────────────────────────────────────
export default function BingoEditPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [tab, setTab] = useState('board');
  const [config, setConfig] = useState(null);
  const [eventName, setEventName] = useState('');
  const [squares, setSquares] = useState([]);
  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const flash = (text, isError = false) => { setMsg({ text, isError }); setTimeout(() => setMsg(null), 4000); };

  useEffect(() => {
    (async () => {
      const [{ data: cfg }, { data: sqs }, { data: pls }, { data: tms }, { data: ev }] = await Promise.all([
        supabase.from('bingo_config').select('*').eq('event_id', eventId).single(),
        supabase.from('bingo_squares').select('*').eq('event_id', eventId).order('position'),
        supabase.from('bingo_players').select('*').eq('event_id', eventId).order('sort_order'),
        supabase.from('bingo_teams').select('*').eq('event_id', eventId).order('sort_order'),
        supabase.from('events').select('name').eq('id', eventId).single(),
      ]);
      setConfig(cfg ?? {});
      setSquares(sqs?.length > 0 ? sqs : defaultSquares(cfg?.free_space_enabled ?? true));
      setPlayers(pls ?? []);
      setTeams(tms ?? []);
      setEventName(ev?.name ?? '');
      setLoading(false);
    })();
  }, [eventId]);

  const saveConfig = async () => {
    setSaving(true);
    const { error } = await supabase.from('bingo_config').update(config).eq('event_id', eventId);
    setSaving(false);
    if (error) return flash(error.message, true);
    flash('Configuration saved.');
    await logAudit({ actor: profile, eventType: 'config_change', action: `Saved bingo config for "${eventName}"`, eventId, eventName });
  };

  // saveSquares also saves line values (they live in bingo_config)
  const saveSquares = async () => {
    setSaving(true);
    // Save line values to bingo_config first
    const lineValueUpdate = {};
    LINE_KEYS.forEach(({ key }) => { lineValueUpdate[key] = config[key] ?? 0; });
    const { error: cfgErr } = await supabase.from('bingo_config').update(lineValueUpdate).eq('event_id', eventId);
    if (cfgErr) { setSaving(false); return flash(cfgErr.message, true); }

    await supabase.from('bingo_squares').delete().eq('event_id', eventId);
    const toInsert = squares.map(({ id, _isNew, ...s }) => ({ ...s, event_id: eventId }));
    const { error } = await supabase.from('bingo_squares').insert(toInsert);
    setSaving(false);
    if (error) return flash(error.message, true);
    const { data } = await supabase.from('bingo_squares').select('*').eq('event_id', eventId).order('position');
    setSquares(data ?? []);
    flash('Board and line values saved.');
    await logAudit({ actor: profile, eventType: 'config_change', action: `Saved bingo board for "${eventName}"`, eventId, eventName });
  };

  const savePlayersTeams = async () => {
    setSaving(true);
    try {
      for (const t of teams) {
        const { id, _isNew, ...fields } = t;
        if (_isNew) {
          const { data } = await supabase.from('bingo_teams').insert({ ...fields, event_id: eventId }).select().single();
          setPlayers(prev => prev.map(p => p.team_id === id ? { ...p, team_id: data.id } : p));
          setTeams(prev => prev.map(t2 => t2.id === id ? { ...t2, id: data.id, _isNew: false } : t2));
        } else {
          await supabase.from('bingo_teams').update(fields).eq('id', id);
        }
      }
      for (const p of players) {
        const { id, _isNew, ...fields } = p;
        if (_isNew) {
          await supabase.from('bingo_players').insert({ ...fields, event_id: eventId });
        } else {
          await supabase.from('bingo_players').update(fields).eq('id', id);
        }
      }
      const [{ data: pls }, { data: tms }] = await Promise.all([
        supabase.from('bingo_players').select('*').eq('event_id', eventId).order('sort_order'),
        supabase.from('bingo_teams').select('*').eq('event_id', eventId).order('sort_order'),
      ]);
      setPlayers(pls ?? []); setTeams(tms ?? []);
      flash('Players and teams saved.');
    } catch (e) { flash(e.message, true); }
    finally { setSaving(false); }
  };

  // ── Square CSV import/export ──────────────────────────────
  const importSquares = async (rows) => {
    let imported = 0, errors = [];
    const parsed = rows.map(row => {
      const pos = parseInt(row['position']);
      if (isNaN(pos) || pos < 0 || pos > 24) { errors.push(`Invalid position: "${row['position']}"`); return null; }
      return {
        position: pos,
        label: row['label']?.trim() || `Square ${pos + 1}`,
        point_value: parseFloat(row['point_value']) || 1,
        description: row['description']?.trim() || '',
        is_free_space: row['is_free_space']?.toLowerCase() === 'true',
      };
    }).filter(Boolean);

    setSquares(prev => {
      const map = Object.fromEntries(prev.map(s => [s.position, s]));
      for (const sq of parsed) { map[sq.position] = { ...map[sq.position], ...sq }; imported++; }
      return Object.values(map).sort((a, b) => a.position - b.position);
    });

    if (errors.length) return { error: true, text: `${imported} merged, ${errors.length} skipped: ${errors[0]}` };
    return { text: `${imported} squares merged. Click Save Board to commit.` };
  };

  const exportSquares = () => {
    downloadCSV(
      `bingo_squares_${eventId}.csv`,
      ['position', 'label', 'point_value', 'description', 'is_free_space'],
      squares.map(s => ({ position: s.position, label: s.label, point_value: s.point_value, description: s.description ?? '', is_free_space: s.is_free_space }))
    );
  };

  // ── Line values CSV import/export ─────────────────────────
  const importLineValues = async (rows) => {
    let imported = 0, errors = [];
    const validKeys = new Set(LINE_KEYS.map(({ key }) => key.replace('_value', '')));
    const updates = {};
    for (const row of rows) {
      const line = row['line']?.trim().toLowerCase();
      if (!line || !validKeys.has(line)) { errors.push(`Unknown line: "${row['line']}"`); continue; }
      const val = parseFloat(row['value']);
      if (isNaN(val)) { errors.push(`Invalid value for ${line}: "${row['value']}"`); continue; }
      updates[`${line}_value`] = val;
      imported++;
    }
    // Merge into config state (will be committed when runner clicks Save Board)
    setConfig(prev => ({ ...prev, ...updates }));
    if (errors.length) return { error: true, text: `${imported} merged, ${errors.length} errors: ${errors[0]}. Click Save Board to commit.` };
    return { text: `${imported} line values merged. Click Save Board to commit.` };
  };

  const exportLineValues = () => {
    downloadCSV(
      `bingo_line_values_${eventId}.csv`,
      ['line', 'value'],
      LINE_KEYS.map(({ key, label }) => ({ line: key.replace('_value', ''), value: config[key] ?? 0 }))
    );
  };

  // ── Players/Teams CSV import/export ───────────────────────
  const importPlayers = async (rows) => {
    let imported = 0, errors = [];
    for (const row of rows) {
      const name = row['player_name']?.trim();
      if (!name) { errors.push('Row missing player_name'); continue; }
      const teamName = row['team_name']?.trim();
      const team = teamName ? teams.find(t => t.name.toLowerCase() === teamName.toLowerCase()) : null;
      const existing = players.find(p => p.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        await supabase.from('bingo_players').update({
          avatar_url: row['avatar_url']?.trim() || existing.avatar_url,
          color: row['color']?.trim() || existing.color,
          team_id: team?.id ?? existing.team_id,
        }).eq('id', existing.id);
      } else {
        await supabase.from('bingo_players').insert({
          event_id: eventId, name,
          avatar_url: row['avatar_url']?.trim() || null,
          color: row['color']?.trim() || TEAM_COLORS[imported % TEAM_COLORS.length],
          team_id: team?.id ?? null,
          sort_order: players.length + imported,
        });
      }
      imported++;
    }
    const { data } = await supabase.from('bingo_players').select('*').eq('event_id', eventId).order('sort_order');
    setPlayers(data ?? []);
    if (errors.length) return { error: true, text: `${imported} imported, ${errors.length} errors: ${errors[0]}` };
    return { text: `${imported} players imported.` };
  };

  const exportPlayers = () => {
    downloadCSV(
      `bingo_players_${eventId}.csv`,
      ['player_name', 'team_name', 'avatar_url', 'color'],
      players.map(p => ({
        player_name: p.name,
        team_name: teams.find(t => t.id === p.team_id)?.name ?? '',
        avatar_url: p.avatar_url ?? '',
        color: p.color ?? '',
      }))
    );
  };

  const importTeams = async (rows) => {
    let imported = 0, errors = [];
    for (const row of rows) {
      const name = row['team_name']?.trim();
      if (!name) { errors.push('Row missing team_name'); continue; }
      const existing = teams.find(t => t.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        await supabase.from('bingo_teams').update({
          avatar_url: row['avatar_url']?.trim() || existing.avatar_url,
          color: row['color']?.trim() || existing.color,
          discord_webhook_url: row['discord_webhook']?.trim() || existing.discord_webhook_url,
        }).eq('id', existing.id);
      } else {
        await supabase.from('bingo_teams').insert({
          event_id: eventId, name,
          avatar_url: row['avatar_url']?.trim() || null,
          color: row['color']?.trim() || TEAM_COLORS[imported % TEAM_COLORS.length],
          discord_webhook_url: row['discord_webhook']?.trim() || null,
          sort_order: teams.length + imported,
        });
      }
      imported++;
    }
    const { data } = await supabase.from('bingo_teams').select('*').eq('event_id', eventId).order('sort_order');
    setTeams(data ?? []);
    if (errors.length) return { error: true, text: `${imported} imported, ${errors.length} errors: ${errors[0]}` };
    return { text: `${imported} teams imported.` };
  };

  const exportTeams = () => {
    downloadCSV(
      `bingo_teams_${eventId}.csv`,
      ['team_name', 'avatar_url', 'color', 'discord_webhook'],
      teams.map(t => ({ team_name: t.name, avatar_url: t.avatar_url ?? '', color: t.color ?? '', discord_webhook: t.discord_webhook_url ?? '' }))
    );
  };

  if (loading) return <div style={{ padding: 40, color: 'var(--text-dim)' }}>Loading...</div>;
  if (!config) return <div style={{ padding: 40, color: '#ef4444' }}>Event not found.</div>;

  const themeColor = config.theme_color || '#c62828';
  const tabs = [{ id: 'board', label: 'Board Tiles' }, { id: 'config', label: 'Configuration' }, { id: 'players', label: 'Players & Teams' }];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '32px 24px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <button onClick={() => navigate(`/admin/bingo/${eventId}`)}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-dim)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>
            ← Back
          </button>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#fff' }}>Edit Bingo Event</h1>
        </div>

        {msg && (
          <div style={{ background: msg.isError ? '#ef444422' : `${themeColor}22`, border: `1px solid ${msg.isError ? '#ef4444' : themeColor}`, color: msg.isError ? '#ef4444' : themeColor, borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontWeight: 600 }}>
            {msg.text}
          </div>
        )}

        <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)', marginBottom: 24 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ background: 'none', border: 'none', borderBottom: tab === t.id ? `3px solid ${themeColor}` : '3px solid transparent', color: tab === t.id ? themeColor : 'var(--text-dim)', padding: '10px 20px', fontSize: 14, fontWeight: tab === t.id ? 700 : 400, cursor: 'pointer', marginBottom: -2, transition: 'color 0.15s' }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'board' && (
          <BoardBuilder
            squares={squares} setSquares={setSquares}
            config={config} setConfig={setConfig}
            themeColor={themeColor}
            onSaveSquares={saveSquares} saving={saving}
            onImportSquares={importSquares} onExportSquares={exportSquares}
            onImportLineValues={importLineValues} onExportLineValues={exportLineValues}
            eventId={eventId}
          />
        )}
        {tab === 'config' && (
          <ConfigTab config={config} setConfig={setConfig} onSave={saveConfig} saving={saving} />
        )}
        {tab === 'players' && (
          <PlayersTab
            config={config}
            players={players} setPlayers={setPlayers}
            teams={teams} setTeams={setTeams}
            eventId={eventId} onSave={savePlayersTeams} saving={saving}
            onImportPlayers={importPlayers} onExportPlayers={exportPlayers}
            onImportTeams={importTeams} onExportTeams={exportTeams}
          />
        )}
      </div>
    </div>
  );
}
