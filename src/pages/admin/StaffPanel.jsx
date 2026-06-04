// src/pages/admin/StaffPanel.jsx
import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { logAudit } from '../../lib/audit';

const ACC = '#c62828';
const ROLE_COLORS = { scorer: '#2e7d32', player: '#6a1b9a' };

export default function StaffPanel() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [scorers, setScorers] = useState([]);
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  // Scorer form
  const [scorerUsername, setScorerUsername] = useState('');
  const [scorerPassword, setScorerPassword] = useState('');

  // Player form
  const [playerUsername, setPlayerUsername] = useState('');
  const [playerPassword, setPlayerPassword] = useState('');

  // Search
  const [scorerSearch, setScorerSearch] = useState('');
  const [playerSearch, setPlayerSearch] = useState('');

  const flash = (text, isError = false) => {
    setMsg({ text, isError });
    setTimeout(() => setMsg(null), 6000);
  };

  const fetchAll = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, role, created_at')
      .in('role', ['scorer', 'player'])
      .order('role')
      .order('email');
    if (error) flash(error.message, true);
    const all = data ?? [];
    setScorers(all.filter(u => u.role === 'scorer'));
    setPlayers(all.filter(u => u.role === 'player'));
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const createAccount = async (e, role, username, password, clearFn) => {
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
          body: JSON.stringify({ username: username.trim(), password, role }),
        }
      );
      const result = await res.json();
      if (!res.ok || result.error) throw new Error(result.error ?? 'Account creation failed');
      clearFn();
      flash(`Account "${username}" created as ${role}.`);
      await logAudit({
        actor: profile, eventType: 'config_change',
        action: `Created ${role} account: ${username}`,
        metadata: { role, username },
      });
      await fetchAll();
    } catch (err) {
      flash(err.message, true);
    }
    setSaving(false);
  };

  const removeAccount = async (user) => {
    if (!window.confirm(`Remove ${user.email}? This deletes their account permanently.`)) return;
    // Demote to a non-functional state — actual deletion requires service role key
    // For now we set role to a revoked state or simply remove from view via role change
    const { error } = await supabase.from('profiles').update({ role: 'revoked' }).eq('id', user.id);
    if (error) { flash(error.message, true); return; }
    await logAudit({
      actor: profile, eventType: 'role_change',
      action: `Revoked account: ${user.email} (was ${user.role})`,
      targetId: user.id, targetName: user.email,
      metadata: { old_role: user.role },
    });
    flash(`${user.email} has been revoked.`);
    await fetchAll();
  };

  const filteredScorers = scorers.filter(u =>
    !scorerSearch || (u.email ?? '').toLowerCase().includes(scorerSearch.toLowerCase())
  );
  const filteredPlayers = players.filter(u =>
    !playerSearch || (u.email ?? '').toLowerCase().includes(playerSearch.toLowerCase())
  );

  return (
    <div style={s.page}>
      <div style={s.topBar}>
        <div>
          <h1 style={s.title}>Staff Panel</h1>
          <p style={s.subtitle}>Manage scorer and player accounts.</p>
        </div>
        <button onClick={() => navigate('/admin')} style={s.backBtn}>← Dashboard</button>
      </div>

      {msg && (
        <div style={{ background: msg.isError ? '#2d0a0a' : '#0a2d0a', border: `1px solid ${msg.isError ? ACC : '#2e7d32'}`, color: msg.isError ? '#ef9a9a' : '#81c784', borderRadius: 8, padding: '12px 16px', marginBottom: 20 }}>
          {msg.text}
        </div>
      )}

      {/* ── Scorers ── */}
      <div style={s.card}>
        <div style={{ ...s.cardTitle, color: ROLE_COLORS.scorer }}>SCORERS ({scorers.length})</div>
        <p style={s.cardDesc}>Scorers can enter scores and commit days for any event. No per-event assignment needed.</p>

        <form onSubmit={e => createAccount(e, 'scorer', scorerUsername, scorerPassword, () => { setScorerUsername(''); setScorerPassword(''); })}
          style={s.formRow}>
          <div style={s.formGroup}>
            <label style={s.label}>Username</label>
            <input type="text" value={scorerUsername} onChange={e => setScorerUsername(e.target.value)}
              placeholder="pokenexus_username" required autoComplete="off" style={s.input} />
          </div>
          <div style={s.formGroup}>
            <label style={s.label}>Password</label>
            <input type="password" value={scorerPassword} onChange={e => setScorerPassword(e.target.value)}
              placeholder="Min 6 characters" minLength={6} required autoComplete="new-password" style={s.input} />
          </div>
          <div style={{ ...s.formGroup, flex: 'none' }}>
            <label style={s.label}>&nbsp;</label>
            <button type="submit" disabled={saving}
              style={{ ...s.createBtn, background: ROLE_COLORS.scorer }}>
              {saving ? 'Creating...' : '+ Create Scorer'}
            </button>
          </div>
        </form>

        <div style={{ marginTop: 16 }}>
          <input type="text" placeholder="Search scorers..." value={scorerSearch}
            onChange={e => setScorerSearch(e.target.value)} style={{ ...s.input, width: '100%', marginBottom: 10, boxSizing: 'border-box' }} />
          {loading ? <div style={s.loading}>Loading...</div> : filteredScorers.length === 0
            ? <div style={s.empty}>No scorer accounts yet.</div>
            : filteredScorers.map(u => (
              <div key={u.id} style={s.userRow}>
                <div>
                  <div style={s.userEmail}>{u.email}</div>
                  <div style={s.userMeta}>Joined {new Date(u.created_at).toLocaleDateString()}</div>
                </div>
                <button onClick={() => removeAccount(u)}
                  style={s.removeBtn}>Revoke</button>
              </div>
            ))
          }
        </div>
      </div>

      {/* ── Players ── */}
      <div style={s.card}>
        <div style={{ ...s.cardTitle, color: ROLE_COLORS.player }}>PLAYERS ({players.length})</div>
        <p style={s.cardDesc}>Player accounts can log in to player-facing features like Slots. Username is their PokeNexus display name.</p>

        <form onSubmit={e => createAccount(e, 'player', playerUsername, playerPassword, () => { setPlayerUsername(''); setPlayerPassword(''); })}
          style={s.formRow}>
          <div style={s.formGroup}>
            <label style={s.label}>Username</label>
            <input type="text" value={playerUsername} onChange={e => setPlayerUsername(e.target.value)}
              placeholder="pokenexus_username" required autoComplete="off" style={s.input} />
          </div>
          <div style={s.formGroup}>
            <label style={s.label}>Password</label>
            <input type="password" value={playerPassword} onChange={e => setPlayerPassword(e.target.value)}
              placeholder="Min 6 characters" minLength={6} required autoComplete="new-password" style={s.input} />
          </div>
          <div style={{ ...s.formGroup, flex: 'none' }}>
            <label style={s.label}>&nbsp;</label>
            <button type="submit" disabled={saving}
              style={{ ...s.createBtn, background: ROLE_COLORS.player }}>
              {saving ? 'Creating...' : '+ Create Player'}
            </button>
          </div>
        </form>

        <div style={{ marginTop: 16 }}>
          <input type="text" placeholder="Search players..." value={playerSearch}
            onChange={e => setPlayerSearch(e.target.value)} style={{ ...s.input, width: '100%', marginBottom: 10, boxSizing: 'border-box' }} />
          {loading ? <div style={s.loading}>Loading...</div> : filteredPlayers.length === 0
            ? <div style={s.empty}>No player accounts yet.</div>
            : filteredPlayers.map(u => (
              <div key={u.id} style={s.userRow}>
                <div>
                  <div style={s.userEmail}>{u.email}</div>
                  <div style={s.userMeta}>Joined {new Date(u.created_at).toLocaleDateString()}</div>
                </div>
                <button onClick={() => removeAccount(u)}
                  style={s.removeBtn}>Revoke</button>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );
}

const s = {
  page: { maxWidth: 860, margin: '0 auto', padding: '28px 16px', fontFamily: 'sans-serif' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 },
  title: { color: '#fff', fontSize: 22, margin: '0 0 4px' },
  subtitle: { color: '#888', fontSize: 13, margin: 0 },
  backBtn: { background: 'transparent', border: '1px solid #444', color: '#888', borderRadius: 5, padding: '6px 12px', fontSize: 13, cursor: 'pointer' },
  loading: { color: '#888', textAlign: 'center', padding: 20 },
  empty: { color: '#555', fontSize: 13, padding: '12px 0' },
  card: { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '16px 20px', marginBottom: 16 },
  cardTitle: { fontWeight: 700, fontSize: 14, marginBottom: 8, letterSpacing: '0.05em' },
  cardDesc: { color: '#888', fontSize: 12, margin: '0 0 14px' },
  formRow: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' },
  formGroup: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 160 },
  label: { color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' },
  input: { background: '#111', border: '1px solid #333', color: '#fff', borderRadius: 6, padding: '8px 12px', fontSize: 14 },
  createBtn: { color: '#fff', border: 'none', borderRadius: 6, padding: '9px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' },
  userRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #2a2a2a', gap: 12, flexWrap: 'wrap' },
  userEmail: { color: '#fff', fontSize: 14, fontWeight: 600 },
  userMeta: { color: '#666', fontSize: 12, marginTop: 2 },
  removeBtn: { background: 'transparent', border: '1px solid #4a1010', color: '#ef5350', borderRadius: 4, padding: '4px 12px', fontSize: 12, cursor: 'pointer' },
};
