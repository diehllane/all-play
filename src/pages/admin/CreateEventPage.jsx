// src/pages/admin/CreateEventPage.jsx
// Step 0: pick event type (board_game | all_play | high_score | bingo[coming soon])
// Then branches to type-specific wizard.

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { upsertHSConfig } from '../../lib/highscore';

const ACC = '#c62828';

// ── Type Picker ───────────────────────────────────────────────

const EVENT_TYPES = [
  {
    id: 'board_game',
    icon: '🎲',
    label: 'Board Game',
    description: '252-square snake board. Daily scores move players. Gym badges, prize squares, jump squares.',
    comingSoon: false,
  },
  {
    id: 'all_play',
    icon: '⚔️',
    label: 'All-Play Tournament',
    description: 'Round-robin schedule with head-to-head matchups, League Average, and playoff brackets.',
    comingSoon: false,
  },
  {
    id: 'high_score',
    icon: '🏆',
    label: 'High Score',
    description: 'Solo or team competition. Cumulative daily scores build toward a final leaderboard.',
    comingSoon: false,
  },
  {
    id: 'bingo',
    icon: '🎯',
    label: 'Bingo',
    description: 'Team and solo bingo boards with custom encounter categories for each square.',
    comingSoon: true,
  },
];

export default function CreateEventPage() {
  const [step, setStep] = useState(0);
  const [eventType, setEventType] = useState('');
  const navigate = useNavigate();

  if (step === 0) {
    return <TypePicker onSelect={type => { setEventType(type); setStep(1); }} />;
  }

  if (eventType === 'board_game') return <BoardGameWizard />;
  if (eventType === 'all_play') return <AllPlayWizard />;
  if (eventType === 'high_score') return <HighScoreWizard />;
  return null;
}

// ── Type Picker Component ─────────────────────────────────────

