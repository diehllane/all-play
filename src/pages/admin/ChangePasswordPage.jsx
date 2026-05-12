import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import Navbar from '../../components/Navbar'

export default function ChangePasswordPage() {
  const { profile } = useAuth()
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setMessage(null)

    if (newPassword.length < 6) {
      setMessage({ type: 'error', text: 'Password must be at least 6 characters.' })
      return
    }
    if (newPassword !== confirm) {
      setMessage({ type: 'error', text: 'Passwords do not match.' })
      return
    }

    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) {
      setMessage({ type: 'error', text: error.message })
    } else {
      setMessage({ type: 'success', text: 'Password updated successfully.' })
      setNewPassword('')
      setConfirm('')
    }
    setSaving(false)
  }

  return (
    <>
      <Navbar />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'calc(100vh - 64px)' }}>
        <div style={{ width: '100%', maxWidth: '420px', padding: '0 1.5rem' }}>
          <div className="card">
            <div style={{ marginBottom: '1.5rem' }}>
              <h1 style={{ fontSize: '1.4rem', fontWeight: 900, marginBottom: '0.25rem' }}>Change Password</h1>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>{profile?.email}</p>
            </div>

            {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">New Password</label>
                <input
                  type="password"
                  className="form-input"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  minLength={6}
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">Confirm Password</label>
                <input
                  type="password"
                  className="form-input"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat new password"
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={saving} style={{ width: '100%', justifyContent: 'center' }}>
                {saving ? 'Updating...' : 'Update Password'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  )
}
