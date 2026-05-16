import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { TEAM_COLORS, TEAM_COLOR_NAMES } from '../../lib/bingo';

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

// ── Drag-and-drop tile grid ────────────────────────────────
function BoardBuilder({ squares, setSquares, config, onSaveSquares, saving }) {
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);
  const [editingIdx, setEditingIdx] = useState(null);
  const themeColor = config.theme_color || '#c62828';

  const handleDragStart = (pos) => setDragging(pos);
  const handleDragOver = (e, pos) => { e.preventDefault(); setOver(pos); };
  const handleDrop = (pos) => {
    if (dragging === null || dragging === pos) { setDragging(null); setOver(null); return; }
    const newSqs = [...squares];
    const fromIdx = newSqs.findIndex(s => s.position === dragging);
    const toIdx = newSqs.findIndex(s => s.position === pos);
    if (fromIdx < 0 || toIdx < 0) { setDragging(null); setOver(null); return; }
    // Swap positions
    const tmp = newSqs[fromIdx].position;
    newSqs[fromIdx] = { ...newSqs[fromIdx], position: newSqs[toIdx].position };
    newSqs[toIdx] = { ...newSqs[toIdx], position: tmp };
    newSqs.sort((a, b) => a.position - b.position);
    setSquares(newSqs);
    setDragging(null);
    setOver(null);
  };

  const updateSquare = (position, field, value) => {
    setSquares(prev => prev.map(s => s.position === position ? { ...s, [field]: value } : s));
  };

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>Drag tiles to rearrange. Click a tile to edit its details.</span>
        <button onClick={onSaveSquares} disabled={saving}
          style={{ marginLeft: 'auto', background: themeColor, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          {saving ? 'Saving...' : 'Save Board'}
        </button>
      </div>

      {/* Column headers with line values */}
      <div style={{ display: 'grid', gridTemplateColumns: '24px repeat(5, 1fr)', gap: 4, marginBottom: 4 }}>
        <div />
        {[0,1,2,3,4].map(c => (
          <div key={c} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>Col {c+1}</div>
            <div style={{ fontSize: 10, color: themeColor }}>{config[`col${c+1}_value`] > 0 ? `${config[`col${c+1}_value`]}pts` : ''}</div>
          </div>
        ))}
      </div>

      {[0,1,2,3,4].map(row => (
        <div key={row} style={{ display: 'grid', gridTemplateColumns: '24px repeat(5, 1fr)', gap: 4, marginBottom: 4 }}>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-end', paddingRight: 4 }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>R{row+1}</div>
            <div style={{ fontSize: 10, color: themeColor }}>{config[`row${row+1}_value`] > 0 ? `${config[`row${row+1}_value`]}pts` : ''}</div>
          </div>
          {[0,1,2,3,4].map(col => {
            const pos = row * 5 + col;
            const sq = squares.find(s => s.position === pos);
            if (!sq) return <div key={col} />;
            const isEditing = editingIdx === pos;
            const isDraggingThis = dragging === pos;
            const isOver = over === pos;
            return (
              <div key={col}
                draggable={!isEditing}
                onDragStart={() => handleDragStart(pos)}
                onDragOver={e => handleDragOver(e, pos)}
                onDrop={() => handleDrop(pos)}
                onClick={() => setEditingIdx(isEditing ? null : pos)}
                style={{
                  border: `2px solid ${isOver ? themeColor : isEditing ? themeColor : 'var(--border)'}`,
                  borderRadius: 6,
                  background: sq.is_free_space ? `${themeColor}33` : isEditing ? `${themeColor}18` : 'var(--surface-raised)',
                  padding: 8,
                  cursor: 'grab',
                  opacity: isDraggingThis ? 0.4 : 1,
                  minHeight: 80,
                  transition: 'border-color 0.15s',
                  position: 'relative',
                }}>
                {sq.is_free_space && (
                  <div style={{ position: 'absolute', top: 4, right: 4, background: themeColor, color: '#fff', fontSize: 9, fontWeight: 700, borderRadius: 3, padding: '1px 4px' }}>FREE</div>
                )}
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3, marginBottom: 4 }}>{sq.label || '(empty)'}</div>
                {!sq.is_free_space && <div style={{ fontSize: 11, color: themeColor, fontWeight: 700 }}>{sq.point_value}pts</div>}

                {isEditing && (
                  <div onClick={e => e.stopPropagation()} style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <input value={sq.label} onChange={e => updateSquare(pos, 'label', e.target.value)}
                      placeholder="Label"
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 4, padding: '4px 8px', fontSize: 12, width: '100%' }} />
                    {!sq.is_free_space && (
                      <input type="number" value={sq.point_value} onChange={e => updateSquare(pos, 'point_value', Number(e.target.value))}
                        placeholder="Points"
                        style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 4, padding: '4px 8px', fontSize: 12, width: '100%' }} />
                    )}
                    <textarea value={sq.description ?? ''} onChange={e => updateSquare(pos, 'description', e.target.value)}
                      placeholder="Description (optional)"
                      rows={2}
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 4, padding: '4px 8px', fontSize: 11, width: '100%', resize: 'vertical' }} />
                    {config.free_space_enabled && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-dim)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={sq.is_free_space} onChange={e => {
                          // Only one free space allowed
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

      {/* Diagonal labels */}
      <div style={{ marginTop: 8, display: 'flex', gap: 20, fontSize: 12, color: 'var(--text-dim)' }}>
        {config.diag1_value > 0 && <span>↘ Diagonal: {config.diag1_value}pts</span>}
        {config.diag2_value > 0 && <span>↙ Diagonal: {config.diag2_value}pts</span>}
      </div>
    </div>
  );
}

// ── Config Tab ─────────────────────────────────────────────
function ConfigTab({ config, setConfig, onSave, saving }) {
  const themeColor = config.theme_color || '#c62828';
  const field = (key, label, type = 'text', extra = {}) => (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>{label}</label>
      <input type={type} value={config[key] ?? ''} onChange={e => setConfig(p => ({ ...p, [key]: type === 'number' ? Number(e.target.value) : e.target.value }))}
        {...extra}
        style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '8px 12px', fontSize: 14, width: '100%', maxWidth: 360 }} />
    </div>
  );
  const boolField = (key, label) => (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14, color: 'var(--text)' }}>
        <input type="checkbox" checked={!!config[key]} onChange={e => setConfig(p => ({ ...p, [key]: e.target.checked }))} />
        {label}
      </label>
    </div>
  );
  const lineValueField = (key, label) => (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>{label}</label>
      <input type="number" min={0} value={config[key] ?? 0} onChange={e => setConfig(p => ({ ...p, [key]: Number(e.target.value) }))}
        style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '7px 10px', fontSize: 14, width: 100 }} />
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
          style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '8px 12px', fontSize: 14 }}>
          <option value="divide">Divide</option>
          <option value="multiply">Multiply</option>
        </select>
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>Rounding Mode</label>
        <select value={config.score_rounding_mode ?? 'ceil'} onChange={e => setConfig(p => ({ ...p, score_rounding_mode: e.target.value }))}
          style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '8px 12px', fontSize: 14 }}>
          <option value="ceil">Ceiling</option>
          <option value="floor">Floor</option>
          <option value="round">Round</option>
        </select>
      </div>

      <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginTop: 24, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 }}>Bingo Line Values</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
        {[1,2,3,4,5].map(i => lineValueField(`row${i}_value`, `Row ${i}`))}
        {[1,2,3,4,5].map(i => lineValueField(`col${i}_value`, `Column ${i}`))}
        {lineValueField('diag1_value', 'Diagonal ↘')}
        {lineValueField('diag2_value', 'Diagonal ↙')}
      </div>

      <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginTop: 24, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 }}>Settings</h3>
      {boolField('free_space_enabled', 'Free Space in Center (position 12)')}

      <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginTop: 24, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 }}>Discord</h3>
      {field('discord_webhook_url', 'Overall Discord Webhook URL')}

      <button onClick={onSave} disabled={saving}
        style={{ marginTop: 8, background: themeColor, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
        {saving ? 'Saving...' : 'Save Configuration'}
      </button>
    </div>
  );
}

