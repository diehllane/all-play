// src/pages/admin/CreateEventPage.jsx
// Replaces the existing CreateEventPage.
// Step 0: choose event type (All-Play Tournament or Board Game)
// All-Play steps: unchanged from original.
// Board Game steps: basic info → players → categories → board config → tile builder.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import BoardBuilder from '../../components/BoardBuilder';
import { DEFAULT_BOARD_SQUARES } from '../../lib/boardgame';
import Navbar from '../../components/Navbar';

// ── All-Play wizard (unchanged logic, re-exported inline) ──
// Steps 1-5 of the original wizard are preserved below.
// Board Game wizard is new steps BG1-BG5.

const STEP_LABELS_ALLPLAY = ['Event Info', 'Divisions', 'Teams', 'Categories', 'Bracket Config'];
const STEP_LABELS_BG      = ['Event Info', 'Players', 'Categories', 'Board Config', 'Tile Builder'];

export default function CreateEventPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [eventType, setEventType] = useState(null); // null = not chosen yet
  const [step, setStep]           = useState(0);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState(null);

  // ── Shared fields ──────────────────────────────────────────
  const [eventName, setEventName]       = useState('');
  const [startDate, setStartDate]       = useState('');
  const [endDate, setEndDate]           = useState('');

  // ── All-Play fields (unchanged from original) ──────────────
  const [numDivisions, setNumDivisions] = useState(1);
  const [divisions, setDivisions]       = useState([{ name: 'Division 1', teams: [''] }]);
  const [categories, setCategories]     = useState([{ name: '', multiplier: '' }]);
  const [bracketConfig, setBracketConfig] = useState({ rounds: [] });

  // ── Board Game fields ──────────────────────────────────────
  const [bgPlayers, setBgPlayers]       = useState([{ name: '', avatar_url: '' }]);
  const [bgCategories, setBgCategories] = useState([{ name: '', multiplier: '' }]);
  const [bgConfig, setBgConfig]         = useState({
    track_length: 252,
    grid_columns: 18,
    score_divisor: 2,
    score_operation: 'divide',
    score_rounding: 'ceil',
    min_moves_per_day: 1,
    max_moves_per_day: 0,
    theme_color: '#c62828',
    title_image_url: '',
    badge_bonus_enabled: true,
    show_badge_sidebar: true,
    show_flavor_text: true,
  });
  const [bgSquares, setBgSquares]       = useState(DEFAULT_BOARD_SQUARES.map(s => ({ ...s })));

  const stepLabels = eventType === 'board_game' ? STEP_LABELS_BG : STEP_LABELS_ALLPLAY;
  const totalSteps = stepLabels.length;

  // ── Save handlers ──────────────────────────────────────────
  const handleSaveAllPlay = async () => {
    setSaving(true);
    setError(null);
    try {
      const slug = eventName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now();
      // 1. Create event
      const { data: ev, error: evErr } = await supabase.from('events').insert({
        name: eventName,
        slug,
        start_date: startDate || null,
        end_date: endDate || null,
        event_type: 'all_play',
        division_count: divisions.length,
        status: 'setup',
        created_by: user?.id,
      }).select().single();
      if (evErr) throw evErr;

      // 2. Divisions + teams
      for (const [divIndex, div] of divisions.entries()) {
        const { data: divData, error: divErr } = await supabase.from('divisions').insert({
          event_id: ev.id,
          name: div.name,
          division_number: divIndex + 1,
        }).select().single();
        if (divErr) throw divErr;
        const teamInserts = div.teams.filter(t => t.trim()).map((name, teamIndex) => ({
          event_id: ev.id,
          division_id: divData.id,
          name,
          team_number: teamIndex + 1,
        }));
        if (teamInserts.length) {
          const { error: tErr } = await supabase.from('teams').insert(teamInserts);
          if (tErr) throw tErr;
        }
      }

      // 3. Categories
      const catInserts = categories.filter(c => c.name.trim()).map(c => ({
        event_id: ev.id, name: c.name, multiplier: parseFloat(c.multiplier) || 1,
      }));
      if (catInserts.length) {
        const { error: cErr } = await supabase.from('categories').insert(catInserts);
        if (cErr) throw cErr;
      }

      // 4. Bracket config
      if (bracketConfig.rounds?.length) {
        const { error: bErr } = await supabase.from('events').update({
          bracket_round_config: bracketConfig,
        }).eq('id', ev.id);
        if (bErr) throw bErr;
      }

      navigate(`/admin/events/${ev.id}`);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  const handleSaveBoardGame = async () => {
    setSaving(true);
    setError(null);
    try {
      const slug = eventName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now();
      // 1. Create event
      const { data: ev, error: evErr } = await supabase.from('events').insert({
        name: eventName,
        slug,
        start_date: startDate || null,
        end_date: endDate || null,
        event_type: 'board_game',
        division_count: 1,
        status: 'setup',
        created_by: user?.id,
      }).select().single();
      if (evErr) throw evErr;

      // 2. Board game config
      const { error: cfgErr } = await supabase.from('board_game_config').insert({
        event_id: ev.id,
        ...bgConfig,
        title_image_url: bgConfig.title_image_url || null,
      });
      if (cfgErr) throw cfgErr;

      // 3. Players
      const playerInserts = bgPlayers.filter(p => p.name.trim()).map((p, i) => ({
        event_id: ev.id,
        name: p.name.trim(),
        avatar_url: p.avatar_url.trim() || null,
        sort_order: i,
      }));
      if (playerInserts.length) {
        const { error: pErr } = await supabase.from('board_players').insert(playerInserts);
        if (pErr) throw pErr;
      }

      // 4. Categories (same table as all-play, event-scoped)
      const catInserts = bgCategories.filter(c => c.name.trim()).map(c => ({
        event_id: ev.id, name: c.name.trim(), multiplier: parseFloat(c.multiplier) || 1,
      }));
      if (catInserts.length) {
        const { error: cErr } = await supabase.from('categories').insert(catInserts);
        if (cErr) throw cErr;
      }

      // 5. Board squares
      const squareInserts = bgSquares.map(s => ({
        event_id: ev.id,
        square_number: s.square_number,
        type: s.type,
        label: s.label || null,
        icon: s.icon || null,
        jump_to: s.jump_to != null ? parseInt(s.jump_to) : null,
        move_amount: s.move_amount != null ? parseInt(s.move_amount) : null,
        badge: s.badge || null,
        description: s.description || null,
        flavor_text: s.flavor_text || null,
      }));
      if (squareInserts.length) {
        const { error: sErr } = await supabase.from('board_squares').insert(squareInserts);
        if (sErr) throw sErr;
      }

      navigate(`/admin/board/${ev.id}`);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  // ── Step 0: event type picker ─────────────────────────────
  if (!eventType) {
    return (
      <>
        <Navbar />
        <div style={{ padding: 40, maxWidth: 600, margin: '0 auto', color: '#fff' }}>
        <h2 style={{ marginBottom: 8 }}>Create New Event</h2>
        <p style={{ opacity: 0.6, marginBottom: 32 }}>What type of event are you running?</p>
        <div style={{ display: 'flex', gap: 20 }}>
          <EventTypeCard
            title="All-Play Tournament"
            icon="🏆"
            description="Round-robin schedule, head-to-head matchups, League Average, playoff brackets."
            onClick={() => { setEventType('all_play'); setStep(0); }}
          />
          <EventTypeCard
            title="Board Game"
            icon="🎲"
            description="252-square board, daily score → moves, gym badges, prize squares, drag-and-drop tile config."
            onClick={() => { setEventType('board_game'); setStep(0); }}
          />
        </div>
      </div>
      </>
    );
  }

  // ── Wizard shell ──────────────────────────────────────────
  const canNext = step < totalSteps - 1;
  const canBack = step > 0;
  const isLast  = step === totalSteps - 1;

  return (
    <>
    <Navbar />
    <div style={{ padding: 24, maxWidth: 860, margin: '0 auto', color: '#fff' }}>
      {/* Progress bar */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', gap: 0, marginBottom: 8 }}>
          {stepLabels.map((label, i) => (
            <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 12, opacity: i === step ? 1 : 0.4, fontWeight: i === step ? 700 : 400, transition: 'all 0.2s' }}>
              {i + 1}. {label}
            </div>
          ))}
        </div>
        <div style={{ height: 4, background: '#2a2a3e', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${((step + 1) / totalSteps) * 100}%`, height: '100%', background: '#c62828', transition: 'width 0.3s' }} />
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 16px', marginBottom: 16, borderRadius: 6, background: '#4a1010', border: '1px solid #c62828' }}>
          {error}
        </div>
      )}

      {/* ── BOARD GAME STEPS ──────────────────────────────── */}
      {eventType === 'board_game' && (
        <>
          {/* BG Step 0: Basic info */}
          {step === 0 && (
            <WizardStep title="Event Information">
              <FormField label="Event Name *" value={eventName} onChange={setEventName} placeholder="PokeNexus Summer Board Game" />
              <FormField label="Start Date" value={startDate} onChange={setStartDate} type="date" />
              <FormField label="End Date" value={endDate} onChange={setEndDate} type="date" />
              <FormField label="Theme Color" value={bgConfig.theme_color} onChange={v => setBgConfig(c => ({ ...c, theme_color: v }))} type="color" />
              <FormField label="Title Image URL (optional)" value={bgConfig.title_image_url} onChange={v => setBgConfig(c => ({ ...c, title_image_url: v }))} placeholder="https://..." />
            </WizardStep>
          )}

          {/* BG Step 1: Players */}
          {step === 1 && (
            <WizardStep title="Players">
              <p style={{ fontSize: 13, opacity: 0.6, marginBottom: 16 }}>
                Add all participants. You can also add players after event creation from the Event Detail page.
              </p>
              {bgPlayers.map((p, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                  <input value={p.name} onChange={e => { const a = [...bgPlayers]; a[i].name = e.target.value; setBgPlayers(a); }}
                    placeholder={`Player ${i + 1} name`}
                    style={{ flex: 2, padding: '7px 10px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13 }} />
                  <input value={p.avatar_url} onChange={e => { const a = [...bgPlayers]; a[i].avatar_url = e.target.value; setBgPlayers(a); }}
                    placeholder="Avatar URL (optional)"
                    style={{ flex: 3, padding: '7px 10px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13 }} />
                  <button onClick={() => setBgPlayers(bgPlayers.filter((_, j) => j !== i))}
                    style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 18 }}>✕</button>
                </div>
              ))}
              <button onClick={() => setBgPlayers([...bgPlayers, { name: '', avatar_url: '' }])}
                style={{ padding: '6px 14px', background: '#2a2a3e', border: '1px solid #444', color: '#fff', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                + Add Player
              </button>
            </WizardStep>
          )}

          {/* BG Step 2: Categories */}
          {step === 2 && (
            <WizardStep title="Encounter Categories">
              <p style={{ fontSize: 13, opacity: 0.6, marginBottom: 16 }}>
                Define each encounter type and its point value. These appear in the score entry dropdowns.
              </p>
              {bgCategories.map((c, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'center' }}>
                  <input value={c.name} onChange={e => { const a = [...bgCategories]; a[i].name = e.target.value; setBgCategories(a); }}
                    placeholder="Category name (e.g. Shiny Legend)"
                    style={{ flex: 3, padding: '7px 10px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13 }} />
                  <input value={c.multiplier} onChange={e => { const a = [...bgCategories]; a[i].multiplier = e.target.value; setBgCategories(a); }}
                    placeholder="Points" type="number" min="0"
                    style={{ flex: 1, padding: '7px 10px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13 }} />
                  <button onClick={() => setBgCategories(bgCategories.filter((_, j) => j !== i))}
                    style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 18 }}>✕</button>
                </div>
              ))}
              <button onClick={() => setBgCategories([...bgCategories, { name: '', multiplier: '' }])}
                style={{ padding: '6px 14px', background: '#2a2a3e', border: '1px solid #444', color: '#fff', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                + Add Category
              </button>
            </WizardStep>
          )}

          {/* BG Step 3: Board Config */}
          {step === 3 && (
            <WizardStep title="Board Configuration">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <FormField label="Track Length" value={bgConfig.track_length} onChange={v => setBgConfig(c => ({ ...c, track_length: parseInt(v) || 252 }))} type="number" />
                <FormField label="Grid Columns" value={bgConfig.grid_columns} onChange={v => setBgConfig(c => ({ ...c, grid_columns: parseInt(v) || 18 }))} type="number" />
                <FormField label="Score Divisor" value={bgConfig.score_divisor} onChange={v => setBgConfig(c => ({ ...c, score_divisor: parseFloat(v) || 2 }))} type="number" />
                <div>
                  <label style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Score Operation</label>
                  <select value={bgConfig.score_operation} onChange={e => setBgConfig(c => ({ ...c, score_operation: e.target.value }))}
                    style={{ width: '100%', padding: '7px 10px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13 }}>
                    <option value="divide">Divide</option>
                    <option value="multiply">Multiply</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Score Rounding</label>
                  <select value={bgConfig.score_rounding} onChange={e => setBgConfig(c => ({ ...c, score_rounding: e.target.value }))}
                    style={{ width: '100%', padding: '7px 10px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13 }}>
                    <option value="ceil">Ceiling (round up)</option>
                    <option value="floor">Floor (round down)</option>
                    <option value="round">Round (nearest)</option>
                  </select>
                </div>
                <FormField label="Min Moves/Day (0 = none)" value={bgConfig.min_moves_per_day} onChange={v => setBgConfig(c => ({ ...c, min_moves_per_day: parseInt(v) || 0 }))} type="number" />
                <FormField label="Max Moves/Day (0 = no cap)" value={bgConfig.max_moves_per_day} onChange={v => setBgConfig(c => ({ ...c, max_moves_per_day: parseInt(v) || 0 }))} type="number" />
              </div>
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <ToggleField label="Badge Bonus Enabled" value={bgConfig.badge_bonus_enabled} onChange={v => setBgConfig(c => ({ ...c, badge_bonus_enabled: v }))} />
                <ToggleField label="Show Badge Sidebar" value={bgConfig.show_badge_sidebar} onChange={v => setBgConfig(c => ({ ...c, show_badge_sidebar: v }))} />
                <ToggleField label="Show Flavor Text" value={bgConfig.show_flavor_text} onChange={v => setBgConfig(c => ({ ...c, show_flavor_text: v }))} />
              </div>
              <div style={{ marginTop: 14, padding: 12, background: '#13131f', borderRadius: 6, fontSize: 13, opacity: 0.7 }}>
                With divisor <strong>{bgConfig.score_divisor}</strong> ({bgConfig.score_operation}), a raw score of <strong>200</strong> → <strong>{
                  bgConfig.score_operation === 'divide'
                    ? (bgConfig.score_rounding === 'ceil' ? Math.ceil(200 / bgConfig.score_divisor) : bgConfig.score_rounding === 'floor' ? Math.floor(200 / bgConfig.score_divisor) : Math.round(200 / bgConfig.score_divisor))
                    : Math.round(200 * bgConfig.score_divisor)
                } moves</strong>
              </div>
            </WizardStep>
          )}

          {/* BG Step 4: Tile Builder */}
          {step === 4 && (
            <WizardStep title="Board Tile Placement">
              <p style={{ fontSize: 13, opacity: 0.6, marginBottom: 12 }}>
                The default Kanto/Johto layout is pre-loaded. Drag tiles to reposition, click to edit, click empty squares to add.
              </p>
              <BoardBuilder
                squares={bgSquares}
                onChange={setBgSquares}
                trackLength={bgConfig.track_length}
                gridColumns={bgConfig.grid_columns}
                themeColor={bgConfig.theme_color}
              />
            </WizardStep>
          )}
        </>
      )}

      {/* ── ALL-PLAY STEPS (original wizard logic) ─────────── */}
      {eventType === 'all_play' && (
        <>
          {step === 0 && (
            <WizardStep title="Event Information">
              <FormField label="Event Name *" value={eventName} onChange={setEventName} placeholder="PokeNexus Summer All-Play" />
              <FormField label="Start Date" value={startDate} onChange={setStartDate} type="date" />
              <FormField label="End Date" value={endDate} onChange={setEndDate} type="date" />
            </WizardStep>
          )}
          {step === 1 && (
            <WizardStep title="Divisions">
              <p style={{ fontSize: 13, opacity: 0.6, marginBottom: 12 }}>How many divisions? (1–4)</p>
              <input type="number" min={1} max={4} value={numDivisions}
                onChange={e => {
                  const n = Math.min(4, Math.max(1, parseInt(e.target.value) || 1));
                  setNumDivisions(n);
                  setDivisions(Array.from({ length: n }, (_, i) => divisions[i] || { name: `Division ${i+1}`, teams: [''] }));
                }}
                style={{ width: 80, padding: '7px 10px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13, marginBottom: 16 }} />
              {divisions.map((div, i) => (
                <div key={i} style={{ marginBottom: 12 }}>
                  <input value={div.name} onChange={e => { const a=[...divisions]; a[i].name=e.target.value; setDivisions(a); }}
                    style={{ padding: '7px 10px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13, marginBottom: 6, width: 220 }}
                    placeholder={`Division ${i+1} name`} />
                </div>
              ))}
            </WizardStep>
          )}
          {step === 2 && (
            <WizardStep title="Teams">
              {divisions.map((div, di) => (
                <div key={di} style={{ marginBottom: 20 }}>
                  <h4 style={{ margin: '0 0 8px 0', color: '#c62828' }}>{div.name}</h4>
                  {div.teams.map((t, ti) => (
                    <div key={ti} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                      <input value={t} onChange={e => { const a=[...divisions]; a[di].teams[ti]=e.target.value; setDivisions(a); }}
                        placeholder={`Team ${ti+1}`}
                        style={{ flex: 1, padding: '7px 10px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13 }} />
                      <button onClick={() => { const a=[...divisions]; a[di].teams=a[di].teams.filter((_,j)=>j!==ti); setDivisions(a); }}
                        style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}>✕</button>
                    </div>
                  ))}
                  <button onClick={() => { const a=[...divisions]; a[di].teams.push(''); setDivisions(a); }}
                    style={{ fontSize: 12, background: 'none', border: '1px solid #444', color: '#aaa', padding: '4px 10px', borderRadius: 6, cursor: 'pointer' }}>+ Team</button>
                </div>
              ))}
            </WizardStep>
          )}
          {step === 3 && (
            <WizardStep title="Encounter Categories">
              {categories.map((c, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                  <input value={c.name} onChange={e => { const a=[...categories]; a[i].name=e.target.value; setCategories(a); }}
                    placeholder="Category name"
                    style={{ flex: 3, padding: '7px 10px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13 }} />
                  <input value={c.multiplier} onChange={e => { const a=[...categories]; a[i].multiplier=e.target.value; setCategories(a); }}
                    placeholder="Points" type="number"
                    style={{ flex: 1, padding: '7px 10px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13 }} />
                  <button onClick={() => setCategories(categories.filter((_,j)=>j!==i))}
                    style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 18 }}>✕</button>
                </div>
              ))}
              <button onClick={() => setCategories([...categories, { name: '', multiplier: '' }])}
                style={{ padding: '6px 14px', background: '#2a2a3e', border: '1px solid #444', color: '#fff', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
                + Add Category
              </button>
            </WizardStep>
          )}
          {step === 4 && (
            <WizardStep title="Bracket Configuration">
              <p style={{ fontSize: 13, opacity: 0.6, marginBottom: 12 }}>
                Configure per-round series format for the playoff bracket. You can set this after creation too.
              </p>
              {[1,2,3,4].map(round => {
                const r = bracketConfig.rounds?.[round-1] || { format: 'single' };
                return (
                  <div key={round} style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10 }}>
                    <label style={{ width: 80, fontSize: 13, opacity: 0.7 }}>Round {round}</label>
                    <select value={r.format}
                      onChange={e => {
                        const rounds = [...(bracketConfig.rounds || [{},{},{},{}])];
                        rounds[round-1] = { ...rounds[round-1], format: e.target.value };
                        setBracketConfig({ rounds });
                      }}
                      style={{ padding: '6px 10px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 13 }}>
                      <option value="single">Single Game</option>
                      <option value="best_of_3">Best of 3</option>
                      <option value="best_of_5">Best of 5</option>
                      <option value="aggregate">Aggregate Score</option>
                    </select>
                  </div>
                );
              })}
            </WizardStep>
          )}
        </>
      )}

      {/* Nav buttons */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28 }}>
        <div>
          <button onClick={() => { if (step === 0) setEventType(null); else setStep(s => s - 1); }}
            style={{ padding: '9px 20px', background: '#2a2a3e', border: '1px solid #444', color: '#fff', borderRadius: 6, cursor: 'pointer' }}>
            ← {step === 0 ? 'Change Type' : 'Back'}
          </button>
        </div>
        <div>
          {canNext && (
            <button onClick={() => setStep(s => s + 1)}
              disabled={step === 0 && !eventName.trim()}
              style={{ padding: '9px 24px', background: '#c62828', border: 'none', color: '#fff', borderRadius: 6, cursor: 'pointer', fontWeight: 700, opacity: (step === 0 && !eventName.trim()) ? 0.4 : 1 }}>
              Next →
            </button>
          )}
          {isLast && (
            <button
              onClick={eventType === 'board_game' ? handleSaveBoardGame : handleSaveAllPlay}
              disabled={saving}
              style={{ padding: '9px 24px', background: '#2e7d32', border: 'none', color: '#fff', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}>
              {saving ? 'Creating...' : '✅ Create Event'}
            </button>
          )}
        </div>
      </div>
    </div>
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────
function WizardStep({ title, children }) {
  return (
    <div>
      <h3 style={{ margin: '0 0 20px 0', fontSize: 18 }}>{title}</h3>
      {children}
    </div>
  );
}

function FormField({ label, value, onChange, type = 'text', placeholder = '', disabled = false }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 }}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} disabled={disabled}
        style={{ width: '100%', padding: '8px 12px', background: '#13131f', border: '1px solid #444', color: '#fff', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }} />
    </div>
  );
}

function ToggleField({ label, value, onChange }) {
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

function EventTypeCard({ title, icon, description, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <div onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        flex: 1, padding: 24, background: hover ? '#1e1e2e' : '#13131f',
        border: hover ? '2px solid #c62828' : '2px solid #2a2a3e',
        borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s',
      }}>
      <div style={{ fontSize: 36, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13, opacity: 0.65, lineHeight: 1.5 }}>{description}</div>
    </div>
  );
}
