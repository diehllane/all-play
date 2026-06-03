import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { awardTokens, exportSlotsXLSX } from '../../lib/slots';
import { exportSlotsXLSX as doExport } from '../../lib/slotsExport';

export default function SlotsEventDetailPage() {
  const { eventId } = useParams();
  const { user, profile } = useAuth();

  const [event, setEvent] = useState(null);
  const [config, setConfig] = useState(null);
  const [players, setPlayers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [commits, setCommits] = useState([]);
  const [storeItems, setStoreItems] = useState([]);
  const [prizeBoard, setPrizeBoard] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Player management
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerAvatar, setNewPlayerAvatar] = useState('');
  const [newPlayerColor, setNewPlayerColor] = useState('#c62828');
  const [playerMsg, setPlayerMsg] = useState('');

  // Category management
  const [newCatLabel, setNewCatLabel] = useState('');
  const [newCatPts, setNewCatPts] = useState('');
  const [catMsg, setCatMsg] = useState('');

  // Token award
  const [awardPlayerId, setAwardPlayerId] = useState('');
  const [awardAmount, setAwardAmount] = useState('');
  const [awardReason, setAwardReason] = useState('');
  const [awardMsg, setAwardMsg] = useState('');
  const [awardLoading, setAwardLoading] = useState(false);

  // Store management
  const [newItemLabel, setNewItemLabel] = useState('');
  const [newItemDesc, setNewItemDesc] = useState('');
  const [newItemCost, setNewItemCost] = useState('');
  const [newItemQty, setNewItemQty] = useState('');
  const [newItemTokens, setNewItemTokens] = useState('');
  const [storeMsg, setStoreMsg] = useState('');

  const [activeSection, setActiveSection] = useState('overview');
  const [exporting, setExporting] = useState(false);

  const canManage = profile?.role === 'event_runner' || profile?.role === 'owner';

  const loadAll = useCallback(async () => {
    try {
      const [evRes, cfgRes, playersRes, catsRes, commitsRes, storeRes, prizesRes, auditRes] = await Promise.all([
        supabase.from('events').select('*').eq('id', eventId).single(),
        supabase.from('slots_config').select('*').eq('event_id', eventId).single(),
        supabase.from('slots_players').select('*').eq('event_id', eventId).order('display_name'),
        supabase.from('slots_categories').select('*').eq('event_id', eventId).order('sort_order'),
        supabase.from('slots_commits').select('*').eq('event_id', eventId).order('day_number', { ascending: false }),
        supabase.from('slots_store_items').select('*').eq('event_id', eventId).order('cost_cpc'),
        supabase.from('slots_prize_board').select(`*, slots_players(display_name), slots_store_items(label)`).eq('event_id', eventId).order('purchased_at', { ascending: false }),
        supabase.from('slots_audit_log').select('*, profiles(email)').eq('event_id', eventId).order('created_at', { ascending: false }).limit(50),
      ]);
      if (evRes.error) throw evRes.error;
      setEvent(evRes.data);
      setConfig(cfgRes.data);
      setPlayers(playersRes.data || []);
      setCategories(catsRes.data || []);
      setCommits(commitsRes.data || []);
      setStoreItems(storeRes.data || []);
      setPrizeBoard(prizesRes.data || []);
      setAuditLog(auditRes.data || []);
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

  const theme = config?.theme_color || '#c62828';

  // ─── Handlers ─────────────────────────────────────────────────
  const addPlayer = async () => {
    if (!newPlayerName.trim()) return;
    const { error: e } = await supabase.from('slots_players').insert({
      event_id: eventId,
      display_name: newPlayerName.trim(),
      avatar_url: newPlayerAvatar.trim() || null,
      color: newPlayerColor || null,
      slot_tokens: 0, casino_prize_coins: 0,
      total_tokens_spent: 0, total_cpc_won: 0, total_spins: 0, jackpots_hit: 0,
    });
    if (e) { setPlayerMsg('Error: ' + e.message); return; }
    setNewPlayerName(''); setNewPlayerAvatar('');
    setPlayerMsg('Player added.'); loadAll();
    setTimeout(() => setPlayerMsg(''), 3000);
  };

  const removePlayer = async (id) => {
    if (!confirm('Remove this player? Their spin history will be deleted.')) return;
    await supabase.from('slots_players').delete().eq('id', id);
    loadAll();
  };

  const addCategory = async () => {
    if (!newCatLabel.trim() || !newCatPts) return;
    const { error: e } = await supabase.from('slots_categories').insert({
      event_id: eventId,
      label: newCatLabel.trim(),
      point_value: parseFloat(newCatPts),
      sort_order: categories.length,
      is_active: true,
    });
    if (e) { setCatMsg('Error: ' + e.message); return; }
    setNewCatLabel(''); setNewCatPts('');
    setCatMsg('Category added.'); loadAll();
    setTimeout(() => setCatMsg(''), 3000);
  };

  const toggleCategory = async (cat) => {
    await supabase.from('slots_categories').update({ is_active: !cat.is_active }).eq('id', cat.id);
    loadAll();
  };

  const handleAwardTokens = async () => {
    if (!awardPlayerId || !awardAmount) return;
    setAwardLoading(true);
    try {
      await awardTokens(eventId, awardPlayerId, parseInt(awardAmount), awardReason || 'Manual award', user.id);
      setAwardMsg('Tokens awarded!');
      setAwardPlayerId(''); setAwardAmount(''); setAwardReason('');
      loadAll();
    } catch (e) {
      setAwardMsg('Error: ' + e.message);
    } finally {
      setAwardLoading(false);
      setTimeout(() => setAwardMsg(''), 4000);
    }
  };

  const addStoreItem = async () => {
    if (!newItemLabel.trim() || !newItemCost) return;
    const { error: e } = await supabase.from('slots_store_items').insert({
      event_id: eventId,
      label: newItemLabel.trim(),
      description: newItemDesc.trim() || null,
      cost_cpc: parseInt(newItemCost),
      quantity: newItemQty ? parseInt(newItemQty) : null,
      quantity_remaining: newItemQty ? parseInt(newItemQty) : null,
      pays_out_slot_tokens: newItemTokens ? parseInt(newItemTokens) : null,
      is_active: true,
    });
    if (e) { setStoreMsg('Error: ' + e.message); return; }
    setNewItemLabel(''); setNewItemDesc(''); setNewItemCost(''); setNewItemQty(''); setNewItemTokens('');
    setStoreMsg('Item added.'); loadAll();
    setTimeout(() => setStoreMsg(''), 3000);
  };

  const toggleStoreItem = async (item) => {
    await supabase.from('slots_store_items').update({ is_active: !item.is_active }).eq('id', item.id);
    loadAll();
  };

  const markPrizePaid = async (entry, paid) => {
    await supabase.from('slots_prize_board').update({ paid, paid_at: paid ? new Date().toISOString() : null, paid_by: paid ? user.id : null }).eq('id', entry.id);
    loadAll();
  };

  const handleExport = async () => {
    setExporting(true);
    try { await doExport(eventId, event?.name || 'Slots Event'); }
    catch (e) { alert('Export failed: ' + e.message); }
    finally { setExporting(false); }
  };

  const sections = [
    ['overview','📊 Overview'],['players','👥 Players'],['categories','📂 Categories'],
    ['tokens','🎟️ Award Tokens'],['store','🛒 Store'],['prizes','🏅 Prizes'],['audit','📋 Audit'],
  ];

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={{ ...styles.header, borderBottomColor: theme }}>
        <div>
          <div style={{ ...styles.title, color: theme }}>{event?.name}</div>
          <div style={{ fontSize: 12, opacity: 0.5 }}>Slots Event · Admin</div>
        </div>
        <div style={styles.headerActions}>
          <Link to={`/slots/${eventId}`} target="_blank" style={styles.linkBtn}>🎰 Public Page ↗</Link>
          <Link to={`/admin/slots/${eventId}/scores`} style={{ ...styles.linkBtn, background: theme }}>📝 Score Entry</Link>
          <Link to={`/admin/slots/${eventId}/edit`} style={styles.linkBtn}>⚙️ Edit Config</Link>
          <button onClick={handleExport} disabled={exporting} style={styles.linkBtn}>
            {exporting ? '…' : '📥 Export Results XLSX'}
          </button>
        </div>
      </div>

      <div style={styles.layout}>
        {/* Sidebar nav */}
        <nav style={styles.sidebar}>
          {sections.map(([id, label]) => (
            <button key={id} onClick={() => setActiveSection(id)}
              style={{ ...styles.navItem, ...(activeSection === id ? { background: `${theme}22`, color: '#fff', borderLeftColor: theme } : {}) }}>
              {label}
            </button>
          ))}
        </nav>

        {/* Main content */}
        <div style={styles.main}>
          {/* ── Overview ── */}
          {activeSection === 'overview' && (
            <div>
              <h2 style={styles.h2}>Overview</h2>
              <div style={styles.statGrid}>
                {[
                  ['Players', players.length],
                  ['Categories', categories.length],
                  ['Commits', commits.length],
                  ['Store Items', storeItems.filter(i => i.is_active).length],
                  ['Prizes Pending', prizeBoard.filter(p => !p.paid).length],
                  ['Total Spins', players.reduce((s, p) => s + (p.total_spins || 0), 0).toLocaleString()],
                ].map(([label, val]) => (
                  <div key={label} style={styles.statCard}>
                    <div style={styles.statVal}>{val}</div>
                    <div style={styles.statLabel}>{label}</div>
                  </div>
                ))}
              </div>

              <h3 style={{ marginTop: 24, marginBottom: 12, color: '#888' }}>Config Summary</h3>
              <div style={styles.configGrid}>
                {[
                  ['Score Divisor', config?.score_divisor ?? 1],
                  ['Score Operation', config?.score_operation ?? 'divide'],
                  ['Rounding', config?.score_rounding ?? 'floor'],
                  ['Min Tokens/Day', config?.min_tokens_per_day ?? 0],
                  ['Max Tokens/Day', config?.max_tokens_per_day === 0 ? 'None' : config?.max_tokens_per_day],
                  ['CPC per Token', config?.cpc_per_token ?? 5],
                  ['Theme Color', config?.theme_color ?? '#c62828'],
                  ['Discord Webhook', config?.discord_webhook_url ? '✅ Set' : '—'],
                ].map(([k, v]) => (
                  <div key={k} style={styles.configRow}>
                    <span style={{ opacity: 0.6, fontSize: 12 }}>{k}</span>
                    <span style={{ fontWeight: 600 }}>{String(v)}</span>
                  </div>
                ))}
              </div>

              <h3 style={{ marginTop: 24, marginBottom: 12, color: '#888' }}>Commit History</h3>
              {commits.length === 0 ? <div style={styles.empty}>No commits yet.</div> : (
                <table style={styles.table}>
                  <thead><tr>{['Day','Committed At','Players'].map(h => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {commits.map(c => (
                      <tr key={c.id}>
                        <td style={styles.td}>Day {c.day_number}</td>
                        <td style={styles.td}>{new Date(c.committed_at).toLocaleString()}</td>
                        <td style={styles.td}>{c.player_results?.length ?? 0} players</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── Players ── */}
          {activeSection === 'players' && (
            <div>
              <h2 style={styles.h2}>Players</h2>
              <div style={styles.formRow}>
                <input placeholder="Display name" value={newPlayerName} onChange={e => setNewPlayerName(e.target.value)} style={styles.input} />
                <input placeholder="Avatar URL (optional)" value={newPlayerAvatar} onChange={e => setNewPlayerAvatar(e.target.value)} style={{ ...styles.input, flex: 2 }} />
                <input type="color" value={newPlayerColor} onChange={e => setNewPlayerColor(e.target.value)} style={{ ...styles.input, width: 48, padding: 4 }} />
                <button onClick={addPlayer} style={{ ...styles.btn, background: theme }}>Add</button>
              </div>
              {playerMsg && <div style={styles.msg}>{playerMsg}</div>}
              <table style={styles.table}>
                <thead><tr>{['Player','Tokens','CPC','Spins','Jackpots',''].map(h => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {players.map(p => (
                    <tr key={p.id}>
                      <td style={styles.td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {p.avatar_url ? <img src={p.avatar_url} style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} /> : <div style={{ width: 24, height: 24, borderRadius: '50%', background: p.color || theme, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{p.display_name?.[0]}</div>}
                          {p.display_name}
                        </div>
                      </td>
                      <td style={styles.tdNum}>🎟️ {p.slot_tokens}</td>
                      <td style={styles.tdNum}>🪙 {p.casino_prize_coins}</td>
                      <td style={styles.tdNum}>{p.total_spins}</td>
                      <td style={styles.tdNum}>{p.jackpots_hit > 0 ? `🏆 ${p.jackpots_hit}` : '—'}</td>
                      <td style={styles.td}><button onClick={() => removePlayer(p.id)} style={{ ...styles.smallBtn, background: '#7333' }}>Remove</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Categories ── */}
          {activeSection === 'categories' && (
            <div>
              <h2 style={styles.h2}>Score Categories</h2>
              <div style={styles.formRow}>
                <input placeholder="Category label" value={newCatLabel} onChange={e => setNewCatLabel(e.target.value)} style={styles.input} />
                <input placeholder="Point value" type="number" value={newCatPts} onChange={e => setNewCatPts(e.target.value)} style={{ ...styles.input, width: 120 }} />
                <button onClick={addCategory} style={{ ...styles.btn, background: theme }}>Add</button>
              </div>
              {catMsg && <div style={styles.msg}>{catMsg}</div>}
              <table style={styles.table}>
                <thead><tr>{['Label','Points','Status',''].map(h => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {categories.map(cat => (
                    <tr key={cat.id} style={{ opacity: cat.is_active ? 1 : 0.4 }}>
                      <td style={styles.td}>{cat.label}</td>
                      <td style={styles.tdNum}>{cat.point_value}</td>
                      <td style={styles.td}><span style={{ color: cat.is_active ? '#4CAF50' : '#888', fontSize: 12 }}>{cat.is_active ? 'Active' : 'Inactive'}</span></td>
                      <td style={styles.td}><button onClick={() => toggleCategory(cat)} style={{ ...styles.smallBtn, background: cat.is_active ? '#555' : theme }}>{cat.is_active ? 'Deactivate' : 'Activate'}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Award Tokens ── */}
          {activeSection === 'tokens' && (
            <div>
              <h2 style={styles.h2}>Award / Deduct Tokens</h2>
              <p style={{ opacity: 0.6, fontSize: 13 }}>All manual token changes are logged to the audit log.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 440 }}>
                <select value={awardPlayerId} onChange={e => setAwardPlayerId(e.target.value)} style={styles.input}>
                  <option value="">Select player…</option>
                  {players.map(p => <option key={p.id} value={p.id}>{p.display_name} (🎟️ {p.slot_tokens})</option>)}
                </select>
                <input placeholder="Amount (use negative to deduct)" type="number" value={awardAmount} onChange={e => setAwardAmount(e.target.value)} style={styles.input} />
                <input placeholder="Reason (optional)" value={awardReason} onChange={e => setAwardReason(e.target.value)} style={styles.input} />
                <button onClick={handleAwardTokens} disabled={awardLoading || !awardPlayerId || !awardAmount} style={{ ...styles.btn, background: theme, opacity: (!awardPlayerId || !awardAmount) ? 0.5 : 1 }}>
                  {awardLoading ? '…' : 'Award Tokens'}
                </button>
              </div>
              {awardMsg && <div style={{ ...styles.msg, marginTop: 12 }}>{awardMsg}</div>}
            </div>
          )}

          {/* ── Store ── */}
          {activeSection === 'store' && (
            <div>
              <h2 style={styles.h2}>Prize Store Management</h2>
              <div style={styles.formRow}>
                <input placeholder="Item label" value={newItemLabel} onChange={e => setNewItemLabel(e.target.value)} style={styles.input} />
                <input placeholder="CPC cost" type="number" value={newItemCost} onChange={e => setNewItemCost(e.target.value)} style={{ ...styles.input, width: 100 }} />
                <input placeholder="Qty (blank = ∞)" type="number" value={newItemQty} onChange={e => setNewItemQty(e.target.value)} style={{ ...styles.input, width: 100 }} />
                <input placeholder="Pays tokens (opt)" type="number" value={newItemTokens} onChange={e => setNewItemTokens(e.target.value)} style={{ ...styles.input, width: 120 }} />
                <button onClick={addStoreItem} style={{ ...styles.btn, background: theme }}>Add</button>
              </div>
              <div style={styles.formRow}>
                <input placeholder="Description (optional)" value={newItemDesc} onChange={e => setNewItemDesc(e.target.value)} style={{ ...styles.input, flex: 1 }} />
              </div>
              {storeMsg && <div style={styles.msg}>{storeMsg}</div>}
              <table style={styles.table}>
                <thead><tr>{['Item','Cost','Qty Left','Tokens Pays','Status',''].map(h => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {storeItems.map(item => (
                    <tr key={item.id} style={{ opacity: item.is_active ? 1 : 0.4 }}>
                      <td style={styles.td}><div style={{ fontWeight: 600 }}>{item.label}</div>{item.description && <div style={{ fontSize: 11, opacity: 0.5 }}>{item.description}</div>}</td>
                      <td style={styles.tdNum}>🪙 {item.cost_cpc}</td>
                      <td style={styles.tdNum}>{item.quantity_remaining === null ? '∞' : item.quantity_remaining}</td>
                      <td style={styles.tdNum}>{item.pays_out_slot_tokens ? `🎟️ ${item.pays_out_slot_tokens}` : '—'}</td>
                      <td style={styles.td}><span style={{ color: item.is_active ? '#4CAF50' : '#888', fontSize: 12 }}>{item.is_active ? 'Active' : 'Inactive'}</span></td>
                      <td style={styles.td}><button onClick={() => toggleStoreItem(item)} style={{ ...styles.smallBtn, background: '#555' }}>{item.is_active ? 'Hide' : 'Show'}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Prizes ── */}
          {activeSection === 'prizes' && (
            <div>
              <h2 style={styles.h2}>Prize Fulfillment</h2>
              {prizeBoard.length === 0 ? <div style={styles.empty}>No prizes claimed yet.</div> : (
                <table style={styles.table}>
                  <thead><tr>{['Player','Prize','Cost','Date','Status',''].map(h => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {prizeBoard.map(entry => (
                      <tr key={entry.id} style={{ opacity: entry.paid ? 0.5 : 1 }}>
                        <td style={styles.td}>{entry.slots_players?.display_name}</td>
                        <td style={styles.td}>{entry.slots_store_items?.label}</td>
                        <td style={styles.tdNum}>🪙 {entry.cost_cpc_at_purchase}</td>
                        <td style={styles.td}>{new Date(entry.purchased_at).toLocaleDateString()}</td>
                        <td style={styles.td}><span style={{ color: entry.paid ? '#4CAF50' : '#f90', fontSize: 12 }}>{entry.paid ? '✅ Fulfilled' : '⏳ Pending'}</span></td>
                        <td style={styles.td}><button onClick={() => markPrizePaid(entry, !entry.paid)} style={{ ...styles.smallBtn, background: entry.paid ? '#555' : '#4CAF50' }}>{entry.paid ? 'Unmark' : 'Fulfill'}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── Audit ── */}
          {activeSection === 'audit' && (
            <div>
              <h2 style={styles.h2}>Audit Log</h2>
              <table style={styles.table}>
                <thead><tr>{['Time','Actor','Action','Player','Details'].map(h => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {auditLog.map(entry => (
                    <tr key={entry.id}>
                      <td style={{ ...styles.td, fontSize: 11, opacity: 0.5, whiteSpace: 'nowrap' }}>{new Date(entry.created_at).toLocaleString()}</td>
                      <td style={{ ...styles.td, fontSize: 12 }}>{entry.profiles?.email?.split('@')[0] || '—'}</td>
                      <td style={styles.td}><span style={{ ...styles.badge, background: actionColor(entry.action) }}>{entry.action}</span></td>
                      <td style={{ ...styles.td, fontSize: 12 }}>{players.find(p => p.id === entry.player_id)?.display_name || '—'}</td>
                      <td style={{ ...styles.td, fontSize: 11, opacity: 0.6, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.metadata ? JSON.stringify(entry.metadata) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function actionColor(action) {
  if (!action) return '#333';
  if (action.includes('award') || action.includes('commit')) return '#1b5e2022';
  if (action.includes('deduct') || action.includes('undo')) return '#b71c1c22';
  if (action.includes('purchase') || action.includes('paid')) return '#1565c022';
  return '#33333388';
}

const styles = {
  page: { minHeight: '100vh', background: '#0a0a0f', color: '#e0e0e0', fontFamily: "'Segoe UI', sans-serif" },
  center: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh', color: '#888' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', borderBottom: '2px solid', background: '#111' },
  title: { fontSize: 20, fontWeight: 800 },
  headerActions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  linkBtn: { padding: '7px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, color: '#e0e0e0', background: '#222', border: '1px solid #333', cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' },
  layout: { display: 'flex', minHeight: 'calc(100vh - 60px)' },
  sidebar: { width: 200, background: '#0d0d14', borderRight: '1px solid #1a1a2a', padding: '16px 8px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  navItem: { background: 'none', border: 'none', borderLeft: '3px solid transparent', color: '#888', padding: '8px 12px', cursor: 'pointer', fontSize: 13, textAlign: 'left', borderRadius: '0 6px 6px 0', transition: 'all 0.15s' },
  main: { flex: 1, padding: 28, overflowY: 'auto' },
  h2: { fontSize: 18, fontWeight: 700, marginBottom: 16, color: '#ddd' },
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 },
  statCard: { background: '#111', border: '1px solid #222', borderRadius: 10, padding: '16px 12px', textAlign: 'center' },
  statVal: { fontSize: 28, fontWeight: 800, color: '#fff' },
  statLabel: { fontSize: 12, opacity: 0.5, marginTop: 4 },
  configGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 },
  configRow: { background: '#111', border: '1px solid #1a1a1a', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 2 },
  formRow: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' },
  input: { background: '#111', border: '1px solid #333', borderRadius: 6, color: '#e0e0e0', padding: '8px 12px', fontSize: 13, flex: 1, minWidth: 120 },
  btn: { padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, color: '#fff', border: 'none', cursor: 'pointer' },
  smallBtn: { padding: '4px 10px', fontSize: 11, fontWeight: 600, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' },
  msg: { fontSize: 13, color: '#90CAF9', padding: '8px 12px', background: '#1565c011', border: '1px solid #1565c044', borderRadius: 6, marginBottom: 12 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid #222', color: '#888', fontWeight: 600, fontSize: 12 },
  td: { padding: '10px 12px', borderBottom: '1px solid #1a1a1a', color: '#ccc' },
  tdNum: { padding: '10px 12px', borderBottom: '1px solid #1a1a1a', textAlign: 'right', color: '#ccc' },
  empty: { textAlign: 'center', color: '#444', padding: '32px 0' },
  badge: { padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, border: '1px solid #333' },
};
