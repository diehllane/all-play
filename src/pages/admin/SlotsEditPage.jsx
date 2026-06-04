import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

const ALL_SYMBOLS = ['masterball','pokeball','greatball','ultraball','pikachu','eevee','rare_candy','potion','berry'];
const SYMBOL_LABELS = { masterball:'Masterball', pokeball:'Pokeball', greatball:'Greatball', ultraball:'Ultraball', pikachu:'Pikachu', eevee:'Eevee', rare_candy:'Rare Candy', potion:'Potion', berry:'Berry' };
const DEFAULT_EMOJIS = { masterball:'🟣', pokeball:'🔴', greatball:'🔵', ultraball:'🟡', pikachu:'⚡', eevee:'🦊', rare_candy:'🍬', potion:'🧪', berry:'🫐' };

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

export default function SlotsEditPage() {
  const { eventId } = useParams();
  const { profile } = useAuth();

  const [event, setEvent] = useState(null);
  const [config, setConfig] = useState(null);
  const [categories, setCategories] = useState([]);
  const [storeItems, setStoreItems] = useState([]);
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('config');

  // Config form state
  const [form, setForm] = useState({});
  const [symbolImages, setSymbolImages] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const canManage = profile?.role === 'event_runner' || profile?.role === 'owner';

  const loadAll = useCallback(async () => {
    try {
      const [evRes, cfgRes, catRes, storeRes, playersRes] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).single(),
        supabase.from('slots_config').select('*').eq('event_id', eventId).single(),
        supabase.from('slots_categories').select('*').eq('event_id', eventId).order('sort_order'),
        supabase.from('slots_store_items').select('*').eq('event_id', eventId).order('sort_order'),
        supabase.from('slots_players').select('*').eq('event_id', eventId).order('sort_order'),
      ]);
      if (evRes.error) throw evRes.error;
      setEvent(evRes.data);
      const cfg = cfgRes.data || {};
      setConfig(cfg);
      setForm({
        game_title: cfg.game_title || '',
        game_subtitle: cfg.game_subtitle || '',
        banner_image_url: cfg.banner_image_url || '',
        theme_color: cfg.theme_color || '#c62828',
        score_divisor: cfg.score_divisor ?? 1,
        score_operation: cfg.score_operation || 'divide',
        score_rounding: cfg.score_rounding || 'floor',
        min_tokens_per_day: cfg.min_tokens_per_day ?? 0,
        max_tokens_per_day: cfg.max_tokens_per_day ?? 0,
        cpc_per_token: cfg.cpc_per_token ?? 5,
        discord_webhook_url: cfg.discord_webhook_url || '',
      });
      setSymbolImages(cfg.symbol_images || {});
      setCategories(catRes.data || []);
      setStoreItems(storeRes.data || []);
      setPlayers(playersRes.data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  if (!canManage) return <div style={styles.center}>Access denied.</div>;
  if (loading) return <div style={styles.center}>Loading…</div>;
  if (error) return <div style={styles.center}>Error: {error}</div>;

  const theme = form.theme_color || '#c62828';
  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const flash = (msg) => { setSaveMsg(msg); setTimeout(() => setSaveMsg(''), 4000); };

  const saveConfig = async () => {
    setSaving(true);
    const { error: e } = await supabase.from('slots_config').update({
      game_title: form.game_title || null,
      game_subtitle: form.game_subtitle || null,
      banner_image_url: form.banner_image_url || null,
      theme_color: form.theme_color,
      score_divisor: parseFloat(form.score_divisor) || 1,
      score_operation: form.score_operation,
      score_rounding: form.score_rounding,
      min_tokens_per_day: parseInt(form.min_tokens_per_day) || 0,
      max_tokens_per_day: parseInt(form.max_tokens_per_day) || 0,
      cpc_per_token: parseInt(form.cpc_per_token) || 5,
      discord_webhook_url: form.discord_webhook_url || null,
    }).eq('event_id', eventId);
    flash(e ? 'Error: ' + e.message : '✅ Saved!');
    setSaving(false);
    if (!e) loadAll();
  };

  const saveSymbols = async () => {
    setSaving(true);
    const { error: e } = await supabase.from('slots_config').update({ symbol_images: symbolImages }).eq('event_id', eventId);
    flash(e ? 'Error: ' + e.message : '✅ Symbol images saved!');
    setSaving(false);
    if (!e) loadAll();
  };

  // ── Players CSV ───────────────────────────────────────────
  const importPlayers = async (rows) => {
    let imported = 0, errors = [];
    for (const row of rows) {
      const name = row['player_name']?.trim();
      if (!name) { errors.push('Row missing player_name'); continue; }
      const existing = players.find(p => p.name?.toLowerCase() === name.toLowerCase());
      if (existing) {
        await supabase.from('slots_players').update({
          avatar_url: row['avatar_url']?.trim() || existing.avatar_url,
          color: row['color']?.trim() || existing.color,
        }).eq('id', existing.id);
      } else {
        await supabase.from('slots_players').insert({
          event_id: eventId,
          name,
          avatar_url: row['avatar_url']?.trim() || null,
          color: row['color']?.trim() || null,
          sort_order: players.length + imported,
        });
      }
      imported++;
    }
    await loadAll();
    if (errors.length) return { error: true, text: `${imported} imported, ${errors.length} errors: ${errors[0]}` };
    return { text: `${imported} players imported.` };
  };

  const exportPlayers = () => {
    downloadCSV(
      `slots_players_${eventId}.csv`,
      ['player_name', 'avatar_url', 'color'],
      players.map(p => ({ player_name: p.name, avatar_url: p.avatar_url ?? '', color: p.color ?? '' }))
    );
  };

  // ── Categories CSV ────────────────────────────────────────
  const importCategories = async (rows) => {
    let imported = 0, errors = [];
    for (const row of rows) {
      const label = row['label']?.trim();
      if (!label) { errors.push('Row missing label'); continue; }
      const pts = parseFloat(row['point_value']) || 1;
      const sortOrder = parseInt(row['sort_order']) || imported;
      const existing = categories.find(c => c.label?.toLowerCase() === label.toLowerCase());
      if (existing) {
        await supabase.from('slots_categories').update({ point_value: pts, sort_order: sortOrder }).eq('id', existing.id);
      } else {
        await supabase.from('slots_categories').insert({ event_id: eventId, label, point_value: pts, sort_order: sortOrder });
      }
      imported++;
    }
    await loadAll();
    if (errors.length) return { error: true, text: `${imported} imported, ${errors.length} errors: ${errors[0]}` };
    return { text: `${imported} categories imported.` };
  };

  const exportCategories = () => {
    downloadCSV(
      `slots_categories_${eventId}.csv`,
      ['label', 'point_value', 'sort_order'],
      categories.map((c, i) => ({ label: c.label, point_value: c.point_value, sort_order: c.sort_order ?? i }))
    );
  };

  // ── Store Items CSV ───────────────────────────────────────
  const importStoreItems = async (rows) => {
    let imported = 0, errors = [];
    for (const row of rows) {
      const label = row['label']?.trim();
      if (!label) { errors.push('Row missing label'); continue; }
      const cost = parseInt(row['cost_cpc']) || 0;
      const qty = parseInt(row['quantity']) || 0;
      const paysOut = ['true','1','yes'].includes(String(row['pays_out_slot_tokens']).toLowerCase());
      const sortOrder = parseInt(row['sort_order']) || imported;
      const existing = storeItems.find(s => s.label?.toLowerCase() === label.toLowerCase());
      if (existing) {
        await supabase.from('slots_store_items').update({
          cost_cpc: cost,
          quantity: qty,
          pays_out_slot_tokens: paysOut,
          sort_order: sortOrder,
        }).eq('id', existing.id);
      } else {
        await supabase.from('slots_store_items').insert({
          event_id: eventId, label, cost_cpc: cost, quantity: qty, pays_out_slot_tokens: paysOut, sort_order: sortOrder,
        });
      }
      imported++;
    }
    await loadAll();
    if (errors.length) return { error: true, text: `${imported} imported, ${errors.length} errors: ${errors[0]}` };
    return { text: `${imported} store items imported.` };
  };

  const exportStoreItems = () => {
    downloadCSV(
      `slots_store_items_${eventId}.csv`,
      ['label', 'cost_cpc', 'quantity', 'pays_out_slot_tokens', 'sort_order'],
      storeItems.map((s, i) => ({
        label: s.label,
        cost_cpc: s.cost_cpc,
        quantity: s.quantity,
        pays_out_slot_tokens: s.pays_out_slot_tokens ? 'true' : 'false',
        sort_order: s.sort_order ?? i,
      }))
    );
  };

  return (
    <div style={styles.page}>
      <div style={{ ...styles.header, borderBottomColor: theme }}>
        <div>
          <div style={{ ...styles.title, color: theme }}>{event?.name}</div>
          <div style={{ fontSize: 12, opacity: 0.5 }}>Edit Slots Config</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to={`/admin/slots/${eventId}`} style={styles.linkBtn}>← Admin</Link>
          <Link to={`/slots/${eventId}`} target="_blank" style={styles.linkBtn}>🎰 Public ↗</Link>
        </div>
      </div>

      <div style={styles.tabBar}>
        {[['config','⚙️ Configuration'],['symbols','🖼️ Symbol Images'],['categories','🎯 Categories'],['players','👥 Players'],['store','🛒 Store Items']].map(([id,label]) => (
          <button key={id} onClick={() => setActiveTab(id)}
            style={{ ...styles.tab, ...(activeTab===id ? { borderBottomColor: theme, color: '#fff' } : {}) }}>
            {label}
          </button>
        ))}
      </div>

      <div style={styles.content}>
        {saveMsg && <div style={{ ...styles.flashMsg, borderColor: saveMsg.startsWith('Error') ? '#f44' : '#4caf50', color: saveMsg.startsWith('Error') ? '#f44' : '#4caf50' }}>{saveMsg}</div>}

        {/* ─── Configuration ─── */}
        {activeTab === 'config' && (
          <div style={styles.formWrap}>
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Display</div>
              <Field label="Game Title"><input value={form.game_title} onChange={e => set('game_title', e.target.value)} style={styles.input} /></Field>
              <Field label="Game Subtitle"><input value={form.game_subtitle} onChange={e => set('game_subtitle', e.target.value)} style={styles.input} /></Field>
              <Field label="Banner Image URL"><input value={form.banner_image_url} onChange={e => set('banner_image_url', e.target.value)} style={styles.input} placeholder="https://…" /></Field>
              <Field label="Theme Color">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="color" value={form.theme_color} onChange={e => set('theme_color', e.target.value)} style={{ width: 48, height: 36, border: 'none', background: 'none', cursor: 'pointer' }} />
                  <input value={form.theme_color} onChange={e => set('theme_color', e.target.value)} style={{ ...styles.input, width: 120, flex: 'none' }} />
                </div>
              </Field>
            </div>

            <div style={styles.section}>
              <div style={styles.sectionTitle}>Scoring & Tokens</div>
              <Field label="Score Divisor" hint="raw_score ÷ divisor = tokens awarded">
                <input type="number" step="0.1" value={form.score_divisor} onChange={e => set('score_divisor', e.target.value)} style={{ ...styles.input, width: 120 }} />
              </Field>
              <Field label="Score Operation">
                <select value={form.score_operation} onChange={e => set('score_operation', e.target.value)} style={styles.input}>
                  <option value="divide">Divide</option>
                  <option value="multiply">Multiply</option>
                </select>
              </Field>
              <Field label="Rounding">
                <select value={form.score_rounding} onChange={e => set('score_rounding', e.target.value)} style={styles.input}>
                  <option value="floor">Floor (round down)</option>
                  <option value="ceil">Ceiling (round up)</option>
                  <option value="round">Round (nearest)</option>
                </select>
              </Field>
              <Field label="Min Tokens / Day" hint="0 = no minimum">
                <input type="number" value={form.min_tokens_per_day} onChange={e => set('min_tokens_per_day', e.target.value)} style={{ ...styles.input, width: 120 }} />
              </Field>
              <Field label="Max Tokens / Day" hint="0 = no cap">
                <input type="number" value={form.max_tokens_per_day} onChange={e => set('max_tokens_per_day', e.target.value)} style={{ ...styles.input, width: 120 }} />
              </Field>
            </div>

            <div style={styles.section}>
              <div style={styles.sectionTitle}>Economy</div>
              <Field label="CPC per Token" hint="CPC wagered per spin (affects display only — RTP math is fixed)">
                <input type="number" value={form.cpc_per_token} onChange={e => set('cpc_per_token', e.target.value)} style={{ ...styles.input, width: 120 }} />
              </Field>
            </div>

            <div style={styles.section}>
              <div style={styles.sectionTitle}>Integrations</div>
              <Field label="Discord Webhook URL" hint="Post-commit summary sent here. Leave blank to disable.">
                <input value={form.discord_webhook_url} onChange={e => set('discord_webhook_url', e.target.value)} style={styles.input} placeholder="https://discord.com/api/webhooks/…" />
              </Field>
            </div>

            <button onClick={saveConfig} disabled={saving} style={{ ...styles.saveBtn, background: theme }}>
              {saving ? 'Saving…' : 'Save Configuration'}
            </button>
          </div>
        )}

        {/* ─── Symbol Images ─── */}
        {activeTab === 'symbols' && (
          <div style={styles.formWrap}>
            <p style={{ opacity: 0.6, fontSize: 13, marginBottom: 20 }}>
              Provide direct image URLs for each symbol. Leave blank to use the default emoji. Custom images should be square (recommended: 64×64px or larger, hosted externally).
            </p>
            <div style={styles.symbolGrid}>
              {ALL_SYMBOLS.map(sym => (
                <div key={sym} style={styles.symbolCard}>
                  <div style={styles.symbolPreview}>
                    {symbolImages[sym]
                      ? <img src={symbolImages[sym]} style={{ width: 48, height: 48, objectFit: 'contain' }} alt={sym} />
                      : <span style={{ fontSize: 36 }}>{DEFAULT_EMOJIS[sym]}</span>
                    }
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{SYMBOL_LABELS[sym]}</div>
                  <input
                    placeholder="Image URL (optional)"
                    value={symbolImages[sym] || ''}
                    onChange={e => setSymbolImages(s => ({ ...s, [sym]: e.target.value || undefined }))}
                    style={{ ...styles.input, fontSize: 11 }}
                  />
                  {symbolImages[sym] && (
                    <button onClick={() => setSymbolImages(s => { const n = {...s}; delete n[sym]; return n; })}
                      style={{ marginTop: 4, fontSize: 11, color: '#888', background: 'none', border: 'none', cursor: 'pointer' }}>
                      × Clear
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button onClick={saveSymbols} disabled={saving} style={{ ...styles.saveBtn, background: theme }}>
              {saving ? 'Saving…' : 'Save Symbol Images'}
            </button>
          </div>
        )}

        {/* ─── Categories ─── */}
        {activeTab === 'categories' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
              <p style={{ fontSize: 13, opacity: 0.6, margin: 0 }}>Encounter types and their point values. Upserts by label.</p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <CsvImporter
                  label="slots_categories"
                  themeColor={theme}
                  sampleHeaders={['label', 'point_value', 'sort_order']}
                  sampleRow={{ label: 'Shiny Legend', point_value: 100, sort_order: 0 }}
                  onImport={importCategories}
                />
                <button onClick={exportCategories}
                  style={{ background: 'none', border: '1px solid #333', color: '#666', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
                  ↓ Export CSV
                </button>
              </div>
            </div>
            {categories.length === 0 && <div style={{ color: '#666', fontSize: 13, padding: '20px 0' }}>No categories yet. Import a CSV or add them via the Event Admin page.</div>}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              {categories.length > 0 && (
                <thead>
                  <tr style={{ borderBottom: '1px solid #222' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Label</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: '#666', fontWeight: 600 }}>Points</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: '#666', fontWeight: 600 }}>Order</th>
                  </tr>
                </thead>
              )}
              <tbody>
                {categories.map(c => (
                  <tr key={c.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                    <td style={{ padding: '8px 12px', color: '#ddd' }}>{c.label}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#ffd700' }}>{c.point_value}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#666' }}>{c.sort_order}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ─── Players ─── */}
        {activeTab === 'players' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
              <p style={{ fontSize: 13, opacity: 0.6, margin: 0 }}>{players.length} players. Upserts by player_name.</p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <CsvImporter
                  label="slots_players"
                  themeColor={theme}
                  sampleHeaders={['player_name', 'avatar_url', 'color']}
                  sampleRow={{ player_name: 'Ash', avatar_url: 'https://example.com/ash.png', color: '#ef4444' }}
                  onImport={importPlayers}
                />
                <button onClick={exportPlayers}
                  style={{ background: 'none', border: '1px solid #333', color: '#666', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
                  ↓ Export CSV
                </button>
              </div>
            </div>
            {players.length === 0 && <div style={{ color: '#666', fontSize: 13, padding: '20px 0' }}>No players yet. Import a CSV to bulk-add them.</div>}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              {players.length > 0 && (
                <thead>
                  <tr style={{ borderBottom: '1px solid #222' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Player</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Color</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Avatar</th>
                  </tr>
                </thead>
              )}
              <tbody>
                {players.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                    <td style={{ padding: '8px 12px', color: '#ddd', display: 'flex', alignItems: 'center', gap: 10 }}>
                      {p.avatar_url
                        ? <img src={p.avatar_url} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
                        : <div style={{ width: 28, height: 28, borderRadius: '50%', background: p.color || '#555', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#fff' }}>{p.name?.charAt(0)}</div>
                      }
                      {p.name}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ display: 'inline-block', width: 16, height: 16, borderRadius: '50%', background: p.color || '#555', verticalAlign: 'middle', marginRight: 6 }} />
                      <span style={{ color: '#666', fontSize: 12 }}>{p.color || '—'}</span>
                    </td>
                    <td style={{ padding: '8px 12px', color: '#555', fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.avatar_url || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ─── Store Items ─── */}
        {activeTab === 'store' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
              <p style={{ fontSize: 13, opacity: 0.6, margin: 0 }}>Store items players can redeem tokens for. Upserts by label.</p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <CsvImporter
                  label="slots_store_items"
                  themeColor={theme}
                  sampleHeaders={['label', 'cost_cpc', 'quantity', 'pays_out_slot_tokens', 'sort_order']}
                  sampleRow={{ label: 'Masterball', cost_cpc: 500, quantity: 1, pays_out_slot_tokens: 'false', sort_order: 0 }}
                  onImport={importStoreItems}
                />
                <button onClick={exportStoreItems}
                  style={{ background: 'none', border: '1px solid #333', color: '#666', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
                  ↓ Export CSV
                </button>
              </div>
            </div>
            {storeItems.length === 0 && <div style={{ color: '#666', fontSize: 13, padding: '20px 0' }}>No store items yet. Import a CSV to bulk-add them.</div>}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              {storeItems.length > 0 && (
                <thead>
                  <tr style={{ borderBottom: '1px solid #222' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Item</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: '#666', fontWeight: 600 }}>Cost (CPC)</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: '#666', fontWeight: 600 }}>Qty</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', color: '#666', fontWeight: 600 }}>Pays Tokens</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: '#666', fontWeight: 600 }}>Order</th>
                  </tr>
                </thead>
              )}
              <tbody>
                {storeItems.map(s => (
                  <tr key={s.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                    <td style={{ padding: '8px 12px', color: '#ddd' }}>{s.label}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#ffd700' }}>{s.cost_cpc}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#ddd' }}>{s.quantity}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                      <span style={{ color: s.pays_out_slot_tokens ? '#4ade80' : '#666' }}>{s.pays_out_slot_tokens ? 'Yes' : 'No'}</span>
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#666' }}>{s.sort_order}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 12, color: '#888', marginBottom: 6, fontWeight: 600 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, opacity: 0.4, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: '#0a0a0f', color: '#e0e0e0', fontFamily: "'Segoe UI', sans-serif" },
  center: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh', color: '#888' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 24px', borderBottom: '2px solid', background: '#111' },
  title: { fontSize: 18, fontWeight: 800 },
  linkBtn: { padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, color: '#e0e0e0', background: '#222', border: '1px solid #333', cursor: 'pointer', textDecoration: 'none' },
  tabBar: { display: 'flex', background: '#111', borderBottom: '1px solid #222', padding: '0 12px', gap: 4, flexWrap: 'wrap' },
  tab: { background: 'none', border: 'none', borderBottom: '2px solid transparent', color: '#666', padding: '10px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 500 },
  content: { maxWidth: 900, margin: '0 auto', padding: 28 },
  flashMsg: { padding: '10px 16px', borderRadius: 8, border: '1px solid', marginBottom: 20, fontSize: 13, fontWeight: 600 },
  formWrap: {},
  section: { background: '#111', border: '1px solid #1a1a1a', borderRadius: 10, padding: '18px 20px', marginBottom: 16 },
  sectionTitle: { fontWeight: 700, fontSize: 14, marginBottom: 16, color: '#ccc' },
  input: { background: '#0d0d14', border: '1px solid #2a2a3a', borderRadius: 6, color: '#e0e0e0', padding: '8px 12px', fontSize: 13, width: '100%', boxSizing: 'border-box' },
  saveBtn: { padding: '10px 28px', borderRadius: 8, fontSize: 14, fontWeight: 700, color: '#fff', border: 'none', cursor: 'pointer', marginTop: 8 },
  symbolGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginBottom: 20 },
  symbolCard: { background: '#111', border: '1px solid #222', borderRadius: 10, padding: 14 },
  symbolPreview: { width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8, background: '#0a0a0f', borderRadius: 8 },
};
