// src/pages/admin/CreateEventPage.jsx
// Step 0: pick event type (board_game | all_play | high_score | bingo_solo | bingo_team | slots)
// Then branches to type-specific wizard.

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { upsertHSConfig } from '../../lib/highscore';
import { seedSlotsEvent } from '../../lib/slots';

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
    id: 'bingo_solo',
    icon: '🎯',
    label: 'Solo Bingo',
    description: '5×5 bingo board. Individual players complete squares and earn bingo line bonuses.',
    comingSoon: false,
  },
  {
    id: 'bingo_team',
    icon: '🤝',
    label: 'Team Bingo',
    description: '5×5 bingo board. Teams collaborate to complete rows, columns, and diagonals together.',
    comingSoon: false,
  },
  {
    id: 'slots',
    icon: '🎰',
    label: 'Slots',
    description: 'Players earn Slot Tokens from daily scores and spin a slot machine to win Casino Prize Coins.',
    comingSoon: false,
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
  if (eventType === 'bingo_solo' || eventType === 'bingo_team') return <BingoWizard eventType={eventType} />;
  if (eventType === 'slots') return <SlotsWizard />;
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

// ── Bingo Wizard ──────────────────────────────────────────────

function buildDefaultSquares(hasFreeSpace) {
  return Array.from({ length: 25 }, (_, i) => ({
    position: i,
    label: i === 12 && hasFreeSpace ? 'FREE' : `Square ${i + 1}`,
    description: '',
    point_value: 1,
    is_free_space: i === 12 && hasFreeSpace,
  }));
}

function BingoWizard({ eventType }) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isTeam = eventType === 'bingo_team';

  const [wizStep, setWizStep] = useState(1);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState('');

  const [name, setName] = useState('');
  const [gameTitle, setGameTitle] = useState('');
  const [gameSubtitle, setGameSubtitle] = useState('');
  const [titleImageUrl, setTitleImageUrl] = useState('');
  const [themeColor, setThemeColor] = useState('#c62828');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [freeSpaceEnabled, setFreeSpaceEnabled] = useState(true);
  const [discordWebhook, setDiscordWebhook] = useState('');

  const [scoreDivisor, setScoreDivisor] = useState(1);
  const [scoreOperation, setScoreOperation] = useState('divide');
  const [scoreRoundingMode, setScoreRoundingMode] = useState('ceil');

  const [lineValues, setLineValues] = useState({
    row1_value: 0, row2_value: 0, row3_value: 0, row4_value: 0, row5_value: 0,
    col1_value: 0, col2_value: 0, col3_value: 0, col4_value: 0, col5_value: 0,
    diag1_value: 0, diag2_value: 0,
  });

  const setLineVal = (key, val) => setLineValues(prev => ({ ...prev, [key]: Number(val) }));

  const handleCreate = async () => {
    if (!name.trim()) { setMsg('Event name is required.'); return; }
    setCreating(true);
    setMsg('');
    try {
      const { data: event, error: evErr } = await supabase
        .from('events')
        .insert({
          name: name.trim(),
          slug: name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          event_type: eventType,
          status: 'active',
          division_count: 1,
          start_date: startDate || null,
          end_date: endDate || null,
          discord_overall_webhook: discordWebhook || null,
          created_by: profile?.id,
        })
        .select()
        .single();
      if (evErr) throw evErr;

      const { error: cfgErr } = await supabase.from('bingo_config').insert({
        event_id: event.id,
        event_type: isTeam ? 'team' : 'solo',
        free_space_enabled: freeSpaceEnabled,
        score_divisor: scoreDivisor,
        score_operation: scoreOperation,
        score_rounding_mode: scoreRoundingMode,
        theme_color: themeColor,
        title_image_url: titleImageUrl || null,
        game_title: gameTitle || name.trim(),
        game_subtitle: gameSubtitle || null,
        start_date: startDate || null,
        end_date: endDate || null,
        discord_webhook_url: discordWebhook || null,
        ...lineValues,
      });
      if (cfgErr) throw cfgErr;

      const squares = buildDefaultSquares(freeSpaceEnabled).map(sq => ({
        ...sq,
        event_id: event.id,
      }));
      const { error: sqErr } = await supabase.from('bingo_squares').insert(squares);
      if (sqErr) throw sqErr;

      navigate(`/admin/bingo/${event.id}/edit`);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={s.page}>
      <Link to="/admin" style={s.back}>← Dashboard</Link>
      <h1 style={s.title}>{isTeam ? '🤝' : '🎯'} New {isTeam ? 'Team' : 'Solo'} Bingo Event</h1>

      <div style={s.stepRow}>
        {['Basics', 'Scoring', 'Line Values'].map((label, i) => (
          <div key={i} style={{ ...s.step, ...(wizStep === i + 1 ? s.stepActive : {}) }}>
            <span style={s.stepNum}>{i + 1}</span> {label}
          </div>
        ))}
      </div>

      {msg && <div style={s.msg}>{msg}</div>}

      {wizStep === 1 && (
        <div style={s.card}>
          <h2 style={s.cardTitle}>Event Basics</h2>
          <label style={s.label}>Internal Event Name *</label>
          <input value={name} onChange={e => setName(e.target.value)} style={s.input} placeholder="e.g. Christmas Bingo 2026" />
          <label style={s.label}>Display Title</label>
          <input value={gameTitle} onChange={e => setGameTitle(e.target.value)} style={s.input} placeholder="Shown on the public board (defaults to event name)" />
          <label style={s.label}>Subtitle (optional)</label>
          <input value={gameSubtitle} onChange={e => setGameSubtitle(e.target.value)} style={s.input} />
          <label style={s.label}>Title Image URL (optional)</label>
          <input value={titleImageUrl} onChange={e => setTitleImageUrl(e.target.value)} style={s.input} placeholder="https://..." />
          <label style={s.label}>Theme Color</label>
          <input type="color" value={themeColor} onChange={e => setThemeColor(e.target.value)}
            style={{ ...s.input, height: 40, padding: 4, width: 80 }} />
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
          <label style={s.checkLabel}>
            <input type="checkbox" checked={freeSpaceEnabled} onChange={e => setFreeSpaceEnabled(e.target.checked)} />
            Free Space in center (position 13)
          </label>
          <label style={s.label}>Overall Discord Webhook (optional)</label>
          <input value={discordWebhook} onChange={e => setDiscordWebhook(e.target.value)} style={s.input} placeholder="https://discord.com/api/webhooks/..." />
          <div style={s.navRow}>
            <button onClick={() => setWizStep(2)} style={s.nextBtn}>Next →</button>
          </div>
        </div>
      )}

      {wizStep === 2 && (
        <div style={s.card}>
          <h2 style={s.cardTitle}>Scoring</h2>
          <div style={s.twoCol}>
            <div>
              <label style={s.label}>Score Divisor</label>
              <input type="number" min={1} value={scoreDivisor} onChange={e => setScoreDivisor(Number(e.target.value))} style={s.input} />
            </div>
            <div>
              <label style={s.label}>Operation</label>
              <select value={scoreOperation} onChange={e => setScoreOperation(e.target.value)} style={s.input}>
                <option value="divide" style={{ background: '#1a1a1a', color: '#fff' }}>Divide</option>
                <option value="multiply" style={{ background: '#1a1a1a', color: '#fff' }}>Multiply</option>
              </select>
            </div>
          </div>
          <label style={s.label}>Score Rounding</label>
          <select value={scoreRoundingMode} onChange={e => setScoreRoundingMode(e.target.value)} style={s.input}>
            <option value="ceil" style={{ background: '#1a1a1a', color: '#fff' }}>Ceiling (always up)</option>
            <option value="floor" style={{ background: '#1a1a1a', color: '#fff' }}>Floor (always down)</option>
            <option value="round" style={{ background: '#1a1a1a', color: '#fff' }}>Round (nearest)</option>
          </select>
          <div style={s.navRow}>
            <button onClick={() => setWizStep(1)} style={s.backBtn}>← Back</button>
            <button onClick={() => setWizStep(3)} style={s.nextBtn}>Next →</button>
          </div>
        </div>
      )}

      {wizStep === 3 && (
        <div style={s.card}>
          <h2 style={s.cardTitle}>Bingo Line Values</h2>
          <p style={{ color: '#666', fontSize: 13, marginTop: 0 }}>
            Bonus points awarded for completing each row, column, or diagonal. Set to 0 for no bonus.
          </p>
          <div style={s.twoCol}>
            <div>
              <div style={{ color: '#aaa', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Rows (top → bottom)</div>
              {[1,2,3,4,5].map(i => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <label style={{ ...s.label, margin: 0, width: 50, flexShrink: 0 }}>Row {i}</label>
                  <input type="number" min={0} value={lineValues[`row${i}_value`]}
                    onChange={e => setLineVal(`row${i}_value`, e.target.value)}
                    style={{ ...s.input, width: 100 }} />
                </div>
              ))}
            </div>
            <div>
              <div style={{ color: '#aaa', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Columns (left → right)</div>
              {[1,2,3,4,5].map(i => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <label style={{ ...s.label, margin: 0, width: 50, flexShrink: 0 }}>Col {i}</label>
                  <input type="number" min={0} value={lineValues[`col${i}_value`]}
                    onChange={e => setLineVal(`col${i}_value`, e.target.value)}
                    style={{ ...s.input, width: 100 }} />
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={{ color: '#aaa', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Diagonals</div>
            <div style={{ display: 'flex', gap: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ ...s.label, margin: 0, width: 80, flexShrink: 0 }}>Diag ↘</label>
                <input type="number" min={0} value={lineValues.diag1_value}
                  onChange={e => setLineVal('diag1_value', e.target.value)}
                  style={{ ...s.input, width: 100 }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ ...s.label, margin: 0, width: 80, flexShrink: 0 }}>Diag ↙</label>
                <input type="number" min={0} value={lineValues.diag2_value}
                  onChange={e => setLineVal('diag2_value', e.target.value)}
                  style={{ ...s.input, width: 100 }} />
              </div>
            </div>
          </div>
          <div style={s.navRow}>
            <button onClick={() => setWizStep(2)} style={s.backBtn}>← Back</button>
            <button onClick={handleCreate} disabled={creating} style={s.createBtn}>
              {creating ? 'Creating...' : 'Create Event →'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── High Score Wizard ─────────────────────────────────────────

function HighScoreWizard() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [mode, setMode] = useState('solo');
  const [overallWebhook, setOverallWebhook] = useState('');

  async function handleCreate() {
    if (!name.trim()) { setMsg('Event name is required.'); return; }
    if (!slug.trim()) { setMsg('URL slug is required.'); return; }
    setSaving(true);
    setMsg('');
    try {
      const { data: ev, error: evErr } = await supabase
        .from('events')
        .insert({
          name: name.trim(),
          slug: slug.trim(),
          event_type: 'high_score',
          status: 'active',
          division_count: 1,
          discord_overall_webhook: overallWebhook || null,
          created_by: profile?.id,
        })
        .select().single();
      if (evErr) throw evErr;

      await upsertHSConfig(ev.id, {
        mode,
        theme_color: '#c62828',
        score_divisor: 1,
        score_operation: 'divide',
        score_rounding: 'round',
        allow_handicap: false,
      });

      navigate(`/admin/highscore/${ev.id}/edit`);
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
      {msg && <div style={s.msg}>{msg}</div>}
      <div style={s.card}>
        <h2 style={s.cardTitle}>Event Basics</h2>
        <label style={s.label}>Event Name</label>
        <input value={name} onChange={e => setName(e.target.value)} style={s.input} placeholder="Summer High Score Challenge" />
        <label style={s.label}>URL Slug</label>
        <input
          value={slug}
          onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
          style={s.input}
          placeholder="summer-high-score-2026"
        />
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
          <button onClick={handleCreate} disabled={saving} style={s.createBtn}>
            {saving ? 'Creating...' : 'Create Event'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Board Game Wizard ─────────────────────────────────────────

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

      await supabase.from('board_game_config').insert({
        event_id: ev.id, track_length: 252, grid_columns: 18, score_divisor: 2,
        score_operation: 'divide', score_rounding: 'ceil', min_moves_per_day: 1,
        max_moves_per_day: 0, theme_color: '#c62828', badge_bonus_enabled: true,
        show_badge_sidebar: true, show_flavor_text: true,
      });

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
      ].map(sq => ({ ...sq, event_id: ev.id }));

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
        <div style={s.hint}>Posts full board standings on every day commit.</div>
        <div style={s.navRow}>
          <button onClick={handleCreate} disabled={saving} style={s.createBtn}>
            {saving ? 'Creating...' : 'Create Event'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── All-Play Wizard ───────────────────────────────────────────

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

      const count = Number(numDivisions) || 1;
      await supabase.from('divisions').insert(
        Array.from({ length: count }, (_, i) => ({
          event_id: ev.id, division_number: i + 1,
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
            <option value="single" style={{ background: '#1a1a1a', color: '#fff' }}>Single game</option>
            <option value="best_of_3" style={{ background: '#1a1a1a', color: '#fff' }}>Best of 3</option>
            <option value="best_of_5" style={{ background: '#1a1a1a', color: '#fff' }}>Best of 5</option>
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

// ── Slots Wizard ──────────────────────────────────────────────

function SlotsWizard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [wizStep, setWizStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [gameTitle, setGameTitle] = useState('');
  const [gameSubtitle, setGameSubtitle] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [themeColor, setThemeColor] = useState('#c62828');
  const [discordWebhook, setDiscordWebhook] = useState('');

  const [categories, setCategories] = useState([{ label: '', point_value: 1 }]);
  const [scoreDivisor, setScoreDivisor] = useState(1);
  const [scoreOperation, setScoreOperation] = useState('divide');
  const [scoreRounding, setScoreRounding] = useState('floor');
  const [minTokens, setMinTokens] = useState(0);
  const [maxTokens, setMaxTokens] = useState(0);

  const SYMBOLS = ['masterball','pokeball','greatball','ultraball','pikachu','eevee','rare_candy','potion','berry'];
  const SYMBOL_LABELS = { masterball:'Masterball', pokeball:'Pokeball', greatball:'Greatball', ultraball:'Ultraball', pikachu:'Pikachu', eevee:'Eevee', rare_candy:'Rare Candy', potion:'Potion', berry:'Berry' };
  const [symbolImages, setSymbolImages] = useState({});

  const [storeItems, setStoreItems] = useState([]);

  const addCat = () => setCategories(c => [...c, { label: '', point_value: 1 }]);
  const removeCat = i => setCategories(c => c.filter((_, idx) => idx !== i));
  const updateCat = (i, field, val) => setCategories(c => c.map((cat, idx) => idx === i ? { ...cat, [field]: val } : cat));

  const addStoreItem = () => setStoreItems(s => [...s, { label: '', cost_cpc: 100, quantity: null, pays_out_slot_tokens: 0 }]);
  const removeStoreItem = i => setStoreItems(s => s.filter((_, idx) => idx !== i));
  const updateStoreItem = (i, field, val) => setStoreItems(s => s.map((item, idx) => idx === i ? { ...item, [field]: val } : item));

  async function handleCreate() {
    setSaving(true);
    setMsg('');
    try {
      const autoSlug = slug.trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const { data: ev, error: evErr } = await supabase.from('events').insert({
        name: name.trim(),
        slug: autoSlug,
        event_type: 'slots',
        status: 'active',
        division_count: 1,          // ← required non-null column
        created_by: user?.id,
      }).select().single();
      if (evErr) throw evErr;

      await seedSlotsEvent({
        eventId: ev.id,
        gameTitle: gameTitle.trim() || name.trim(),
        gameSubtitle: gameSubtitle.trim() || null,
        themeColor,
        discordWebhookUrl: discordWebhook.trim() || null,
        scoreDivisor: Number(scoreDivisor),
        scoreOperation,
        scoreRounding,
        minTokensPerDay: Number(minTokens),
        maxTokensPerDay: Number(maxTokens),
        categories: categories.filter(c => c.label.trim()),
      });

      const symImgMap = {};
      for (const sym of SYMBOLS) {
        if (symbolImages[sym]?.trim()) symImgMap[sym] = symbolImages[sym].trim();
      }
      if (Object.keys(symImgMap).length > 0) {
        await supabase.from('slots_config').update({ symbol_images: symImgMap }).eq('event_id', ev.id);
      }

      if (storeItems.length > 0) {
        const rows = storeItems
          .filter(i => i.label.trim())
          .map((i, idx) => ({
            event_id: ev.id,
            label: i.label.trim(),
            cost_cpc: Number(i.cost_cpc) || 100,
            quantity_remaining: i.quantity ? Number(i.quantity) : null,
            pays_out_slot_tokens: Number(i.pays_out_slot_tokens) || 0,
            is_active: true,
            sort_order: idx,
          }));
        if (rows.length > 0) await supabase.from('slots_store_items').insert(rows);
      }

      navigate(`/admin/slots/${ev.id}`);
    } catch (e) {
      setMsg(e.message);
      setSaving(false);
    }
  }

  const steps = ['Basic Info', 'Scoring', 'Symbols', 'Store'];

  return (
    <div style={s.page}>
      <Link to="/admin" style={s.back}>← Dashboard</Link>
      <h1 style={s.title}>New Slots Event</h1>

      <div style={s.stepRow}>
        {steps.map((label, i) => (
          <div key={i} style={{ ...s.step, ...(wizStep === i + 1 ? s.stepActive : {}) }}>
            <span style={s.stepNum}>{i + 1}</span> {label}
          </div>
        ))}
      </div>

      {msg && <div style={s.msg}>{msg}</div>}

      {wizStep === 1 && (
        <div style={s.card}>
          <h2 style={s.cardTitle}>Basic Info</h2>
          <label style={s.label}>Internal Event Name *</label>
          <input value={name} onChange={e => setName(e.target.value)} style={s.input} placeholder="Summer Slots 2026" />
          <label style={s.label}>URL Slug (auto-generated if blank)</label>
          <input value={slug} onChange={e => setSlug(e.target.value)} style={s.input} placeholder="summer-slots-2026" />
          <label style={s.label}>Display Title (shown on public board)</label>
          <input value={gameTitle} onChange={e => setGameTitle(e.target.value)} style={s.input} placeholder="Same as event name if blank" />
          <label style={s.label}>Subtitle</label>
          <input value={gameSubtitle} onChange={e => setGameSubtitle(e.target.value)} style={s.input} placeholder="Optional tagline" />
          <label style={s.label}>Banner Image URL</label>
          <input value={bannerUrl} onChange={e => setBannerUrl(e.target.value)} style={s.input} placeholder="https://..." />
          <label style={s.label}>Theme Color</label>
          <input type="color" value={themeColor} onChange={e => setThemeColor(e.target.value)} style={{ ...s.input, width: 60, padding: 2 }} />
          <label style={s.label}>Discord Webhook URL</label>
          <input value={discordWebhook} onChange={e => setDiscordWebhook(e.target.value)} style={s.input} placeholder="https://discord.com/api/webhooks/..." />
          <div style={s.navRow}>
            <button onClick={() => setWizStep(2)} disabled={!name.trim()} style={s.nextBtn}>Next →</button>
          </div>
        </div>
      )}

      {wizStep === 2 && (
        <div style={s.card}>
          <h2 style={s.cardTitle}>Scoring &amp; Categories</h2>
          <label style={s.label}>Score Divisor</label>
          <input type="number" value={scoreDivisor} onChange={e => setScoreDivisor(e.target.value)} style={s.input} min="1" />
          <p style={s.hint}>Tokens awarded = floor(raw_score ÷ divisor). Raw score = sum of encounter counts × point values.</p>
          <div style={s.twoCol}>
            <div>
              <label style={s.label}>Min Tokens/Day</label>
              <input type="number" value={minTokens} onChange={e => setMinTokens(e.target.value)} style={s.input} min="0" />
            </div>
            <div>
              <label style={s.label}>Max Tokens/Day (0 = no cap)</label>
              <input type="number" value={maxTokens} onChange={e => setMaxTokens(e.target.value)} style={s.input} min="0" />
            </div>
          </div>
          <label style={s.label}>Encounter Categories</label>
          {categories.map((cat, i) => (
            <div key={i} style={s.catRow}>
              <input value={cat.label} onChange={e => updateCat(i, 'label', e.target.value)} placeholder="Category name" style={{ ...s.input, flex: 2 }} />
              <input type="number" value={cat.point_value} onChange={e => updateCat(i, 'point_value', e.target.value)} placeholder="Pts" style={{ ...s.input, width: 70 }} />
              {categories.length > 1 && <button onClick={() => removeCat(i)} style={s.removeBtn}>✕</button>}
            </div>
          ))}
          <button onClick={addCat} style={s.addCatBtn}>+ Add Category</button>
          <div style={s.navRow}>
            <button onClick={() => setWizStep(1)} style={s.backBtn}>← Back</button>
            <button onClick={() => setWizStep(3)} style={s.nextBtn}>Next →</button>
          </div>
        </div>
      )}

      {wizStep === 3 && (
        <div style={s.card}>
          <h2 style={s.cardTitle}>Symbol Images <span style={{ color: '#666', fontSize: 13, fontWeight: 400 }}>(optional — set now or later in Edit)</span></h2>
          <p style={s.hint}>Provide direct image URLs for each reel symbol. Leave blank to use emoji fallbacks.</p>
          {SYMBOLS.map(sym => (
            <div key={sym}>
              <label style={s.label}>{SYMBOL_LABELS[sym]}</label>
              <input value={symbolImages[sym] || ''} onChange={e => setSymbolImages(prev => ({ ...prev, [sym]: e.target.value }))} style={s.input} placeholder="https://..." />
            </div>
          ))}
          <div style={s.navRow}>
            <button onClick={() => setWizStep(2)} style={s.backBtn}>← Back</button>
            <button onClick={() => setWizStep(4)} style={s.nextBtn}>Next →</button>
          </div>
        </div>
      )}

      {wizStep === 4 && (
        <div style={s.card}>
          <h2 style={s.cardTitle}>Prize Store Setup <span style={{ color: '#666', fontSize: 13, fontWeight: 400 }}>(optional — add items now or later)</span></h2>
          <p style={s.hint}>Each item costs Casino Prize Coins (CPC). Optionally awards Slot Tokens on purchase (for token bundle items).</p>
          {storeItems.map((item, i) => (
            <div key={i} style={{ ...s.catRow, flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              <input value={item.label} onChange={e => updateStoreItem(i, 'label', e.target.value)} placeholder="Item name" style={{ ...s.input, flex: 2, minWidth: 120 }} />
              <input type="number" value={item.cost_cpc} onChange={e => updateStoreItem(i, 'cost_cpc', e.target.value)} placeholder="CPC cost" style={{ ...s.input, width: 90 }} />
              <input type="number" value={item.quantity ?? ''} onChange={e => updateStoreItem(i, 'quantity', e.target.value || null)} placeholder="Qty (∞)" style={{ ...s.input, width: 80 }} />
              <input type="number" value={item.pays_out_slot_tokens} onChange={e => updateStoreItem(i, 'pays_out_slot_tokens', e.target.value)} placeholder="Token payout" style={{ ...s.input, width: 100 }} />
              <button onClick={() => removeStoreItem(i)} style={s.removeBtn}>✕</button>
            </div>
          ))}
          <button onClick={addStoreItem} style={s.addCatBtn}>+ Add Store Item</button>
          <div style={s.navRow}>
            <button onClick={() => setWizStep(3)} style={s.backBtn}>← Back</button>
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
  title: { color: 'var(--text)', fontSize: 24, marginBottom: 6 },
  subtitle: { color: '#888', fontSize: 15, marginBottom: 24 },
  typeGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 },
  typeCard: { background: '#1a1a1a', border: '1px solid #333', borderRadius: 10, padding: 20, cursor: 'pointer', textAlign: 'left', transition: 'border-color .15s', color: 'var(--text)' },
  typeCardDisabled: { opacity: 0.5, cursor: 'default', background: '#111' },
  typeIcon: { fontSize: 32, marginBottom: 8 },
  typeLabel: { fontWeight: 700, fontSize: 16, marginBottom: 4 },
  typeDesc: { color: '#888', fontSize: 13, lineHeight: 1.5 },
  comingSoon: { display: 'inline-block', background: '#333', color: '#888', borderRadius: 4, padding: '2px 8px', fontSize: 11, marginBottom: 6 },
  stepRow: { display: 'flex', gap: 0, marginBottom: 24, borderBottom: '1px solid #333' },
  step: { padding: '10px 20px', color: '#888', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 },
  stepActive: { color: 'var(--text)', borderBottom: `2px solid ${ACC}`, fontWeight: 700 },
  stepNum: { width: 20, height: 20, borderRadius: '50%', background: '#333', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 },
  card: { background: '#1a1a1a', border: '1px solid #333', borderRadius: 10, padding: 24 },
  cardTitle: { color: 'var(--text)', fontSize: 17, marginTop: 0, marginBottom: 16 },
  label: { display: 'block', color: '#aaa', fontSize: 13, marginBottom: 6, marginTop: 16 },
  input: { width: '100%', boxSizing: 'border-box', background: '#111', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 14 },
  hint: { color: '#666', fontSize: 12, marginTop: 4 },
  radioRow: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 },
  radioLabel: { display: 'flex', alignItems: 'center', gap: 8, color: '#ccc', fontSize: 14, cursor: 'pointer' },
  checkLabel: { display: 'flex', alignItems: 'center', gap: 8, color: '#ccc', fontSize: 14, marginTop: 16, cursor: 'pointer' },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  catRow: { display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' },
  removeBtn: { background: 'none', color: '#c55', border: '1px solid #522', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' },
  addCatBtn: { background: 'none', color: ACC, border: `1px solid ${ACC}`, borderRadius: 6, padding: '7px 16px', cursor: 'pointer', marginTop: 4 },
  navRow: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 24 },
  nextBtn: { background: ACC, color: 'var(--text)', border: 'none', borderRadius: 6, padding: '9px 20px', cursor: 'pointer', fontWeight: 700 },
  backBtn: { background: '#222', color: '#ccc', border: '1px solid var(--border)', borderRadius: 6, padding: '9px 16px', cursor: 'pointer' },
  createBtn: { background: ACC, color: 'var(--text)', border: 'none', borderRadius: 6, padding: '10px 24px', cursor: 'pointer', fontWeight: 700, fontSize: 15 },
  msg: { background: '#1e1e1e', border: '1px solid #553', borderRadius: 6, padding: '10px 14px', color: '#ffb', marginBottom: 16 },
};
