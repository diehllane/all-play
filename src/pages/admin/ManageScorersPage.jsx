import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import Navbar from '../../components/Navbar'

export default function ManageScorersPage() {
  const { id } = useParams()
  const { profile } = useAuth()
  const [event, setEvent] = useState(null)
  const [scorers, setScorers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  // New scorer form
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')

  useEffect(() => { fetchAll() }, [id])

  async function fetchAll() {
    const { data: ev } = await supabase.from('events').select('*').eq('id', id).single()
    setEvent(ev)

    // Get all scorers assigned to this event
    const { data: assignments } = await supabase
      .from('user_event_assignments')
      .select('*, profiles(*)')
      .eq('event_id', id)
    setScorers(assignments?.map(a => a.profiles).filter(Boolean) || [])
    setLoading(false)
  }

  async function createScorer(e) {
    e.preventDefault()
    setSaving(true)
    setMessage(null)

    try {
      // Create user via Supabase admin (requires service role - using anon will fail for prod)
      // For a real deployment, this should call a Supabase Edge Function with service role key
      // For now we'll sign up and immediately handle the profile
      const { data, error } = await supabase.auth.signUp({
        email: newEmail,
        password: newPassword,
        options: {
          data: { role: 'scorer' }
        }
      })

      if (error) throw error
      if (!data.user) throw new Error('User creation failed')

      // Wait briefly then create assignment
      // In prod: use an Edge Function to handle this atomically
      setTimeout(async () => {
        await supabase.from('user_event_assignments').insert({
          user_id: data.user.id,
          event_id: id
        })
        await fetchAll()
      }, 1000)

      setNewEmail('')
      setNewPassword('')
      setMessage({ type: 'success', text: `Scorer account created for ${newEmail}. They will need to confirm their email before logging in.` })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    }
    setSaving(false)
  }

  async function removeScorer(scorerId) {
    await supabase.from('user_event_assignments')
      .delete()
      .eq('user_id', scorerId)
      .eq('event_id', id)
    setScorers(prev => prev.filter(s => s.id !== scorerId))
    setMessage({ type: 'info', text: 'Scorer removed from this event.' })
  }

  if (loading) return <><Navbar /><div className="loading-screen"><div className="spinner" /></div></>

  return (
    <>
      <Navbar />
      <div className="page-container">
        <div className="page-header">
          <div className="page-header-meta">{event?.name} → Scorers</div>
          <h1>Manage Scorers</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Scorer accounts can enter scores for any team in this event.
          </p>
        </div>

        <div className="page-content" style={{ maxWidth: 700 }}>
          {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}

          {/* Current scorers */}
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <div className="card-title">Assigned Scorers ({scorers.length})</div>
            {scorers.length === 0 ? (
              <div className="empty-state" style={{ padding: '1.5rem' }}>
                <p>No scorers assigned yet. Create scorer accounts below.</p>
              </div>
            ) : (
              scorers.map(scorer => (
                <div key={scorer.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 0', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{scorer.email}</div>
                    <span className="badge badge-setup" style={{ marginTop: '0.25rem' }}>scorer</span>
                  </div>
                  <button className="btn btn-danger btn-sm" onClick={() => removeScorer(scorer.id)}>
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Create new scorer */}
          <div className="card">
            <div className="card-title">Create Scorer Account</div>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
              This creates a new login that can enter scores for any team in this event, but cannot create new events.
            </p>

            <form onSubmit={createScorer}>
              <div className="form-group">
                <label className="form-label">Scorer Email</label>
                <input type="email" className="form-input" value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  placeholder="scorer@example.com" required />
              </div>
              <div className="form-group">
                <label className="form-label">Temporary Password</label>
                <input type="password" className="form-input" value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Minimum 6 characters" minLength={6} required />
              </div>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Creating...' : 'Create Scorer Account'}
              </button>
            </form>

            <div className="alert alert-info" style={{ marginTop: '1rem' }}>
              <strong>Note:</strong> In production, scorer creation should be handled via a Supabase Edge Function
              with a service role key to avoid email confirmation requirements. See deployment docs.
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
