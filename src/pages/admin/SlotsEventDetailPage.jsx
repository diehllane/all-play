import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { awardTokens, awardCPC } from '../../lib/slots';
import { exportSlotsXLSX } from '../../lib/slotsExport';

export default function SlotsEventDetailPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const canManage = profile?.role === 'event_runner' || profile?.role === 'owner';

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
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState(null);

  const [activeTab, setActiveTab] = useState('overview');

  // Award tokens state
  const [awardPlayerId, setAwardPlayerId] = useState('');
  const [awardAmount, setAwardAmount] = useState('');
  const [awardReason, setAwardReason] = useState('');
  const [awardLoading, setAwardLoading] = useState(false);

  // Award CPC state
  const [cpcPlayerId, setCpcPlayerId] = useState('');
  const [cpcAmount, setCpcAmount] = useState('');
  const [cpcReason, setCpcReason] = useState('');
  const [cpcLoading, setCpcLoading] = useState(false);

  const flash = (text, isError = false) => { setMsg({ text, isError }); setTimeout(() => setMsg(null), 4000); };

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

  if (!canManage) return <div style={s.center}>Access denied.</div>;
  if (loading) return <div style={s.center}>Loading...</div>;
  if (error) return <div style={s.center}>Error: {error}</div>;

  const theme = config?.theme_color || '#c62828';

  const handleExport = async () => {
    setExporting(true);
    try { await exportSlotsXLSX(eventId, event?.name || 'Slots Event'); }
    catch (e) { flash('Export failed: ' + e.message, true); }
    finally { setExporting(false); }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this Slots event and ALL associated data? This cannot be undone.')) return;
    setDeleting(true);
    await supabase.from('slots_score_entries').delete().eq('event_id', eventId);
    await supabase.from('slots_spins').delete().eq('event_id', eventId);
    await supabase.from('slots_prize_board').delete().eq('event_id', eventId);
    await supabase.from('slots_store_items').delete().eq('event_id', eventId);
    await supabase.from('slots_commits').delete().eq('event_id', eventId);
    await supabase.from('slots_players').delete().eq('event_id', eventId);
    await supabase.from('slots_categories').delete().eq('event_id', eventId);
    await supabase.from('slots_payout_table').delete().eq('event_id', eventId);
    await supabase.from('slots_config').delete().eq('event_id', eventId);
    await supabase.from('slots_audit_log').delete().eq('event_id', eventId);
    await supabase.from('events').delete().eq('id', eventId);
    navigate('/admin');
  };

  const handleAwardTokens = async () => {
    if (!awardPlayerId || !awardAmount) return;
    setAwardLoading(true);
    try {
      await awardTokens(eventId, awardPlayerId, parseInt(awardAmount), awardReason || 'Manual award', user.id);
      flash('Tokens awarded!');
      setAwardPlayerId(''); setAwardAmount(''); setAwardReason('');
      loadAll();
    } catch (e) {
      flash('Error: ' + e.message, true);
    } finally {
      setAwardLoading(false);
    }
  };

  const handleAwardCPC = async () => {
    if (!cpcPlayerId || !cpcAmount) return;
    setCpcLoading(true);
    try {
      await awardCPC(eventId, cpcPlayerId, parseInt(cpcAmount), cpcReason || 'Manual award', user.id);
      flash('CPC awarded!');
      setCpcPlayerId(''); setCpcAmount(''); setCpcReason('');
      loadAll();
    } catch (e) {
      flash('Error: ' + e.message, true);
    } finally {
      setCpcLoading(false);
    }
  };

  const markPrizePaid = async (entry, paid) => {
    await supabase.from('slots_prize_board').update({
      paid, paid_at: paid ? new Date().toISOString() : null, paid_by: paid ? user.id : null
    }).eq('id', entry.id);
    loadAll();
  };

  const toggleStoreItem = async (item) => {
    await supabase.from('slots_store_items').update({ is_active: !item.is_active }).eq('id', item.id);
    loadAll();
  };

  const TABS = [
    ['overview',  'Overview'],
    ['players',   'Players'],
    ['tokens',    'Award Tokens'],
    ['cpc',       'Award CPC'],
    ['store',     'Store'],
    ['prizes',    'Prizes'],
    ['commits',   'Commits'],
    ['audit',     'Audit'],
  ];

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={{ padding: '20px 28px 0', background: '#0a0a0f', borderBottom: `2px solid ${theme}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div>
            <Link to="/admin" style={{ color: '#888', textDecoration: 'none', fontSize: 13 }}>← Dashboard</Link>
            <h1 style={{ margin: '4px 0 2px', fontSize: 22, fontWeight: 800, color: theme }}>{event?.name}</h1>
            <span style={{ fontSize: 12, opacity: 0.5 }}>Slots Event</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link to={`/slots/${eventId}`} target="_blank" style={s.btn}>🎰 Public Page</Link>
            <Link to={`/admin/slots/${eventId}/scores`} style={{ ...s.btn, background: theme, border: `1px solid ${theme}` }}>📝 Score Entry</Link>
            <Link to={`/admin/slots/${eventId}/edit`} style={s.btn}>⚙️ Edit Config</Link>
            <button onClick={handleExport} disabled={exporting} style={s.btn}>
              {exporting ? '...' : '📥 Export XLSX'}
            </button>
            <button onClick={handleDelete} disabled={deleting} style={s.dangerBtn}>
              {deleting ? 'Deleting...' : 'Delete Event'}
            </button>
          </div>
        </div>

        {msg && (
          <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 6, background: msg.isError ? '#ef444422' : '#4caf5022', border: `1px solid ${msg.isError ? '#ef4444' : '#4caf50'}`, color: msg.isError ? '#ef4444' : '#4caf50', fontSize: 13 }}>
            {msg.text}
          </div>
        )}

        {/* Horizontal tabs */}
        <div style={{ display: 'flex', gap: 0, marginTop: 4, flexWrap: 'wrap' }}>
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => setActiveTab(id)} style={{
              background: 'none', border: 'none',
              borderBottom: activeTab === id ? `2px solid ${theme}` : '2px solid transparent',
              color: activeTab === id ? '#fff' : '#888',
              padding: '10px 16px', cursor: 'pointer', fontSize: 13,
              fontWeight: activeTab === id ? 700 : 400,
            }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={s.content}>

        {/* ── Overview ── */}
        {activeTab === 'overview' && (
          <div>
            <div style={s.statGrid}>
              {[
                ['Players', players.length],
                ['Categories', categories.length],
                ['Days Committed', commits.length],
                ['Store Items', storeItems.filter(i => i.is_active).length],
                ['Prizes Pending', prizeBoard.filter(p => !p.paid).length],
                ['Total Spins', players.reduce((sum, p) => sum + (p.total_spins || 0), 0).toLocaleString()],
              ].map(([label, val]) => (
                <div key={label} style={s.statCard}>
                  <div style={s.statVal}>{val}</div>
                  <div style={s.statLabel}>{label}</div>
                </div>
              ))}
            </div>

            <h3 style={s.sectionHead}>Config Summary</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, marginBottom: 24 }}>
              {[
                ['Score Divisor', config?.score_divisor ?? 1],
                ['Score Operation', config?.score_operation ?? 'divide'],
                ['Rounding', config?.score_rounding ?? 'floor'],
                ['Min Tokens/Day', config?.min_tokens_per_day ?? 0],
                ['Max Tokens/Day', config?.max_tokens_per_day === 0 ? 'None' : config?.max_tokens_per_day],
                ['CPC per Token', config?.cpc_per_token ?? 5],
                ['Theme Color', config?.theme_color ?? '#c62828'],
                ['Discord Webhook', config?.discord_webhook_url ? 'Set' : '--'],
              ].map(([k, v]) => (
                <div key={k} style={{ background: '#111', border: '1px solid #1a1a1a', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ opacity: 0.6, fontSize: 11, marginBottom: 2 }}>{k}</div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{String(v)}</div>
                </div>
              ))}
            </div>

            <h3 style={s.sectionHead}>Player Balances</h3>
            <table style={s.table}>
              <thead><tr>{['Player','Tokens','CPC Balance','Spins','CPC Won','Jackpots'].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>
                {[...players].sort((a,b) => b.total_cpc_won - a.total_cpc_won).map(p => (
                  <tr key={p.id}>
                    <td style={s.td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {p.avatar_url
                          ? <img src={p.avatar_url} style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover' }} alt="" />
                          : <div style={{ width: 22, height: 22, borderRadius: '50%', background: p.color || theme, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{p.display_name?.[0]}</div>
                        }
                        {p.display_name}
                      </div>
                    </td>
                    <td style={s.tdNum}>T {p.slot_tokens}</td>
                    <td style={s.tdNum}>C {p.casino_prize_coins}</td>
                    <td style={s.tdNum}>{p.total_spins}</td>
                    <td style={s.tdNum}>C {p.total_cpc_won}</td>
                    <td style={s.tdNum}>{p.jackpots_hit > 0 ? `J ${p.jackpots_hit}` : '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Players ── */}
        {activeTab === 'players' && (
          <div>
            <p style={{ opacity: 0.6, fontSize: 13, marginBottom: 16 }}>
              Use <Link to={`/admin/slots/${eventId}/edit`} style={{ color: theme }}>Edit Config</Link> to add, import, or export players with full CSV support and avatar/color fields.
            </p>
            <table style={s.table}>
              <thead><tr>{['Player','Tokens','CPC','Spins','Jackpots'].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>
                {players.map(p => (
                  <tr key={p.id}>
                    <td style={s.td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {p.avatar_url
                          ? <img src={p.avatar_url} style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} alt="" />
                          : <div style={{ width: 24, height: 24, borderRadius: '50%', background: p.color || theme, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{p.display_name?.[0]}</div>
                        }
                        {p.display_name}
                      </div>
                    </td>
                    <td style={s.tdNum}>T {p.slot_tokens}</td>
                    <td style={s.tdNum}>C {p.casino_prize_coins}</td>
                    <td style={s.tdNum}>{p.total_spins}</td>
                    <td style={s.tdNum}>{p.jackpots_hit > 0 ? `J ${p.jackpots_hit}` : '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Award Tokens ── */}
        {activeTab === 'tokens' && (
          <div style={{ maxWidth: 440 }}>
            <p style={{ opacity: 0.6, fontSize: 13, marginBottom: 20 }}>All manual token changes are logged to the audit log. Use a negative number to deduct.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <select value={awardPlayerId} onChange={e => setAwardPlayerId(e.target.value)} style={s.input}>
                <option value="">Select player...</option>
                {players.map(p => <option key={p.id} value={p.id}>{p.display_name} (T {p.slot_tokens})</option>)}
              </select>
              <input placeholder="Amount (negative to deduct)" type="number" value={awardAmount} onChange={e => setAwardAmount(e.target.value)} style={s.input} />
              <input placeholder="Reason — e.g. 1st Shiny ER bonus" value={awardReason} onChange={e => setAwardReason(e.target.value)} style={s.input} />
              <button onClick={handleAwardTokens} disabled={awardLoading || !awardPlayerId || !awardAmount}
                style={{ ...s.actionBtn, background: theme, opacity: (!awardPlayerId || !awardAmount) ? 0.5 : 1 }}>
                {awardLoading ? '...' : 'Award Tokens'}
              </button>
            </div>
          </div>
        )}

        {/* ── Award CPC ── */}
        {activeTab === 'cpc' && (
          <div style={{ maxWidth: 440 }}>
            <p style={{ opacity: 0.6, fontSize: 13, marginBottom: 20 }}>
              Award or deduct Casino Prize Coins manually. Use this for event challenge prizes such as 1st Shiny ER, 1st Triple Drop, etc. All changes are logged to the audit log.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <select value={cpcPlayerId} onChange={e => setCpcPlayerId(e.target.value)} style={s.input}>
                <option value="">Select player...</option>
                {players.map(p => <option key={p.id} value={p.id}>{p.display_name} (C {p.casino_prize_coins})</option>)}
              </select>
              <input placeholder="Amount (negative to deduct)" type="number" value={cpcAmount} onChange={e => setCpcAmount(e.target.value)} style={s.input} />
              <input placeholder="Reason — e.g. 1st Triple Drop prize" value={cpcReason} onChange={e => setCpcReason(e.target.value)} style={s.input} />
              <button onClick={handleAwardCPC} disabled={cpcLoading || !cpcPlayerId || !cpcAmount}
                style={{ ...s.actionBtn, background: '#d4af37', opacity: (!cpcPlayerId || !cpcAmount) ? 0.5 : 1 }}>
                {cpcLoading ? '...' : 'Award CPC'}
              </button>
            </div>
            <div style={{ marginTop: 24, background: '#111', border: '1px solid #222', borderRadius: 8, padding: '14px 16px' }}>
              <div style={{ fontSize: 12, color: '#888', fontWeight: 600, marginBottom: 10 }}>CURRENT CPC BALANCES</div>
              {[...players].sort((a, b) => b.casino_prize_coins - a.casino_prize_coins).map(p => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #1a1a1a' }}>
                  <span style={{ fontSize: 13, color: '#ccc' }}>{p.display_name}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#d4af37' }}>{p.casino_prize_coins?.toLocaleString()} CPC</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Store ── */}
        {activeTab === 'store' && (
          <div>
            <p style={{ opacity: 0.6, fontSize: 13, marginBottom: 16 }}>
              Use <Link to={`/admin/slots/${eventId}/edit`} style={{ color: theme }}>Edit Config</Link> to add, import, or export store items with full CSV support.
            </p>
            <table style={s.table}>
              <thead><tr>{['Item','Cost (CPC)','Qty Left','Pays Tokens','Status',''].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>
                {storeItems.map(item => (
                  <tr key={item.id} style={{ opacity: item.is_active ? 1 : 0.4 }}>
                    <td style={s.td}>
                      <div style={{ fontWeight: 600 }}>{item.label}</div>
                      {item.description && <div style={{ fontSize: 11, opacity: 0.5 }}>{item.description}</div>}
                    </td>
                    <td style={s.tdNum}>C {item.cost_cpc}</td>
                    <td style={s.tdNum}>{item.quantity_remaining === null ? 'inf' : item.quantity_remaining}</td>
                    <td style={s.tdNum}>{item.pays_out_slot_tokens ? `T ${item.pays_out_slot_tokens}` : '--'}</td>
                    <td style={s.td}><span style={{ color: item.is_active ? '#4CAF50' : '#888', fontSize: 12 }}>{item.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td style={s.td}><button onClick={() => toggleStoreItem(item)} style={{ ...s.smallBtn, background: '#555' }}>{item.is_active ? 'Hide' : 'Show'}</button></td>
                  </tr>
                ))}
                {storeItems.length === 0 && <tr><td colSpan={6} style={{ ...s.td, textAlign: 'center', color: '#555', padding: '32px 0' }}>No store items yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Prizes ── */}
        {activeTab === 'prizes' && (
          <div>
            <table style={s.table}>
              <thead><tr>{['Player','Prize','Cost','Date','Status',''].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>
                {prizeBoard.map(entry => (
                  <tr key={entry.id} style={{ opacity: entry.paid ? 0.5 : 1 }}>
                    <td style={s.td}>{entry.slots_players?.display_name}</td>
                    <td style={s.td}>{entry.slots_store_items?.label}</td>
                    <td style={s.tdNum}>C {entry.cost_cpc_at_purchase}</td>
                    <td style={s.td}>{new Date(entry.purchased_at).toLocaleDateString()}</td>
                    <td style={s.td}><span style={{ color: entry.paid ? '#4CAF50' : '#f90', fontSize: 12 }}>{entry.paid ? 'Fulfilled' : 'Pending'}</span></td>
                    <td style={s.td}><button onClick={() => markPrizePaid(entry, !entry.paid)} style={{ ...s.smallBtn, background: entry.paid ? '#555' : '#4CAF50' }}>{entry.paid ? 'Unmark' : 'Fulfill'}</button></td>
                  </tr>
                ))}
                {prizeBoard.length === 0 && <tr><td colSpan={6} style={{ ...s.td, textAlign: 'center', color: '#555', padding: '32px 0' }}>No prizes claimed yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Commits ── */}
        {activeTab === 'commits' && (
          <div>
            <table style={s.table}>
              <thead><tr>{['Day','Committed At','Players Updated'].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>
                {commits.map(c => (
                  <tr key={c.id}>
                    <td style={s.td}>Day {c.day_number}</td>
                    <td style={s.td}>{new Date(c.committed_at).toLocaleString()}</td>
                    <td style={s.tdNum}>{c.player_results?.length ?? 0}</td>
                  </tr>
                ))}
                {commits.length === 0 && <tr><td colSpan={3} style={{ ...s.td, textAlign: 'center', color: '#555', padding: '32px 0' }}>No commits yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Audit ── */}
        {activeTab === 'audit' && (
          <div>
            <table style={s.table}>
              <thead><tr>{['Time','Actor','Action','Player','Details'].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>
                {auditLog.map(entry => (
                  <tr key={entry.id}>
                    <td style={{ ...s.td, fontSize: 11, opacity: 0.5, whiteSpace: 'nowrap' }}>{new Date(entry.created_at).toLocaleString()}</td>
                    <td style={{ ...s.td, fontSize: 12 }}>{entry.profiles?.email?.split('@')[0] || '--'}</td>
                    <td style={s.td}><span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, border: '1px solid #333' }}>{entry.action}</span></td>
                    <td style={{ ...s.td, fontSize: 12 }}>{players.find(p => p.id === entry.player_id)?.display_name || '--'}</td>
                    <td style={{ ...s.td, fontSize: 11, opacity: 0.6, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.metadata ? JSON.stringify(entry.metadata) : '--'}
                    </td>
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

const s = {
  page: { minHeight: '100vh', background: '#0a0a0f', color: '#e0e0e0', fontFamily: "'Segoe UI', sans-serif" },
  center: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh', color: '#888' },
  content: { maxWidth: 1000, margin: '0 auto', padding: '28px 28px' },
  btn: { padding: '7px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, color: '#e0e0e0', background: '#222', border: '1px solid #333', cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' },
  dangerBtn: { padding: '7px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, color: '#ef5350', background: 'none', border: '1px solid #4a1010', cursor: 'pointer' },
  actionBtn: { padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, color: '#fff', border: 'none', cursor: 'pointer' },
  smallBtn: { padding: '4px 10px', fontSize: 11, fontWeight: 600, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' },
  input: { background: '#111', border: '1px solid #333', borderRadius: 6, color: '#e0e0e0', padding: '8px 12px', fontSize: 13, width: '100%' },
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, marginBottom: 28 },
  statCard: { background: '#111', border: '1px solid #222', borderRadius: 10, padding: '16px 12px', textAlign: 'center' },
  statVal: { fontSize: 28, fontWeight: 800, color: '#fff' },
  statLabel: { fontSize: 12, opacity: 0.5, marginTop: 4 },
  sectionHead: { fontSize: 14, fontWeight: 700, color: '#888', marginBottom: 12, marginTop: 24 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid #222', color: '#888', fontWeight: 600, fontSize: 12 },
  td: { padding: '10px 12px', borderBottom: '1px solid #1a1a1a', color: '#ccc' },
  tdNum: { padding: '10px 12px', borderBottom: '1px solid #1a1a1a', textAlign: 'right', color: '#ccc' },
};
