import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import Navbar from '../../components/Navbar'
import { sortStandings, generatePlayoffBracket } from '../../lib/scoring'

export default function EventDetailPage() {
  const { id } = useParams()
  const { profile } = useAuth()
  const [event, setEvent] = useState(null)
  const [divisions, setDivisions] = useState([])
  const [teams, setTeams] = useState([])
  const [categories, setCategories] = useState([])
  const [standings, setStandings] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => { fetchAll() }, [id])

  async function fetchAll() {
    const [{ data: ev }, { data: divs }, { data: teamsData }, { data: cats }, { data: stands }] = await Promise.all([
      supabase.from('events').select('*').eq('id', id).single(),
      supabase.from('divisions').select('*').eq('event_id', id).order('division_number'),
      supabase.from('teams').select('*').eq('event_id', id).order('team_number'),
      supabase.from('categories').select('*').eq('event_id', id).order('display_order'),
      supabase.from('standings').select('*').eq('event_id', id)
    ])
    setEvent(ev)
    setDivisions(divs || [])
    setTeams(teamsData || [])
    setCategories(cats || [])
    setStandings(stands || [])
    setLoading(false)
  }

  async function updateStatus(status) {
    setSaving(true)
    await supabase.from('events').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    setEvent(prev => ({ ...prev, status }))
    setSaving(false)
    setMessage({ type: 'success', text: `Event status updated to ${status}` })
  }

  async function generateBracket() {
    setSaving(true)
    try {
      // Sort all teams by standings
      const enrichedStandings = standings.map(s => ({
        ...s,
        id: teams.find(t => t.id === s.team_id)?.id
      })).filter(s => s.id)

      const sorted = sortStandings(enrichedStandings)
      const bracketMatches = generatePlayoffBracket(sorted, event.id)

      // Delete existing bracket if any
      await supabase.from('playoff_bracket').delete().eq('event_id', event.id)

      // Insert new bracket
      const { error } = await supabase.from('playoff_bracket').insert(bracketMatches)
      if (error) throw error

      setMessage({ type: 'success', text: 'Playoff bracket generated successfully!' })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    }
    setSaving(false)
  }

  const isOwner = profile?.role === 'event_runner' && event?.created_by === profile?.id

  if (loading) return <><Navbar /><div className="loading-screen"><div className="spinner" /></div></>
  if (!event) return <><Navbar /><div className="page-container"><div className="page-content"><div className="empty-state"><h3>Event not found</h3></div></div></div></>

  return (
    <>
      <Navbar />
      <div className="page-container">
        <div className="page-header">
          <div className="page-header-meta">Admin → Events</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <h1>{event.name}</h1>
            <span className={`badge badge-${event.status}`}>{event.status}</span>
          </div>
          <div className="page-header-actions">
            <Link to={`/admin/event/${id}/score`} className="btn btn-primary">Enter Scores</Link>
            <a href={`/event/${event.slug}/standings`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
              Public View ↗
            </a>
            {isOwner && (
              <Link to={`/admin/event/${id}/scorers`} className="btn btn-secondary">Manage Scorers</Link>
            )}
          </div>
        </div>

        <div className="page-content">
          {message && (
            <div className={`alert alert-${message.type}`} style={{ marginBottom: '1.5rem' }}>
              {message.text}
            </div>
          )}

          <div className="tab-bar">
            {['overview', 'teams', 'categories', 'settings'].map(tab => (
              <button key={tab} className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
                onClick={() => setActiveTab(tab)}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Overview */}
          {activeTab === 'overview' && (
            <div>
              <div className="stats-row">
                <div className="stat-card">
                  <div className="stat-label">Divisions</div>
                  <div className="stat-value">{divisions.length}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Total Teams</div>
                  <div className="stat-value">{teams.length}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Categories</div>
                  <div className="stat-value">{categories.length}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Status</div>
                  <div className="stat-value" style={{ fontSize: '1.1rem' }}>{event.status}</div>
                </div>
              </div>

              {isOwner && (
                <div className="card" style={{ marginTop: '1.5rem' }}>
                  <div className="card-title">Event Controls</div>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    {event.status === 'setup' && (
                      <button className="btn btn-primary" disabled={saving} onClick={() => updateStatus('active')}>
                        Activate Event
                      </button>
                    )}
                    {event.status === 'active' && (
                      <button className="btn btn-primary" disabled={saving} onClick={() => updateStatus('playoffs')}>
                        Move to Playoffs
                      </button>
                    )}
                    {event.status === 'playoffs' && (
                      <>
                        <button className="btn btn-primary" disabled={saving} onClick={generateBracket}>
                          {saving ? 'Generating...' : 'Generate Playoff Bracket'}
                        </button>
                        <button className="btn btn-secondary" disabled={saving} onClick={() => updateStatus('completed')}>
                          Mark Complete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Teams */}
          {activeTab === 'teams' && (
            <div>
              {divisions.map(div => {
                const divTeams = teams.filter(t => t.division_id === div.id).sort((a, b) => a.team_number - b.team_number)
                return (
                  <div key={div.id} style={{ marginBottom: '1.5rem' }}>
                    <h3 style={{ fontSize: '0.875rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent-gold)', marginBottom: '0.75rem' }}>
                      {div.name}
                    </h3>
                    <div className="card" style={{ padding: 0 }}>
                      <div className="table-container">
                        <table>
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Team Name</th>
                              <th>Display Name</th>
                            </tr>
                          </thead>
                          <tbody>
                            {divTeams.map(team => (
                              <tr key={team.id}>
                                <td className="mono">{team.team_number}</td>
                                <td>{team.name}</td>
                                <td style={{ color: 'var(--text-muted)' }}>{team.display_name}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Categories */}
          {activeTab === 'categories' && (
            <div className="card">
              <div className="card-title">Encounter Categories</div>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Points per Encounter</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map(cat => (
                      <tr key={cat.id}>
                        <td style={{ fontWeight: 600 }}>{cat.name}</td>
                        <td className="mono">{cat.multiplier}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Settings */}
          {activeTab === 'settings' && isOwner && (
            <div className="card">
              <div className="card-title">Danger Zone</div>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                Status changes affect the public scoreboard immediately.
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {['setup', 'active', 'playoffs', 'completed'].map(s => (
                  <button key={s} className={`btn ${event.status === s ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                    disabled={saving || event.status === s}
                    onClick={() => updateStatus(s)}>
                    Set: {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
