import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import Navbar from '../../components/Navbar'

export default function AdminDashboard() {
  const { profile } = useAuth()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchEvents() }, [profile])

  async function fetchEvents() {
    if (!profile) return
    let query = supabase.from('events').select('*')

    if (profile.role === 'event_runner') {
      query = query.eq('created_by', profile.id)
    } else if (profile.role === 'scorer') {
      const { data: assignments } = await supabase
        .from('user_event_assignments')
        .select('event_id')
        .eq('user_id', profile.id)
      const eventIds = assignments?.map(a => a.event_id) || []
      if (eventIds.length === 0) { setLoading(false); return }
      query = query.in('id', eventIds)
    }

    const { data } = await query.order('created_at', { ascending: false })
    setEvents(data || [])
    setLoading(false)
  }

  return (
    <>
      <Navbar />
      <div className="page-container">
        <div className="page-header">
          <div className="page-header-meta">Admin</div>
          <h1>Dashboard</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Signed in as <strong>{profile?.email}</strong>
            <span style={{ marginLeft: '0.5rem' }} className={`badge badge-${profile?.role === 'event_runner' ? 'active' : 'setup'}`}>
              {profile?.role?.replace('_', ' ')}
            </span>
          </p>
          {profile?.role === 'event_runner' && (
            <div className="page-header-actions">
              <Link to="/admin/events/create" className="btn btn-primary">+ Create Event</Link>
            </div>
          )}
        </div>

        <div className="page-content">
          <h2 style={{ fontSize: '0.875rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            {profile?.role === 'scorer' ? 'My Assigned Events' : 'My Events'}
          </h2>

          {loading ? (
            <div className="loading-inline"><div className="spinner" /> Loading...</div>
          ) : events.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📋</div>
              <h3>No Events Found</h3>
              <p>{profile?.role === 'event_runner' ? 'Create your first event to get started.' : 'You have not been assigned to any events yet.'}</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {events.map(event => {
                const isBoardGame = event.event_type === 'board_game'
                return (
                  <div key={event.id} className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                        <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>{event.name}</h3>
                        <span className={`badge badge-${event.status}`}>{event.status}</span>
                        <span style={{
                          fontSize: '0.7rem', padding: '2px 7px', borderRadius: 8, fontWeight: 600,
                          background: isBoardGame ? '#1a3a5c' : '#1a3a1a',
                          color: isBoardGame ? '#90caf9' : '#81c784',
                          textTransform: 'uppercase', letterSpacing: 0.5
                        }}>
                          {isBoardGame ? 'Board Game' : 'All-Play'}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {isBoardGame ? (
                        <>
                          <Link to={`/admin/board/${event.id}/scores`} className="btn btn-primary btn-sm">
                            Enter Scores
                          </Link>
                          {profile?.role === 'event_runner' && (
                            <Link to={`/admin/board/${event.id}`} className="btn btn-secondary btn-sm">
                              Manage Event
                            </Link>
                          )}
                          <Link to={`/board/${event.id}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                            View Board ↗
                          </Link>
                        </>
                      ) : (
                        <>
                          <Link to={`/admin/events/${event.id}/scores`} className="btn btn-primary btn-sm">
                            Enter Scores
                          </Link>
                          {profile?.role === 'event_runner' && (
                            <>
                              <Link to={`/admin/events/${event.id}`} className="btn btn-secondary btn-sm">
                                Manage Event
                              </Link>
                              <Link to={`/admin/events/${event.id}/scorers`} className="btn btn-secondary btn-sm">
                                Manage Scorers
                              </Link>
                            </>
                          )}
                          <Link to={`/events/${event.slug}/standings`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                            View Public ↗
                          </Link>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
