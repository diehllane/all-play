// src/pages/admin/EventStaffPage.jsx
// Per-event staff: who can run and who can score THIS event.
// Route: /admin/events/:id/staff (any event type). Owner or this event's runners only.
//
// Roles live in user_event_assignments. Owners have access to every event and
// don't need a row. Being a player is separate (each game mode's enrollment).

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { logAudit } from '../../lib/audit';

const ROLE_LABEL = { event_runner: 'Event Runner', scorer: 'Scorer' };
const ROLE_HELP = {
  event_runner: 'Full control of this event: settings, players, scoring, undo, and this staff list.',
  scorer: 'Can enter scores and commit days for this event. Cannot change settings or undo.',
};

function adminPathFor(event) {
  if (!event) return '/admin';
  switch (event.event_type) {
    case 'slots': return `/admin/slots/${event.id}`;
    case 'bingo_solo':
    case 'bingo_team': return `/admin/bingo/${event.id}`;
    case 'board_game': return `/admin/board/${event.id}`;
    case 'high_score': return `/admin/highscore/${event.id}`;
    default: return `/admin/events/${event.id}`;
  }
}

const displayName = (p) => (p?.email ? p.email.replace(/@pokenexus\.internal$/i, '') : '(unknown)');

export default function EventStaffPage() {
  const { id: eventId } = useParams();
  const { user, profile, refreshAssignments } = useAuth();

  const [event, setEvent] = useState(null);
  const [staff, setStaff] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const [search, setSearch] = useState('');
  const [pickId, setPickId] = useState('');
  const [pickRole, setPickRole] = useState('scorer');

  const flash = (text, isError = false) => { setMsg({ text, isError }); setTimeout(() => setMsg(null), 5000); };

  const load = useCallback(async () => {
    try {
      const [evRes, staffRes, accRes] = await Promise.all([
        supabase.from('events').select('id, name, event_type, created_by').eq('id', eventId).single(),
        supabase.from('user_event_assignments').select('id, user_id, role, created_at, profiles!user_event_assignments_user_id_fkey(id, email, role, is_active)').eq('event_id', eventId).order('created_at'),
        supabase.from('profiles').select('id, email, role, is_active').order('email'),
      ]);
      if (evRes.error) throw evRes.error;
      if (staffRes.error) throw staffRes.error;
      setEvent(evRes.data);
      setStaff(staffRes.data ?? []);
      setAccounts((accRes.data ?? []).filter(a => a.is_active !== false && a.role !== 'revoked'));
    } catch (e) {
      flash('Error loading staff: ' + e.message, true);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const assignedIds = useMemo(() => new Set(staff.map(s => s.user_id)), [staff]);
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts
      .filter(a => a.role !== 'owner' && !assignedIds.has(a.id))
      .filter(a => !q || a.email?.toLowerCase().includes(q));
  }, [accounts, assignedIds, search]);
  const owners = accounts.filter(a => a.role === 'owner');
  const runnerCount = staff.filter(s => s.role === 'event_runner').length;

  const audit = (action, target, metadata) => logAudit({
    actor: profile, eventType: 'role_change', action,
    eventId, eventName: event?.name, targetId: target?.id, targetName: displayName(target), metadata,
  });

  const handleAdd = async () => {
    const target = accounts.find(a => a.id === pickId);
    if (!target) return;
    setBusy(true);
    const { data, error } = await supabase.from('user_event_assignments')
      .insert({ user_id: target.id, event_id: eventId, role: pickRole, added_by: user.id })
      .select();
    setBusy(false);
    if (error || !data?.length) { flash('Error: ' + (error?.message || 'Blocked — check your role on this event.'), true); return; }
    audit(`Added ${displayName(target)} to ${event?.name} as ${ROLE_LABEL[pickRole]}`, target, { role: pickRole });
    flash(`${displayName(target)} added as ${ROLE_LABEL[pickRole]}.`);
    setPickId(''); setSearch('');
    load();
  };

  const handleRoleChange = async (row, newRole) => {
    const target = row.profiles;
    if (row.user_id === user.id && newRole !== 'event_runner' && profile?.role !== 'owner') {
      if (!window.confirm('Change yourself to Scorer? You will lose the ability to manage this event and its staff.')) return;
    }
    if (row.role === 'event_runner' && runnerCount === 1 && profile?.role !== 'owner') {
      if (!window.confirm('This is the only Event Runner. After this, only Owners can manage this event. Continue?')) return;
    }
    setBusy(true);
    const { data, error } = await supabase.from('user_event_assignments').update({ role: newRole }).eq('id', row.id).select();
    setBusy(false);
    if (error || !data?.length) { flash('Error: ' + (error?.message || 'Blocked — check your role on this event.'), true); return; }
    audit(`Changed ${displayName(target)} on ${event?.name} from ${ROLE_LABEL[row.role]} to ${ROLE_LABEL[newRole]}`, target, { from: row.role, to: newRole });
    if (row.user_id === user.id) await refreshAssignments();
    load();
  };

  const handleRemove = async (row) => {
    const target = row.profiles;
    const self = row.user_id === user.id;
    const lastRunner = row.role === 'event_runner' && runnerCount === 1;
    let prompt = `Remove ${displayName(target)} from ${event?.name}?`;
    if (self) prompt = `Remove yourself from ${event?.name}? You will lose access to this event.`;
    else if (lastRunner) prompt += ' They are the only Event Runner; after this only Owners can manage the event.';
    if (!window.confirm(prompt)) return;
    setBusy(true);
    const { data, error } = await supabase.from('user_event_assignments').delete().eq('id', row.id).select();
    setBusy(false);
    if (error || !data?.length) { flash('Error: ' + (error?.message || 'Blocked — check your role on this event.'), true); return; }
    audit(`Removed ${displayName(target)} (${ROLE_LABEL[row.role]}) from ${event?.name}`, target, { role: row.role });
    if (self) await refreshAssignments();
    load();
  };

  if (loading) return <div style={s.page}><div style={{ color: '#888' }}>Loading...</div></div>;

  return (
    <div style={s.page}>
      <Link to={adminPathFor(event)} style={s.back}>← Back to {event?.name ?? 'event'}</Link>
      <h1 style={s.title}>👥 Event Staff</h1>
      <div style={s.sub}>{event?.name}</div>

      {msg && <div style={{ ...s.flash, borderColor: msg.isError ? '#ef4444' : '#4caf50', color: msg.isError ? '#ef4444' : '#4caf50' }}>{msg.text}</div>}

      <div style={s.help}>
        Roles here apply to <b>this event only</b>. The same person can run one event, score another and play in a third.
        Players are added through each game's own player list, not here.
      </div>

      {/* Current staff */}
      <div style={s.card}>
        <div style={s.cardTitle}>Current staff ({staff.length})</div>
        {staff.length === 0 && <div style={{ color: '#666', fontSize: 13 }}>No one is assigned yet. Owners can still manage it.</div>}
        {staff.map(row => {
          const p = row.profiles;
          const inactive = p?.is_active === false || p?.role === 'revoked';
          return (
            <div key={row.id} style={s.row}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ color: inactive ? '#666' : '#fff', fontWeight: 600 }}>
                  {displayName(p)} {row.user_id === user.id && <span style={s.youTag}>you</span>}
                  {row.user_id === event?.created_by && <span style={s.creatorTag}>creator</span>}
                </div>
                <div style={{ fontSize: 11, color: '#666' }}>
                  Account: {p?.role ?? '—'}{inactive && ' · suspended (no access)'}
                </div>
              </div>
              <select value={row.role} disabled={busy} onChange={e => handleRoleChange(row, e.target.value)} style={s.select}>
                <option value="event_runner" style={s.option}>Event Runner</option>
                <option value="scorer" style={s.option}>Scorer</option>
              </select>
              <button onClick={() => handleRemove(row)} disabled={busy} style={s.removeBtn}>Remove</button>
            </div>
          );
        })}
        {owners.length > 0 && (
          <div style={{ fontSize: 11, color: '#666', marginTop: 10 }}>
            Owners ({owners.map(displayName).join(', ')}) have access to every event automatically.
          </div>
        )}
      </div>

      {/* Add */}
      <div style={s.card}>
        <div style={s.cardTitle}>Add someone</div>
        <input value={search} onChange={e => { setSearch(e.target.value); setPickId(''); }}
          placeholder="Search accounts by name..." style={s.input} />
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <select value={pickId} onChange={e => setPickId(e.target.value)} style={{ ...s.select, flex: 1, minWidth: 200 }}>
            <option value="" style={s.option}>{candidates.length ? `Choose an account (${candidates.length})` : 'No matching accounts'}</option>
            {candidates.slice(0, 200).map(a => (
              <option key={a.id} value={a.id} style={s.option}>{displayName(a)} ({a.role})</option>
            ))}
          </select>
          <select value={pickRole} onChange={e => setPickRole(e.target.value)} style={s.select}>
            <option value="scorer" style={s.option}>Scorer</option>
            <option value="event_runner" style={s.option}>Event Runner</option>
          </select>
          <button onClick={handleAdd} disabled={!pickId || busy} style={{ ...s.addBtn, opacity: !pickId || busy ? 0.5 : 1 }}>Add</button>
        </div>
        <div style={{ fontSize: 12, color: '#777', marginTop: 8 }}>{ROLE_HELP[pickRole]}</div>
        <div style={{ fontSize: 11, color: '#555', marginTop: 6 }}>
          Need a new account? Create it in the <Link to="/admin/panel" style={{ color: '#81c784' }}>Staff Panel</Link> first (Event Runner and Owner accounts only), then add it here.
        </div>
      </div>
    </div>
  );
}

