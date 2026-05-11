import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import Navbar from '../../components/Navbar'

export default function HomePage() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchEvents() {
      const { data } = await supabase
        .from('events')
        .select('*')
        .order('created_at', { ascending: false })
      setEvents(data || [])
      setLoading(false)
    }
    fetchEvents()
  }, [])

  return (
    <>
      <Navbar />
      <div className="page-container">
        <div className="page-header">
          <div className="page-header-meta">PokeNexus Event System</div>
          <h1>Active Events</h1>
          <p>Select an event to view standings, schedule, and bracket.</p>
        </div>

        <div className="page-content">
          {loading ? (
            <div className="loading-inline">
              <div className="spinner" /> Loading events...
            </div>
          ) : events.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🏆</div>
              <h3>No Events Yet</h3>
              <p>Events will appear here once created by an event runner.</p>
            </div>
          ) : (
            <div className="grid-2">
              {events.map(event => (
                <Link
                  key={event.id}
                  to={`/event/${event.slug}/standings`}
                  style={{ textDecoration: 'none' }}
                >
                  <div className="card" style={{ cursor: 'pointer', transition: 'all 0.2s' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-gold)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                      <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{event.name}</h3>
                      <span className={`badge badge-${event.status}`}>{event.status}</span>
                    </div>
                    <div style={{ fontSize: '0.825rem', color: 'var(--text-muted)', display: 'flex', gap: '1.5rem' }}>
                      <span>{event.division_count} Division{event.division_count !== 1 ? 's' : ''}</span>
                      <span>View Standings →</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
