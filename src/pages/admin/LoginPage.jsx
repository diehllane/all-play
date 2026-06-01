// src/pages/admin/LoginPage.jsx
// Supports both email login (staff) and username login (players).
// Players are created with a synthetic internal email; this page
// auto-detects which format to use based on whether the input contains '@'.

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

// Must match the transform in the Edge Function create-account/index.ts
function usernameToEmail(username) {
  return `${username.toLowerCase().replace(/[^a-z0-9]/g, '_')}@pokenexus.internal`
}

export default function LoginPage() {
  const { user, profile, signIn } = useAuth()
  const navigate = useNavigate()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (user && profile) {
      // Route players to their dashboard, everyone else to admin
      navigate(profile.role === 'player' ? '/player' : '/admin')
    }
  }, [user, profile])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    // If input contains '@' treat as email, otherwise convert username → synthetic email
    const email = identifier.includes('@') ? identifier : usernameToEmail(identifier)
    const { error } = await signIn(email, password)
    if (error) setError(error.message)
    setLoading(false)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 64px)' }}>
      <div style={{ width: '100%', maxWidth: '400px', padding: '0 1.5rem' }}>
        <div className="card">
          <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚡</div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 900, marginBottom: '0.25rem' }}>Sign In</h1>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>PokeNexus Events Portal</p>
          </div>
          {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Username or Email</label>
              <input
                type="text"
                className="form-input"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                placeholder="username or email@example.com"
                required
                autoFocus
                autoComplete="username"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                type="password"
                className="form-input"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary btn-lg"
              disabled={loading}
              style={{ width: '100%', justifyContent: 'center', marginTop: '0.5rem' }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
          <p style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Players: sign in with your PokeNexus username.
          </p>
        </div>
      </div>
    </div>
  )
}