function TypePicker({ onSelect }) {
  return (
    <div style={s.page}>
      <Link to="/admin" style={s.back}>← Dashboard</Link>
      <h1 style={s.title}>Create New Event</h1>
      <p style={s.subtitle}>Choose an event type to get started.</p>
      <div style={s.typeGrid}>
        {EVENT_TYPES.map(t => (
          <button
            key={t.id}
            onClick={() => !t.comingSoon && onSelect(t.id)}
            style={{
              ...s.typeCard,
              ...(t.comingSoon ? s.typeCardDisabled : {}),
            }}
            disabled={t.comingSoon}
          >
            <div style={s.typeIcon}>{t.icon}</div>
            <div style={s.typeLabel}>{t.label}</div>
            {t.comingSoon && <div style={s.comingSoon}>Coming Soon</div>}
            <div style={s.typeDesc}>{t.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── High Score Wizard ─────────────────────────────────────────

function HighScoreWizard() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [wizStep, setWizStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  // Step 1: Basic info + mode
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [mode, setMode] = useState('solo'); // 'solo' | 'team'
  const [overallWebhook, setOverallWebhook] = useState('');

  // Step 2: Config
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [scoreDivisor, setScoreDivisor] = useState(1);
  const [scoreOperation, setScoreOperation] = useState('divide');
  const [scoreRounding, setScoreRounding] = useState('round');
  const [allowHandicap, setAllowHandicap] = useState(false);
  const [themeColor, setThemeColor] = useState('#c62828');
  const [titleImageUrl, setTitleImageUrl] = useState('');

  // Step 3: Categories
  const [categories, setCategories] = useState([{ name: '', multiplier: 1 }]);

  function addCategory() { setCategories(c => [...c, { name: '', multiplier: 1 }]); }
  function removeCategory(i) { setCategories(c => c.filter((_, idx) => idx !== i)); }
  function updateCategory(i, field, val) {
    setCategories(c => c.map((cat, idx) => idx === i ? { ...cat, [field]: val } : cat));
  }

  async function handleCreate() {
    if (!name.trim()) { setMsg('Event name is required.'); return; }
    if (!slug.trim()) { setMsg('URL slug is required.'); return; }
    if (categories.some(c => !c.name.trim())) { setMsg('All categories need a name.'); return; }

    setSaving(true);
    setMsg('');
    try {
      // Create event
      const { data: ev, error: evErr } = await supabase
        .from('events')
        .insert({
          name,
          slug,
          event_type: 'high_score',
          status: 'active',
          division_count: 1,
          start_date: startDate || null,
          end_date: endDate || null,
          discord_overall_webhook: overallWebhook || null,
          created_by: profile?.id,
        })
        .select()
        .single();
      if (evErr) throw evErr;

      // Create hs_config
      await upsertHSConfig(ev.id, {
        mode,
        theme_color: themeColor,
        title_image_url: titleImageUrl || null,
        start_date: startDate || null,
        end_date: endDate || null,
        score_divisor: Number(scoreDivisor),
        score_operation: scoreOperation,
        score_rounding: scoreRounding,
        allow_handicap: allowHandicap,
      });

      // Create categories
      if (categories.length > 0) {
        await supabase.from('categories').insert(
          categories.filter(c => c.name.trim()).map(c => ({
            event_id: ev.id,
            name: c.name.trim(),
            multiplier: Number(c.multiplier),
          }))
        );
      }

      navigate(`/admin/highscore/${ev.id}`);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={s.page}>
      <Link to="/admin" style={s.back}>← Dashboard</Link>
      <h1 style={s.title}>🏆 New High Score Event</h1>

      {/* Step indicators */}
      <div style={s.stepRow}>
        {['Basics', 'Config', 'Categories'].map((label, i) => (
          <div key={i} style={{ ...s.step, ...(wizStep === i + 1 ? s.stepActive : {}) }}>
            <span style={s.stepNum}>{i + 1}</span> {label}
          </div>
        ))}
      </div>

      {msg && <div style={s.msg}>{msg}</div>}

      {/* Step 1: Basics */}
      {wizStep === 1 && (
        <div style={s.card}>
          <h2 style={s.cardTitle}>Event Basics</h2>

          <label style={s.label}>Event Name</label>
          <input value={name} onChange={e => setName(e.target.value)} style={s.input} placeholder="Summer High Score Challenge" />

          <label style={s.label}>URL Slug</label>
          <input value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} style={s.input} placeholder="summer-high-score-2026" />
          <div style={s.hint}>Used in the public URL. Letters, numbers, and hyphens only.</div>

          <label style={s.label}>Mode</label>
          <div style={s.radioRow}>
            {[['solo', '👤 Solo — individual players only'], ['team', '👥 Team — players grouped into teams']].map(([val, lbl]) => (
              <label key={val} style={s.radioLabel}>
                <input type="radio" value={val} checked={mode === val} onChange={() => setMode(val)} />
                {lbl}
              </label>
            ))}
          </div>

          <label style={s.label}>Overall Discord Webhook (optional)</label>
          <input value={overallWebhook} onChange={e => setOverallWebhook(e.target.value)} style={s.input} placeholder="https://discord.com/api/webhooks/..." />
          <div style={s.hint}>Posts full standings to this channel on every day commit.</div>

          <div style={s.navRow}>
            <button onClick={() => setWizStep(2)} style={s.nextBtn}>Next →</button>
          </div>
        </div>
      )}

      {/* Step 2: Config */}
      {wizStep === 2 && (
        <div style={s.card}>
          <h2 style={s.cardTitle}>Scoring & Display</h2>

          <div style={s.twoCol}>
            <div>
              <label style={s.label}>Start Date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={s.input} />
            </div>
            <div>
              <label style={s.label}>End Date</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={s.input} />
            </div>
          </div>

          <div style={s.twoCol}>
            <div>
              <label style={s.label}>Score Divisor</label>
              <input type="number" value={scoreDivisor} onChange={e => setScoreDivisor(e.target.value)} style={s.input} min="0.1" step="0.1" />
            </div>
            <div>
              <label style={s.label}>Operation</label>
              <select value={scoreOperation} onChange={e => setScoreOperation(e.target.value)} style={s.input}>
                <option value="divide">Divide</option>
                <option value="multiply">Multiply</option>
              </select>
            </div>
          </div>

          <label style={s.label}>Score Rounding</label>
          <select value={scoreRounding} onChange={e => setScoreRounding(e.target.value)} style={s.input}>
            <option value="round">Round (nearest)</option>
            <option value="ceil">Ceiling (always up)</option>
            <option value="floor">Floor (always down)</option>
          </select>

          {mode === 'team' && (
            <label style={s.checkLabel}>
              <input type="checkbox" checked={allowHandicap} onChange={e => setAllowHandicap(e.target.checked)} />
              Enable handicap multipliers per team
            </label>
          )}

          <label style={s.label}>Theme Color</label>
          <input type="color" value={themeColor} onChange={e => setThemeColor(e.target.value)} style={{ ...s.input, height: 40, padding: 4, width: 80 }} />

          <label style={s.label}>Title Image URL (optional)</label>
          <input value={titleImageUrl} onChange={e => setTitleImageUrl(e.target.value)} style={s.input} placeholder="https://..." />

          <div style={s.navRow}>
            <button onClick={() => setWizStep(1)} style={s.backBtn}>← Back</button>
            <button onClick={() => setWizStep(3)} style={s.nextBtn}>Next →</button>
          </div>
        </div>
      )}

      {/* Step 3: Categories */}
      {wizStep === 3 && (
        <div style={s.card}>
          <h2 style={s.cardTitle}>Score Categories</h2>
          <p style={s.hint}>Define what players catch and how many points each is worth.</p>

          {categories.map((cat, i) => (
            <div key={i} style={s.catRow}>
              <input
                value={cat.name}
                onChange={e => updateCategory(i, 'name', e.target.value)}
                style={{ ...s.input, flex: 1 }}
                placeholder="Category name (e.g. Shiny Legend)"
              />
              <input
                type="number"
                value={cat.multiplier}
                onChange={e => updateCategory(i, 'multiplier', e.target.value)}
                style={{ ...s.input, width: 80 }}
                placeholder="Pts"
                min="1"
              />
              <button onClick={() => removeCategory(i)} style={s.removeBtn}>✕</button>
            </div>
          ))}
          <button onClick={addCategory} style={s.addCatBtn}>+ Add Category</button>

          <div style={s.navRow}>
            <button onClick={() => setWizStep(2)} style={s.backBtn}>← Back</button>
            <button onClick={handleCreate} disabled={saving} style={s.createBtn}>
              {saving ? 'Creating...' : 'Create Event'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Board Game Wizard (delegates to existing flow) ────────────

function BoardGameWizard() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [overallWebhook, setOverallWebhook] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  async function handleCreate() {
    if (!name.trim() || !slug.trim()) { setMsg('Name and slug required.'); return; }
    setSaving(true);
    try {
      const { data: ev, error } = await supabase
        .from('events')
        .insert({
          name, slug, event_type: 'board_game', status: 'active', division_count: 1,
          discord_overall_webhook: overallWebhook || null,
          created_by: profile?.id,
        })
        .select().single();
      if (error) throw error;

      // Create default board config
      await supabase.from('board_game_config').insert({
        event_id: ev.id,
        track_length: 252,
        grid_columns: 18,
        score_divisor: 2,
        score_operation: 'divide',
        score_rounding: 'ceil',
        min_moves_per_day: 1,
        max_moves_per_day: 0,
        theme_color: '#c62828',
        badge_bonus_enabled: true,
        show_badge_sidebar: true,
        show_flavor_text: true,
      });

      // Insert default Kanto/Johto squares
      const defaultSquares = [
        { square_number: 0,   type: 'start',        label: 'Start',               icon: '🏁' },
        { square_number: 125, type: 'center',        label: 'Indigo Plateau',      icon: '🏥' },
        { square_number: 126, type: 'elite',         label: 'Kanto Elite 4',       icon: '⚔️' },
        { square_number: 250, type: 'center',        label: 'Pokemon Center',      icon: '🏥' },
        { square_number: 251, type: 'elite',         label: 'Indigo Plateau',      icon: '⚔️' },
        { square_number: 252, type: 'finish',        label: 'Johto Elite 4',       icon: '🏆' },
        { square_number: 14,  type: 'gym', label: 'Pewter City Gym',    icon: '🪨', badge: 'Boulder Badge' },
        { square_number: 28,  type: 'gym', label: 'Cerulean City Gym',  icon: '💧', badge: 'Cascade Badge' },
        { square_number: 42,  type: 'gym', label: 'Vermilion City Gym', icon: '⚡', badge: 'Thunder Badge' },
        { square_number: 56,  type: 'gym', label: 'Celadon City Gym',   icon: '🌿', badge: 'Rainbow Badge' },
        { square_number: 70,  type: 'gym', label: 'Fuchsia City Gym',   icon: '☠️',  badge: 'Soul Badge' },
        { square_number: 84,  type: 'gym', label: 'Saffron City Gym',   icon: '🔮', badge: 'Marsh Badge' },
        { square_number: 98,  type: 'gym', label: 'Cinnabar Island Gym',icon: '🔥', badge: 'Volcano Badge' },
        { square_number: 112, type: 'gym', label: 'Viridian City Gym',  icon: '🌍', badge: 'Earth Badge' },
        { square_number: 140, type: 'gym', label: 'Violet City Gym',    icon: '🌬️', badge: 'Zephyr Badge' },
        { square_number: 153, type: 'gym', label: 'Azalea Town Gym',    icon: '🐛', badge: 'Hive Badge' },
        { square_number: 166, type: 'gym', label: 'Goldenrod City Gym', icon: '🌾', badge: 'Plain Badge' },
        { square_number: 179, type: 'gym', label: 'Ecruteak City Gym',  icon: '👻', badge: 'Fog Badge' },
        { square_number: 192, type: 'gym', label: 'Cianwood City Gym',  icon: '🌊', badge: 'Storm Badge' },
        { square_number: 205, type: 'gym', label: 'Olivine City Gym',   icon: '⚙️',  badge: 'Mineral Badge' },
        { square_number: 218, type: 'gym', label: 'Mahogany Town Gym',  icon: '🧊', badge: 'Glacier Badge' },
        { square_number: 231, type: 'gym', label: 'Blackthorn City Gym',icon: '🐉', badge: 'Rising Badge' },
        { square_number: 34,  type: 'prize',        label: '10 Quick Balls',   icon: '🎁' },
        { square_number: 69,  type: 'prize',        label: '5 Mystery Boxes',  icon: '📦' },
        { square_number: 180, type: 'prize',        label: '1 Ability Capsule',icon: '💊' },
        { square_number: 20,  type: 'bonus_jump',   label: 'Short Cut!', icon: '⬆️', jump_to: 34 },
        { square_number: 55,  type: 'bonus_jump',   label: 'Short Cut!', icon: '⬆️', jump_to: 69 },
        { square_number: 160, type: 'bonus_jump',   label: 'Short Cut!', icon: '⬆️', jump_to: 180 },
        { square_number: 40,  type: 'penalty_jump', label: 'Setback!',   icon: '⬇️', jump_to: 14 },
        { square_number: 85,  type: 'penalty_jump', label: 'Setback!',   icon: '⬇️', jump_to: 70 },
        { square_number: 130, type: 'penalty_jump', label: 'Setback!',   icon: '⬇️', jump_to: 98 },
        { square_number: 195, type: 'penalty_jump', label: 'Setback!',   icon: '⬇️', jump_to: 140 },
        { square_number: 230, type: 'penalty_jump', label: 'Setback!',   icon: '⬇️', jump_to: 218 },
        ...[8,22,48,62,78,100,115,135,150,168,190,210,235,248].map(n => ({ square_number: n, type: 'bonus_small',   icon: '✨', move_amount: 2, label: '+2 Steps' })),
        ...[12,30,52,73,90,108,118,145,162,175,200,220,240,245].map(n => ({ square_number: n, type: 'penalty_small', icon: '💢', move_amount: 2, label: '-2 Steps' })),
      ].map(s => ({ ...s, event_id: ev.id }));

      await supabase.from('board_squares').insert(defaultSquares);

      navigate(`/admin/board/${ev.id}`);
    } catch (e) { setMsg(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div style={s.page}>
      <Link to="/admin" style={s.back}>← Dashboard</Link>
      <h1 style={s.title}>🎲 New Board Game Event</h1>
      {msg && <div style={s.msg}>{msg}</div>}
      <div style={s.card}>
        <label style={s.label}>Event Name</label>
        <input value={name} onChange={e => setName(e.target.value)} style={s.input} placeholder="PokeNexus Summer Board Game" />
        <label style={s.label}>URL Slug</label>
        <input value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} style={s.input} placeholder="summer-board-game-2026" />
        <label style={s.label}>Overall Discord Webhook (optional)</label>
        <input value={overallWebhook} onChange={e => setOverallWebhook(e.target.value)} style={s.input} placeholder="https://discord.com/api/webhooks/..." />
        <div style={s.hint}>Posts full board standings on every day commit. Configure player-level webhooks in the event editor after creation.</div>
        <div style={s.navRow}>
          <button onClick={handleCreate} disabled={saving} style={s.createBtn}>
            {saving ? 'Creating...' : 'Create Event'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── All-Play Wizard (existing flow, slimmed) ──────────────────

function AllPlayWizard() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [wizStep, setWizStep] = useState(1);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [overallWebhook, setOverallWebhook] = useState('');
  const [numDivisions, setNumDivisions] = useState(1);
  const [seriesFormat, setSeriesFormat] = useState('single');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  async function handleCreate() {
    if (!name.trim() || !slug.trim()) { setMsg('Name and slug required.'); return; }
    setSaving(true);
    try {
      const { data: ev, error } = await supabase
        .from('events')
        .insert({
          name, slug, event_type: 'all_play', status: 'active',
          discord_overall_webhook: overallWebhook || null,
          division_count: Number(numDivisions) || 1,
          created_by: profile?.id,
        })
        .select().single();
      if (error) throw error;

      // Create division rows
      const count = Number(numDivisions) || 1;
      await supabase.from('divisions').insert(
        Array.from({ length: count }, (_, i) => ({
          event_id: ev.id,
          division_number: i + 1,
          name: count === 1 ? 'Division 1' : `Division ${i + 1}`,
        }))
      );

      navigate(`/admin/events/${ev.id}`);
    } catch (e) { setMsg(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div style={s.page}>
      <Link to="/admin" style={s.back}>← Dashboard</Link>
      <h1 style={s.title}>⚔️ New All-Play Tournament</h1>
      {msg && <div style={s.msg}>{msg}</div>}

      {wizStep === 1 && (
        <div style={s.card}>
          <h2 style={s.cardTitle}>Event Basics</h2>
          <label style={s.label}>Event Name</label>
          <input value={name} onChange={e => setName(e.target.value)} style={s.input} placeholder="PokeNexus Summer Tournament" />
          <label style={s.label}>URL Slug</label>
          <input value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} style={s.input} placeholder="summer-tournament-2026" />
          <label style={s.label}>Overall Discord Webhook (optional)</label>
          <input value={overallWebhook} onChange={e => setOverallWebhook(e.target.value)} style={s.input} placeholder="https://discord.com/api/webhooks/..." />
          <div style={s.hint}>Posts full standings on every day commit. Per-team webhooks configured in event management.</div>
          <div style={s.navRow}>
            <button onClick={() => setWizStep(2)} style={s.nextBtn}>Next →</button>
          </div>
        </div>
      )}

      {wizStep === 2 && (
        <div style={s.card}>
          <h2 style={s.cardTitle}>Format</h2>
          <label style={s.label}>Number of Divisions</label>
          <input type="number" value={numDivisions} onChange={e => setNumDivisions(Number(e.target.value))} style={s.input} min="1" max="4" />
          <label style={s.label}>Default Series Format</label>
          <select value={seriesFormat} onChange={e => setSeriesFormat(e.target.value)} style={s.input}>
            <option value="single">Single game</option>
            <option value="best_of_3">Best of 3</option>
            <option value="best_of_5">Best of 5</option>
          </select>
          <div style={s.navRow}>
            <button onClick={() => setWizStep(1)} style={s.backBtn}>← Back</button>
            <button onClick={handleCreate} disabled={saving} style={s.createBtn}>
              {saving ? 'Creating...' : 'Create Event'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared Styles ─────────────────────────────────────────────

const s = {
  page: { maxWidth: 720, margin: '0 auto', padding: '32px 16px', fontFamily: 'sans-serif' },
  back: { color: '#888', textDecoration: 'none', fontSize: 13, display: 'block', marginBottom: 12 },
  title: { color: '#fff', fontSize: 24, marginBottom: 6 },
  subtitle: { color: '#888', fontSize: 15, marginBottom: 24 },
  typeGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 },
  typeCard: { background: '#1a1a1a', border: '1px solid #333', borderRadius: 10, padding: 20, cursor: 'pointer', textAlign: 'left', transition: 'border-color .15s', color: '#fff' },
  typeCardDisabled: { opacity: 0.5, cursor: 'default', background: '#111' },
  typeIcon: { fontSize: 32, marginBottom: 8 },
  typeLabel: { fontWeight: 700, fontSize: 16, marginBottom: 4 },
  typeDesc: { color: '#888', fontSize: 13, lineHeight: 1.5 },
  comingSoon: { display: 'inline-block', background: '#333', color: '#888', borderRadius: 4, padding: '2px 8px', fontSize: 11, marginBottom: 6 },
  stepRow: { display: 'flex', gap: 0, marginBottom: 24, borderBottom: '1px solid #333' },
  step: { padding: '10px 20px', color: '#888', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 },
  stepActive: { color: '#fff', borderBottom: `2px solid ${ACC}`, fontWeight: 700 },
  stepNum: { width: 20, height: 20, borderRadius: '50%', background: '#333', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 },
  card: { background: '#1a1a1a', border: '1px solid #333', borderRadius: 10, padding: 24 },
  cardTitle: { color: '#fff', fontSize: 17, marginTop: 0, marginBottom: 16 },
  label: { display: 'block', color: '#aaa', fontSize: 13, marginBottom: 6, marginTop: 16 },
  input: { width: '100%', boxSizing: 'border-box', background: '#111', color: '#fff', border: '1px solid #444', borderRadius: 6, padding: '8px 12px', fontSize: 14 },
  hint: { color: '#666', fontSize: 12, marginTop: 4 },
  radioRow: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 },
  radioLabel: { display: 'flex', alignItems: 'center', gap: 8, color: '#ccc', fontSize: 14, cursor: 'pointer' },
  checkLabel: { display: 'flex', alignItems: 'center', gap: 8, color: '#ccc', fontSize: 14, marginTop: 16, cursor: 'pointer' },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  catRow: { display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' },
  removeBtn: { background: 'none', color: '#c55', border: '1px solid #522', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' },
  addCatBtn: { background: 'none', color: ACC, border: `1px solid ${ACC}`, borderRadius: 6, padding: '7px 16px', cursor: 'pointer', marginTop: 4 },
  navRow: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 24 },
  nextBtn: { background: ACC, color: '#fff', border: 'none', borderRadius: 6, padding: '9px 20px', cursor: 'pointer', fontWeight: 700 },
  backBtn: { background: '#222', color: '#ccc', border: '1px solid #444', borderRadius: 6, padding: '9px 16px', cursor: 'pointer' },
  createBtn: { background: ACC, color: '#fff', border: 'none', borderRadius: 6, padding: '10px 24px', cursor: 'pointer', fontWeight: 700, fontSize: 15 },
  msg: { background: '#1e1e1e', border: '1px solid #553', borderRadius: 6, padding: '10px 14px', color: '#ffb', marginBottom: 16 },
};
