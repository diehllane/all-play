// src/pages/admin/OwnerPage.jsx
import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { logAudit } from '../../lib/audit';

const ACC = '#c62828';

const ROLES = ['player', 'scorer', 'event_runner', 'owner'];
const ROLE_LABELS = { player: 'Player', scorer: 'Scorer', event_runner: 'Event Runner', owner: 'Owner' };

export default function OwnerPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const isOwner = profile?.role === 'owner';

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  // New user form
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('player');

  // Filter
  const [filterRole, setFilterRole] = useState('');
  const [filterSearch, setFilterSearch] = useState('');

  useEffect(() => {
    if (!isOwner) { navigate('/admin'); return; }
    fetchUsers();
  }, [isOwner]);

  const flash = (text, isError = false) => {
    setMsg({ text, isError });
    setTimeout(() => setMsg(null), 6000);
  };

  async function fetchUsers() {
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, role, created_at')
      .order('role')
      .order('email');
    if (error) flash(error.message, true);
    setUsers(data ?? []);
    setLoading(false);
  }

  async function createUser(e) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-account`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            username: newUsername.trim(),
            password: newPassword,
            role: newRole,
          }),
        }
      );
      const result = await res.json();
      if (!res.ok || result.error) throw new Error(result.error ?? 'Account creation failed');
      setNewUsername('');
      setNewPassword('');
      setNewRole('player');
      flash(`Account "${newUsername}" created with role "${ROLE_LABELS[newRole]}". No email confirmation needed.`);
      await fetchUsers();
    } catch (err) {
      flash(err.message, true);
    }
    setSaving(false);
  }

  async function changeRole(user, targetRole) {
    if (user.id === profile?.id) { flash('You cannot change your own role.', true); return; }
    const label = `Change ${user.email}'s role from "${ROLE_LABELS[user.role]}" to "${ROLE_LABELS[targetRole]}"?`;
    if (!window.confirm(label)) return;

    const { error } = await supabase.from('profiles').update({ role: targetRole }).eq('id', user.id);
    if (error) { flash(error.message, true); return; }

    await logAudit({
      actor: profile, eventType: 'role_change',
      action: `Changed ${user.email}'s role from "${user.role}" to "${targetRole}"`,
      targetId: user.id, targetName: user.email,
      metadata: { old_role: user.role, new_role: targetRole },
    });

    setUsers(prev => prev.map(u => u.id === user.id ? { ...u, role: targetRole } : u));
    flash(`${user.email} is now ${ROLE_LABELS[targetRole]}.`);
  }

  const filtered = users.filter(u => {
    const matchRole = !filterRole || u.role === filterRole;
    const matchSearch = !filterSearch || (u.email ?? '').toLowerCase().includes(filterSearch.toLowerCase());
    return matchRole && matchSearch;
  });

  const byRole = ROLES.reduce((acc, r) => {
    acc[r] = filtered.filter(u => u.role === r);
    return acc;
  }, {});

  const ROLE_COLORS = { owner: '#c62828', event_runner: '#1565c0', scorer: '#2e7d32', player: '#6a1b9a' };

  return (
    <div style={s.page}>
      <div style={s.topBar}>
        <div>
          <h1 style={s.title}>Owner Panel</h1>
          <p style={s.subtitle}>Manage all accounts and roles.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/admin/audit" style={s.auditBtn}>📋 Audit Log</Link>
          <button onClick={() => navigate('/admin')} style={s.backBtn}>← Dashboard</button>
        </div>
      </div>

      {msg && (
        <div style={{ background: msg.isError ? '#2d0a0a' : '#0a2d0a', border: `1px solid ${msg.isError ? ACC : '#2e7d32'}`, color: msg.isError ? '#ef9a9a' : '#81c784', borderRadius: 8, padding: '12px 16px', marginBottom: 20 }}>
          {msg.text}
        </div>
      )}

      {/* Create Account */}
      <div style={s.card}>
        <div style={s.cardTitle}>Create Account</div>
        <p style={s.cardDesc}>Accounts are created immediately — no email confirmation required. Players log in with username + password.</p>
        <form onSubmit={createUser} style={s.formRow}>
          <div style={s.formGroup}>
            <label style={s.label}>Username</label>
            <input
              type="text"
              value={newUsername}
              onChange={e => setNewUsername(e.target.value)}
              placeholder="pokenexus_username"
              required
              autoComplete="off"
              style={s.input}
            />
          </div>
          <div style={s.formGroup}>
            <label style={s.label}>Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Minimum 6 characters"
              minLength={6}
              required
              autoComplete="new-password"
              style={s.input}
            />
          </div>
          <div style={s.formGroup}>
            <label style={s.label}>Role</label>
            <select value={newRole} onChange={e => setNewRole(e.target.value)} style={s.select}>
              <option value="player">Player</option>
              <option value="scorer">Scorer</option>
              <option value="event_runner">Event Runner</option>
              <option value="owner">Owner</option>
            </select>
          </div>
          <div style={{ ...s.formGroup, justifyContent: 'flex-end' }}>
            <label style={s.label}>&nbsp;</label>
            <button type="submit" disabled={saving} style={s.createBtn}>
              {saving ? 'Creating...' : 'Create Account'}
            </button>
          </div>
        </form>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search by email/username..."
          value={filterSearch}
          onChange={e => setFilterSearch(e.target.value)}
          style={{ ...s.input, flex: 1, minWidth: 180 }}
        />
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)} style={s.select}>
          <option value="">All Roles</option>
          {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
        <span style={{ color: '#555', fontSize: 12 }}>{filtered.length} accounts</span>
      </div>

      {loading ? (
        <div style={s.loading}>Loading...</div>
      ) : (
        ROLES.slice().reverse().map(role => {
          const members = byRole[role];
          if (!members?.length) return null;
          return (
            <div key={role} style={s.card}>
              <div style={{ ...s.cardTitle, color: ROLE_COLORS[role] }}>
                {ROLE_LABELS[role].toUpperCase()} ({members.length})
              </div>
              {members.map(u => (
                <div key={u.id} style={s.userRow}>
                  <div>
                    <div style={s.userEmail}>
                      {u.email}
                      {u.id === profile?.id && <span style={s.youBadge}>you</span>}
                    </div>
                    <div style={s.userMeta}>
                      Joined {new Date(u.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  {u.id !== profile?.id && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {ROLES.filter(r => r !== u.role).map(r => (
                        <button
                          key={r}
                          onClick={() => changeRole(u, r)}
                          style={{
                            background: 'transparent',
                            border: `1px solid ${ROLE_COLORS[r]}`,
                            color: ROLE_COLORS[r],
                            borderRadius: 4,
                            padding: '3px 10px',
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          → {ROLE_LABELS[r]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}

const s = {
  page: { maxWidth: 860, margin: '0 auto', padding: '28px 16px', fontFamily: 'sans-serif' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 },
  title: { color: '#fff', fontSize: 22, margin: '0 0 4px' },
  subtitle: { color: '#888', fontSize: 13, margin: 0 },
  auditBtn: { background: '#1a1a2e', border: '1px solid #444', color: '#ccc', borderRadius: 5, padding: '6px 12px', fontSize: 13, textDecoration: 'none', display: 'inline-block' },
  backBtn: { background: 'transparent', border: '1px solid #444', color: '#888', borderRadius: 5, padding: '6px 12px', fontSize: 13, cursor: 'pointer' },
  loading: { color: '#888', textAlign: 'center', padding: 40 },
  card: { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '16px 20px', marginBottom: 16 },
  cardTitle: { color: '#fff', fontWeight: 700, fontSize: 14, marginBottom: 12, letterSpacing: '0.05em' },
  cardDesc: { color: '#888', fontSize: 12, margin: '0 0 14px' },
  formRow: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' },
  formGroup: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 160 },
  label: { color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' },
  input: { background: '#111', border: '1px solid #333', color: '#fff', borderRadius: 6, padding: '8px 12px', fontSize: 14 },
  select: { background: '#111', border: '1px solid #333', color: '#fff', borderRadius: 6, padding: '8px 12px', fontSize: 14 },
  createBtn: { background: ACC, color: '#fff', border: 'none', borderRadius: 6, padding: '9px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' },
  userRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #2a2a2a', gap: 12, flexWrap: 'wrap' },
  userEmail: { color: '#fff', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 },
  userMeta: { color: '#666', fontSize: 12, marginTop: 2 },
  youBadge: { background: '#2a2a2a', color: '#888', borderRadius: 4, padding: '1px 6px', fontSize: 11 },
};
