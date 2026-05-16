// ============================================================
// BINGO CREATION WIZARD
// Add this to CreateEventPage.jsx as a new event_type branch.
// The existing Step 0 type picker should add:
//   { id: 'bingo_solo', label: 'Solo Bingo', icon: '🎲' }
//   { id: 'bingo_team', label: 'Team Bingo', icon: '🤝' }
// Both route into the BingoWizard below with eventType prop.
// ============================================================

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

// Default 25 squares for a new event
function buildDefaultSquares(hasFreeSpace) {
  return Array.from({ length: 25 }, (_, i) => ({
    position: i,
    label: i === 12 && hasFreeSpace ? 'FREE' : `Square ${i + 1}`,
    description: '',
    point_value: 10,
    is_free_space: i === 12 && hasFreeSpace,
  }));
}

export function BingoWizard({ eventType }) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isTeam = eventType === 'bingo_team';

  const [step, setStep] = useState(1);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  // Step 1: Basic info
  const [name, setName] = useState('');
  const [gameTitle, setGameTitle] = useState('');
  const [gameSubtitle, setGameSubtitle] = useState('');
  const [titleImageUrl, setTitleImageUrl] = useState('');
  const [themeColor, setThemeColor] = useState('#c62828');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [freeSpaceEnabled, setFreeSpaceEnabled] = useState(true);
  const [discordWebhook, setDiscordWebhook] = useState('');

  // Step 2: Scoring config
  const [scoreDivisor, setScoreDivisor] = useState(1);
  const [scoreOperation, setScoreOperation] = useState('divide');
  const [scoreRoundingMode, setScoreRoundingMode] = useState('ceil');

  // Step 3: Bingo line values
  const [lineValues, setLineValues] = useState({
    row1_value: 0, row2_value: 0, row3_value: 0, row4_value: 0, row5_value: 0,
    col1_value: 0, col2_value: 0, col3_value: 0, col4_value: 0, col5_value: 0,
    diag1_value: 0, diag2_value: 0,
  });

  const setLineVal = (key, val) => setLineValues(prev => ({ ...prev, [key]: Number(val) }));

  const TOTAL_STEPS = 3;

  const handleCreate = async () => {
    if (!name.trim()) return setError('Event name is required.');
    setCreating(true);
    setError(null);

    try {
      // 1. Create the event row
      const { data: event, error: evErr } = await supabase
        .from('events')
        .insert({
          name: name.trim(),
          event_type: isTeam ? 'bingo_team' : 'bingo_solo',
          status: 'active',
          created_by: profile?.id,
          start_date: startDate || null,
          end_date: endDate || null,
        })
        .select()
        .single();
      if (evErr) throw evErr;

      // 2. Create bingo_config
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

      // 3. Create default 25 squares
      const squares = buildDefaultSquares(freeSpaceEnabled).map(s => ({
        ...s,
        event_id: event.id,
      }));
      const { error: sqErr } = await supabase.from('bingo_squares').insert(squares);
      if (sqErr) throw sqErr;

      navigate(`/admin/bingo/${event.id}/edit`);
    } catch (e) {
      setError(e.message);
      setCreating(false);
    }
  };

  const inputStyle = {
    background: 'var(--surface-raised)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    borderRadius: 6,
    padding: '9px 12px',
    fontSize: 14,
    width: '100%',
    maxWidth: 400,
  };

  const labelStyle = { display: 'block', fontSize: 12, color: 'var(--text-dim)', marginBottom: 5, marginTop: 14 };

  return (
    <div style={{ maxWidth: 540, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 28 }}>
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <div key={i} style={{
            flex: 1, height: 4, borderRadius: 2,
            background: i + 1 <= step ? themeColor : 'var(--border)',
            transition: 'background 0.2s',
          }} />
        ))}
      </div>

      {error && <div style={{ background: '#ef444422', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>{error}</div>}

      {step === 1 && (
        <div>
          <h2 style={{ margin: '0 0 20px', fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>Basic Info</h2>
          <label style={labelStyle}>Internal Event Name *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Christmas Bingo 2026" style={inputStyle} />

          <label style={labelStyle}>Display Title</label>
          <input value={gameTitle} onChange={e => setGameTitle(e.target.value)} placeholder="Shown on the public board" style={inputStyle} />

          <label style={labelStyle}>Subtitle (optional)</label>
          <input value={gameSubtitle} onChange={e => setGameSubtitle(e.target.value)} style={inputStyle} />

          <label style={labelStyle}>Title Image URL (optional)</label>
          <input value={titleImageUrl} onChange={e => setTitleImageUrl(e.target.value)} placeholder="https://..." style={inputStyle} />

          <label style={labelStyle}>Theme Color</label>
          <input type="color" value={themeColor} onChange={e => setThemeColor(e.target.value)} style={{ width: 48, height: 36, border: 'none', background: 'none', cursor: 'pointer' }} />

          <label style={labelStyle}>Start Date</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ ...inputStyle, maxWidth: 200 }} />

          <label style={labelStyle}>End Date</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ ...inputStyle, maxWidth: 200 }} />

          <label style={{ ...labelStyle, marginTop: 20 }}>
            <input type="checkbox" checked={freeSpaceEnabled} onChange={e => setFreeSpaceEnabled(e.target.checked)} style={{ marginRight: 8 }} />
            Free Space in center (position 13)
          </label>

          <label style={labelStyle}>Discord Webhook URL (optional)</label>
          <input value={discordWebhook} onChange={e => setDiscordWebhook(e.target.value)} placeholder="https://discord.com/api/webhooks/..." style={inputStyle} />
        </div>
      )}

      {step === 2 && (
        <div>
          <h2 style={{ margin: '0 0 20px', fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>Scoring</h2>
          <label style={labelStyle}>Score Divisor</label>
          <input type="number" min={1} value={scoreDivisor} onChange={e => setScoreDivisor(Number(e.target.value))} style={{ ...inputStyle, maxWidth: 120 }} />

          <label style={labelStyle}>Score Operation</label>
          <select value={scoreOperation} onChange={e => setScoreOperation(e.target.value)}
            style={{ ...inputStyle, maxWidth: 180 }}>
            <option value="divide">Divide</option>
            <option value="multiply">Multiply</option>
          </select>

          <label style={labelStyle}>Rounding Mode</label>
          <select value={scoreRoundingMode} onChange={e => setScoreRoundingMode(e.target.value)}
            style={{ ...inputStyle, maxWidth: 180 }}>
            <option value="ceil">Ceiling</option>
            <option value="floor">Floor</option>
            <option value="round">Round</option>
          </select>
        </div>
      )}

      {step === 3 && (
        <div>
          <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>Bingo Line Values</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 20 }}>
            Set bonus point values for completing each row, column, and diagonal. Set to 0 for no bonus.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>Rows (top → bottom)</div>
              {[1,2,3,4,5].map(i => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <label style={{ fontSize: 13, color: 'var(--text-dim)', width: 50 }}>Row {i}</label>
                  <input type="number" min={0} value={lineValues[`row${i}_value`]}
                    onChange={e => setLineVal(`row${i}_value`, e.target.value)}
                    style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 10px', fontSize: 13, width: 90 }} />
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>Columns (left → right)</div>
              {[1,2,3,4,5].map(i => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <label style={{ fontSize: 13, color: 'var(--text-dim)', width: 60 }}>Col {i}</label>
                  <input type="number" min={0} value={lineValues[`col${i}_value`]}
                    onChange={e => setLineVal(`col${i}_value`, e.target.value)}
                    style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 10px', fontSize: 13, width: 90 }} />
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 16, display: 'flex', gap: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <label style={{ fontSize: 13, color: 'var(--text-dim)', width: 90 }}>Diag ↘</label>
              <input type="number" min={0} value={lineValues.diag1_value}
                onChange={e => setLineVal('diag1_value', e.target.value)}
                style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 10px', fontSize: 13, width: 90 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <label style={{ fontSize: 13, color: 'var(--text-dim)', width: 90 }}>Diag ↙</label>
              <input type="number" min={0} value={lineValues.diag2_value}
                onChange={e => setLineVal('diag2_value', e.target.value)}
                style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '6px 10px', fontSize: 13, width: 90 }} />
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div style={{ display: 'flex', gap: 12, marginTop: 32 }}>
        {step > 1 && (
          <button onClick={() => setStep(s => s - 1)}
            style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-dim)', borderRadius: 8, padding: '10px 20px', fontSize: 14, cursor: 'pointer' }}>
            Back
          </button>
        )}
        {step < TOTAL_STEPS && (
          <button onClick={() => setStep(s => s + 1)}
            style={{ background: themeColor, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            Next
          </button>
        )}
        {step === TOTAL_STEPS && (
          <button onClick={handleCreate} disabled={creating}
            style={{ background: themeColor, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontSize: 14, fontWeight: 700, cursor: creating ? 'not-allowed' : 'pointer' }}>
            {creating ? 'Creating...' : 'Create Event →'}
          </button>
        )}
      </div>
    </div>
  );
}