const s = {
  page: { maxWidth: 760, margin: '0 auto', padding: '28px 16px', fontFamily: 'sans-serif', color: '#ddd' },
  back: { color: '#888', fontSize: 13, textDecoration: 'none' },
  title: { color: '#fff', fontSize: 22, margin: '12px 0 2px' },
  sub: { color: '#888', fontSize: 14, marginBottom: 16 },
  flash: { padding: '10px 14px', border: '1px solid', borderRadius: 6, fontSize: 13, marginBottom: 14 },
  help: { background: '#111a22', border: '1px solid #1e3a52', color: '#9cc3e6', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 },
  card: { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '14px 16px', marginBottom: 16 },
  cardTitle: { color: '#ccc', fontWeight: 700, fontSize: 14, marginBottom: 10 },
  row: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #222', flexWrap: 'wrap' },
  youTag: { background: '#1a2a1a', color: '#81c784', fontSize: 10, borderRadius: 4, padding: '1px 6px', marginLeft: 6 },
  creatorTag: { background: '#2a1a00', color: '#f90', fontSize: 10, borderRadius: 4, padding: '1px 6px', marginLeft: 6 },
  // Native select/option ignore CSS variables — explicit hex only
  select: { background: '#1a1a1a', color: '#fff', border: '1px solid #444', borderRadius: 6, padding: '7px 8px', fontSize: 13 },
  option: { background: '#1a1a1a', color: '#fff' },
  input: { background: '#0d0d14', border: '1px solid #2a2a3a', borderRadius: 6, color: '#e0e0e0', padding: '8px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box' },
  removeBtn: { background: 'none', border: '1px solid #4a1010', color: '#ef5350', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' },
  addBtn: { background: '#c62828', border: 'none', color: '#fff', borderRadius: 6, padding: '7px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
};
