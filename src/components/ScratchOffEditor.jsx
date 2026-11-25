// src/components/ScratchOffEditor.jsx
// Event-runner setup for scratch-off tickets (Slots → Edit Config → Scratch-Offs tab).

import { useState, useEffect, useCallback } from 'react';
import {
  SCRATCH_SYMBOLS, SCRATCH_SYMBOL_LABELS, SCRATCH_SYMBOL_IMAGES, MAX_SCRATCH_TIERS,
  defaultTierIcon, computeOdds, formatOneIn, validateScratchGame,
  fetchScratchGames, saveScratchGame, setScratchGameActive, deleteScratchGame,
} from '../lib/scratchoff';
import { supabase } from '../lib/supabase';

const TIER_NAMES = ['Grand Prize', '2nd Prize', '3rd Prize', '4th Prize', '5th Prize', '6th Prize', '7th Prize', '8th Prize', '9th Prize'];

function blankDraft() {
  return {
    id: null,
    label: 'Scratch & Win',
    description: '',
    cost_cpc: '',
    total_tickets: '',
    max_per_player: '',
    is_active: true,
    sell_in_store: true,
    award_category_id: '',
    tiers: [
      { prize_label: '', prize_count: 1, icon: 'masterball', icon_url: '', iconAuto: true },
      { prize_label: '', prize_count: '', icon: 'berry', icon_url: '', iconAuto: true },
    ],
  };
}

// Re-apply default icons to any tier the runner hasn't picked an icon for by hand
function reflowIcons(tiers) {
  return tiers.map((t, i) => (t.iconAuto ? { ...t, icon: defaultTierIcon(i, tiers.length) } : t));
}

function TierIcon({ tier, size = 28 }) {
  const src = tier.icon_url?.trim() || SCRATCH_SYMBOL_IMAGES[tier.icon];
  return <img src={src} alt={tier.icon} style={{ width: size, height: size, objectFit: 'contain', flex: 'none' }}
    onError={e => { e.currentTarget.style.opacity = 0.2; }} onLoad={e => { e.currentTarget.style.opacity = 1; }} />;
}

