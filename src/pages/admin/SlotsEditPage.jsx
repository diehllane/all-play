import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useEventPermissions } from '../../contexts/AuthContext';
import { getEventWebhooks, setEventWebhook } from '../../lib/webhooks';
import ScratchOffEditor from '../../components/ScratchOffEditor';

const ALL_SYMBOLS = ['masterball','pokeball','greatball','ultraball','pikachu','eevee','rare_candy','potion','berry'];
const SYMBOL_LABELS = { masterball:'Masterball', pokeball:'Pokeball', greatball:'Greatball', ultraball:'Ultraball', pikachu:'Pikachu', eevee:'Eevee', rare_candy:'Rare Candy', potion:'Potion', berry:'Berry' };
const SYMBOL_IMAGES = {
  masterball: '/all-play/images/slots/masterball.png',
  pokeball:   '/all-play/images/slots/pokeball.png',
  greatball:  '/all-play/images/slots/greatball.png',
  ultraball:  '/all-play/images/slots/ultraball.png',
  pikachu:    '/all-play/images/slots/pikachu.png',
  eevee:      '/all-play/images/slots/eevee.png',
  rare_candy: '/all-play/images/slots/rarecandy.png',
  potion:     '/all-play/images/slots/potion.png',
  berry:      '/all-play/images/slots/berry.png',
};

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
  

  const [event, setEvent] = useState(null);
  const [config, setConfig] = useState(null);
  const [categories, setCategories] = useState([]);
  const [storeItems, setStoreItems] = useState([]);
  const [players, setPlayers] = useState([]);
  const [allProfiles, setAllProfiles] = useState([]);
  const [profilesError, setProfilesError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('config');

  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const [newCatLabel, setNewCatLabel] = useState('');
  const [newCatPts, setNewCatPts] = useState('1');
  const [newItemLabel, setNewItemLabel] = useState('');
  const [newItemCost, setNewItemCost] = useState('');
  const [newItemQty, setNewItemQty] = useState('');
  const [newItemMaxPerPlayer, setNewItemMaxPerPlayer] = useState('');
  const [newItemTokens, setNewItemTokens] = useState('');
  const [newItemShowOnBoard, setNewItemShowOnBoard] = useState(true);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [newPlayerColor, setNewPlayerColor] = useState('#c62828');

  const [editingItemId, setEditingItemId] = useState(null);
  const [editDraft, setEditDraft] = useState({});

  const { canManage } = useEventPermissions();

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
        symbol_images: Object.fromEntries(ALL_SYMBOLS.map(sym => [sym, cfg.symbol_images?.[sym] || ''])),
        discord_webhook_url: (await getEventWebhooks(eventId)).overall,
      });
      setCategories(catRes.data || []);
      setStoreItems(storeRes.data || []);
      setPlayers(playersRes.data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  const loadProfiles = useCallback(async () => {
    const { data, error: profErr } = await supabase
      .from('profiles').select('id, email, role').neq('role', 'revoked').order('email');
    if (profErr) {
      setProfilesError(`Cannot load accounts: ${profErr.message}`);
    } else {
      setAllProfiles((data || []).map(p => ({ ...p, username: p.email?.split('@')[0] || p.id })));
      setProfilesError(null);
    }
  }, []);

  useEffect(() => { loadAll(); loadProfiles(); }, [loadAll, loadProfiles]);

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
      symbol_images: Object.fromEntries(ALL_SYMBOLS.map(sym => [sym, form.symbol_images?.[sym]?.trim() || null])),
    }).eq('event_id', eventId);
    let whErr = null;
    if (!e) {
      try { await setEventWebhook(eventId, 'overall', null, form.discord_webhook_url); }
      catch (err) { whErr = err; }
    }
    flash(e ? 'Error: ' + e.message : whErr ? 'Saved, but webhook: ' + whErr.message : '✅ Saved!');
    setSaving(false);
    if (!e) loadAll();
  };

  const addCategory = async () => {
    const label = newCatLabel.trim();
    if (!label) return;
    const { error: e } = await supabase.from('slots_categories').insert({
      event_id: eventId, label, point_value: parseFloat(newCatPts) || 1,
      sort_order: categories.length, is_active: true,
    });
    if (e) { flash('Error: ' + e.message); return; }
    setNewCatLabel(''); setNewCatPts('1');
    await loadAll();
  };

  const removeCategory = async (id) => {
    if (!confirm('Remove this category?')) return;
    await supabase.from('slots_categories').delete().eq('id', id);
    await loadAll();
  };

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
        await supabase.from('slots_categories').insert({ event_id: eventId, label, point_value: pts, sort_order: sortOrder, is_active: true });
      }
      imported++;
    }
    await loadAll();
    if (errors.length) return { error: true, text: `${imported} imported, ${errors.length} errors: ${errors[0]}` };
    return { text: `${imported} categories imported.` };
  };

  const exportCategories = () => {
    downloadCSV(`slots_categories_${eventId}.csv`, ['label', 'point_value', 'sort_order'],
      categories.map((c, i) => ({ label: c.label, point_value: c.point_value, sort_order: c.sort_order ?? i })));
  };

  const addPlayer = async () => {
    if (!selectedProfileId) return;
    const prof = allProfiles.find(p => p.id === selectedProfileId);
    if (!prof) return;
    const displayName = prof.username || prof.email?.split('@')[0] || 'Unknown';
    const { error: e } = await supabase.from('slots_players').insert({
      event_id: eventId, display_name: displayName, profile_id: prof.id,
      color: newPlayerColor || null, avatar_url: null, sort_order: players.length,
      slot_tokens: 0, casino_prize_coins: 0, total_tokens_spent: 0,
      total_cpc_won: 0, total_spins: 0, jackpots_hit: 0,
    });
    if (e) { flash('Error: ' + e.message); return; }
    setSelectedProfileId(''); setNewPlayerColor('#c62828');
    await loadAll();
  };

  const removePlayer = async (id, name) => {
    if (!confirm(`Remove ${name} from this event? Their token balance and spin history will be deleted.`)) return;
    await supabase.from('slots_players').delete().eq('id', id);
    await loadAll();
  };

  const importPlayers = async (rows) => {
    let imported = 0, errors = [];
    for (const row of rows) {
      const name = row['player_name']?.trim();
      if (!name) { errors.push('Row missing player_name'); continue; }
      const existing = players.find(p => p.display_name?.toLowerCase() === name.toLowerCase());
      if (existing) {
        await supabase.from('slots_players').update({
          avatar_url: row['avatar_url']?.trim() || existing.avatar_url,
          color: row['color']?.trim() || existing.color,
        }).eq('id', existing.id);
      } else {
        await supabase.from('slots_players').insert({
          event_id: eventId, display_name: name,
          avatar_url: row['avatar_url']?.trim() || null,
          color: row['color']?.trim() || null,
          sort_order: players.length + imported,
          slot_tokens: 0, casino_prize_coins: 0,
          total_tokens_spent: 0, total_cpc_won: 0, total_spins: 0, jackpots_hit: 0,
        });
      }
      imported++;
    }
    await loadAll();
    if (errors.length) return { error: true, text: `${imported} imported, ${errors.length} errors: ${errors[0]}` };
    return { text: `${imported} players imported.` };
  };

  const exportPlayers = () => {
    downloadCSV(`slots_players_${eventId}.csv`, ['player_name', 'avatar_url', 'color'],
      players.map(p => ({ player_name: p.display_name, avatar_url: p.avatar_url ?? '', color: p.color ?? '' })));
  };

  const addStoreItem = async () => {
    const label = newItemLabel.trim();
    if (!label || !newItemCost) return;
    const insertPayload = {
      event_id: eventId,
      label,
      cost_cpc: parseInt(newItemCost) || 0,
      quantity: newItemQty ? parseInt(newItemQty) : null,
      quantity_remaining: newItemQty ? parseInt(newItemQty) : null,
      max_per_player: newItemMaxPerPlayer ? parseInt(newItemMaxPerPlayer) : null,
      pays_out_slot_tokens: newItemTokens ? parseInt(newItemTokens) : null,
      show_on_prize_board: newItemShowOnBoard,
      is_active: true,
    };
    try {
      const { error: e } = await supabase.from('slots_store_items').insert({ ...insertPayload, sort_order: storeItems.length });
      if (e) {
        if (e.message?.includes('sort_order')) {
          const { error: e2 } = await supabase.from('slots_store_items').insert(insertPayload);
          if (e2) { flash('Error: ' + e2.message); return; }
        } else { flash('Error: ' + e.message); return; }
      }
    } catch (err) { flash('Error: ' + err.message); return; }
    setNewItemLabel(''); setNewItemCost(''); setNewItemQty(''); setNewItemMaxPerPlayer(''); setNewItemTokens(''); setNewItemShowOnBoard(true);
    await loadAll();
  };

  const removeStoreItem = async (id, label) => {
    if (!confirm(`Remove "${label}" from the store?`)) return;
    await supabase.from('slots_store_items').delete().eq('id', id);
    await loadAll();
  };

  const startEditItem = (item) => {
    setEditingItemId(item.id);
    setEditDraft({
      label: item.label,
      cost_cpc: String(item.cost_cpc ?? 0),
      quantity: item.quantity === null ? '' : String(item.quantity),
      max_per_player: item.max_per_player === null ? '' : String(item.max_per_player),
      pays_out_slot_tokens: item.pays_out_slot_tokens === null ? '' : String(item.pays_out_slot_tokens),
      show_on_prize_board: item.show_on_prize_board !== false,
    });
  };

  const cancelEditItem = () => { setEditingItemId(null); setEditDraft({}); };

  // Editing "Total Qty" must not clobber units already sold. We back into the
  // sold count from the item's current quantity/quantity_remaining and carry
  // it forward onto the new total, rather than just overwriting remaining.
  const saveEditItem = async (item) => {
    const label = editDraft.label?.trim();
    if (!label) { flash('Error: label cannot be blank'); return; }
    const newQty = editDraft.quantity === '' ? null : parseInt(editDraft.quantity) || 0;

    let newQuantityRemaining;
    if (newQty === null) {
      newQuantityRemaining = null;
    } else if (item.quantity === null) {
      newQuantityRemaining = newQty;
    } else {
      const sold = item.quantity - (item.quantity_remaining ?? item.quantity);
      newQuantityRemaining = Math.max(0, newQty - sold);
    }

    const { error: e } = await supabase.from('slots_store_items').update({
      label,
      cost_cpc: parseInt(editDraft.cost_cpc) || 0,
      quantity: newQty,
      quantity_remaining: newQuantityRemaining,
      max_per_player: editDraft.max_per_player === '' ? null : parseInt(editDraft.max_per_player) || 0,
      pays_out_slot_tokens: editDraft.pays_out_slot_tokens === '' ? null : parseInt(editDraft.pays_out_slot_tokens) || 0,
      show_on_prize_board: editDraft.show_on_prize_board,
    }).eq('id', item.id);
    if (e) { flash('Error: ' + e.message); return; }
    cancelEditItem();
    await loadAll();
  };

  const importStoreItems = async (rows) => {
    let imported = 0, errors = [];
    for (const row of rows) {
      const label = row['label']?.trim();
      if (!label) { errors.push('Row missing label'); continue; }
      const cost = parseInt(row['cost_cpc']) || 0;
      const qty = row['quantity'] ? parseInt(row['quantity']) : null;
      const maxPP = row['max_per_player'] ? parseInt(row['max_per_player']) : null;
      const paysOut = row['pays_out_slot_tokens'] ? parseInt(row['pays_out_slot_tokens']) : null;
      const showOnBoard = row['show_on_prize_board'] === undefined || row['show_on_prize_board'] === ''
        ? true
        : ['true', '1', 'yes'].includes(String(row['show_on_prize_board']).trim().toLowerCase());
      const existing = storeItems.find(s => s.label?.toLowerCase() === label.toLowerCase());
      if (existing) {
        await supabase.from('slots_store_items').update({ cost_cpc: cost, quantity: qty, max_per_player: maxPP, pays_out_slot_tokens: paysOut, show_on_prize_board: showOnBoard }).eq('id', existing.id);
      } else {
        await supabase.from('slots_store_items').insert({ event_id: eventId, label, cost_cpc: cost, quantity: qty, quantity_remaining: qty, max_per_player: maxPP, pays_out_slot_tokens: paysOut, show_on_prize_board: showOnBoard, is_active: true });
      }
      imported++;
    }
    await loadAll();
    if (errors.length) return { error: true, text: `${imported} imported, ${errors.length} errors: ${errors[0]}` };
    return { text: `${imported} store items imported.` };
  };

  const exportStoreItems = () => {
    downloadCSV(`slots_store_items_${eventId}.csv`,
      ['label', 'cost_cpc', 'quantity', 'max_per_player', 'pays_out_slot_tokens', 'show_on_prize_board', 'sort_order'],
      storeItems.map((s, i) => ({
        label: s.label, cost_cpc: s.cost_cpc, quantity: s.quantity ?? '',
        max_per_player: s.max_per_player ?? '',
        pays_out_slot_tokens: s.pays_out_slot_tokens ?? '',
        show_on_prize_board: s.show_on_prize_board !== false,
        sort_order: s.sort_order ?? i,
      })));
  };

  const enrolledProfileIds = new Set(players.map(p => p.profile_id).filter(Boolean));
  const availableProfiles = allProfiles.filter(prof => !enrolledProfileIds.has(prof.id));

  const TABS = [['config','⚙️ Configuration'],['categories','🎯 Categories'],['players','👥 Players'],['store','🛒 Store Items'],['scratch','🎫 Scratch-Offs']];

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
        {TABS.map(([id, label]) => (
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
              <Field label="Banner Image URL" hint="Replaces the text title in the header when set.">
                <input value={form.banner_image_url} onChange={e => set('banner_image_url', e.target.value)} style={styles.input} placeholder="https://…" />
              </Field>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#888', marginBottom: 4, fontWeight: 600 }}>Reel Symbols</label>
                <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 10 }}>Paste a direct image URL to replace a symbol for this event only. Leave blank to use the default image. Changes apply after Save.</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {ALL_SYMBOLS.map(sym => {
                    const custom = form.symbol_images?.[sym]?.trim() || '';
                    return (
                      <div key={sym} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <img src={custom || SYMBOL_IMAGES[sym]} alt={sym}
                          title={custom ? 'If this stays faded, the URL is not loading' : undefined}
                          onError={e => { e.currentTarget.style.opacity = 0.2; }}
                          onLoad={e => { e.currentTarget.style.opacity = 1; }}
                          style={{ width: 36, height: 36, objectFit: 'contain', flex: 'none' }} />
                        <div style={{ width: 84, fontSize: 12, color: custom ? '#fff' : '#888', flex: 'none' }}>
                          {SYMBOL_LABELS[sym]}
                          {custom && <div style={{ fontSize: 10, color: theme }}>custom</div>}
                        </div>
                        <input value={form.symbol_images?.[sym] || ''}
                          onChange={e => setForm(f => ({ ...f, symbol_images: { ...f.symbol_images, [sym]: e.target.value } }))}
                          style={styles.input} placeholder="Default image" />
                        {custom && (
                          <button type="button" title="Revert to default"
                            onClick={() => setForm(f => ({ ...f, symbol_images: { ...f.symbol_images, [sym]: '' } }))}
                            style={{ background: 'none', border: '1px solid #444', color: '#aaa', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', flex: 'none' }}>
                            Reset
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
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

        {/* ─── Categories ─── */}
        {activeTab === 'categories' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
              <span style={{ fontSize: 13, opacity: 0.6 }}>{categories.length} categories</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <CsvImporter label="slots_categories" themeColor={theme}
                  sampleHeaders={['label', 'point_value', 'sort_order']}
                  sampleRow={{ label: 'Shiny Legend', point_value: 100, sort_order: 0 }}
                  onImport={importCategories} />
                <button onClick={exportCategories}
                  style={{ background: 'none', border: '1px solid #333', color: '#666', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
                  ↓ Export CSV
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center', background: '#111', border: '1px solid #222', borderRadius: 8, padding: 12 }}>
              <input value={newCatLabel} onChange={e => setNewCatLabel(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCategory()}
                placeholder="Category label (e.g. Shiny Legend)"
                style={{ ...styles.input, flex: 2, minWidth: 160 }} />
              <input type="number" value={newCatPts} onChange={e => setNewCatPts(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCategory()}
                placeholder="Points" min="0" step="0.1"
                style={{ ...styles.input, width: 90 }} />
              <button onClick={addCategory} disabled={!newCatLabel.trim()}
                style={{ ...styles.saveBtn, padding: '8px 18px', marginTop: 0, opacity: newCatLabel.trim() ? 1 : 0.5, background: theme }}>
                + Add
              </button>
            </div>
            {categories.length === 0 && <div style={{ color: '#555', fontSize: 13, padding: '16px 0' }}>No categories yet.</div>}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              {categories.length > 0 && (
                <thead>
                  <tr style={{ borderBottom: '1px solid #222' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Label</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: '#666', fontWeight: 600 }}>Points</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: '#666', fontWeight: 600 }}>Order</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: '#666', fontWeight: 600 }}></th>
                  </tr>
                </thead>
              )}
              <tbody>
                {categories.map(c => (
                  <tr key={c.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                    <td style={{ padding: '8px 12px', color: '#ddd' }}>{c.label}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#ffd700' }}>{c.point_value}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#555' }}>{c.sort_order}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                      <button onClick={() => removeCategory(c.id)}
                        style={{ background: 'none', border: '1px solid #4a1010', color: '#ef5350', borderRadius: 5, padding: '3px 10px', fontSize: 12, cursor: 'pointer' }}>
                        Remove
                      </button>
                    </td>
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
              <span style={{ fontSize: 13, opacity: 0.6 }}>{players.length} players enrolled</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <CsvImporter label="slots_players" themeColor={theme}
                  sampleHeaders={['player_name', 'avatar_url', 'color']}
                  sampleRow={{ player_name: 'Ash', avatar_url: 'https://example.com/ash.png', color: '#ef4444' }}
                  onImport={importPlayers} />
                <button onClick={exportPlayers}
                  style={{ background: 'none', border: '1px solid #333', color: '#666', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
                  ↓ Export CSV
                </button>
              </div>
            </div>
            <div style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: 14, marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 10, fontWeight: 600 }}>ADD PLAYER FROM ACCOUNT</div>
              {profilesError ? (
                <div style={{ fontSize: 12, color: '#ef5350', padding: '8px 0' }}>
                  ⚠️ {profilesError}
                  <div style={{ color: '#666', marginTop: 4 }}>You can still use CSV import to add players by name.</div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <select value={selectedProfileId} onChange={e => setSelectedProfileId(e.target.value)}
                    style={{ ...styles.input, flex: 2, minWidth: 200 }}>
                    <option value="">Select account…</option>
                    {availableProfiles.map(p => (
                      <option key={p.id} value={p.id}>{p.username || p.email?.split('@')[0]} ({p.role})</option>
                    ))}
                  </select>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <label style={{ fontSize: 12, color: '#888' }}>Color</label>
                    <input type="color" value={newPlayerColor} onChange={e => setNewPlayerColor(e.target.value)}
                      style={{ width: 40, height: 34, border: 'none', background: 'none', cursor: 'pointer' }} />
                  </div>
                  <button onClick={addPlayer} disabled={!selectedProfileId}
                    style={{ ...styles.saveBtn, padding: '8px 18px', marginTop: 0, opacity: selectedProfileId ? 1 : 0.5, background: theme }}>
                    + Add Player
                  </button>
                </div>
              )}
              {!profilesError && availableProfiles.length === 0 && allProfiles.length > 0 && (
                <div style={{ fontSize: 12, color: '#555', marginTop: 8 }}>All accounts are already enrolled.</div>
              )}
            </div>
            {players.length === 0 && <div style={{ color: '#555', fontSize: 13, padding: '16px 0' }}>No players enrolled yet.</div>}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              {players.length > 0 && (
                <thead>
                  <tr style={{ borderBottom: '1px solid #222' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Player</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Color</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Tokens</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>CPC</th>
                    <th style={{ padding: '8px 12px' }}></th>
                  </tr>
                </thead>
              )}
              <tbody>
                {players.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                    <td style={{ padding: '8px 12px', color: '#ddd' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {p.avatar_url
                          ? <img src={p.avatar_url} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
                          : <div style={{ width: 28, height: 28, borderRadius: '50%', background: p.color || '#555', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#fff' }}>{p.display_name?.charAt(0)}</div>
                        }
                        {p.display_name}
                      </div>
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ display: 'inline-block', width: 16, height: 16, borderRadius: '50%', background: p.color || '#555', verticalAlign: 'middle', marginRight: 6 }} />
                      <span style={{ color: '#555', fontSize: 12 }}>{p.color || '—'}</span>
                    </td>
                    <td style={{ padding: '8px 12px', color: '#ffd700' }}>🎟️ {p.slot_tokens ?? 0}</td>
                    <td style={{ padding: '8px 12px', color: '#aaa' }}>🪙 {p.casino_prize_coins ?? 0}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                      <button onClick={() => removePlayer(p.id, p.display_name)}
                        style={{ background: 'none', border: '1px solid #4a1010', color: '#ef5350', borderRadius: 5, padding: '3px 10px', fontSize: 12, cursor: 'pointer' }}>
                        Remove
                      </button>
                    </td>
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
              <span style={{ fontSize: 13, opacity: 0.6 }}>{storeItems.length} items</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <CsvImporter label="slots_store_items" themeColor={theme}
                  sampleHeaders={['label', 'cost_cpc', 'quantity', 'max_per_player', 'pays_out_slot_tokens', 'show_on_prize_board', 'sort_order']}
                  sampleRow={{ label: 'Masterball', cost_cpc: 500, quantity: 1, max_per_player: '', pays_out_slot_tokens: '', show_on_prize_board: true, sort_order: 0 }}
                  onImport={importStoreItems} />
                <button onClick={exportStoreItems}
                  style={{ background: 'none', border: '1px solid #333', color: '#666', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
                  ↓ Export CSV
                </button>
              </div>
            </div>
            <div style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: 14, marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 10, fontWeight: 600 }}>ADD STORE ITEM</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                <input value={newItemLabel} onChange={e => setNewItemLabel(e.target.value)}
                  placeholder="Item label" style={{ ...styles.input, flex: 2, minWidth: 160 }} />
                <input type="number" value={newItemCost} onChange={e => setNewItemCost(e.target.value)}
                  placeholder="CPC cost" style={{ ...styles.input, width: 100 }} />
                <input type="number" value={newItemQty} onChange={e => setNewItemQty(e.target.value)}
                  placeholder="Total qty (∞ if blank)" style={{ ...styles.input, width: 150 }} />
                <input type="number" value={newItemMaxPerPlayer} onChange={e => setNewItemMaxPerPlayer(e.target.value)}
                  placeholder="Max per player (∞ if blank)" style={{ ...styles.input, width: 180 }} />
                <input type="number" value={newItemTokens} onChange={e => setNewItemTokens(e.target.value)}
                  placeholder="Pays tokens (opt)" style={{ ...styles.input, width: 140 }} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#aaa' }}>
                  <input type="checkbox" checked={newItemShowOnBoard} onChange={e => setNewItemShowOnBoard(e.target.checked)} />
                  Show on Prize Board
                </label>
                <button onClick={addStoreItem} disabled={!newItemLabel.trim() || !newItemCost}
                  style={{ ...styles.saveBtn, padding: '8px 18px', marginTop: 0, opacity: (newItemLabel.trim() && newItemCost) ? 1 : 0.5, background: theme }}>
                  + Add
                </button>
              </div>
              <div style={{ fontSize: 11, color: '#555' }}>
                Total qty = overall stock cap (blank = unlimited). Max per player = how many times one player can buy this item (blank = unlimited). Pays tokens = token bundle items that award Slot Tokens on purchase. Uncheck "Show on Prize Board" for pure token top-ups so they don't clutter the public fulfillment board.
              </div>
            </div>
            {storeItems.length === 0 && <div style={{ color: '#555', fontSize: 13, padding: '16px 0' }}>No store items yet.</div>}
            <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              {storeItems.length > 0 && (
                <thead>
                  <tr style={{ borderBottom: '1px solid #222' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#666', fontWeight: 600 }}>Item</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: '#666', fontWeight: 600 }}>Cost (CPC)</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: '#666', fontWeight: 600 }}>Total Qty</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: '#666', fontWeight: 600 }}>Max / Player</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', color: '#666', fontWeight: 600 }}>Pays Tokens</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: '#666', fontWeight: 600 }} title="CPC cost ÷ tokens paid out — how many CPC each token effectively costs on this item, vs. the configured CPC per Token rate">CPC:Token</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', color: '#666', fontWeight: 600 }}>On Board</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', color: '#666', fontWeight: 600 }}>Status</th>
                    <th style={{ padding: '8px 12px' }}></th>
                  </tr>
                </thead>
              )}
              <tbody>
                {storeItems.map(s => {
                  const isEditing = editingItemId === s.id;
                  const ratio = s.pays_out_slot_tokens ? (s.cost_cpc / s.pays_out_slot_tokens) : null;
                  const configRatio = Number(form.cpc_per_token) || 5;

                  if (isEditing) {
                    return (
                      <tr key={s.id} style={{ borderBottom: '1px solid #1a1a1a', background: '#0d0d14' }}>
                        <td style={{ padding: '6px 12px' }}>
                          <input value={editDraft.label} onChange={e => setEditDraft(d => ({ ...d, label: e.target.value }))}
                            style={{ ...styles.input, width: 140 }} />
                        </td>
                        <td style={{ padding: '6px 12px' }}>
                          <input type="number" value={editDraft.cost_cpc} onChange={e => setEditDraft(d => ({ ...d, cost_cpc: e.target.value }))}
                            style={{ ...styles.input, width: 90, textAlign: 'right' }} />
                        </td>
                        <td style={{ padding: '6px 12px' }}>
                          <input type="number" value={editDraft.quantity} placeholder="∞" onChange={e => setEditDraft(d => ({ ...d, quantity: e.target.value }))}
                            style={{ ...styles.input, width: 90, textAlign: 'right' }} />
                        </td>
                        <td style={{ padding: '6px 12px' }}>
                          <input type="number" value={editDraft.max_per_player} placeholder="∞" onChange={e => setEditDraft(d => ({ ...d, max_per_player: e.target.value }))}
                            style={{ ...styles.input, width: 90, textAlign: 'right' }} />
                        </td>
                        <td style={{ padding: '6px 12px' }}>
                          <input type="number" value={editDraft.pays_out_slot_tokens} placeholder="—" onChange={e => setEditDraft(d => ({ ...d, pays_out_slot_tokens: e.target.value }))}
                            style={{ ...styles.input, width: 90, textAlign: 'right' }} />
                        </td>
                        <td style={{ padding: '6px 12px', textAlign: 'right', color: '#555', fontSize: 11 }}>—</td>
                        <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                          <input type="checkbox" checked={editDraft.show_on_prize_board} onChange={e => setEditDraft(d => ({ ...d, show_on_prize_board: e.target.checked }))} />
                        </td>
                        <td style={{ padding: '6px 12px', textAlign: 'center', color: '#555', fontSize: 11 }}>{s.is_active ? 'Active' : 'Inactive'}</td>
                        <td style={{ padding: '6px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button onClick={() => saveEditItem(s)}
                            style={{ background: theme, border: 'none', color: '#fff', borderRadius: 5, padding: '3px 10px', fontSize: 12, cursor: 'pointer', marginRight: 6 }}>
                            Save
                          </button>
                          <button onClick={cancelEditItem}
                            style={{ background: 'none', border: '1px solid #444', color: '#aaa', borderRadius: 5, padding: '3px 10px', fontSize: 12, cursor: 'pointer' }}>
                            Cancel
                          </button>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={s.id} style={{ borderBottom: '1px solid #1a1a1a', opacity: s.is_active ? 1 : 0.45 }}>
                      <td style={{ padding: '8px 12px', color: '#ddd' }}>{s.label}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', color: '#ffd700' }}>{s.cost_cpc}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', color: '#ddd' }}>{s.quantity ?? '∞'}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', color: s.max_per_player ? '#90CAF9' : '#555' }}>
                        {s.max_per_player ?? '∞'}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        <span style={{ color: s.pays_out_slot_tokens ? '#4ade80' : '#555' }}>
                          {s.pays_out_slot_tokens ? `🎟️ ${s.pays_out_slot_tokens}` : '—'}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                        {ratio !== null ? (
                          <span style={{ color: Math.abs(ratio - configRatio) > 0.5 ? '#f0a020' : '#888', fontSize: 12 }}
                            title={`Configured CPC per Token: ${configRatio}`}>
                            {ratio.toFixed(1)}
                          </span>
                        ) : <span style={{ color: '#444' }}>—</span>}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        <span style={{ fontSize: 14 }} title={s.show_on_prize_board !== false ? 'Shown on Prize Board' : 'Hidden from Prize Board'}>
                          {s.show_on_prize_board !== false ? '👁️' : '🚫'}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        <span style={{ fontSize: 11, color: s.is_active ? '#4ade80' : '#555' }}>{s.is_active ? 'Active' : 'Inactive'}</span>
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button onClick={() => startEditItem(s)}
                          style={{ background: 'none', border: '1px solid #333', color: '#90CAF9', borderRadius: 5, padding: '3px 10px', fontSize: 12, cursor: 'pointer', marginRight: 6 }}>
                          Edit
                        </button>
                        <button onClick={() => removeStoreItem(s.id, s.label)}
                          style={{ background: 'none', border: '1px solid #4a1010', color: '#ef5350', borderRadius: 5, padding: '3px 10px', fontSize: 12, cursor: 'pointer' }}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {/* ─── Scratch-Offs ─── */}
        {activeTab === 'scratch' && (
          <ScratchOffEditor eventId={eventId} theme={theme} storeItems={storeItems} />
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
};