// ── Players/Teams Tab ─────────────────────────────────────
function PlayersTab({ config, players, setPlayers, teams, setTeams, eventId, onSave, saving }) {
  const isTeam = config.event_type === 'team';
  const themeColor = config.theme_color || '#c62828';

  const addPlayer = () => setPlayers(prev => [...prev, {
    id: `new-${Date.now()}`,
    event_id: eventId,
    name: '',
    avatar_url: '',
    color: TEAM_COLORS[prev.filter(p => p.team_id === (isTeam ? teams[0]?.id : null)).length % TEAM_COLORS.length],
    team_id: null,
    sort_order: prev.length,
    _isNew: true,
  }]);

  const addTeam = () => setTeams(prev => [...prev, {
    id: `new-${Date.now()}`,
    event_id: eventId,
    name: '',
    avatar_url: '',
    discord_webhook_url: '',
    color: TEAM_COLORS[prev.length % TEAM_COLORS.length],
    sort_order: prev.length,
    _isNew: true,
  }]);

  const updatePlayer = (id, field, value) => setPlayers(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  const updateTeam = (id, field, value) => setTeams(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
  const removePlayer = (id) => setPlayers(prev => prev.filter(p => p.id !== id));
  const removeTeam = (id) => { setTeams(prev => prev.filter(t => t.id !== id)); setPlayers(prev => prev.map(p => p.team_id === id ? { ...p, team_id: null } : p)); };

  return (
    <div>
      {isTeam && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: 1 }}>Teams</h3>
            <button onClick={addTeam} style={{ background: 'none', border: `1px solid ${themeColor}`, color: themeColor, borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>+ Add Team</button>
          </div>
          {teams.map((t, ti) => (
            <div key={t.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 10, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 3 }}>Team Name</label>
                <input value={t.name} onChange={e => updateTeam(t.id, 'name', e.target.value)}
                  style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 5, padding: '6px 10px', fontSize: 13 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 3 }}>Avatar URL</label>
                <input value={t.avatar_url ?? ''} onChange={e => updateTeam(t.id, 'avatar_url', e.target.value)}
                  placeholder="https://..."
                  style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 5, padding: '6px 10px', fontSize: 13, width: 200 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 3 }}>Team Color</label>
                <input type="color" value={t.color ?? '#ef4444'} onChange={e => updateTeam(t.id, 'color', e.target.value)}
                  style={{ width: 40, height: 32, border: 'none', background: 'none', cursor: 'pointer' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 3 }}>Discord Webhook</label>
                <input value={t.discord_webhook_url ?? ''} onChange={e => updateTeam(t.id, 'discord_webhook_url', e.target.value)}
                  placeholder="https://discord.com/api/webhooks/..."
                  style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 5, padding: '6px 10px', fontSize: 12, width: 260 }} />
              </div>
              <button onClick={() => removeTeam(t.id)} style={{ background: 'none', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 5, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>Remove</button>
            </div>
          ))}
        </div>
      )}

      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: 1 }}>Players</h3>
          <button onClick={addPlayer} style={{ background: 'none', border: `1px solid ${themeColor}`, color: themeColor, borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>+ Add Player</button>
        </div>
        {players.map(p => (
          <div key={p.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 10, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 3 }}>Name</label>
              <input value={p.name} onChange={e => updatePlayer(p.id, 'name', e.target.value)}
                style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 5, padding: '6px 10px', fontSize: 13 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-dim)', display: 'block', marginBottom: 3 }}>Avatar URL</label>
              <input value={p.avatar_url ?? ''} onChange={e => updatePlayer(p.id, 'avatar_url', e.target.value)}
                placeholder="https://..."
                style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 5, padding: '6px 10px', fontSize: 13, width: 180 }} />
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
                  style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 5, padding: '6px 10px', fontSize: 13 }}>
                  <option value="">No Team</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
            <button onClick={() => removePlayer(p.id)} style={{ background: 'none', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 5, padding: '6px 10px', fontSize: 12, cursor: 'pointer' }}>Remove</button>
          </div>
        ))}
      </div>

      <button onClick={onSave} disabled={saving}
        style={{ marginTop: 16, background: themeColor, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
        {saving ? 'Saving...' : 'Save Players & Teams'}
      </button>
    </div>
  );
}

