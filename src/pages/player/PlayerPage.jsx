// src/pages/player/PlayerPage.jsx
// Player-facing dashboard: token balances and transaction history.
// Slots spin buttons will be added once that game mode is built.

import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

export default function PlayerPage() {
  const { profile, signOut } = useAuth()

  const [tokens, setTokens]     = useState([])
  const [txns, setTxns]         = useState([])
  const [loadingTok, setLTok]   = useState(true)
  const [loadingTx, setLTx]     = useState(true)

  useEffect(() => {
    if (!profile) return
    loadTokens()
    loadTxns()
  }, [profile])

  async function loadTokens() {
    setLTok(true)
    const { data } = await supabase
      .from('player_tokens')
      .select('*, events(name)')
      .eq('player_id', profile.id)
      .order('updated_at', { ascending: false })
    setTokens(data ?? [])
    setLTok(false)
  }

  async function loadTxns() {
    setLTx(true)
    const { data } = await supabase
      .from('token_transactions')
      .select('*, events(name)')
      .eq('player_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(50)
    setTxns(data ?? [])
    setLTx(false)
  }

  const globalBal = tokens.find(t => t.event_id === null)
  const eventBals = tokens.filter(t => t.event_id !== null)

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <div style={s.greeting}>Welcome back,</div>
          <h1 style={s.name}>{profile?.email?.split('@')[0] ?? 'Trainer'}</h1>
          <span style={s.roleBadge}>Player</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Link to="/" style={s.navBtn}>🏠 Events</Link>
          <button onClick={signOut} style={s.signOutBtn}>Sign Out</button>
        </div>
      </div>

      {/* Token Balances */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>🪙 Token Balance</h2>
        {loadingTok ? (
          <p style={s.muted}>Loading...</p>
        ) : tokens.length === 0 ? (
          <p style={s.muted}>No tokens yet — participate in an event to earn them!</p>
        ) : (
          <div style={s.tokenGrid}>
            {globalBal && (
              <div style={{ ...s.tokenCard, borderTop: '3px solid #c62828' }}>
                <div style={s.tokenLabel}>Global Balance</div>
                <div style={s.tokenAmount}>{globalBal.token_balance.toLocaleString()}</div>
                <div style={s.tokenSub}>{globalBal.lifetime_earned.toLocaleString()} earned lifetime</div>
              </div>
            )}
            {eventBals.map(t => (
              <div key={t.id} style={s.tokenCard}>
                <div style={s.tokenLabel}>{t.events?.name ?? 'Event'}</div>
                <div style={s.tokenAmount}>{t.token_balance.toLocaleString()}</div>
                <div style={s.tokenSub}>{t.lifetime_earned.toLocaleString()} earned · {new Date(t.updated_at).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Slots placeholder */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>🎰 Slot Events</h2>
        <div style={s.placeholder}>
          <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🎰</div>
          <p style={s.muted}>Slot events coming soon. When a Slots event is live and you have tokens, your spin button will appear here.</p>
        </div>
      </div>

      {/* Transaction history */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>📜 Token History</h2>
        {loadingTx ? (
          <p style={s.muted}>Loading...</p>
        ) : txns.length === 0 ? (
          <p style={s.muted}>No transactions yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {txns.map(tx => (
              <div key={tx.id} style={s.txRow}>
                <span style={{ ...s.txAmt, color: tx.amount >= 0 ? '#66bb6a' : '#ef5350' }}>
                  {tx.amount >= 0 ? '+' : ''}{tx.amount}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#ccc', fontSize: 13, textTransform: 'capitalize' }}>{tx.reason.replace(/_/g, ' ')}</div>
                  {tx.events?.name && <div style={{ color: '#666', fontSize: 11 }}>{tx.events.name}</div>}
                </div>
                <div style={{ color: '#666', fontSize: 12, whiteSpace: 'nowrap' }}>
                  {new Date(tx.created_at).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const s = {
  page:        { maxWidth: 860, margin: '0 auto', padding: '28px 16px', fontFamily: 'sans-serif', minHeight: '100vh', background: '#0d0d1a', color: '#eee' },
  header:      { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32, flexWrap: 'wrap', gap: 12 },
  greeting:    { color: '#888', fontSize: 13, marginBottom: 2 },
  name:        { margin: '0 0 4px', fontSize: 24, color: '#fff', fontWeight: 700 },
  roleBadge:   { display: 'inline-block', background: '#6a1b9a', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 3, textTransform: 'uppercase', letterSpacing: '0.05em' },
  navBtn:      { background: '#1e1e2e', border: '1px solid #333', color: '#ccc', padding: '6px 12px', borderRadius: 5, fontSize: 13, textDecoration: 'none' },
  signOutBtn:  { background: 'transparent', border: '1px solid #333', color: '#888', padding: '6px 12px', borderRadius: 5, fontSize: 13, cursor: 'pointer' },
  section:     { marginBottom: 32 },
  sectionTitle:{ margin: '0 0 12px', fontSize: 15, color: '#ddd', fontWeight: 600 },
  muted:       { color: '#666', fontSize: 13 },
  tokenGrid:   { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 },
  tokenCard:   { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '14px 16px' },
  tokenLabel:  { color: '#888', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 },
  tokenAmount: { fontSize: 28, fontWeight: 700, color: '#fff', lineHeight: 1 },
  tokenSub:    { color: '#555', fontSize: 11, marginTop: 4 },
  placeholder: { background: '#1a1a1a', border: '1px dashed #2a2a2a', borderRadius: 8, padding: '2rem', textAlign: 'center' },
  txRow:       { display: 'flex', alignItems: 'center', gap: 12, background: '#1a1a1a', border: '1px solid #222', borderRadius: 6, padding: '8px 14px' },
  txAmt:       { fontSize: 16, fontWeight: 700, minWidth: 50, textAlign: 'right' },
}
