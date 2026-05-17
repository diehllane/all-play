// src/pages/admin/OwnerPage.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

const ACC = '#c62828';

export default function OwnerPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const isOwner = profile?.role === 'owner';

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  // New user form
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('event_runner');

  useEffect(() => {
    if (!isOwner) { navigate('/admin'); return; }
    fetchUsers();
  }, [isOwner]);

  const flash = (text, isError = false) => {
    setMsg({ text, isError });
    setTimeout(() => setMsg(null), 5000);
  };

  async function fetchUsers() {
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, role, created_at')
      .in('role', ['owner', 'event_runner'])
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
      const { data, error } = await supabase.auth.signUp({
        email: newEmail,
        password: newPassword,
        options: { data: { role: newRole } },
      });
      if (error) throw error;
      if (!data.user) throw new Error('User creation failed');
      // Give Supabase a moment to create the profile row via trigger
      setTimeout(async () => {
        await supabase.from('profiles').update({ role: newRole }).eq('id', data.user.id);
        await fetchUsers();
      }, 1500);
      setNewEmail('');
      setNewPassword('');
      setNewRole('event_runner');
      flash(`Account created for ${newEmail}. They will need to confirm their email before logging in.`);
    } catch (err) {
      flash(err.message, true);
    }
    setSaving(false);
  }

  async function changeRole(userId, currentRole) {
    if (userId === profile?.id) {
      flash('You cannot change your own role.', true);
      return;
    }
    const newRole = currentRole === 'owner' ? 'event_runner' : 'owner';
    const label = newRole === 'owner' ? 'promote to Owner' : 'demote to Event Runner';
    if (!window.confirm(`Are you sure you want to ${label} this account?`)) return;

    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', userId);
    if (error) { flash(error.message, true); return; }
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
    flash(`Role updated to ${newRole}.`);
  }

  const owners = users.filter(u => u.role === 'owner');
  const runners = users.filter(u => u.role === 'event_runner');

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Owner Panel</h1>
          <p style={s.subtitle}>Manage event runners and owners. Owners have full access including this page.</p>
        </div>
      </div>

      {msg && (
        <div style={{ background: msg.isError ? '#ef444422' : '#22c55e22', border: `1px solid ${msg.isError ? '#ef4444' : '#22c55e'}`, color: msg.isError ? '#ef4444' : '#22c55e', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontWeight: 600 }}>
          {msg.text}
        </div>
      )}

      {loading ? (
        <div style={s.loading}>Loading...</div>
      ) : (
        <>
          <UserTable title="Owners" users={owners} currentUserId={profile?.id} onChangeRole={changeRole} />
          <UserTable title="Event Runners" users={runners} currentUserId={profile?.id} onChangeRole={changeRole} />
        </>
      )}

      {/* Create account form */}
      <div style={s.card}>
        <div style={s.cardTitle}>Create Account</div>
        <p style={s.cardDesc}>Creates a login for a new event runner or owner.</p>
        <form onSubmit={createUser} style={s.form}>
          <div style={s.formRow}>
            <div style={s.formGroup}>
              <label style={s.label}>Email</label>
              <input
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                placeholder="user@example.com"
                required
                style={s.input}
              />
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>Temporary Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                minLength={6}
                required
                style={s.input}
              />
            </div>
            <div style={s.formGroup}>
              <label style={s.label}>Role</label>
              <select value={newRole} onChange={e => setNewRole(e.target.value)} style={s.select}>
                <option value="event_runner">Event Runner</option>
                <option value="owner">Owner</option>
              </select>
            </div>
          </div>
          <button type="submit" disabled={saving} style={s.createBtn}>
            {saving ? 'Creating...' : 'Create Account'}
          </button>
        </form>
        <div style={s.note}>
          <strong>Note:</strong> Production deployments should use a Supabase Edge Function with service role key to skip email confirmation.
        </div>
      </div>
    </div>
  );
}

function UserTable({ title, users, currentUserId, onChangeRole }) {
  if (users.length === 0) return (
    <div style={s.card}>
      <div style={s.cardTitle}>{title} (0)</div>
      <div style={s.empty}>None yet.</div>
    </div>
  );

  return (
    <div style={{ ...s.card, marginBottom: 20 }}>
      <div style={s.cardTitle}>{title} ({users.length})</div>
      {users.map(u => (
        <div key={u.id} style={s.userRow}>
          <div>
            <div style={s.userEmail}>
              {u.email}
              {u.id === currentUserId && <span style={s.youBadge}>you</span>}
            </div>
            <div style={s.userMeta}>
              Since {new Date(u.created_at).toLocaleDateString()}
            </div>
          </div>
          {u.id !== currentUserId && (
            <button
              onClick={() => onChangeRole(u.id, u.role)}
              style={u.role === 'owner' ? s.demoteBtn : s.promoteBtn}
            >
              {u.role === 'owner' ? 'Demote to Runner' : 'Promote to Owner'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

const s = {
  page: { maxWidth: 800, margin: '0 auto', padding: '28px 16px', fontFamily: 'sans-serif' },
  header: { marginBottom: 24 },
  title: { color: '#fff', fontSize: 22, margin: '0 0 4px' },
  subtitle: { color: '#888', fontSize: 13, margin: 0 },
  loading: { color: '#888', textAlign: 'center', padding: 40 },
  card: { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '16px 20px', marginBottom: 20 },
  cardTitle: { color: '#fff', fontWeight: 700, fontSize: 15, marginBottom: 12 },
  cardDesc: { color: '#888', fontSize: 13, margin: '0 0 16px' },
  empty: { color: '#555', fontSize: 13, padding: '4px 0' },
  userRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #2a2a2a' },
  userEmail: { color: '#fff', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 },
  userMeta: { color: '#666', fontSize: 12, marginTop: 2 },
  youBadge: { background: '#2a2a2a', color: '#888', borderRadius: 4, padding: '1px 6px', fontSize: 11 },
  promoteBtn: { background: ACC, color: '#fff', border: 'none', borderRadius: 5, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  demoteBtn: { background: 'none', color: '#888', border: '1px solid #444', borderRadius: 5, padding: '5px 12px', fontSize: 12, cursor: 'pointer' },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  formRow: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  formGroup: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 180 },
  label: { color: '#888', fontSize: 12 },
  input: { background: '#111', border: '1px solid #333', color: '#fff', borderRadius: 6, padding: '8px 12px', fontSize: 14 },
  select: { background: '#111', border: '1px solid #333', color: '#fff', borderRadius: 6, padding: '8px 12px', fontSize: 14 },
  createBtn: { background: ACC, color: '#fff', border: 'none', borderRadius: 6, padding: '9px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer', alignSelf: 'flex-start' },
  note: { background: '#111', border: '1px solid #2a2a2a', borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#888', marginTop: 16 },
};