// ── Main Edit Page ─────────────────────────────────────────
export default function BingoEditPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState('board');
  const [config, setConfig] = useState(null);
  const [squares, setSquares] = useState([]);
  const [players, setPlayers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const flash = (text, isError = false) => { setMsg({ text, isError }); setTimeout(() => setMsg(null), 4000); };

  useEffect(() => {
    (async () => {
      const [
        { data: cfg },
        { data: sqs },
        { data: pls },
        { data: tms },
      ] = await Promise.all([
        supabase.from('bingo_config').select('*').eq('event_id', eventId).single(),
        supabase.from('bingo_squares').select('*').eq('event_id', eventId).order('position'),
        supabase.from('bingo_players').select('*').eq('event_id', eventId).order('sort_order'),
        supabase.from('bingo_teams').select('*').eq('event_id', eventId).order('sort_order'),
      ]);
      setConfig(cfg ?? {});
      setSquares(sqs?.length > 0 ? sqs : defaultSquares(cfg?.free_space_enabled ?? true));
      setPlayers(pls ?? []);
      setTeams(tms ?? []);
      setLoading(false);
    })();
  }, [eventId]);

  const saveConfig = async () => {
    setSaving(true);
    const { error } = await supabase.from('bingo_config').update(config).eq('event_id', eventId);
    setSaving(false);
    if (error) return flash(error.message, true);
    flash('Configuration saved.');
  };

  const saveSquares = async () => {
    setSaving(true);
    // Delete all, then re-insert
    await supabase.from('bingo_squares').delete().eq('event_id', eventId);
    const toInsert = squares.map(({ id, _isNew, ...s }) => ({ ...s, event_id: eventId }));
    const { error } = await supabase.from('bingo_squares').insert(toInsert);
    setSaving(false);
    if (error) return flash(error.message, true);
    // Reload to get IDs
    const { data } = await supabase.from('bingo_squares').select('*').eq('event_id', eventId).order('position');
    setSquares(data ?? []);
    flash('Board saved.');
  };

  const savePlayersTeams = async () => {
    setSaving(true);
    try {
      // Teams first
      for (const t of teams) {
        const { id, _isNew, ...fields } = t;
        if (_isNew) {
          const { data } = await supabase.from('bingo_teams').insert({ ...fields, event_id: eventId }).select().single();
          // Update player team_id references
          setPlayers(prev => prev.map(p => p.team_id === id ? { ...p, team_id: data.id } : p));
          setTeams(prev => prev.map(t2 => t2.id === id ? { ...t2, id: data.id, _isNew: false } : t2));
        } else {
          await supabase.from('bingo_teams').update(fields).eq('id', id);
        }
      }
      // Players
      for (const p of players) {
        const { id, _isNew, ...fields } = p;
        if (_isNew) {
          await supabase.from('bingo_players').insert({ ...fields, event_id: eventId });
        } else {
          await supabase.from('bingo_players').update(fields).eq('id', id);
        }
      }
      // Re-fetch
      const [{ data: pls }, { data: tms }] = await Promise.all([
        supabase.from('bingo_players').select('*').eq('event_id', eventId).order('sort_order'),
        supabase.from('bingo_teams').select('*').eq('event_id', eventId).order('sort_order'),
      ]);
      setPlayers(pls ?? []);
      setTeams(tms ?? []);
      flash('Players and teams saved.');
    } catch (e) {
      flash(e.message, true);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: 40, color: 'var(--text-dim)' }}>Loading...</div>;
  if (!config) return <div style={{ padding: 40, color: '#ef4444' }}>Event not found.</div>;

  const themeColor = config.theme_color || '#c62828';
  const tabs = [{ id: 'board', label: 'Board Tiles' }, { id: 'config', label: 'Configuration' }, { id: 'players', label: 'Players & Teams' }];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '32px 24px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <button onClick={() => navigate(`/admin/bingo/${eventId}`)} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-dim)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>← Back</button>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>Edit Bingo Event</h1>
        </div>

        {msg && (
          <div style={{ background: msg.isError ? '#ef444422' : `${themeColor}22`, border: `1px solid ${msg.isError ? '#ef4444' : themeColor}`, color: msg.isError ? '#ef4444' : themeColor, borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontWeight: 600 }}>
            {msg.text}
          </div>
        )}

        {/* Tabs */}
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
            squares={squares}
            setSquares={setSquares}
            config={config}
            onSaveSquares={saveSquares}
            saving={saving}
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
            eventId={eventId}
            onSave={savePlayersTeams}
            saving={saving}
          />
        )}
      </div>
    </div>
  );
}
