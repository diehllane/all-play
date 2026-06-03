import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

const ALL_SYMBOLS = ['masterball','pokeball','greatball','ultraball','pikachu','eevee','rare_candy','potion','berry'];
const SYMBOL_LABELS = { masterball:'Masterball', pokeball:'Pokeball', greatball:'Greatball', ultraball:'Ultraball', pikachu:'Pikachu', eevee:'Eevee', rare_candy:'Rare Candy', potion:'Potion', berry:'Berry' };
const DEFAULT_EMOJIS = { masterball:'🟣', pokeball:'🔴', greatball:'🔵', ultraball:'🟡', pikachu:'⚡', eevee:'🦊', rare_candy:'🍬', potion:'🧪', berry:'🫐' };

export default function SlotsEditPage() {
  const { eventId } = useParams();
  const { profile } = useAuth();

  const [event, setEvent] = useState(null);
  const [config, setConfig] = useState(null);
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
      const [evRes, cfgRes] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).single(),
        supabase.from('slots_config').select('*').eq('event_id', eventId).single(),
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

  const saveConfig = async () => {
    setSaving(true);
    setSaveMsg('');
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
    setSaveMsg(e ? 'Error: ' + e.message : '✅ Saved!');
    setSaving(false);
    if (!e) loadAll();
    setTimeout(() => setSaveMsg(''), 4000);
  };

  const saveSymbols = async () => {
    setSaving(true);
    const { error: e } = await supabase.from('slots_config').update({ symbol_images: symbolImages }).eq('event_id', eventId);
    setSaveMsg(e ? 'Error: ' + e.message : '✅ Symbol images saved!');
    setSaving(false);
    if (!e) loadAll();
    setTimeout(() => setSaveMsg(''), 4000);
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
        {[['config','⚙️ Configuration'],['symbols','🖼️ Symbol Images'],['store','🛒 Store']].map(([id,label]) => (
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

        {/* ─── Store (redirect note) ─── */}
        {activeTab === 'store' && (
          <div style={{ textAlign: 'center', padding: '48px 0', opacity: 0.6 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🛒</div>
            <div>Store items are managed in the Event Admin page.</div>
            <Link to={`/admin/slots/${eventId}`} style={{ color: theme, marginTop: 12, display: 'inline-block' }}>
              → Go to Event Admin → Store
            </Link>
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
  tabBar: { display: 'flex', background: '#111', borderBottom: '1px solid #222', padding: '0 12px', gap: 4 },
  tab: { background: 'none', border: 'none', borderBottom: '2px solid transparent', color: '#666', padding: '10px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 500 },
  content: { maxWidth: 800, margin: '0 auto', padding: 28 },
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