export default function ScratchOffEditor({ eventId, theme, storeItems = [] }) {
  const [games, setGames] = useState([]);
  const [soldByGame, setSoldByGame] = useState({});
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(null);       // null = not editing
  const [draftSold, setDraftSold] = useState(0);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [categories, setCategories] = useState([]);

  const flash = (text, isError = false) => { setMsg({ text, isError }); setTimeout(() => setMsg(null), 5000); };

  const load = useCallback(async () => {
    try {
      const list = await fetchScratchGames(eventId);
      setGames(list);
      const sold = {};
      for (const g of list) sold[g.id] = g.total_tickets - g.tickets_remaining;
      setSoldByGame(sold);
    } catch (e) {
      flash('Error loading scratch-offs: ' + e.message, true);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  // Scoring categories, for "award a ticket when this category is scored"
  useEffect(() => {
    supabase.from('slots_categories').select('id, label, is_active').eq('event_id', eventId).order('sort_order')
      .then(({ data }) => setCategories(data ?? []));
  }, [eventId]);
  const categoryLabel = (id) => categories.find(c => c.id === id)?.label ?? 'a removed category';

  const topStoreItem = [...storeItems].filter(i => i.is_active !== false && !i.pays_out_slot_tokens).sort((a, b) => b.cost_cpc - a.cost_cpc)[0];

  const startNew = () => { setDraft(blankDraft()); setDraftSold(0); };

  const startEdit = async (g) => {
    // Fresh sold count from the DB so the lock state is right even if the page is stale
    const { count } = await supabase.from('slots_scratch_tickets').select('id', { count: 'exact', head: true }).eq('game_id', g.id);
    setDraftSold(count ?? 0);
    setDraft({
      id: g.id,
      label: g.label,
      description: g.description || '',
      cost_cpc: g.cost_cpc,
      total_tickets: g.total_tickets,
      max_per_player: g.max_per_player ?? '',
      is_active: g.is_active,
      sell_in_store: g.sell_in_store !== false,
      award_category_id: g.award_category_id || '',
      tiers: g.tiers.map((t, i) => ({
        id: t.id,
        prize_label: t.prize_label,
        prize_count: t.prize_count,
        icon: t.icon,
        icon_url: t.icon_url || '',
        iconAuto: !t.icon_url && t.icon === defaultTierIcon(i, g.tiers.length),
      })),
    });
  };

  const locked = draft?.id && draftSold > 0;

  const setField = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const setTier = (i, patch) => setDraft(d => ({ ...d, tiers: d.tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) }));
  const addTier = () => setDraft(d => ({ ...d, tiers: reflowIcons([...d.tiers, { prize_label: '', prize_count: '', icon: 'berry', icon_url: '', iconAuto: true }]) }));
  const removeTier = (i) => setDraft(d => ({ ...d, tiers: reflowIcons(d.tiers.filter((_, j) => j !== i)) }));
  const moveTier = (i, dir) => setDraft(d => {
    const tiers = [...d.tiers];
    const j = i + dir;
    if (j < 0 || j >= tiers.length) return d;
    [tiers[i], tiers[j]] = [tiers[j], tiers[i]];
    return { ...d, tiers: reflowIcons(tiers) };
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await saveScratchGame(eventId, draft);
      flash(res?.locked ? 'Saved. Tickets were already given out, so the pool and odds were left as they were; names, icons, limits, distribution and on/off were updated.' : 'Scratch-off saved.');
      setDraft(null);
      await load();
    } catch (e) {
      flash('Error: ' + e.message, true);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (g) => {
    try { await setScratchGameActive(g.id, !g.is_active); await load(); }
    catch (e) { flash('Error: ' + e.message, true); }
  };

  const handleDelete = async (g) => {
    const sold = soldByGame[g.id] ?? 0;
    const warning = sold > 0
      ? `Delete "${g.label}"? ${sold} ticket(s) have been given out. Their records will be removed (prizes already on the Prize Board stay). This cannot be undone.`
      : `Delete "${g.label}"? This cannot be undone.`;
    if (!window.confirm(warning)) return;
    try { await deleteScratchGame(g.id); flash('Scratch-off deleted.'); await load(); }
    catch (e) { flash('Error: ' + e.message, true); }
  };

  if (loading) return <div style={{ color: '#666', padding: 20 }}>Loading...</div>;

  // ── Editor view ──
  if (draft) {
    const odds = computeOdds(draft.total_tickets, draft.tiers);
    const validation = validateScratchGame(draft);
    const revenue = (Number(draft.cost_cpc) || 0) * (Number(draft.total_tickets) || 0);

    return (
      <div>
        {msg && <Flash msg={msg} />}
        <div style={st.card}>
          <div style={st.cardTitle}>{draft.id ? 'Edit Scratch-Off' : 'New Scratch-Off'}</div>
          {locked && (
            <div style={st.lockNote}>
              🔒 {draftSold} ticket{draftSold === 1 ? '' : 's'} already given out. Price, ticket count and prize counts are locked so the odds players got can't change. You can still rename things, swap icons, change the per-player limit, change how tickets are handed out, or turn the game on/off.
            </div>
          )}

          <div style={st.grid2}>
            <L label="Ticket name"><input value={draft.label} onChange={e => setField('label', e.target.value)} style={st.input} /></L>
            <L label={draft.sell_in_store ? 'Price (CPC per ticket)' : 'Price (not sold in store)'}><input type="number" min="0" disabled={(locked && Number(draft.cost_cpc) > 0) || !draft.sell_in_store} value={draft.sell_in_store ? draft.cost_cpc : ''} placeholder={draft.sell_in_store ? '' : '—'} onChange={e => setField('cost_cpc', e.target.value)} style={st.input} /></L>
            <L label="Total tickets in the pool"><input type="number" min="1" disabled={locked} value={draft.total_tickets} onChange={e => setField('total_tickets', e.target.value)} style={st.input} /></L>
            <L label="Max per player (blank = unlimited)"><input type="number" min="1" value={draft.max_per_player} onChange={e => setField('max_per_player', e.target.value)} style={st.input} /></L>
          </div>
          <L label="Description (optional)"><input value={draft.description} onChange={e => setField('description', e.target.value)} style={st.input} placeholder="e.g. Match 3 to win! Grand prize: Shiny Legend of your choice" /></L>
          <div style={st.howBox}>
            <div style={{ fontSize: 12, color: '#888', fontWeight: 600, marginBottom: 8 }}>How players get tickets</div>
            <label style={st.check}>
              <input type="checkbox" checked={draft.sell_in_store} onChange={e => setField('sell_in_store', e.target.checked)} />
              Sold in the Store for CPC
            </label>
            <label style={{ ...st.check, alignItems: 'flex-start' }}>
              <input type="checkbox" checked={!!draft.award_category_id}
                onChange={e => setField('award_category_id', e.target.checked ? (categories.find(c => c.is_active !== false)?.id ?? '') : '')}
                style={{ marginTop: 3 }} />
              <span style={{ flex: 1 }}>
                Free ticket when a scoring category is scored
                {!!draft.award_category_id && (
                  <select value={draft.award_category_id} onChange={e => setField('award_category_id', e.target.value)} style={{ ...st.select, display: 'block', marginTop: 6, width: '100%' }}>
                    {categories.map(c => <option key={c.id} value={c.id} style={st.option}>{c.label}{c.is_active === false ? ' (inactive)' : ''}</option>)}
                  </select>
                )}
                {!!draft.award_category_id && (
                  <span style={{ display: 'block', fontSize: 11, color: '#777', marginTop: 6 }}>
                    When a day is committed, each player who scored this category gets 1 ticket per count, up to the per-player max.
                    Tip: for a once-per-person quest set <b>Max per player</b> to 1 and <b>Total tickets</b> to the number of people who could finish it.
                    If the pool runs out, later finishers get nothing; if not everyone finishes, unclaimed tickets (and any prize on them) stay unclaimed.
                  </span>
                )}
                {categories.length === 0 && <span style={{ display: 'block', fontSize: 11, color: '#f0a020', marginTop: 4 }}>This event has no scoring categories yet.</span>}
              </span>
            </label>
            <label style={{ ...st.check, marginBottom: 0 }}>
              <input type="checkbox" checked={draft.is_active} onChange={e => setField('is_active', e.target.checked)} />
              Active (switch off to stop selling and awarding)
            </label>
          </div>

          <div style={{ ...st.cardTitle, fontSize: 13, marginTop: 8 }}>Prize tiers <span style={{ fontWeight: 400, color: '#666' }}>— top row is the grand prize</span></div>
          {topStoreItem && (
            <div style={{ fontSize: 11, color: '#666', marginBottom: 10 }}>
              For scale: your most expensive store prize is <span style={{ color: '#ccc' }}>{topStoreItem.label}</span> at <span style={{ color: '#d4af37' }}>{topStoreItem.cost_cpc.toLocaleString()} CPC</span>.
            </div>
          )}

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['', 'Tier', 'Icon', 'Prize (what the winner gets)', '# of prizes', 'Odds', ''].map((h, i) => <th key={i} style={st.th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {draft.tiers.map((t, i) => {
                  const tOdds = odds.tiers[i]?.oneIn ?? null;
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid #1a1a1a' }}>
                      <td style={{ ...st.td, width: 40, whiteSpace: 'nowrap' }}>
                        {!locked && (
                          <>
                            <button onClick={() => moveTier(i, -1)} disabled={i === 0} style={st.arrow} title="Move up">▲</button>
                            <button onClick={() => moveTier(i, 1)} disabled={i === draft.tiers.length - 1} style={st.arrow} title="Move down">▼</button>
                          </>
                        )}
                      </td>
                      <td style={{ ...st.td, color: i === 0 ? '#FFD700' : '#aaa', fontWeight: i === 0 ? 700 : 500, whiteSpace: 'nowrap' }}>{TIER_NAMES[i]}</td>
                      <td style={{ ...st.td, minWidth: 220 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <TierIcon tier={t} />
                          <select value={t.icon} onChange={e => setTier(i, { icon: e.target.value, iconAuto: false })} style={st.select}>
                            {SCRATCH_SYMBOLS.map(sym => <option key={sym} value={sym} style={st.option}>{SCRATCH_SYMBOL_LABELS[sym]}</option>)}
                          </select>
                        </div>
                        <input value={t.icon_url} onChange={e => setTier(i, { icon_url: e.target.value, iconAuto: false })}
                          placeholder="Custom image URL (optional)" style={{ ...st.input, marginTop: 4, fontSize: 11, padding: '5px 8px' }} />
                      </td>
                      <td style={{ ...st.td, minWidth: 200 }}>
                        <input value={t.prize_label} onChange={e => setTier(i, { prize_label: e.target.value })}
                          placeholder={i === 0 ? 'e.g. Shiny Legend of choice' : i === draft.tiers.length - 1 ? 'e.g. 250k in-game cash' : 'e.g. Masterball'} style={st.input} />
                      </td>
                      <td style={{ ...st.td, width: 90 }}>
                        <input type="number" min="1" disabled={locked} value={t.prize_count} onChange={e => setTier(i, { prize_count: e.target.value })} style={{ ...st.input, textAlign: 'right' }} />
                      </td>
                      <td style={{ ...st.td, color: '#90CAF9', whiteSpace: 'nowrap' }}>{formatOneIn(tOdds)}</td>
                      <td style={{ ...st.td, width: 30 }}>
                        {!locked && draft.tiers.length > 1 && (
                          <button onClick={() => removeTier(i)} style={st.xBtn} title="Remove tier">✕</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!locked && draft.tiers.length < MAX_SCRATCH_TIERS && (
            <button onClick={addTier} style={{ ...st.ghostBtn, marginTop: 10 }}>+ Add lower tier</button>
          )}

          {/* Odds summary, the "back of the ticket" */}
          <div style={st.oddsBox}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
              <Stat label="Overall odds of winning" value={formatOneIn(odds.overall)} color="#4CAF50" />
              <Stat label="Winning tickets" value={odds.totalPrizes.toLocaleString()} />
              <Stat label="Losing tickets" value={Number.isFinite(odds.losers) && odds.losers >= 0 ? odds.losers.toLocaleString() : '—'} />
              {draft.sell_in_store && <Stat label="CPC taken in if all sell" value={revenue ? `${revenue.toLocaleString()} CPC` : '—'} color="#d4af37" />}
            </div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 10 }}>
              Odds are exact: the pool works like a printed roll of scratchers. Every ticket drawn comes out of what's left, so all {odds.totalPrizes} prizes are guaranteed to be in the pool until someone wins them.
            </div>
          </div>

          {validation && <div style={{ color: '#f0a020', fontSize: 12, marginTop: 12 }}>⚠ {validation}</div>}

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button onClick={handleSave} disabled={saving || !!validation}
              style={{ ...st.primaryBtn, background: theme, opacity: (saving || validation) ? 0.5 : 1, cursor: (saving || validation) ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Saving...' : draft.id ? 'Save Changes' : 'Create Scratch-Off'}
            </button>
            <button onClick={() => setDraft(null)} style={st.ghostBtn}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  // ── List view ──
  return (
    <div>
      {msg && <Flash msg={msg} />}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontSize: 13, opacity: 0.6 }}>{games.length} scratch-off{games.length === 1 ? '' : 's'}</span>
        <button onClick={startNew} style={{ ...st.primaryBtn, background: theme }}>+ New Scratch-Off</button>
      </div>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 16 }}>
        Scratch-off tickets show up at the top of the public Store tab. Players buy them with CPC and/or earn them by scoring a category you pick, scratch the 9 boxes, and win if 3 match. Wins go straight to the Prize Board to be fulfilled.
      </div>

      {games.length === 0 && <div style={{ color: '#555', fontSize: 13, padding: '16px 0' }}>No scratch-offs yet.</div>}

      {games.map(g => {
        const sold = soldByGame[g.id] ?? 0;
        const odds = computeOdds(g.total_tickets, g.tiers);
        return (
          <div key={g.id} style={{ ...st.card, opacity: g.is_active ? 1 : 0.55 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#fff' }}>🎫 {g.label}</div>
                {g.description && <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{g.description}</div>}
                <div style={{ fontSize: 12, color: '#aaa', marginTop: 6, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {g.sell_in_store !== false && <span style={{ color: '#d4af37' }}>{g.cost_cpc.toLocaleString()} CPC</span>}
                  {g.award_category_id && <span style={{ color: '#ce93d8' }}>🎁 Earned: {categoryLabel(g.award_category_id)}</span>}
                  <span>{sold.toLocaleString()} / {g.total_tickets.toLocaleString()} given out</span>
                  <span style={{ color: '#4CAF50' }}>Overall {formatOneIn(odds.overall)}</span>
                  {g.max_per_player && <span style={{ color: '#90CAF9' }}>Max {g.max_per_player}/player</span>}
                  <span style={{ color: g.is_active ? '#4ade80' : '#888' }}>{g.is_active ? 'Active' : 'Off'}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => startEdit(g)} style={{ ...st.ghostBtn, color: '#90CAF9' }}>Edit</button>
                <button onClick={() => handleToggle(g)} style={st.ghostBtn}>{g.is_active ? 'Switch off' : 'Switch on'}</button>
                <button onClick={() => handleDelete(g)} style={{ ...st.ghostBtn, color: '#ef5350', borderColor: '#4a1010' }}>Delete</button>
              </div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 12 }}>
              <thead><tr>{['Tier', 'Icon', 'Prize', 'Won / Total', 'Odds'].map(h => <th key={h} style={st.th}>{h}</th>)}</tr></thead>
              <tbody>
                {g.tiers.map((t, i) => (
                  <tr key={t.id}>
                    <td style={{ ...st.td, color: i === 0 ? '#FFD700' : '#aaa' }}>{TIER_NAMES[i]}</td>
                    <td style={st.td}><TierIcon tier={t} size={22} /></td>
                    <td style={{ ...st.td, color: '#ddd' }}>{t.prize_label}</td>
                    <td style={st.td}>{(t.prize_count - t.prizes_remaining).toLocaleString()} / {t.prize_count.toLocaleString()}</td>
                    <td style={{ ...st.td, color: '#90CAF9' }}>{formatOneIn(odds.tiers[i]?.oneIn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function L({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 12, color: '#888', marginBottom: 5, fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  );
}

function Stat({ label, value, color = '#fff' }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#777' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}

function Flash({ msg }) {
  return (
    <div style={{ padding: '10px 16px', borderRadius: 8, border: `1px solid ${msg.isError ? '#f44' : '#4caf50'}`, color: msg.isError ? '#f44' : '#4caf50', marginBottom: 16, fontSize: 13, fontWeight: 600 }}>
      {msg.text}
    </div>
  );
}

const st = {
  card: { background: '#111', border: '1px solid #1f1f2a', borderRadius: 10, padding: '16px 18px', marginBottom: 16 },
  cardTitle: { fontWeight: 700, fontSize: 14, marginBottom: 14, color: '#ccc' },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0 14px' },
  input: { background: '#0d0d14', border: '1px solid #2a2a3a', borderRadius: 6, color: '#e0e0e0', padding: '8px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box' },
  // Native select/option ignore CSS variables — explicit hex only
  select: { background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, color: '#fff', padding: '6px 8px', fontSize: 12, flex: 1 },
  option: { background: '#1a1a1a', color: '#fff' },
  th: { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #222', color: '#666', fontWeight: 600, fontSize: 11 },
  td: { padding: '6px 8px', verticalAlign: 'middle' },
  arrow: { background: 'none', border: 'none', color: '#777', cursor: 'pointer', fontSize: 10, padding: '0 2px' },
  xBtn: { background: 'none', border: '1px solid #4a1010', color: '#ef5350', borderRadius: 4, padding: '2px 7px', fontSize: 11, cursor: 'pointer' },
  ghostBtn: { background: 'none', border: '1px solid #333', color: '#aaa', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' },
  primaryBtn: { border: 'none', color: '#fff', borderRadius: 6, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  oddsBox: { background: '#0b1a0f', border: '1px solid #1d3a24', borderRadius: 8, padding: '12px 16px', marginTop: 16 },
  howBox: { background: '#0d0d14', border: '1px solid #22223a', borderRadius: 8, padding: '12px 14px', margin: '4px 0 16px' },
  check: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#ccc', marginBottom: 10, cursor: 'pointer' },
  lockNote: { background: '#2a2208', border: '1px solid #5a4a10', color: '#e8c860', borderRadius: 6, padding: '10px 12px', fontSize: 12, marginBottom: 14 },
};
